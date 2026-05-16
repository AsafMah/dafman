# Dafman - Status
> Live progress board. Update this file whenever you finish a milestone item or learn something that changes direction. Keep entries short; link to commits, issues, and `plans/` for detail.
**Active milestone:** **M1 - Make it solid** (see `plans/plan-roadmap.prompt.md`).
## How to use this file
- Tick items in the milestone checklist as PRs land.
- Add a short "Last completed" line so the next agent knows where to start.
- Move items between sections; do not silently delete.
- Prefer linking to commits / files / plans over re-writing rationale.
---
## Last completed
- `d205151` - `feat(chat): render high-value session events (title, intent, usage, system callouts, model change, turn boundaries)`
- `72c6994` - `feat(diagnostics): log reasoning/error event data + Open log folder button`
- `66a5076` - `fix(chat): drop OpenAI's opaque reasoning blob events (empty content)`
- `899c71b` - `fix(chat): drop alias, suppress empty reasoning cards, add ChatWindow component tests`
- `d971488` - `feat(app): auto-create client on mount + per-event session logging + mockIPC E2E tests`
- `1f737ba` - `feat(chat): per-session model + reasoning effort selectors in chat header`
- `83af904` - `fix(chat): readable reasoning in dark mode, labeled selects`
- `ebf636e` - `feat(chat): reasoning visibility + full-width chat redesign`
- `6b4ff19` - `feat(m1): settings store on disk + Settings dialog (theme persistence)`
- `e2837c1` - `feat(m1): per-session Channel + Pinia stores + typed IPC wrapper`
- `1b8f7de` - `refactor(backend): split lib.rs into app/ + ipc/commands/ with AppError`
## Next concrete step
**Markdown + code-block rendering** for assistant/reasoning content. Reasoning blocks especially are unreadable without code highlight today; the SDK already streams markdown-formatted text, we just render it as `pre-wrap`. Candidates: `marked` + `highlight.js`, or `markdown-it`. Sanitization mandatory (assistant output is untrusted).
Other M1 items still open:
1. **Real permission UX** - blocked on having any tools to permission.
2. **URL elicitation card + `UrlOpener`** - blocked on a real caller (SDK auth flow, MCP OAuth, or clickable links once markdown lands).
3. **Tracing redaction** snapshot tests; runtime `EnvFilter` reload handle. Also: tone down per-event session logging (currently every event hits debug; see `M1-TODO(observability)` comment in `src-tauri/src/ipc/commands/session.rs`).
4. **Real binary E2E via `tauri-driver`** (Linux CI).
5. **Reasoning visible in CLI but missing in our UI for GPT-5.5** - investigate how the upstream CLI decrypts/displays `reasoning_opaque`. Worth a separate session.
## M0 - Foundations (DONE)
- [x] Tauri 2 + Vue 3 + PrimeVue scaffold.
- [x] Single SDK Client lifecycle.
- [x] Multi-session create / disconnect.
- [x] Streaming chat (per-session deltas).
- [x] Responsive grid with per-session accent color.
## M1 - Make it solid (IN PROGRESS)
Definition of done lives in `plans/plan-roadmap.prompt.md`.
- [x] **SDK swap to Supercharged** (git pin `c5c5757e935152c0850a822532036f3eea2ec78e`).
- [x] **Observability baseline** - `tracing` + `tracing-subscriber` + `tracing-appender`; daily JSON file appender under `app_log_dir()`; dev stderr layer; `EnvFilter` from `DAFMAN_LOG`; `#[tracing::instrument]` on every Tauri command (secret args skipped).
- [x] **Testing baseline** - Vitest + `@vue/test-utils` + `happy-dom`; `cargo test` + `insta` + `tempfile`; first lib unit test (`logging::init`), first IPC contract snapshot (`SessionEventPayload`); CI runs both.
- [x] **Centralized scripts** in `package.json` (`npm run test`, `npm run lint`, `npm run check`).
- [x] **AGENTS.md** at repo root per the agents.md standard.
- [x] **Backend module refactor** to the architecture-plan layout (`app/{error,events,state,settings,models}.rs`, `ipc/commands/{client,session,settings,models,diagnostics}.rs`). `AppError` (`thiserror`) replaces `String` returns; `tests/ipc_contract.rs` imports the real `SessionEventPayload`.
- [x] **Per-session Tauri channel** (`tauri::ipc::Channel`) returned from `create_session`; dropped the global `session-event` filter on the frontend. `SessionEventPayload` no longer carries `sessionId` (channel identity scopes events). Added `src/ipc/types.ts` as the TS mirror surface.
- [x] **Pinia stores** (`clientStore`, `sessionsStore`, `toastStore`, `permissionsStore` stub); centralized IPC behind `src/ipc/invoke.ts` (typed via `CommandMap`). PrimeVue `Toast` mounted at the app root; stores push toasts without needing a component context.
- [x] **Typed IPC** - hand-mirror in `src/ipc/types.ts` (`SessionEventPayload`, `Settings`, `AppErrorPayload`, `CommandMap`); evaluate `tauri-specta` for M2.
- [x] **Settings store** on disk (versioned JSON in `app_config_dir()/settings.json`) + minimal Settings dialog (General, Appearance) with three-state theme (system/light/dark). Backend `SettingsService` reads sync at startup, writes via `spawn_blocking`; falls back to defaults on missing/malformed files; future schema bumps go through `Settings::migrate`.
- [x] **Dark mode** persisted via settings store; resolved through `resolveIsDark(theme, prefersDark)`, follows `prefers-color-scheme` when theme = `system`.
- [x] **Auto-create client on mount** - no "Create Client" button; `App.vue` calls `clientStore.createClient()` after settings load.
- [x] **Reasoning visibility** (Settings v2: `Appearance.reasoningVisibility` hidden/compact/expanded, default compact) + per-session header override + `ReasoningBlock.vue`. Tolerates `delta`/`deltaContent`/`text` field-name drift; drops OpenAI's opaque `reasoning_opaque` events.
- [x] **Per-session model + reasoning effort selectors** in chat header (`list_models` / `set_session_model` IPC; `modelsStore` lazy load + dedupe; effort Select only renders when `supports.reasoningEffort`).
- [x] **High-value event types rendered**: `session.title_changed` (header), `session.model_change` (badge + toast), `session.usage_info` / `assistant.usage` (token pill), `assistant.turn_start/end` (real "thinking" boundary), `assistant.intent` (intent pill), `session.info/warning`, `system.notification`, `model.call_failure`, `session.truncation`, `session.compaction_start/complete` - all severity-tinted system cards or ambient surfaces. Explicit no-op cases for `assistant.streaming_delta` (dup), raw `system.message`, `tools_updated`, etc.
- [x] **Session event logging**: forwarder logs `event_type` + `session_id` at debug (default-on via `dafman_lib=debug`); reasoning/error/warning data at debug; everything else's data at trace. `M1-TODO(observability)`: demote per-event log to trace once chat is feature-complete and Settings → Diagnostics log toggle ships.
- [x] **Open log folder** button in Settings → General (`get_log_dir` IPC + `revealItemInDir` from `tauri-plugin-opener`).
- [x] **Dev playground** at `?dev` (DEV-only, tree-shaken from prod): scripted event sequences, custom event JSON pusher, toast firing, and a live `ChatWindow` preview.
- [ ] **Real permission UX** - `PermissionService` replaces `ApproveAllHandler`; modal prompt.
- [ ] **URL elicitation card + `UrlOpener`** with defaults (`https://github.com/login/*` allow-always; `localhost:*` allow-always; everything else ask).
- [ ] **Tracing redaction** snapshot tests; runtime `EnvFilter` reload handle.
- [x] **Frontend store + component tests** to follow the refactor (sessionsStore optimistic flow, ChatPane render).
- [x] **mockIPC E2E** (`src/__tests__/App.e2e.test.ts`) - covers auto-create-client → new-session → stream events → send message without launching the Tauri binary.
- [ ] **Real binary E2E via `tauri-driver` + Playwright** (Linux runner; macOS unsupported as of 2025). One smoke test: launch → new session → send → assert streamed reply.
## Tests at a glance
| Surface | Runner | Status |
|---|---|---|
| Frontend unit (`src/lib/__tests__/`, `src/stores/__tests__/`, `src/components/__tests__/`, `src/ipc/__tests__/`) | Vitest + happy-dom | 78 tests passing |
| Frontend E2E via `mockIPC` (`src/__tests__/App.e2e.test.ts`) | Vitest + happy-dom + `@tauri-apps/api/mocks` | 4 tests passing |
| Backend lib (`src-tauri/src/*.rs`) | `cargo test --lib` | 10 tests passing (`logging`, `app::settings`, `app::models`) |
| Backend integration (`src-tauri/tests/`) | `cargo test` | 7 snapshots passing (`SessionEventPayload`, `Settings`, `ModelSummary`, 4 × `AppError` variants) |
| E2E (Playwright via `tauri-driver`) | _not yet wired_ | - |
## Conventions for agents
Agent contract lives in [`AGENTS.md`](AGENTS.md) at the repo root (per the [agents.md](https://agents.md/) standard). Highlights:
- Read `plans/plan-overview.prompt.md` first; it indexes everything else.
- No hardcoded hex colors - use `var(--p-*)` PrimeVue tokens. Per-session accent (`accentForSession` from `src/lib/color.ts`) is the only exception.
- Domain modules do not import `tauri::*`; only `ipc/` and `app/` do.
- Every new Tauri command: `#[tracing::instrument(skip(...))]` with secrets skipped.
- Every new IPC type: add a snapshot test in `src-tauri/tests/ipc_contract.rs` and a TS mirror in `src/ipc/types.ts` (once it exists).
- Run `npm run check` before committing.
- Update this file when you finish a milestone item or change direction.
## Open questions / decisions to make
- Product name (still `dafman`).
- `tauri-specta` adoption timing (currently planned for M2).
- Editor: Monaco vs CodeMirror 6 for the M7 diff viewer.
- MCP scope per release (full vs minimal).