/// E2E test server — same RPC surface as src-bun/index.ts but over
/// WebSocket instead of Electrobun's webview FFI.
///
/// Usage:
///   bun src-bun/test-server.ts --port=4810 --workspace=/tmp/wsx [--user-data=/tmp/ud]
///
/// Wire contract identical to the production bridge: requests are
/// `{type:"request", id, name, args}` → replies are
/// `{type:"response", id, result}` or `{type:"error", id, error}`.
/// Server-pushed events are `{type:"message", name, payload}`.
///
/// The fake CopilotClient (`./app/fakeClient.ts`) is injected as the
/// singleton; production index.ts never imports this module so there's
/// zero risk of leaking into a real run.

import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { rpcGuard } from "./app/errors";
import {
	initLogger,
	getLogLevel,
	setLogLevel,
	recentLogs,
	subscribeLogs,
	log,
} from "./app/logging";
import { initAudit, recentAudit, recordUrl, subscribeAudit } from "./app/audit";
import { saveExportFile } from "./app/exports";
import { exportDiagnostics } from "./app/diagnostics";
import { browseDirectorySync } from "./app/directoryBrowser";
import { tryGetClient, setClientForTest } from "./app/client";
import { SessionRegistry } from "./app/sessions";
import { McpRegistry } from "./app/mcpRegistry";
import { SkillsRegistry } from "./app/skillsRegistry";
import { TerminalRegistry } from "./app/terminalRegistry";
import { SettingsService } from "./app/settings";
import { listInstructionSources } from "./app/instructions";
import { toModelSummary } from "./app/models";
import { FakeCopilotClient } from "./app/fakeClient";
import type { AuditEntry } from "./app/audit";
import type {
	LogRecord,
	SessionEventPayload,
	PendingRequestPayload,
	TerminalCreateParams,
} from "./rpc";

interface CliFlags {
	port: number;
	workspace: string;
	userData: string;
	stubPickerPath?: string;
}

function parseFlags(argv: string[]): CliFlags {
	const out: Partial<CliFlags> = {};
	for (const arg of argv) {
		const [k, v] = arg.replace(/^--/, "").split("=");
		if (!k) continue;
		if (k === "port") out.port = Number(v);
		else if (k === "workspace") out.workspace = v;
		else if (k === "user-data") out.userData = v;
		else if (k === "stub-picker") out.stubPickerPath = v;
	}
	if (!out.port) throw new Error("--port=NNN required");
	if (!out.workspace) throw new Error("--workspace=/abs/path required");
	if (!out.userData) {
		out.userData = join(out.workspace, ".dafman-userdata");
	}
	if (out.stubPickerPath === undefined && process.env.DAFMAN_TEST_PICKER_PATH) {
		out.stubPickerPath = process.env.DAFMAN_TEST_PICKER_PATH;
	}
	return out as CliFlags;
}

const flags = parseFlags(process.argv.slice(2));
mkdirSync(flags.userData, { recursive: true });
mkdirSync(flags.workspace, { recursive: true });

const logDir = join(flags.userData, "logs");
mkdirSync(logDir, { recursive: true });
await initLogger({ logDir });
await initAudit({ dir: join(flags.userData, "audit") });

// Inject the fake SDK BEFORE any session work.
const fakeClient = new FakeCopilotClient({
	catalogPath: join(flags.userData, "fake-sessions.json"),
});
setClientForTest(fakeClient);

const settingsPath = join(flags.userData, "settings.json");
const settings = SettingsService.loadOrDefault(settingsPath);

// Hold open sockets so we can broadcast events to all connected
// renderers. Practically there's only ever one Playwright page, but
// the shape mirrors production.
type Sock = { send: (s: string) => void };
const sockets = new Set<Sock>();

function broadcast(name: string, payload: unknown): void {
	const json = JSON.stringify({ type: "message", name, payload });
	for (const s of sockets) {
		try {
			s.send(json);
		} catch {
			/* socket gone; cleanup happens in close handler */
		}
	}
}

const emitEvent = (payload: SessionEventPayload) =>
	broadcast("sessionEvent", payload);
