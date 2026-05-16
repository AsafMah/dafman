// Hand-mirrored Tauri IPC types.
//
// Keep these in sync with `src-tauri/src/app/events.rs` and friends; the
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
  | { kind: "Sdk"; data: string };

export type CommandMap = {
  create_client: { args: Record<string, never>; result: string };
  create_session: {
    args: { onEvent: Channel<SessionEventPayload> };
    result: string;
  };
  disconnect_session: { args: { sessionId: string }; result: string };
  send_message: { args: { sessionId: string; text: string }; result: string };
};

export type CommandName = keyof CommandMap;

