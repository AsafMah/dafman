use crate::app::error::{AppError, AppResult};
use crate::app::models::ModelSummary;
use crate::app::state::AppState;
use github_copilot_sdk::SetModelOptions;
/// Lists the models known to the running CLI client. The SDK caches the
/// result after the first call; subsequent invocations are cheap.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_models(state: tauri::State<'_, AppState>) -> AppResult<Vec<ModelSummary>> {
    let client = {
        let slot = state.client.lock().await;
        slot.as_ref().ok_or(AppError::ClientNotStarted)?.clone()
    };
    let models = client.list_models().await?;
    Ok(models.into_iter().map(ModelSummary::from).collect())
}
/// Switches the active model for a session. `reasoning_effort` is forwarded
/// only when supplied; the backend emits a `session.model_change` event on
/// the per-session channel so the UI stays in sync.
#[tauri::command]
#[tracing::instrument(skip(state, reasoning_effort), fields(has_effort = reasoning_effort.is_some()))]
pub async fn set_session_model(
    session_id: String,
    model: String,
    reasoning_effort: Option<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.session.clone())
            .ok_or_else(|| AppError::SessionNotFound(session_id.clone()))?
    };
    let opts =
        reasoning_effort.map(|effort| SetModelOptions::default().with_reasoning_effort(effort));
    session.set_model(&model, opts).await?;
    Ok(model)
}
