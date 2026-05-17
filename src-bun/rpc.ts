// Shared RPC contract between the Bun main process and the Vue webview.
//
// The `bun.requests` half lists every command the frontend can invoke
// (the rough equivalent of the Tauri `CommandMap`); `bun.messages` are
// fire-and-forget pushes from bun to the webview — we use a single
// `sessionEvent` channel and route by `sessionId` on the frontend,
// replacing Tauri's per-session `Channel<SessionEventPayload>`.
//
// Keep this file the single source of truth — both `src-bun/index.ts`
// and `src/ipc/invoke.ts` import the type from here.

import type { RPCSchema } from "electrobun/bun";
import type { AppErrorPayload } from "./app/errors";

export type ThemeChoice = "system" | "light" | "dark";
export type ReasoningVisibility = "hidden" | "compact" | "expanded";

export interface Appearance {
	theme: ThemeChoice;
	reasoningVisibility: ReasoningVisibility;
}

export interface Settings {
	version: number;
	appearance: Appearance;
}

export interface ModelSummary {
	id: string;
	name: string;
	supportsReasoningEffort: boolean;
	supportedReasoningEfforts: string[];
	defaultReasoningEffort: string | null;
}

/// Wire-format for a single SDK session event.
/// `eventType` mirrors the SDK's discriminated-union `type` field; `data`
/// carries the full event object verbatim so the frontend can pick out
/// event-specific fields without us hand-mirroring every variant.
export interface SessionEventPayload {
	sessionId: string;
	eventType: string;
	data: Record<string, unknown>;
}

export type DafmanRPC = {
	bun: RPCSchema<{
		requests: {
			createClient: { params: Record<string, never>; response: string };
			createSession: { params: Record<string, never>; response: string };
			disconnectSession: {
				params: { sessionId: string };
				response: string;
			};
			sendMessage: {
				params: { sessionId: string; text: string };
				response: string;
			};
			listModels: {
				params: Record<string, never>;
				response: ModelSummary[];
			};
			setSessionModel: {
				params: {
					sessionId: string;
					model: string;
					reasoningEffort: string | null;
				};
				response: string;
			};
			getSettings: { params: Record<string, never>; response: Settings };
			updateSettings: { params: { next: Settings }; response: Settings };
			getLogDir: { params: Record<string, never>; response: string };
			openLogFolder: {
				params: Record<string, never>;
				response: boolean;
			};
		};
		messages: Record<string, never>;
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: {
			sessionEvent: SessionEventPayload;
		};
	}>;
};

export type { AppErrorPayload };
