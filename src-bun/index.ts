/// <reference types="@types/bun" />

// Dafman main process — Electrobun entry.
//
// Wires up the BrowserWindow, all RPC handlers (one per former Tauri
// command), and the session-event forwarder. This is the only Bun-side
// module allowed to import from `electrobun/bun` for window + RPC
// concerns; everything below `src-bun/app/` stays framework-agnostic so
// it can be `bun test`-ed in isolation.

import { join } from "node:path";
import {
	BrowserView,
	BrowserWindow,
	Updater,
	Utils,
} from "electrobun/bun";
import { ensureClient, shutdownClient } from "./app/client";
import { browseDirectorySync } from "./app/directoryBrowser";
import { rpcGuard } from "./app/errors";
import {
	getLogDir as currentLogDir,
	getLogLevel,
	initLogger,
	log,
	recentLogs,
	setLogLevel,
	subscribeLogs,
} from "./app/logging";
import { exportDiagnostics } from "./app/diagnostics";
import { saveExportFile } from "./app/exports";
import { initAudit, recentAudit, recordUrl, subscribeAudit } from "./app/audit";
import type { AuditEntry } from "./app/audit";
import { toModelSummary } from "./app/models";
import { SessionRegistry } from "./app/sessions";
import { SettingsService, ensureDefaultWorkspace } from "./app/settings";
import { installStderrFilter } from "./app/stderrFilter";
import { tryGetClient } from "./app/client";
import type { DafmanRPC, LogRecord, SessionEventPayload } from "./rpc";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

await initLogger({ logDir: Utils.paths.userLogs });
await initAudit({ dir: join(Utils.paths.userData, "audit") });

// Install the stderr filter *after* the logger is up (so dropped lines
// are routed to the JSON log) but *before* the SDK starts the CLI
// subprocess and relays its stderr to ours. node-pty on Windows emits a
// harmless multi-line AttachConsole stack trace from inside the CLI;
// filtering it here keeps the terminal clean while preserving the
// trace in the log file for diagnostics.
installStderrFilter();

const settingsPath = join(Utils.paths.userData, "settings.json");
const settings = SettingsService.loadOrDefault(settingsPath);