const emitPending = (payload: PendingRequestPayload) =>
	broadcast("pendingRequest", payload);
const emitTerminal = (payload: import("./rpc").TerminalEventPayload) =>
	broadcast("terminalEvent", payload);

const sessions = new SessionRegistry(
	emitEvent,
	emitPending,
	() => settings.get().appearance.streaming,
	() => settings.get().tools.defaultExcluded,
	() => settings.get().tools.defaultAllowed,
);
const mcp = new McpRegistry();
const skills = new SkillsRegistry();
const terminals = new TerminalRegistry(emitTerminal);

subscribeLogs((record: LogRecord) => broadcast("logEvent", record));
subscribeAudit((entry: AuditEntry) => broadcast("auditEvent", entry));

// Reveal-spy state. The test-server's revealPath handler records the
// resolved-isDir + path into spyReveal.calls instead of shelling out
// to OS Explorer. Lets E2E F11 assert the file-vs-folder distinction
// without depending on a real shell.
const spyReveal: { calls: Array<{ isDir: boolean; path: string }> } = {
	calls: [],
};

// Handler table — same signatures as production index.ts, just
// returning plain promises so the ws dispatcher can `await` them.
const handlers: Record<string, (args: unknown) => Promise<unknown>> = {
	createClient: rpcGuard(async () => "ok"),
	createSession: rpcGuard(async (args) => {
		const { workingDirectory } = args as { workingDirectory?: string };
		const cwd = workingDirectory ?? flags.workspace;
		return sessions.create({ workingDirectory: cwd });
	}),
	pickFolder: rpcGuard(async () => flags.stubPickerPath ?? null),
	pickAttachment: rpcGuard(async (args) => {
		const { kind } = args as { kind: "file" | "directory" };
		if (!flags.stubPickerPath) return null;
		// Test mode stubs both modes to the same configured path,
		// reporting back whatever kind the caller asked for. Tests
		// that need kind-specific files just set DAFMAN_TEST_PICKER_PATH
		// to a file vs a directory.
		try {
			const { stat } = await import("node:fs/promises");
			const st = await stat(flags.stubPickerPath);
			const actualKind: "file" | "directory" = st.isDirectory() ? "directory" : "file";
			return { path: flags.stubPickerPath, kind: kind === actualKind ? kind : actualKind };
		} catch {
			return null;
		}
	}),
	disconnectSession: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.disconnect(sessionId);
	}),
	sendMessage: rpcGuard(async (args) => {
		const { sessionId, text, mode, attachments } = args as {
			sessionId: string;
			text: string;
			mode?: "enqueue" | "immediate";
			attachments?: unknown[];
		};
		return sessions.send(
			sessionId,
			text,
			mode,
			attachments as Parameters<typeof sessions.send>[3],
		);
	}),
	searchWorkspaceFiles: rpcGuard(async (args) => {
		const { sessionId, query, limit, includeHidden, includeIgnored } = args as {
			sessionId: string;
			query: string;
			limit?: number;
			includeHidden?: boolean;
			includeIgnored?: boolean;
		};
		return sessions.searchWorkspaceFiles(sessionId, query, limit ?? 40, {
			includeHidden: includeHidden ?? false,
			includeIgnored: includeIgnored ?? false,
		});
	}),
	abortSession: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.abort(sessionId);
	}),
	listModels: rpcGuard(async () => {
		const models = await tryGetClient().listModels();
		return models.map(toModelSummary);
	}),
	setSessionModel: rpcGuard(async (args) => {
		const { sessionId, model, reasoningEffort } = args as {
			sessionId: string;
			model: string;
			reasoningEffort?: string;
		};
		return sessions.setModel(sessionId, model, reasoningEffort);
	}),
	resumeSession: rpcGuard(async (args) => {
		const { sessionId, model, reasoningEffort } = args as {
			sessionId: string;
			model?: string;
			reasoningEffort?: string;
		};
		const actualId = await sessions.resume(sessionId, {
			...(model ? { model } : {}),
			...(reasoningEffort ? { reasoningEffort } : {}),
		});
		const cwd = (await sessions.getCwd(actualId)) ?? null;
		return { sessionId: actualId, cwd };
	}),
	getSettings: rpcGuard(async () => settings.get()),
	updateSettings: rpcGuard(async (args) => {
		const { settings: next } = args as { settings: ReturnType<typeof settings.get> };
		await settings.update(next);
		return settings.get();
	}),
	listSessions: rpcGuard(async () => sessions.list()),
	deleteSession: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.delete(sessionId);
	}),
	getSessionMetadata: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.getMetadata(sessionId);
	}),
	openUrl: rpcGuard(async (args) => {
		const { url } = args as { url: string };
		recordUrl({ url, allowed: false, reason: "stubbed-test-server" });
		return false;
	}),
	revealPath: rpcGuard(async (args) => {
		const { path } = args as { path: string };
		const trimmed = path.trim();
		if (!trimmed) return false;
		// Mirror production isDir-detection but record the decision
		// into spyReveal.calls (used by F11 E2E to assert that
		// file/folder are revealed with the right strategy).
		try {
			const { stat } = await import("node:fs/promises");
			const st = await stat(trimmed);
			spyReveal.calls.push({ isDir: st.isDirectory(), path: trimmed });
			return true;
		} catch {
			spyReveal.calls.push({ isDir: false, path: trimmed });
			return false;
		}
	}),
	respondToRequest: rpcGuard(async (args) => sessions.respondToRequest(args as Parameters<typeof sessions.respondToRequest>[0])),
	browseDirectory: rpcGuard(async (args) => {
		const { prefix } = args as { prefix: string };
		return browseDirectorySync(prefix);
	}),
	rendererLog: rpcGuard(async (args) => {
		const { level, message, extra } = args as {
			level: "debug" | "info" | "warn" | "error";
			message: string;
			extra?: Record<string, unknown>;
		};
		log[level](`[renderer] ${message}`, extra ?? {});
	}),
	getLogState: rpcGuard(async (args) => {
		const { recentLimit } = (args ?? {}) as { recentLimit?: number };
		return { level: getLogLevel(), recent: recentLogs(recentLimit) };
	}),
	setLogLevel: rpcGuard(async (args) => {
		const { level } = args as { level: "debug" | "info" | "warn" | "error" };
		setLogLevel(level);
	}),
	exportDiagnostics: rpcGuard(async () =>
		exportDiagnostics({ outputRoot: flags.userData, settings: settings.get() }),
	),
	saveExportFile: rpcGuard(async (args) => {
		const { fileName, contents } = args as { fileName: string; contents: string };
		return saveExportFile({ outputRoot: flags.userData, fileName, contents });
	}),
	getAuditState: rpcGuard(async (args) => {
		const { recentLimit } = (args ?? {}) as { recentLimit?: number };
		return { recent: recentAudit(recentLimit) };
	}),
	listBuiltinTools: rpcGuard(async () => sessions.listBuiltinTools()),
	listSessionMcpServers: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.listSessionMcpServers(sessionId);
	}),
	setSessionMcpEnabled: rpcGuard(async (args) => {
		const { sessionId, serverName, enabled } = args as {
			sessionId: string;
			serverName: string;
			enabled: boolean;
		};
		return sessions.setSessionMcpEnabled(sessionId, serverName, enabled);
	}),
	getAccountQuota: rpcGuard(async () => sessions.getAccountQuota()),
	listAgents: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.listAgents(sessionId);
	}),
	getCurrentAgent: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.getCurrentAgent(sessionId);
	}),
	selectAgent: rpcGuard(async (args) => {
		const { sessionId, name } = args as { sessionId: string; name: string };
		return sessions.selectAgent(sessionId, name);
	}),
	deselectAgent: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.deselectAgent(sessionId);
	}),
	reloadAgents: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.reloadAgents(sessionId);
	}),
	listTasks: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.listTasks(sessionId);
	}),
	cancelTask: rpcGuard(async (args) => {
		const { sessionId, id } = args as { sessionId: string; id: string };
		return sessions.cancelTask(sessionId, id);
	}),
	removeTask: rpcGuard(async (args) => {
		const { sessionId, id } = args as { sessionId: string; id: string };
		return sessions.removeTask(sessionId, id);
	}),
	promoteTask: rpcGuard(async (args) => {
		const { sessionId, id } = args as { sessionId: string; id: string };
		return sessions.promoteTask(sessionId, id);
	}),
	listJobs: rpcGuard(async () => sessions.listJobs()),
	listAgentFiles: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.listAgentFiles(sessionId);
	}),
	listAgentFilesGlobal: rpcGuard(async () => sessions.listAgentFilesGlobal()),
	writeAgentFile: rpcGuard(async (args) => {
		const { sessionId, spec } = args as {
			sessionId: string;
			spec: Parameters<typeof sessions.writeAgentFile>[1];
		};
		return sessions.writeAgentFile(sessionId, spec);
	}),
	deleteAgentFile: rpcGuard(async (args) => {
		const { sessionId, scope, name } = args as {
			sessionId: string;
			scope: "user" | "project";
			name: string;
		};
		return sessions.deleteAgentFile(sessionId, scope, name);
	}),
	startFleet: rpcGuard(async (args) => {
		const { sessionId, prompt } = args as { sessionId: string; prompt?: string };
		return sessions.startFleet(sessionId, prompt);
	}),
	readSessionPlan: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.readPlan(sessionId);
	}),
	writeSessionPlan: rpcGuard(async (args) => {
		const { sessionId, content } = args as { sessionId: string; content: string };
		return sessions.writePlan(sessionId, content);
	}),
	deleteSessionPlan: rpcGuard(async (args) => {
		const { sessionId } = args as { sessionId: string };
		return sessions.deletePlan(sessionId);
	}),
	listMcpConfigs: rpcGuard(async () => mcp.listConfigs()),
	addMcpConfig: rpcGuard(async (args) => {
		const { name, config } = args as { name: string; config: Record<string, unknown> };
		return mcp.addConfig(name, config);
	}),
	updateMcpConfig: rpcGuard(async (args) => {
		const { name, config } = args as { name: string; config: Record<string, unknown> };
		return mcp.updateConfig(name, config);
	}),
	removeMcpConfig: rpcGuard(async (args) => {
		const { name } = args as { name: string };
		return mcp.removeConfig(name);
	}),
	enableMcpServers: rpcGuard(async (args) => {
		const { names } = args as { names: string[] };
		return mcp.enable(names);
	}),
	disableMcpServers: rpcGuard(async (args) => {
		const { names } = args as { names: string[] };
		return mcp.disable(names);
	}),
	discoverMcpServers: rpcGuard(async (args) => {
		const { workingDirectory } = (args ?? {}) as { workingDirectory?: string };
		return mcp.discover(workingDirectory);
	}),
	loginToMcpServer: rpcGuard(async (args) => {
		const { sessionId, serverName, forceReauth, clientName } = args as {
			sessionId: string;
			serverName: string;
			forceReauth?: boolean;
			clientName?: string;
		};
		return sessions.loginToMcpServer(sessionId, serverName, {
			...(forceReauth !== undefined ? { forceReauth } : {}),
			...(clientName !== undefined ? { clientName } : {}),
		});
	}),
	discoverSkills: rpcGuard(async (args) => {
		const { workingDirectory } = (args ?? {}) as { workingDirectory?: string };
		return skills.discover(workingDirectory);
	}),
	setGloballyDisabledSkills: rpcGuard(async (args) => {
		const { disabledSkills } = args as { disabledSkills: string[] };
		return skills.setGloballyDisabled(disabledSkills);
	}),
	listInstructionSources: rpcGuard(async (args) => {
		const { workingDirectory } = (args ?? {}) as { workingDirectory?: string };
		return listInstructionSources({ workingDirectory });
	}),
	createTerminal: rpcGuard(async (args) =>
		terminals.create(args as TerminalCreateParams),
	),
	writeTerminal: rpcGuard(async (args) => {
		const { terminalId, data } = args as { terminalId: string; data: string };
		return terminals.write(terminalId, data);
	}),
	resizeTerminal: rpcGuard(async (args) => {
		const { terminalId, cols, rows } = args as {
			terminalId: string;
			cols: number;
			rows: number;
		};
		return terminals.resize(terminalId, cols, rows);
	}),
	killTerminal: rpcGuard(async (args) => {
		const { terminalId } = args as { terminalId: string };
		return terminals.kill(terminalId);
	}),
	listTerminals: rpcGuard(async () => terminals.list()),
};

