//! Application core — error type, event payloads, managed state, logging glue.
pub mod error;
pub mod events;
pub mod models;
pub mod settings;
pub mod state;
/// Newtype that keeps the `tracing-appender` `WorkerGuard` alive for the
/// process lifetime. Drop on shutdown flushes pending log lines.
#[allow(dead_code)]
pub struct LogGuard(pub tracing_appender::non_blocking::WorkerGuard);
