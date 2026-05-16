use crate::app::error::AppResult;
use tauri::Manager;
/// Returns the absolute path to the per-app log directory
/// (`{LOCALAPPDATA}/{identifier}/logs` on Windows, `~/Library/Logs/{identifier}`
/// on macOS, `~/.local/share/{identifier}/logs` on Linux).
///
/// The frontend pairs this with `revealItemInDir` from `tauri-plugin-opener`
/// to give users a "Open log folder" button without hard-coding paths.
#[tauri::command]
#[tracing::instrument(skip(app))]
pub async fn get_log_dir(app: tauri::AppHandle) -> AppResult<String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| crate::app::error::AppError::Settings(format!("log dir: {e}")))?;
    Ok(dir.to_string_lossy().to_string())
}
