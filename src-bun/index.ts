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
			getSettings: rpcGuard(async () => settings.get()),
			updateSettings: rpcGuard(async ({ next }) => settings.update(next)),
			getLogDir: rpcGuard(async () => currentLogDir()),
			openLogFolder: rpcGuard(async () => {
				const dir = currentLogDir();
				if (!dir) return false;
				Utils.showItemInFolder(dir);
				return true;
			}),
		},
		messages: {},
	},
}) as unknown as ReturnType<typeof BrowserView.defineRPC<DafmanRPC>>;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			log.info(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			log.info(
				"Vite dev server not running. Run `bun run dev:hmr` for HMR.",
			);
		}
	}
	return "views://mainview/index.html";
}

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "Dafman",
	url,
	rpc,
	frame: { width: 1200, height: 800, x: 100, y: 100 },
});

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
