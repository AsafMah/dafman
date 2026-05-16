# Changelog
All notable changes to Dafman are documented here. Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org).
## [Unreleased]

### Fixed

- Reasoning card was illegible in dark mode (muted text on muted surface); body now uses `--p-text-color`, label stays muted; dark mode bg uses `--p-content-background` tinted via `color-mix` so theme switches keep contrast correct. Same fix on message + system cards.
- Per-session reasoning Select rendered empty by default because the v-model was `null`; it now defaults to a `"default"` sentinel and shows "Default".
- Settings dialog SelectButtons had no accessible name; added `aria-labelledby` pointing at their visible labels.
- Empty / opaque reasoning events no longer render phantom "Thinking..." cards: events with no id AND no text are dropped with a `console.warn`; OpenAI's opaque `reasoning_opaque`-style events (empty `content`, ~500-char base64 `reasoningId`) are dropped unless they update an existing card.
- Session colours: first 12 sessions in a client are now visually distinct via a curated palette indexed by creation order (was a colliding id-hashed HSL hue).

### Added

- **Dev playground** at `?dev` (`src/dev/Playground.vue`). DEV-only, dynamically imported so tree-shaking removes it from production bundles. Includes scripted event sequences, a custom event JSON pusher, toast firing for all four severities, and a live `ChatWindow` preview.
- **Render high-value session events**: `session.title_changed` (header title), `session.model_change` (model badge + toast), `session.usage_info` / `assistant.usage` (footer token pill), `assistant.turn_start/end` (drives "Thinking..." indicator off real boundaries with heuristic fallback), `assistant.intent` (replaces the spinner label with the intent text), `session.info` / `session.warning` / `system.notification` / `model.call_failure` (severity-tinted inline cards), `session.truncation`, `session.compaction_start/complete`. Explicit no-op cases for `assistant.streaming_delta` (dup of `message_delta`), raw `system.message` (system prompt), and the `tools_updated` / `skills_loaded` / `custom_agents_updated` family.
- **Per-session model + reasoning effort selectors** in the chat header. New `list_models` / `set_session_model` IPC commands backed by `app::models::ModelSummary` (slim mirror of `github_copilot_sdk::Model`); `modelsStore` lazy-loads and caches the catalog. The Effort Select only renders when the chosen model advertises `supports.reasoningEffort`. Backend-initiated model switches (e.g. rate-limit auto-switch via `session.model_change`) keep the UI in sync.
- **Open log folder** button in Settings → General. New `get_log_dir` IPC returns Tauri's `app_log_dir()`; frontend pairs it with `revealItemInDir` from `tauri-plugin-opener` (already a dep) so users can pop the daily JSON log file without copying paths.
- **Per-session event logging**: backend forwarder logs `event_type` + `session_id` at debug for every event (default-on); reasoning/error/warning/`model.call_failure` data at debug; every other event's data at trace. `M1-TODO(observability)` comment notes this is intentionally chatty during early M1 and should be demoted to trace once the chat surface is feature-complete and Settings → Diagnostics log toggle ships.
- **Auto-create client on mount**: drops the "Create Client" button; `App.vue` calls `clientStore.createClient()` in `onMounted` after settings load. Placeholder copy shows "Starting Copilot client..." then "Click New Session to start chatting."
- **mockIPC E2E** (`src/__tests__/App.e2e.test.ts`) covering auto-create-client → new-session → stream events → send message via `@tauri-apps/api/mocks`. No Tauri binary required.
- **Test coverage** doubled to 82 vitest (across `lib/`, `stores/`, `components/`, `ipc/`, `__tests__/` E2E) and 17 cargo (10 lib + 7 integration including `AppError` wire snapshots for every variant).
- **Reasoning visibility + full-width chat redesign** — `assistant.reasoning_delta` / `assistant.reasoning` events render as muted full-width cards next to the user/assistant cards. Settings v2 adds `Appearance.reasoningVisibility` (`hidden` / `compact` / `expanded`, default `compact`); v1 documents migrate cleanly via serde defaults. Per-session override in the chat header. Chat messages were redesigned from bubbles-with-avatars to full-width tinted cards distinguished by border colour.
- **M1: Settings store on disk** — new `app::settings` module owning `Settings { version, appearance: { theme, reasoningVisibility } }` persisted to `app_config_dir()/settings.json`. `SettingsService::load_or_default` is sync at startup (falls back to defaults on missing/malformed files, with a tracing warning) and `update` writes via `tauri::async_runtime::spawn_blocking`. Forward migrations are a `Settings::migrate` match arm so adding v2 is localized. Frontend gets a `settingsStore` + `SettingsDialog.vue` (General + Appearance tabs) reached via a cog button in the topbar. Dark mode is three-state (System / Light / Dark) and resolved through `resolveIsDark(theme, prefersDark)`.

### Changed

- **M1: Pinia stores + typed IPC wrapper** — added `clientStore`, `sessionsStore`, `toastStore`, `modelsStore`, `settingsStore`, and a `permissionsStore` scaffold for the upcoming permission UX. New `src/ipc/invoke.ts` is the only place that calls `@tauri-apps/api/core`'s `invoke`; `CommandMap` in `src/ipc/types.ts` types every Tauri command surface. `App.vue` and `ChatWindow.vue` are now dumb components reading stores. PrimeVue `Toast` mounted at the app root and fed from `toastStore`. New dep: `pinia`.
- **M1: Per-session Tauri channel** — `create_session` now takes a `tauri::ipc::Channel<SessionEventPayload>` and forwards SDK events through it instead of the global `session-event` emitter. `SessionEventPayload` drops its `sessionId` field (the channel identity scopes events).
- **M1: Backend module refactor** — split `src-tauri/src/lib.rs` into `app/{error,events,state,settings,models}.rs` + `ipc/commands/{client,session,settings,models,diagnostics}.rs`. Introduced `AppError` (`thiserror`); every command returns `AppResult<T>` instead of `Result<T, String>`.
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


