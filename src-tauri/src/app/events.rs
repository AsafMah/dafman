//! Event payloads emitted to the frontend.
//!
//! Every type here is part of the IPC wire contract — adding or renaming a
//! field must update `src-tauri/tests/ipc_contract.rs` and the TS mirror.
use serde::Serialize;
/// Payload for the `session-event` Tauri event.
///
/// Per-session Tauri channels are planned for the next M1 step (see
/// `plans/plan-architecture.prompt.md`); the global event stays in place
/// until that refactor.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventPayload {
    /// Session that produced the event.
    pub session_id: String,
    /// Event type string from the SDK (e.g. ``"assistant.message_delta"``).
    pub event_type: String,
    /// Event-specific data (untyped JSON for now; typed wrappers will land
    /// alongside the per-session channel in M1).
    pub data: serde_json::Value,
}
