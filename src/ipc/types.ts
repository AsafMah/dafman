// Hand-mirrored types for the Electrobun RPC bridge.
//
// The Bun side's source of truth is `src-bun/rpc.ts`; we re-state the
// payload-only types here so the Vue tree never imports from
// `electrobun/bun` (which is a Bun-only module).

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

export interface SessionEventPayload {
  sessionId: string;
  eventType: string;
  data: Record<string, unknown>;
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
  createSession: { args: Record<string, never>; result: string };
  disconnectSession: { args: { sessionId: string }; result: string };
  sendMessage: { args: { sessionId: string; text: string }; result: string };
  listModels: { args: Record<string, never>; result: ModelSummary[] };
  setSessionModel: {
    args: {
      sessionId: string;
      model: string;
      reasoningEffort: string | null;
    };
    result: string;
  };
  getSettings: { args: Record<string, never>; result: Settings };
  updateSettings: { args: { next: Settings }; result: Settings };
  getLogDir: { args: Record<string, never>; result: string };
  openLogFolder: { args: Record<string, never>; result: boolean };
};

export type CommandName = keyof CommandMap;