// Test-server-only control RPCs. Test code uses these to drive the
// fake SDK from outside the renderer (e.g. push a permission
// request, swap the send script).
const controlHandlers: Record<string, (args: unknown) => Promise<unknown>> = {
	"__test.setSendScript": async (args) => {
		const { script } = args as { script: string };
		const fn = new Function("sendArgs", "push", "state", script);
		fakeClient.setSendScript(async (sendArgs, push, state) => {
			await fn(sendArgs, push, state);
		});
		return "ok";
	},
	"__test.resetSendScript": async () => {
		fakeClient.resetSendScript();
		return "ok";
	},
	"__test.triggerPermission": async (args) => {
		const { sessionId, request } = args as { sessionId: string; request: unknown };
		return fakeClient.triggerPermission(sessionId, request);
	},
	"__test.recordAudit": async (args) => {
		const { entry } = args as {
			entry:
				| (Omit<import("./app/audit").PermissionAuditEntry, "ts" | "kind"> & { kind: "permission" })
				| (Omit<import("./app/audit").UrlAuditEntry, "ts" | "kind"> & { kind: "url" });
		};
		const { recordPermission, recordUrl } = await import("./app/audit");
		if (entry.kind === "permission") {
			const { kind: _kind, ...rest } = entry;
			await recordPermission(rest);
		} else {
			const { kind: _kind, ...rest } = entry;
			await recordUrl(rest);
		}
		return "ok";
	},
	"__test.resetRevealSpy": async () => {
		spyReveal.calls = [];
		return "ok";
	},
	"__test.getRevealSpy": async () => spyReveal.calls,
	"__test.ready": async () => "ok",
};

