use std::collections::HashMap;
use std::sync::Arc;
use github_copilot_sdk::{Client, ClientOptions, SessionConfig};
use github_copilot_sdk::session::Session;
use tauri::async_runtime::Mutex;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[derive(Default)]
struct AppState {
    client: Mutex<Option<Arc<Client>>>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
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
async fn create_session(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let client = {
        let client_slot = state.client.lock().await;
        client_slot
            .as_ref()
            .ok_or_else(|| "Copilot client not initialized. Call create_client first.".to_string())?
            .clone()
    };

    let session = client
        .create_session(SessionConfig::default())
        .await
        .map_err(|err| err.to_string())?;

    let session_id = session.id().to_string();
    let mut sessions = state.sessions.lock().await;
    sessions.insert(session_id.clone(), Arc::new(session));

    Ok(session_id)
}

#[tauri::command]
async fn disconnect_session(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let mut sessions = state.sessions.lock().await;
        sessions.remove(&session_id)
    };

    let Some(session) = session else {
        return Err("Session not found".to_string());
    };

    session.disconnect().await.map_err(|err| err.to_string())?;

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
            .cloned()
            .ok_or_else(|| "Session not found".to_string())?
    };

    let event = session
        .send_and_wait(text.as_str())
        .await
        .map_err(|err| err.to_string())?;

    let Some(event) = event else {
        return Ok(String::new());
    };

    let content = event
        .data
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    Ok(content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
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
