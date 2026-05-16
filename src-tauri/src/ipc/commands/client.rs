use crate::app::error::AppResult;
use crate::app::state::AppState;
use github_copilot_sdk::{Client, ClientOptions};
use std::sync::Arc;
/// Starts the CLI client if it is not already running.
///
/// Idempotent — calling twice is a no-op and returns a friendly string.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn create_client(state: tauri::State<'_, AppState>) -> AppResult<String> {
    let mut slot = state.client.lock().await;
    if slot.is_some() {
        return Ok("Copilot client already created".to_string());
    }
    let client = Client::start(ClientOptions::default()).await?;
    *slot = Some(Arc::new(client));
    Ok("Copilot client created".to_string())
}
