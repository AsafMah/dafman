//! Dafman backend entry point.
//!
//! Module layout follows `plans/plan-architecture.prompt.md`. Per the
//! agent contract in `AGENTS.md`, only this module + `ipc/` + `app/` may
//! touch `tauri::*`; domain modules stay platform-agnostic.
mod app;
mod ipc;
mod logging;
pub use app::events::SessionEventPayload;
pub use app::models::ModelSummary;
use app::settings::SettingsService;
pub use app::settings::{Appearance, ReasoningVisibility, Settings, ThemeChoice, SETTINGS_VERSION};
use app::state::AppState;
use app::LogGuard;
use ipc::commands::client::create_client;
use ipc::commands::diagnostics::get_log_dir;
use ipc::commands::models::{list_models, set_session_model};
use ipc::commands::session::{create_session, disconnect_session, send_message};
use ipc::commands::settings::{get_settings, update_settings};
use std::sync::Arc;
use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Resolve the per-app log directory under the OS app-data dir
            // and start the tracing subscriber. Keep the guard inside
            // managed state so it flushes on shutdown.
            let log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("logs"));
            std::fs::create_dir_all(&log_dir).ok();
            let guard = logging::init(log_dir);
            app.manage(LogGuard(guard));
            app.manage(AppState::default());

            // Resolve `app_config_dir()/settings.json` and prime the cache.
            // Load is sync (one tiny file) and runs before commands are
            // dispatched, so the frontend's first `get_settings` is hot.
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let settings_path = config_dir.join("settings.json");
            let settings = SettingsService::load_or_default(settings_path);
            app.manage(Arc::new(settings));

            tracing::info!(version = env!("CARGO_PKG_VERSION"), "dafman started");
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_client,
            create_session,
            disconnect_session,
            send_message,
            get_settings,
            update_settings,
            list_models,
            set_session_model,
            get_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
