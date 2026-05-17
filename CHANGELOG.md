# Changelog
All notable changes to Dafman are documented here. Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- **Lexical-backed chat composer + message display.** Replaces the PrimeVue `InputText` composer and the plain-`<p>` assistant/reasoning body with two new components, `MessageComposer.vue` and `MessageContent.vue`, both backed by [Lexical](https://lexical.dev) via the `lexical-vue` Vue 3 binding (`lexical-vue@0.14.1` + `lexical@0.38.1` + matching `@lexical/*` packages, all version-pinned to avoid duplicate-version drift). The composer enables markdown keystroke shortcuts (`# heading`, `**bold**`, ` ``` `, `- list`, `> quote`, `---`, links, checkboxes, tab-indent) and serializes sends through `$convertToMarkdownString(TRANSFORMERS)`; the display renders the same markdown back via `$convertFromMarkdownString`. Streaming assistant deltas are coalesced via `requestAnimationFrame` so a burst of 5–30 deltas/sec triggers at most one Lexical reconcile per frame. New `src/lexical/{theme,plugins,nodes}.ts` keep Lexical wiring out of SFCs; global `src/lexical/lexical.css` styles the theme classes Lexical injects into the DOM (scoped CSS can't reach those nodes). Composer height auto-grows up to 60 % of the chat tile via a `ResizeObserver`-published `--tile-height` custom property.

### Fixed

- **Initial window clipping (Windows).** The WebView2 surface attaches at the outer window size, so the renderer reported a viewport ~16 px wider/taller than the visible client area until the first WM_SIZE — anything past that boundary was clipped. We now schedule a ±1 px frame nudge from the Bun main process on a staggered timeline (0/150/400/900 ms after `dom-ready`, plus 200/600/1500 ms fallbacks) so a single resize event always lands after the renderer has finished its first layout, regardless of how slow the renderer mount is (a few hundred ms with Lexical).
- **Model-change toast was emitted twice and lost the reasoning effort.** The SDK fires `session.model_change` for both the user-requested switch and the backend's auto-switch echo. The reducer now dedupes by `(previousModel, newModel, previousReasoningEffort, reasoningEffort)` and folds the effort delta into the toast detail (`claude-sonnet-4.5 → gpt-5.5 (medium → high effort)`).
- **Bun SFC loader emitted duplicate `_hoisted_*` constants** for any SFC whose template had static class attributes on multiple elements. The loader gated the standalone-template-compile pass on `scriptBlock.scriptSetup` — which is `undefined` on the `SFCScriptBlock` returned by `compileScript({inlineTemplate: true})` — so it ran a redundant `compileTemplate` whose hoisted vnode constants collided with the inlined ones. Now gated on `descriptor.scriptSetup` (the source descriptor) instead.

### Changed

- **Toasts.** Click anywhere on a toast to dismiss it. Default auto-dismiss shortened from 4 s → 2.5 s (errors from 6 s → 5 s) to make the stream less noisy during a session.
- **Chat tile + composer layout.** `.session-grid` now uses `minmax(min(360px, 100%), 1fr)` and the chat header wraps; selectors don't push the tile past the viewport.

### Known gaps

- SFC tests for `MessageComposer` / `MessageContent` were prototyped but removed: Bun's ESM loader trips a TDZ inside `@lexical/{history,rich-text,link}` (`Cannot access 'X' before initialization`) that Vite's bundler handles transparently. The components are exercised end-to-end via the Vite production build and the dev playground; deep rendering coverage moves to e2e (see roadmap).

## [Earlier unreleased entries]

- **Port from Tauri → Electrobun.** The Rust backend (`src-tauri/`) is gone; main process is now TypeScript under `src-bun/`, driven by [Electrobun](https://docs.electrobunny.ai/electrobun/) on Bun. The SDK swap is `github-copilot-sdk` (Rust crate) → `copilot-sdk-supercharged` (npm), same JSON-RPC engine. Tauri's per-session `Channel<SessionEventPayload>` is replaced with a single bun→webview `sessionEvent` RPC message that carries `sessionId`. Settings live at `Utils.paths.userData/settings.json`; logs at `Utils.paths.userLogs/dafman-YYYY-MM-DD.log` (JSON lines). "Open log folder" uses Electrobun's `Utils.showItemInFolder`. Per-session permission UX still defers to `approveAll` until M1's PermissionService lands.
- **One runner, one language.** Vitest, `@vue/test-utils`, `happy-dom`, `cargo test`, and `insta` are all gone. `bun test` runs everything; Vue SFC tests work via `tools/bun-vue-loader.ts` (Bun plugin patterned on the [Svelte test guide](https://bun.com/docs/guides/test/svelte-test) using `@vue/compiler-sfc` + `@happy-dom/global-registrator` + `@testing-library/vue`). IPC wire-shape snapshots moved from `insta` inline snapshots to `expect(...).toMatchSnapshot()` in `src-bun/__tests__/wire-contract.test.ts`.
- **package.json scripts**: `dev` / `dev:hmr` / `build` / `test` / `lint` / `check` all run through Bun. Dropped `tauri`, `test:rust`, `test:all`, `lint:rust`, `fmt:rust`.
- **CI**: `.github/workflows/ci.yml` simplifies to a single Linux job (`bun install` → `bun run lint` → `bun test` → `bunx vite build`). Cross-platform `electrobun build` matrix is a follow-up.

### Removed

- `src-tauri/` crate (Rust backend + cargo toolchain + tauri-driver plan).
- `@tauri-apps/api`, `@tauri-apps/cli`, `@tauri-apps/plugin-opener` deps.
- `vitest.config.ts`, `vitest`, `@vitest/coverage-v8`, `@vue/test-utils`, `happy-dom` dev-deps.
- The `insta` integration-test crate (`src-tauri/tests/ipc_contract.rs`).

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


