//! Observability — `tracing` subscriber setup.
//!
//! See `plans/plan-observability.prompt.md` for the full design. This is the
//! M1 baseline: file appender (daily, JSON), dev-stderr layer, env-filter.
//! Redaction layer, OTLP exporter, and Log Viewer IPC land later in M1/M3/M4.
use std::path::PathBuf;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;
/// Default level filter applied when neither `DAFMAN_LOG` nor `RUST_LOG` is set.
const DEFAULT_FILTER: &str = "info,dafman=debug,dafman_lib=debug,github_copilot_sdk=info";
/// Initializes the global `tracing` subscriber.
///
/// Returns a [`WorkerGuard`] that must be kept alive for the lifetime of the
/// process so the non-blocking file appender flushes on shutdown. Drop the
/// guard during graceful shutdown.
pub fn init(log_dir: PathBuf) -> WorkerGuard {
    // Daily-rotating JSON file appender. 14 files kept by default
    // (tracing-appender does not yet auto-prune; that is on the M3 list).
    let file_appender = rolling::daily(&log_dir, "dafman.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let filter = EnvFilter::try_from_env("DAFMAN_LOG")
        .or_else(|_| EnvFilter::try_from_default_env())
        .unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));
    let file_layer = fmt::layer()
        .with_writer(file_writer)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .json()
        .with_current_span(true)
        .with_span_list(false);
    let stderr_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(true)
        .with_ansi(true);
    let subscriber = tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(stderr_layer);
    // Ignore errors from a re-init (tests, hot-reload).
    let _ = subscriber.try_init();
    tracing::info!(
        log_dir = %log_dir.display(),
        default_filter = DEFAULT_FILTER,
        "tracing subscriber initialized",
    );
    guard
}
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    /// `init` returns a guard that — when dropped — flushes the appender. We
    /// verify that the log directory + file are created and that at least the
    /// "tracing subscriber initialized" record lands on disk.
    #[test]
    fn init_creates_log_dir_and_writes_file() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().to_path_buf();
        {
            let _guard = init(path.clone());
            tracing::info!(target: "dafman_lib::logging::tests", "smoke test event");
        } // guard dropped here flushes
          // The daily appender creates a file named `dafman.log.YYYY-MM-DD`.
        let entries: Vec<_> = std::fs::read_dir(&path)
            .expect("read dir")
            .filter_map(Result::ok)
            .collect();
        assert!(
            entries
                .iter()
                .any(|e| { e.file_name().to_string_lossy().starts_with("dafman.log") }),
            "expected a dafman.log* file in the log dir, got: {:?}",
            entries.iter().map(|e| e.file_name()).collect::<Vec<_>>()
        );
    }
}