// One-time backfill: if the user has never set a default workspace,
// auto-resolve to `<homedir>/dafman` (created on demand) and persist.
// Async/fire-and-forget so we don't block startup; the renderer reads
// `settings.workspaces.defaultWorkspace` lazily via `getSettings`.
void (async () => {
	const current = settings.get().workspaces.defaultWorkspace;
	if (current && current.length > 0) return;
	const resolved = await ensureDefaultWorkspace();
	if (!resolved) return;
	const snap = settings.get();
	await settings
		.update({
			...snap,
			workspaces: { ...snap.workspaces, defaultWorkspace: resolved },
		})
		.catch((err) => {
			log.warn("default workspace backfill failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		});
})();

// `emitEvent` is rebound once the BrowserWindow's webview RPC is up.
// Until then we buffer events (in practice none should fire before the
// window is ready, but the indirection keeps the registry decoupled).
let emitEvent: (payload: SessionEventPayload) => void = (payload) => {
	log.debug("dropped session event before webview ready", {
		sessionId: payload.sessionId,
		eventType: payload.eventType,
	});
};
let emitPending: (payload: import("./rpc").PendingRequestPayload) => void = (payload) => {
	log.warn("dropped pending request before webview ready", {
		sessionId: payload.sessionId,
		kind: payload.kind,
		requestId: payload.requestId,
	});
};
const sessions = new SessionRegistry(
	(payload) => emitEvent(payload),
	(payload) => emitPending(payload),
	() => settings.get().appearance.streaming,
);

const rpc = BrowserView.defineRPC<DafmanRPC>({
	maxRequestTime: 120000,
	handlers: {
		requests: {
			createClient: rpcGuard(async () => {
				await ensureClient();
				return "Copilot client created";
			}),
			createSession: rpcGuard(async ({ workingDirectory }) =>
				sessions.create({
					...(workingDirectory ? { workingDirectory } : {}),
				}),
			),
			pickFolder: rpcGuard(async ({ startingFolder }) => {
				const paths = await Utils.openFileDialog({
					canChooseFiles: false,
					canChooseDirectory: true,
					allowsMultipleSelection: false,
					...(startingFolder ? { startingFolder } : {}),
				});
				// `openFileDialog` returns `[""]` on cancel (the FFI
				// hands back an empty comma-separated string). Treat
				// any empty / whitespace-only entry as a cancel.
				const first = paths[0]?.trim();
				return first && first.length > 0 ? first : null;
			}),
			pickAttachment: rpcGuard(async ({ startingFolder }) => {
				// Single-pick, files OR directories. The composer's
				// @-picker exposes this as the "Browse…" escape hatch
				// when fuzzy search isn't fast enough or the file
				// lives outside the workspace cwd.
				const paths = await Utils.openFileDialog({
					canChooseFiles: true,
					canChooseDirectory: true,
					allowsMultipleSelection: false,
					...(startingFolder ? { startingFolder } : {}),
				});
				const first = paths[0]?.trim();
				if (!first) return null;
				try {
					const { stat } = await import("node:fs/promises");
					const st = await stat(first);
					return { path: first, kind: st.isDirectory() ? "directory" : "file" };
				} catch {
					// Path vanished between pick and stat — treat as
					// cancel rather than throwing.
					return null;
				}
			}),
			disconnectSession: rpcGuard(async ({ sessionId }) =>
				sessions.disconnect(sessionId),
			),
			sendMessage: rpcGuard(async ({ sessionId, text, mode, attachments }) =>
				sessions.send(sessionId, text, mode, attachments),
			),
			searchWorkspaceFiles: rpcGuard(async ({ sessionId, query, limit, includeHidden }) =>
				sessions.searchWorkspaceFiles(sessionId, query, limit ?? 40, includeHidden ?? false),
			),
			abortSession: rpcGuard(async ({ sessionId }) =>
				sessions.abort(sessionId),
			),
			listModels: rpcGuard(async () => {
				const client = tryGetClient();
				const models = await client.listModels();
				return models.map(toModelSummary);
			}),
			setSessionModel: rpcGuard(async ({ sessionId, model, reasoningEffort }) =>
				sessions.setModel(sessionId, model, reasoningEffort),
			),
			resumeSession: rpcGuard(async ({ sessionId, model, reasoningEffort }) => {
				const actualId = await sessions.resume(sessionId, {
					...(model ? { model } : {}),
					...(reasoningEffort ? { reasoningEffort } : {}),
				});
				// `getMessages()` history never includes `session.resume`,
				// so the renderer can't learn the cwd from the event
				// stream. Look it up from the session catalog (already in
				// memory CLI-side) and surface it on the RPC response.
				let cwd: string | null = null;
				try {
					const list = await sessions.list();
					const match = list.find((s) => s.sessionId === actualId);
					if (match?.cwd) cwd = match.cwd;
				} catch {
					/* non-fatal — chip will just be hidden until next live event */
				}
				return { sessionId: actualId, cwd };
			}),
			listSessions: rpcGuard(async () => sessions.list()),
			deleteSession: rpcGuard(async ({ sessionId }) =>
				sessions.deleteCliSession(sessionId),
			),
			getSessionMode: rpcGuard(async ({ sessionId }) =>
				sessions.getMode(sessionId),
			),
			setSessionMode: rpcGuard(async ({ sessionId, mode }) =>
				sessions.setMode(sessionId, mode),
			),
			getSessionName: rpcGuard(async ({ sessionId }) =>
				sessions.getName(sessionId),
			),
			setSessionName: rpcGuard(async ({ sessionId, name }) =>
				sessions.setName(sessionId, name),
			),
			setSessionWorkingDirectory: rpcGuard(
				async ({ sessionId, workingDirectory, baseWorkingDirectory }) =>
					sessions.setWorkingDirectory(
						sessionId,
						workingDirectory,
						baseWorkingDirectory,
					),
			),
			compactSessionHistory: rpcGuard(async ({ sessionId }) =>
				sessions.compactHistory(sessionId),
			),
			truncateSessionHistory: rpcGuard(async ({ sessionId, eventId }) =>
				sessions.truncateHistory(sessionId, eventId),
			),
			forkSession: rpcGuard(async ({ sessionId, toEventId }) =>
				sessions.fork(sessionId, toEventId),
			),
			setSessionApproveAll: rpcGuard(async ({ sessionId, enabled }) =>
				sessions.setApproveAll(sessionId, enabled),
			),
			resetSessionApprovals: rpcGuard(async ({ sessionId }) =>
				sessions.resetApprovals(sessionId),
			),
			listSessionSkills: rpcGuard(async ({ sessionId }) =>
				sessions.listSkills(sessionId),
			),
			setSessionSkillEnabled: rpcGuard(async ({ sessionId, name, enabled }) =>
				sessions.setSkillEnabled(sessionId, name, enabled),
			),
			getSessionUsageMetrics: rpcGuard(async ({ sessionId }) =>
				sessions.getUsageMetrics(sessionId),
			),
			getSettings: rpcGuard(async () => settings.get()),
			updateSettings: rpcGuard(async ({ next }) => settings.update(next)),
			getLogDir: rpcGuard(async () => currentLogDir()),
			openLogFolder: rpcGuard(async () => {
				const dir = currentLogDir();
				if (!dir) return false;
				Utils.showItemInFolder(dir);
				return true;
			}),
			revealPath: rpcGuard(async ({ path }) => {
				const trimmed = path.trim();
				if (!trimmed) return false;
				try {
					Utils.showItemInFolder(trimmed);
					return true;
				} catch (err) {
					log.warn("revealPath failed", {
						path: trimmed,
						error: err instanceof Error ? err.message : String(err),
					});
					return false;
				}
			}),
			openUrl: rpcGuard(async ({ url }) => {
				const trimmed = url.trim();
				// Strict scheme allowlist. The handler is reachable by the
				// renderer + any compromised renderer should not be able to
				// shell out to arbitrary URI handlers (file:, javascript:,
				// custom protocol handlers like ms-windows-store:, etc.).
				if (!/^https?:\/\//i.test(trimmed)) {
					log.warn("openUrl rejected non-http scheme", { url: trimmed });
					recordUrl({ url: trimmed, allowed: false, reason: "scheme-blocked" });
					return false;
				}
				try {
					const opened = Utils.openExternal(trimmed);
					recordUrl({
						url: trimmed,
						allowed: opened !== false,
						reason: opened !== false ? "ok" : "openExternal-returned-false",
					});
					return opened;
				} catch (err) {
					log.warn("openUrl threw", {
						url: trimmed,
						error: err instanceof Error ? err.message : String(err),
					});
					recordUrl({
						url: trimmed,
						allowed: false,
						reason: `openExternal-threw: ${err instanceof Error ? err.message : String(err)}`,
					});
					return false;
				}
			}),
			respondToRequest: rpcGuard(async (params) =>
				sessions.respondToRequest(params),
			),
			browseDirectory: rpcGuard(async ({ prefix }) =>
				browseDirectorySync(prefix),
			),
			rendererLog: rpcGuard(async ({ level, message, extra }) => {
				// Mirror the renderer's structured log into the bun-side
				// JSON log so a developer can `tail` it instead of needing
				// WebView2 devtools open. Prefix lets us distinguish from
				// bun-originated entries.
				const tagged = `[renderer] ${message}`;
				const data = extra ?? {};
				switch (level) {
					case "debug":
						log.debug(tagged, data);
						break;
					case "info":
						log.info(tagged, data);
						break;
					case "warn":
						log.warn(tagged, data);
						break;
					case "error":
						log.error(tagged, data);
						break;
				}
			}),
			getLogState: rpcGuard(async ({ recentLimit }) => ({
				level: getLogLevel(),
				recent: recentLogs(recentLimit),
			})),
			setLogLevel: rpcGuard(async ({ level }) => setLogLevel(level)),
			exportDiagnostics: rpcGuard(async () => {
				return exportDiagnostics({
					outputRoot: Utils.paths.userData,
					settings: settings.get(),
				});
			}),
			saveExportFile: rpcGuard(async ({ fileName, contents }) => {
				return saveExportFile({
					outputRoot: Utils.paths.userData,
					fileName,
					contents,
				});
			}),
			getAuditState: rpcGuard(async ({ recentLimit }) => ({
				recent: recentAudit(recentLimit),
			})),
		},
		messages: {},
	},
}) as unknown as ReturnType<typeof BrowserView.defineRPC<DafmanRPC>>;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	// Allow `DAFMAN_PLAYGROUND=1` (dev only) to land directly on the
	// playground without manual URL editing. Handy when iterating on the
	// composer / Lexical bits without a real Copilot session.
	const playground = channel === "dev" && process.env.DAFMAN_PLAYGROUND === "1";
	// Allow `DAFMAN_AUTO_SESSION=1` (dev only) to land on the main app
	// with a session auto-created on mount. Useful for the typing
	// diagnostic, which needs a mounted MessageComposer to fire.
	const autosession = channel === "dev" && process.env.DAFMAN_AUTO_SESSION === "1";
	const suffix = playground ? "?dev" : autosession ? "?autosession=1" : "";
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			log.info(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);
			return `${DEV_SERVER_URL}/${suffix}`;
		} catch {
			log.info(
				"Vite dev server not running. Run `bun run dev:hmr` for HMR.",
			);
		}
	}
	return `views://mainview/index.html${suffix}`;
}

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "Dafman",
	url,
	rpc,
	frame: { width: 1200, height: 800, x: 100, y: 100 },
});

