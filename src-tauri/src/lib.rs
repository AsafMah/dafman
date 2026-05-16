use std::collections::HashMap;
use std::sync::Arc;
use github_copilot_sdk::{Client, ClientOptions, SessionConfig};
use github_copilot_sdk::handler::ApproveAllHandler;
use github_copilot_sdk::session::Session;
use github_copilot_sdk::subscription::RecvError;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri::async_runtime::{spawn, JoinHandle, Mutex};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
struct SessionEntry {
    session: Arc<Session>,
    event_task: JoinHandle<()>,
}

#[derive(Default)]
struct AppState {
    client: Mutex<Option<Arc<Client>>>,
    sessions: Mutex<HashMap<String, SessionEntry>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEventPayload {
    session_id: String,
    event_type: String,
    data: serde_json::Value,
}

#[tauri::command]
async fn create_client(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let mut client_slot = state.client.lock().await;

    if client_slot.is_some() {
        return Ok("Copilot client already created".to_string());
    }

    let client = Client::start(ClientOptions::default())
        .await
        .map_err(|err| err.to_string())?;
    *client_slot = Some(Arc::new(client));

    Ok("Copilot client created".to_string())
}

#[tauri::command]
async fn create_session(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let client = {
        let client_slot = state.client.lock().await;
        client_slot
            .as_ref()
            .ok_or_else(|| "Copilot client not initialized. Call create_client first.".to_string())?
            .clone()
    };

    let session = client
        .create_session(
            SessionConfig::default()
                .with_handler(Arc::new(ApproveAllHandler))
                .with_streaming(true),
        )
        .await
        .map_err(|err| err.to_string())?;

    let session_id = session.id().to_string();
    let session = Arc::new(session);

    // Spawn an event-forwarding task that streams session events to the frontend.
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
                Err(RecvError::Closed) => break,
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

#[tauri::command]
async fn disconnect_session(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let entry = {
        let mut sessions = state.sessions.lock().await;
        sessions.remove(&session_id)
    };

    let Some(entry) = entry else {
        return Err("Session not found".to_string());
    };

    entry.event_task.abort();
    entry
        .session
        .disconnect()
        .await
        .map_err(|err| err.to_string())?;

    Ok("Session closed successfully".to_string())
}

#[tauri::command]
async fn send_message(
    session_id: String,
    text: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.session.clone())
            .ok_or_else(|| "Session not found".to_string())?
    };

    let message_id = session
        .send(text.as_str())
        .await
        .map_err(|err| err.to_string())?;

    Ok(message_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(AppState::default());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_client,
            create_session,
            disconnect_session,
            send_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
