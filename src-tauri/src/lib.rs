//! Dafman backend entry point.
//!
//! Module layout follows `plans/plan-architecture.prompt.md`. Per the
//! agent contract in `AGENTS.md`, only this module + `ipc/` + `app/` may
//! touch `tauri::*`; domain modules stay platform-agnostic.
mod app;
mod ipc;
mod logging;
pub use app::events::SessionEventPayload;
use app::state::AppState;
use app::LogGuard;
use ipc::commands::client::create_client;
use ipc::commands::session::{create_session, disconnect_session, send_message};
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
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "dafman started");
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
