//! Event payloads emitted to the frontend.
//!
//! Every type here is part of the IPC wire contract — adding or renaming a
//! field must update `src-tauri/tests/ipc_contract.rs` and the TS mirror.
use serde::Serialize;
/// Payload sent over a per-session `tauri::ipc::Channel<SessionEventPayload>`.
///
/// The channel handle is returned from `create_session`; the frontend
/// subscribes per-pane, so there is no `session_id` field — the channel
/// identity already scopes the events.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventPayload {
    /// Event type string from the SDK (e.g. ``"assistant.message_delta"``).
    pub event_type: String,
    /// Event-specific data (untyped JSON for now; typed wrappers will land
    /// as the surface grows).
    pub data: serde_json::Value,
}
