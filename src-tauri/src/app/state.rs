//! Application-wide managed state.
//!
//! The plan in `plans/plan-architecture.prompt.md` calls for splitting this
//! into per-domain managers behind traits. We start with a simple aggregate
//! that owns the client slot and active sessions; the trait refactor lands
//! when we introduce the permission service + URL opener.
use github_copilot_sdk::session::Session;
use github_copilot_sdk::Client;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::async_runtime::{JoinHandle, Mutex};
/// One active session and the background task that fans its events out to
/// the frontend.
pub struct SessionEntry {
    /// Cheap-to-clone handle to the SDK session.
    pub session: Arc<Session>,
    /// Task that subscribes to `session.subscribe()` and emits `session-event`s.
    /// Aborted on disconnect.
    pub event_task: JoinHandle<()>,
}
/// Tauri-managed root state. Domain modules never construct this directly;
/// access via `tauri::State<'_, AppState>`.
#[derive(Default)]
pub struct AppState {
    /// At most one CLI client; `None` until `client.create_client` succeeds.
    pub client: Mutex<Option<Arc<Client>>>,
    /// Active sessions keyed by `SessionId`.
    pub sessions: Mutex<HashMap<String, SessionEntry>>,
}
