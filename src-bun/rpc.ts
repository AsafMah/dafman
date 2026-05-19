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

/// Agent run mode, mirrors the SDK `SessionMode` union.
/// "interactive" prompts for permission per action; "plan" stays in
/// read-only planning mode; "autopilot" runs unattended.
export type SessionMode = "interactive" | "plan" | "autopilot";

export interface SessionHistoryCompactionResult {
	/// Whether compaction completed successfully.
	success: boolean;
	/// Tokens freed by compaction (when available).
	tokensFreed: number | null;
	/// Number of messages removed during compaction (when available).
	messagesRemoved: number | null;
}

export interface Appearance {
	theme: ThemeChoice;
	reasoningVisibility: ReasoningVisibility;
}

export interface Settings {
	version: number;
	appearance: Appearance;
	/// Persisted layout state. Only the dockview JSON is stored here —
	/// session content (transcripts, tool calls, …) lives CLI-side and
	/// is rehydrated via `client.resumeSession()` on startup. The
	/// dockview JSON is opaque to us; we never inspect or mutate it
	/// directly, just hand it back to `api.fromJSON()`.
	layout: Layout;
	/// Workspace MRU. Populated by the topbar's path input every time
	/// a session is successfully created with a non-empty
	/// `workingDirectory`. The most-recently-used path is at index 0.
	workspaces: Workspaces;
	/// OS-native notification preferences. Inner indicators (status
	/// dots on tabs + sidebar rows + composer banner) are always on
	/// — these toggles only gate when we actually call
	/// `new Notification()`.
	notifications: NotificationPrefs;
}

export interface NotificationPrefs {
	/// Fire an OS notification when `assistant.turn_end` arrives on a
	/// session whose chat panel isn't the dock's active panel
	/// (and/or the app window isn't focused). Off by default —
	/// turn-end notifications are noisier than waiting-for-input.
	turnEnd: boolean;
	/// Fire an OS notification when the SDK is awaiting user input
	/// (permission.requested / user_input.requested /
	/// elicitation.requested) and the session isn't the active panel.
	/// On by default — this is the high-signal case.
	waitingForInput: boolean;
}

export interface Layout {
	/// Serialized dockview state (`api.toJSON()`). `null` means
	/// "no panes were open last time" — start with an empty dockview.
	dockview: unknown | null;
}

export interface Workspaces {
	/// Most-recently-used absolute filesystem paths the user has spun
	/// sessions in. Capped at WORKSPACES_MRU_LIMIT (10) entries; head
	/// of the list is the most recent. Persisted as-is so the topbar
	/// AutoComplete can suggest from prior runs.
	recent: string[];
	/// Default workspace for newly-created sessions. Pre-populates the
	/// new-session form's path input. Resolved at startup to
	/// `<homedir>/dafman` (auto-created) when the user hasn't set one
	/// explicitly. May still be empty if home-directory resolution
	/// fails (e.g. headless test env) — the renderer treats empty as
	/// "no default" and leaves the input blank.
	defaultWorkspace: string;
}

export interface ModelSummary {
	id: string;
	name: string;
	supportsReasoningEffort: boolean;
	supportedReasoningEfforts: string[];
	defaultReasoningEffort: string | null;
}

/// Summary of a CLI-side session, surfaced to the frontend for the
/// "recent sessions" picker and for startup-resume. Dates are
/// stringified (ISO 8601) so the wire payload is JSON-safe — the SDK
/// hands us `Date` objects but the RPC bridge will lose the type tag.
export interface SessionMetadataSummary {
	sessionId: string;
	startTime: string;
	modifiedTime: string;
	summary?: string;
	isRemote: boolean;
	cwd?: string;
	repository?: string;
	branch?: string;
}

/// Wire-format for a single SDK session event.
/// `eventType` mirrors the SDK's discriminated-union `type` field; `data`
/// carries the full event object verbatim so the frontend can pick out
/// event-specific fields without us hand-mirroring every variant.
/// `agentId` / `eventId` / `timestamp` are lifted off the SDK envelope so
/// the frontend can correlate sub-agent activity and order events without
/// us mirroring every variant's metadata into `data`.
export interface SessionEventPayload {
	sessionId: string;
	eventType: string;
	data: Record<string, unknown>;
	/// Sub-agent instance identifier. Absent for events from the
	/// root/main agent and session-level events.
	agentId?: string;
	/// UUID v4 generated by the SDK when the event is emitted.
	eventId?: string;
	/// ISO 8601 timestamp from the SDK envelope.
	timestamp?: string;
}

