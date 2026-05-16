# Changelog
All notable changes to Dafman are documented here. Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org).
## [Unreleased]
### Added

### Changed

- **M1: Backend module refactor** — split `src-tauri/src/lib.rs` into `app/{error,events,state}.rs` + `ipc/commands/{client,session}.rs` per `plans/plan-architecture.prompt.md`. `lib.rs` is now a 35-line entry point (Tauri setup + handler registration). Introduced `AppError` (`thiserror`) with `From<github_copilot_sdk::Error>`; every command now returns `AppResult<T>` instead of `Result<T, String>`. `tests/ipc_contract.rs` imports the real `SessionEventPayload` so any wire-shape drift fails the snapshot.
- Multi-session chat panes in a responsive grid (M0).
- Streaming token deltas per session via the GitHub Copilot SDK (Supercharged).
- Per-session accent color derived from the session id.
- Light & dark mode via PrimeVue tokens (Aura preset, green primary).
- Initial design documents in `plans/` covering vision, architecture, roadmap, messaging UX, tools & permissions, platform features, SDK & external surfaces, and testing strategy.
- plans/plan-observability.prompt.md ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â logging, tracing, metrics, audit, performance budgets, in-app Log Viewer, privacy controls. Cross-referenced from the overview, architecture, roadmap (M1ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“M7 observability bullets), and testing strategy.
### Changed
- N/A ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â initial release.
### Fixed
- N/A ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â initial release.


