# Changelog
All notable changes to Dafman are documented here. Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org).
## [Unreleased]
### Added

### Changed

- **M1: Pinia stores + typed IPC wrapper** — added `clientStore`, `sessionsStore`, `toastStore`, and a `permissionsStore` scaffold for the upcoming permission UX. New `src/ipc/invoke.ts` is the only place that calls `@tauri-apps/api/core`'s `invoke`; `CommandMap` in `src/ipc/types.ts` types every Tauri command surface. `App.vue` and `ChatWindow.vue` are now dumb components reading stores. PrimeVue `Toast` mounted at the app root and fed from `toastStore` (stores push toasts without a component context). Added `src/stores/__tests__/sessionsStore.test.ts` covering optimistic create, error rollback, channel event forwarding, and close-on-error. New dep: `pinia`.
- **M1: Per-session Tauri channel** — `create_session` now takes a `tauri::ipc::Channel<SessionEventPayload>` and forwards SDK events through it instead of the global `session-event` emitter. `SessionEventPayload` drops its `sessionId` field (the channel identity scopes events); the frontend wires one channel per pane in `App.vue` and `ChatWindow.vue` consumes a reactive events buffer, so the `payload.sessionId === sessionId` filter is gone. Added `src/ipc/types.ts` as the hand-mirrored wire-type module called out in `AGENTS.md`. `tests/ipc_contract.rs` snapshot updated.
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


