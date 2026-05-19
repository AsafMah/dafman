// Hand-mirrored types for the Electrobun RPC bridge.
//
// The Bun side's source of truth is `src-bun/rpc.ts`; we re-state the
// payload-only types here so the Vue tree never imports from
// `electrobun/bun` (which is a Bun-only module).

export type ThemeChoice = "system" | "light" | "dark";

export type ReasoningVisibility = "hidden" | "compact" | "expanded";

/// Mirrors `SessionMode` in `src-bun/rpc.ts`. Agent run mode.
export type SessionMode = "interactive" | "plan" | "autopilot";

/// Mirrors `SessionHistoryCompactionResult` in `src-bun/rpc.ts`.
export interface SessionHistoryCompactionResult {
  success: boolean;
  tokensFreed: number | null;
  messagesRemoved: number | null;
}

export interface Appearance {
  theme: ThemeChoice;
  reasoningVisibility: ReasoningVisibility;
  /// Whether the SDK streams `assistant.message_delta` events for
  /// the assistant's reply. `false` (default) renders only the
  /// final `assistant.message` per turn. Takes effect on the NEXT
  /// session created — existing sessions keep their original mode.
  streaming: boolean;
}

export interface Settings {
  version: number;
  appearance: Appearance;
  layout: Layout;
  workspaces: Workspaces;
  notifications: NotificationPrefs;
}

export interface Layout {
  dockview: unknown | null;
}

export interface Workspaces {
  recent: string[];
  /// Default workspace for new sessions. May be empty when home-dir
  /// resolution failed at startup; treat empty as "no default".
  defaultWorkspace: string;
}

/// OS-native notification preferences. Mirrors `NotificationPrefs` in
/// `src-bun/rpc.ts`. Inner indicators (status dots, banner) are
/// always on; these only gate when we call `new Notification()`.
export interface NotificationPrefs {
  turnEnd: boolean;
  waitingForInput: boolean;
}

export interface ModelSummary {
  id: string;
  name: string;
  supportsReasoningEffort: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
}

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

export interface SessionEventPayload {
  sessionId: string;
  eventType: string;
  data: Record<string, unknown>;
  agentId?: string;
  eventId?: string;
  timestamp?: string;
}

/// Discriminated union mirroring `AppErrorPayload` in `src-bun/app/errors.ts`.
/// RPC rejections are deserialized into this shape by `invokeCommand`.
export type AppErrorPayload =
  | { kind: "ClientNotStarted" }
  | { kind: "SessionNotFound"; data: string }
  | { kind: "Settings"; data: string }
  | { kind: "Sdk"; data: string };

/// Single source of truth for the request surface. Adding a new RPC?
/// Add it here, then implement on the bun side in `src-bun/index.ts`.
export type CommandMap = {
  createClient: { args: Record<string, never>; result: string };
  createSession: {
    args: { workingDirectory?: string };
    result: string;
  };
  pickFolder: {
    args: { startingFolder?: string };
    result: string | null;
  };
  browseDirectory: {
    args: { prefix: string };
    result: string[];
  };
  disconnectSession: { args: { sessionId: string }; result: string };
  sendMessage: {
    args: {
      sessionId: string;
      text: string;
      mode?: "enqueue" | "immediate";
    };
    result: string;
  };
  abortSession: { args: { sessionId: string }; result: string };
  listModels: { args: Record<string, never>; result: ModelSummary[] };
  setSessionModel: {
    args: {
      sessionId: string;
      model: string;
      reasoningEffort: string | null;
    };
    result: string;
  };
  resumeSession: {
    args: {
      sessionId: string;
      model: string | null;
      reasoningEffort: string | null;
    };
    result: { sessionId: string; cwd: string | null };
  };
  listSessions: { args: Record<string, never>; result: SessionMetadataSummary[] };
  deleteSession: { args: { sessionId: string }; result: string };
  getSessionMode: { args: { sessionId: string }; result: SessionMode };
  setSessionMode: {
    args: { sessionId: string; mode: SessionMode };
    result: SessionMode;
  };
  getSessionName: { args: { sessionId: string }; result: string | null };
  setSessionName: {
    args: { sessionId: string; name: string };
    result: string;
  };
  compactSessionHistory: {
    args: { sessionId: string };
    result: SessionHistoryCompactionResult;
  };
  setSessionApproveAll: {
    args: { sessionId: string; enabled: boolean };
    result: boolean;
  };
  resetSessionApprovals: { args: { sessionId: string }; result: boolean };
  getSettings: { args: Record<string, never>; result: Settings };
  updateSettings: { args: { next: Settings }; result: Settings };
  getLogDir: { args: Record<string, never>; result: string };
  openLogFolder: { args: Record<string, never>; result: boolean };
  revealPath: { args: { path: string }; result: boolean };
  rendererLog: {
    args: {
      level: "debug" | "info" | "warn" | "error";
      message: string;
      extra?: Record<string, unknown>;
    };
    result: void;
  };
};

export type CommandName = keyof CommandMap;
