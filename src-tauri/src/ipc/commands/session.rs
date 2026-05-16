use crate::app::error::{AppError, AppResult};
use crate::app::events::SessionEventPayload;
use crate::app::state::{AppState, SessionEntry};
use github_copilot_sdk::handler::ApproveAllHandler;
use github_copilot_sdk::subscription::RecvError;
use github_copilot_sdk::SessionConfig;
use std::sync::Arc;
use tauri::async_runtime::spawn;
use tauri::{AppHandle, Emitter};
/// Creates a streaming session using the running CLI client.
///
/// Spawns a background task that forwards every `SessionEvent` to the
/// frontend via the global ``session-event`` channel. The task is aborted
/// when the session is disconnected.
#[tauri::command]
#[tracing::instrument(skip(app, state))]
pub async fn create_session(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<String> {
    let client = {
        let slot = state.client.lock().await;
        slot.as_ref().ok_or(AppError::ClientNotStarted)?.clone()
    };
    let session = client
        .create_session(
            SessionConfig::default()
                .with_handler(Arc::new(ApproveAllHandler))
                .with_streaming(true),
        )
        .await?;
    let session_id = session.id().to_string();
    let session = Arc::new(session);
    let mut subscription = session.subscribe();
    let app_handle = app.clone();
    let session_id_for_task = session_id.clone();
    let event_task = spawn(async move {
        loop {
            match subscription.recv().await {
                Ok(event) => {
                    let payload = SessionEventPayload {
                        session_id: session_id_for_task.clone(),
                        event_type: event.event_type.clone(),
                        data: event.data.clone(),
                    };
                    let _ = app_handle.emit("session-event", payload);
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });
    let mut sessions = state.sessions.lock().await;
    sessions.insert(
        session_id.clone(),
        SessionEntry {
            session,
            event_task,
        },
    );
    Ok(session_id)
}
/// Aborts the event-forwarding task and disconnects the session cleanly.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn disconnect_session(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<String> {
    let entry = {
        let mut sessions = state.sessions.lock().await;
        sessions.remove(&session_id)
    };
    let Some(entry) = entry else {
        return Err(AppError::SessionNotFound(session_id));
    };
    entry.event_task.abort();
    entry.session.disconnect().await?;
    Ok("Session closed successfully".to_string())
}
/// Fire-and-forget: queues a user message; the agent reply streams back via
/// `session-event`.
///
/// `text` is deliberately skipped from the span; only its `len` is recorded
/// (privacy-first per `plans/plan-observability.prompt.md`).
#[tauri::command]
#[tracing::instrument(skip(state, text), fields(text_len = text.len()))]
pub async fn send_message(
    session_id: String,
    text: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.session.clone())
            .ok_or_else(|| AppError::SessionNotFound(session_id.clone()))?
    };
    let message_id = session.send(text.as_str()).await?;
    Ok(message_id)
}
