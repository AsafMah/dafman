//! App-level error type returned by every Tauri command.
//!
//! See `plans/plan-architecture.prompt.md` ("Error model").
use serde::Serialize;
use thiserror::Error;
/// Tagged + serde-friendly error that maps to a discriminated-union payload
/// on the frontend (see `plan-architecture.prompt.md`).
///
/// New variants are added as the surface grows; keep the tag stable —
/// `src-tauri/tests/ipc_contract.rs` will snapshot the wire shape.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum AppError {
    /// The CLI client has not been started yet.
    #[error("client not started")]
    ClientNotStarted,
    /// A session id was supplied that the manager does not know about.
    #[error("session {0} not found")]
    SessionNotFound(String),
    /// Settings load/save failed.
    #[error("settings: {0}")]
    Settings(String),
    /// Anything coming out of the upstream SDK that we do not have a
    /// finer-grained category for yet.
    #[error("sdk: {0}")]
    Sdk(String),
}
impl From<github_copilot_sdk::Error> for AppError {
    fn from(err: github_copilot_sdk::Error) -> Self {
        Self::Sdk(err.to_string())
    }
}
impl From<crate::app::settings::SettingsError> for AppError {
    fn from(err: crate::app::settings::SettingsError) -> Self {
        Self::Settings(err.to_string())
    }
}
/// `Result` alias used throughout `ipc::commands::*`.
pub type AppResult<T> = std::result::Result<T, AppError>;