const server = Bun.serve({
	port: flags.port,
	fetch(req, srv) {
		if (srv.upgrade(req)) return;
		return new Response("dafman test-server", { status: 200 });
	},
	websocket: {
		open(ws) {
			sockets.add(ws as unknown as Sock);
			log.info("test-server: ws client connected");
		},
		close(ws) {
			sockets.delete(ws as unknown as Sock);
			log.info("test-server: ws client disconnected");
		},
		async message(ws, raw) {
			let msg: { type: string; id?: number; name?: string; args?: unknown };
			try {
				msg = JSON.parse(String(raw));
			} catch {
				return;
			}
			if (msg.type !== "request" || !msg.name) return;
			const handler = handlers[msg.name] ?? controlHandlers[msg.name];
			const id = msg.id;
			if (!handler) {
				ws.send(
					JSON.stringify({
						type: "error",
						id,
						error: { kind: "unknown", message: `unknown rpc: ${msg.name}` },
					}),
				);
				return;
			}
			try {
				const result = await handler(msg.args ?? {});
				ws.send(JSON.stringify({ type: "response", id, result }));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ws.send(
					JSON.stringify({
						type: "error",
						id,
						error: { kind: "runtime", message },
					}),
				);
			}
		},
	},
});

log.info("dafman test-server listening", {
	port: server.port,
	workspace: flags.workspace,
	userData: flags.userData,
	stubPickerPath: flags.stubPickerPath ?? null,
});
// Print marker on stdout so the Playwright harness can await "ready".
console.log(`__TEST_SERVER_READY__::port=${server.port}`);

process.on("SIGINT", async () => {
	await sessions.shutdownAll();
	process.exit(0);
});
process.on("SIGTERM", async () => {
	await sessions.shutdownAll();
	process.exit(0);
});

// keep existsSync import alive (used implicitly by mkdirSync recursive)
void existsSync;
