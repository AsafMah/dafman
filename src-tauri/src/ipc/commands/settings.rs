use crate::app::error::AppResult;
use crate::app::settings::{Settings, SettingsService};
use std::sync::Arc;
/// Returns the currently cached settings document.
#[tauri::command]
#[tracing::instrument(skip(service))]
pub async fn get_settings(service: tauri::State<'_, Arc<SettingsService>>) -> AppResult<Settings> {
    Ok(service.get().await)
}
/// Full-replace update: the frontend sends the next settings document and
/// the backend persists it. Partial patching can be added later when the
/// schema grows beyond what fits in a single dialog.
#[tauri::command]
#[tracing::instrument(skip(service, next))]
pub async fn update_settings(
    next: Settings,
    service: tauri::State<'_, Arc<SettingsService>>,
) -> AppResult<Settings> {
    Ok(service.update(next).await?)
}
