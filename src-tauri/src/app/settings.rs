//! Versioned on-disk settings (`settings.json` under `app_config_dir()`).
//!
//! The schema is intentionally tiny for M1 — General + Appearance only.
//! New sections are added by extending [`Settings`] and bumping
//! [`SETTINGS_VERSION`]; migrations live next to the schema as the surface
//! grows (see `plans/plan-architecture.prompt.md` → "settings/").
//!
//! Domain-only: this module never touches `tauri::*`. The IPC layer in
//! `ipc::commands::settings` is the only place that bridges into Tauri.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::async_runtime::{spawn_blocking, Mutex};

/// Current settings schema version. Bump when adding/removing top-level
/// fields and add a migration in [`Settings::migrate`].
pub const SETTINGS_VERSION: u32 = 1;

/// User-facing theme choice. `System` follows `prefers-color-scheme`.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeChoice {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub theme: ThemeChoice,
}

/// Root settings document persisted to disk.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub appearance: Appearance,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            appearance: Appearance::default(),
        }
    }
}

impl Settings {
    /// Apply forward migrations in place, stamping the current version.
    /// Today this is a stamp-only operation since the schema has one
    /// version; the match arm exists so adding a v2 is a localized change.
    fn migrate(mut self) -> Self {
        // No-op migrations for now; future versions match on `self.version`.
        self.version = SETTINGS_VERSION;
        self
    }
}

/// Errors emitted by the settings service. Mapped onto `AppError::Settings`
/// at the IPC layer.
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse: {0}")]
    Parse(#[from] serde_json::Error),
}

/// Thread-safe settings cache backed by a single JSON file.
///
/// `load` is called once during `tauri::Builder::setup` (sync, off the
/// runtime); subsequent reads/writes go through this service so the cache
/// stays the single source of truth.
pub struct SettingsService {
    path: PathBuf,
    cache: Mutex<Settings>,
}

impl SettingsService {
    /// Load settings from `path` (synchronously) or fall back to defaults
    /// if the file does not exist / fails to parse. Parse failures are
    /// logged but never crash startup — the user should always be able to
    /// open the app and fix things via the Settings dialog.
    pub fn load_or_default(path: PathBuf) -> Self {
        let initial = match Self::read_file(&path) {
            Ok(settings) => settings.migrate(),
            Err(SettingsError::Io(err)) if err.kind() == std::io::ErrorKind::NotFound => {
                tracing::info!(path = %path.display(), "settings file not found, using defaults");
                Settings::default()
            }
            Err(err) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "failed to read settings, falling back to defaults",
                );
                Settings::default()
            }
        };
        Self {
            path,
            cache: Mutex::new(initial),
        }
    }

    fn read_file(path: &Path) -> Result<Settings, SettingsError> {
        let raw = fs::read_to_string(path)?;
        let settings: Settings = serde_json::from_str(&raw)?;
        Ok(settings)
    }

    fn write_file(path: &Path, settings: &Settings) -> Result<(), SettingsError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(settings)?;
        fs::write(path, json)?;
        Ok(())
    }

    pub async fn get(&self) -> Settings {
        self.cache.lock().await.clone()
    }

    /// Replace the cached document and persist to disk. The disk write
    /// runs on `spawn_blocking` so the async runtime is never blocked on
    /// file I/O, even for tiny files.
    pub async fn update(&self, mut next: Settings) -> Result<Settings, SettingsError> {
        next.version = SETTINGS_VERSION;
        {
            let mut guard = self.cache.lock().await;
            *guard = next.clone();
        }
        let path = self.path.clone();
        let to_write = next.clone();
        spawn_blocking(move || Self::write_file(&path, &to_write))
            .await
            .map_err(|join_err| SettingsError::Io(std::io::Error::other(join_err.to_string())))??;
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn defaults_when_file_missing() {
        let dir = TempDir::new().unwrap();
        let svc = SettingsService::load_or_default(dir.path().join("settings.json"));
        let settings = futures_block_on(svc.get());
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn defaults_when_file_malformed() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "not json {{{").unwrap();
        let svc = SettingsService::load_or_default(path);
        let settings = futures_block_on(svc.get());
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn update_persists_and_reloads() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        let svc = SettingsService::load_or_default(path.clone());
        let next = Settings {
            version: SETTINGS_VERSION,
            appearance: Appearance {
                theme: ThemeChoice::Dark,
            },
        };
        let written = futures_block_on(svc.update(next.clone())).unwrap();
        assert_eq!(written, next);

        let reloaded = SettingsService::load_or_default(path);
        let settings = futures_block_on(reloaded.get());
        assert_eq!(settings.appearance.theme, ThemeChoice::Dark);
    }

    #[test]
    fn unknown_version_is_stamped_to_current() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"version": 999, "appearance": {"theme": "light"}}"#,
        )
        .unwrap();
        let svc = SettingsService::load_or_default(path);
        let settings = futures_block_on(svc.get());
        assert_eq!(settings.version, SETTINGS_VERSION);
        assert_eq!(settings.appearance.theme, ThemeChoice::Light);
    }

    /// Minimal blocker so the unit tests don't need a tokio attribute.
    fn futures_block_on<F: std::future::Future>(fut: F) -> F::Output {
        tauri::async_runtime::block_on(fut)
    }
}
