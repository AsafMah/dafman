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
import { rpcGuard } from "./app/errors";
import { getLogDir as currentLogDir, initLogger, log } from "./app/logging";
import { toModelSummary } from "./app/models";
import { SessionRegistry } from "./app/sessions";
import { SettingsService } from "./app/settings";
import { tryGetClient } from "./app/client";
import type { DafmanRPC, SessionEventPayload } from "./rpc";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

await initLogger({ logDir: Utils.paths.userLogs });

const settingsPath = join(Utils.paths.userData, "settings.json");
const settings = SettingsService.loadOrDefault(settingsPath);

// `emitEvent` is rebound once the BrowserWindow's webview RPC is up.
// Until then we buffer events (in practice none should fire before the
// window is ready, but the indirection keeps the registry decoupled).
let emitEvent: (payload: SessionEventPayload) => void = (payload) => {
	log.debug("dropped session event before webview ready", {
		sessionId: payload.sessionId,
		eventType: payload.eventType,
	});
};
const sessions = new SessionRegistry((payload) => emitEvent(payload));

const rpc = BrowserView.defineRPC<DafmanRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {
			createClient: rpcGuard(async () => {
				await ensureClient();
				return "Copilot client created";
			}),
			createSession: rpcGuard(async () => sessions.create()),
			disconnectSession: rpcGuard(async ({ sessionId }) =>
				sessions.disconnect(sessionId),
			),
			sendMessage: rpcGuard(async ({ sessionId, text }) =>
				sessions.send(sessionId, text),
			),
			listModels: rpcGuard(async () => {
				const client = tryGetClient();
				const models = await client.listModels();
				return models.map(toModelSummary);
			}),
			setSessionModel: rpcGuard(async ({ sessionId, model, reasoningEffort }) =>
				sessions.setModel(sessionId, model, reasoningEffort),
			),
			resumeSession: rpcGuard(async ({ sessionId, model, reasoningEffort }) =>
				sessions.resume(sessionId, {
					...(model ? { model } : {}),
					...(reasoningEffort ? { reasoningEffort } : {}),
				}),
			),
			listSessions: rpcGuard(async () => sessions.list()),
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
			compactSessionHistory: rpcGuard(async ({ sessionId }) =>
				sessions.compactHistory(sessionId),
			),
			setSessionApproveAll: rpcGuard(async ({ sessionId, enabled }) =>
				sessions.setApproveAll(sessionId, enabled),
			),
			resetSessionApprovals: rpcGuard(async ({ sessionId }) =>
				sessions.resetApprovals(sessionId),
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

log.info("dafman started", { version: "0.1.0" });

process.on("SIGINT", async () => {
	log.info("SIGINT received, shutting down");
	await sessions.shutdownAll();
	await shutdownClient();
	process.exit(0);
});
