// Hand-mirrored Tauri IPC types.
//
// Keep these in sync with `src-tauri/src/app/events.rs` /
// `src-tauri/src/app/settings.rs` and friends; the
// `src-tauri/tests/ipc_contract.rs` snapshot guards the wire shape on the
// Rust side. Drift is caught when either side updates without the other.

import type { Channel } from "@tauri-apps/api/core";

export type SessionEventPayload = {
  eventType: string;
  data: Record<string, unknown>;
};

/// Discriminated union mirroring `AppError` in `src-tauri/src/app/error.rs`.
/// `invoke` rejections are deserialized into this shape.
export type AppErrorPayload =
  | { kind: "ClientNotStarted" }
  | { kind: "SessionNotFound"; data: string }
  | { kind: "Settings"; data: string }
  | { kind: "Sdk"; data: string };

export type ThemeChoice = "system" | "light" | "dark";

export type ReasoningVisibility = "hidden" | "compact" | "expanded";

export type Appearance = {
  theme: ThemeChoice;
  reasoningVisibility: ReasoningVisibility;
};

export type Settings = {
  version: number;
  appearance: Appearance;
};

export type CommandMap = {
  create_client: { args: Record<string, never>; result: string };
  create_session: {
    args: { onEvent: Channel<SessionEventPayload> };
    result: string;
  };
  disconnect_session: { args: { sessionId: string }; result: string };
  send_message: { args: { sessionId: string; text: string }; result: string };
  get_settings: { args: Record<string, never>; result: Settings };
  update_settings: { args: { next: Settings }; result: Settings };
};

export type CommandName = keyof CommandMap;