/// Initial-paint clipping workaround for the Electrobun BrowserWindow on
/// Windows: the WebView2 surface is created at the *outer* window size,
/// so the renderer reports a viewport ~16px wider/taller than the visible
/// client area until the OS sends its first WM_SIZE. Any manual resize
/// fixes it permanently. We force one by nudging the frame by 1px and
/// snapping it back.
///
/// We schedule the nudge multiple times because heavier renderer init
/// (e.g. Lexical mounting many editors) can delay the renderer's first
/// real layout past a single 100ms tick. Each nudge is a cheap pair of
/// `setFrame` calls; once one of them lands after the renderer has
/// painted, the clip is gone.
function nudgeWindow(): void {
	const { x, y, width, height } = mainWindow.getFrame();
	mainWindow.setFrame(x, y, width + 1, height + 1);
	setTimeout(() => {
		mainWindow.setFrame(x, y, width, height);
	}, 16);
}

mainWindow.webview.on("dom-ready", () => {
	for (const delay of [0, 150, 400, 900]) {
		setTimeout(nudgeWindow, delay);
	}
});
// Belt-and-suspenders fallback in case `dom-ready` is missed (HMR reloads,
// dev-server reconnects, etc.). Cheap no-ops if the renderer is already
// laid out.
for (const delay of [200, 600, 1500]) {
	setTimeout(nudgeWindow, delay);
}

emitEvent = (payload) => {
	(mainWindow.webview.rpc as unknown as {
		send: { sessionEvent: (p: SessionEventPayload) => void };
	}).send.sessionEvent(payload);
};
emitPending = (payload) => {
	(mainWindow.webview.rpc as unknown as {
		send: { pendingRequest: (p: import("./rpc").PendingRequestPayload) => void };
	}).send.pendingRequest(payload);
};

// Live log fan-out to the renderer. The in-app log viewer subscribes
// via the `logEvent` webview message and applies its own level filter
// so users can flip verbosity without losing history.
subscribeLogs((record) => {
	(mainWindow.webview.rpc as unknown as {
		send: { logEvent: (p: LogRecord) => void };
	}).send.logEvent(record);
});

// Live audit fan-out — same fire-and-forget pattern as logs.
subscribeAudit((entry) => {
	(mainWindow.webview.rpc as unknown as {
		send: { auditEvent: (p: AuditEntry) => void };
	}).send.auditEvent(entry);
});

log.info("dafman started", { version: "0.1.0" });

process.on("SIGINT", async () => {
	log.info("SIGINT received, shutting down");
	await sessions.shutdownAll();
	await shutdownClient();
	process.exit(0);
});