export type DafmanRPC = {
	bun: RPCSchema<{
		requests: {
			createClient: { params: Record<string, never>; response: string };
			createSession: {
				/// `workingDirectory` is the absolute filesystem path the
				/// SDK uses as `cwd` for all tool invocations in this
				/// session. Empty / omitted falls back to the bun
				/// process's cwd (the SDK's own default).
				params: { workingDirectory?: string };
				response: string;
			};
			/// Native folder picker. Returns the absolute path of the
			/// chosen directory, or `null` if the user cancelled.
			pickFolder: {
				params: { startingFolder?: string };
				response: string | null;
			};
			/// Directory autocomplete. Given a partial absolute path
			/// like `C:\repo\dafm`, lists immediate subdirectories of
			/// the parent (`C:\repo`) whose name starts with the leaf
			/// prefix (`dafm`). Used by the workspace AutoComplete in
			/// the topbar + Sessions panel to suggest filesystem
			/// completions alongside the persisted MRU. Capped at 20
			/// entries; case-insensitive prefix match. Returns `[]` on
			/// any filesystem error (path doesn't exist, permission
			/// denied, etc.) — the UI falls back to MRU-only.
			browseDirectory: {
				params: { prefix: string };
				response: string[];
			};
			disconnectSession: {
				params: { sessionId: string };
				response: string;
			};
			sendMessage: {
				params: {
					sessionId: string;
					text: string;
					/// SDK delivery mode. `"enqueue"` queues behind any
					/// in-flight turn; `"immediate"` injects into the
					/// running turn (steer). Omitted → SDK default.
					mode?: "enqueue" | "immediate";
				};
				response: string;
			};
			/// Aborts the currently-running turn for this session. The
			/// session remains valid; new sends after this point start a
			/// fresh turn. Backed by `session.abort()`.
			abortSession: {
				params: { sessionId: string };
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
			resumeSession: {
				params: {
					sessionId: string;
					model: string | null;
					reasoningEffort: string | null;
				};
				/// `sessionId` is the SDK's actual id (may differ from the
				/// request if a fork happened). `cwd` is the resumed
				/// session's working directory if the SDK reports one — we
				/// surface it here because `getMessages()` history doesn't
				/// include `session.resume`, so the renderer otherwise has
				/// no chance to learn the workspace path on restore.
				response: { sessionId: string; cwd: string | null };
			};
			listSessions: {
				params: Record<string, never>;
				response: SessionMetadataSummary[];
			};
			/// Permanently deletes a session's CLI-side data. Returns the
			/// session id on success. If the session is currently
			/// registered in this app, it's disconnected first so the
			/// SDK can release its handle.
			deleteSession: {
				params: { sessionId: string };
				response: string;
			};
			getSessionMode: {
				params: { sessionId: string };
				response: SessionMode;
			};
			setSessionMode: {
				params: { sessionId: string; mode: SessionMode };
				response: SessionMode;
			};
			getSessionName: {
				params: { sessionId: string };
				response: string | null;
			};
			setSessionName: {
				params: { sessionId: string; name: string };
				response: string;
			};
			compactSessionHistory: {
				params: { sessionId: string };
				response: SessionHistoryCompactionResult;
			};
			setSessionApproveAll: {
				params: { sessionId: string; enabled: boolean };
				response: boolean;
			};
			resetSessionApprovals: {
				params: { sessionId: string };
				response: boolean;
			};
			getSettings: { params: Record<string, never>; response: Settings };
			updateSettings: { params: { next: Settings }; response: Settings };
			getLogDir: { params: Record<string, never>; response: string };
			openLogFolder: {
				params: Record<string, never>;
				response: boolean;
			};
			/// Reveal an arbitrary path in the OS file explorer. Used
			/// by the workspace chip in the tab strip; returns `false`
			/// when the path is empty or doesn't exist.
			revealPath: {
				params: { path: string };
				response: boolean;
			};
			// Lets the webview pipe console messages + uncaught errors back
			// through the existing RPC channel so they show up in bun's
			// JSON log even when WebView2 devtools is closed. Pure
			// diagnostic — not part of any product surface.
			rendererLog: {
				params: {
					level: "debug" | "info" | "warn" | "error";
					message: string;
					extra?: Record<string, unknown>;
				};
				response: void;
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
