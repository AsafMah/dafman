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
- `1f737ba` - `feat(chat): per-session model + reasoning effort selectors in chat header`
- `83af904` - `fix(chat): readable reasoning in dark mode, labeled selects, friendly session aliases`
- `ebf636e` - `feat(chat): reasoning visibility + full-width chat redesign`
- `6b4ff19` - `feat(m1): settings store on disk + Settings dialog (theme persistence)`
- `e2837c1` - `feat(m1): per-session Channel + Pinia stores + typed IPC wrapper`
- `1b8f7de` - `refactor(backend): split lib.rs into app/ + ipc/commands/ with AppError`
- `b073ead` - `docs: adopt AGENTS.md standard at repo root (agents.md spec)`
- `0e1587d` - `chore: centralize dev commands in package.json + add STATUS.md + copilot-instructions`
- `7d26d5d` - `test(m1): testing baseline (vitest + cargo test + insta + CI)`
- `5e05456` - `feat(m1): swap to Supercharged SDK pin + add tracing observability baseline`
## Next concrete step
Pick a real-caller-grounded next step. **Markdown + code-block rendering** for assistant/reasoning content is a strong candidate — it directly improves what just landed (reasoning blocks would be far more readable with code highlight). After that, real permission UX / URL elicitation will land once we have a tool surface or MCP that actually elicits.
Other M1 items still open:
1. **Real permission UX** — blocked on having any tools to permission.
2. **URL elicitation card + `UrlOpener`** — blocked on a real caller (SDK auth flow, MCP OAuth, or clickable links once markdown lands).
3. **Tracing redaction** snapshot tests; runtime `EnvFilter` reload handle.
4. **One Playwright smoke test** (first-run → create client → create session → send → see streaming reply).
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
- [x] **Backend module refactor** to the architecture-plan layout (`app/{error,events,state}.rs`, `ipc/commands/{client,session}.rs`). `AppError` (`thiserror`) replaces `String` returns; `tests/ipc_contract.rs` imports the real `SessionEventPayload`.
- [x] **Per-session Tauri channel** (`tauri::ipc::Channel`) returned from `create_session`; dropped the global `session-event` filter on the frontend. `SessionEventPayload` no longer carries `sessionId` (channel identity scopes events). Added `src/ipc/types.ts` as the TS mirror surface.
- [x] **Pinia stores** (`clientStore`, `sessionsStore`, `toastStore`, `permissionsStore` stub); centralized IPC behind `src/ipc/invoke.ts` (typed via `CommandMap`). PrimeVue `Toast` mounted at the app root; stores push toasts without needing a component context.
- [x] **Typed IPC** - hand-mirror in `src/ipc/types.ts` (`SessionEventPayload`, `Settings`, `AppErrorPayload`, `CommandMap`); evaluate `tauri-specta` for M2.
- [x] **Settings store** on disk (versioned JSON in `app_config_dir()/settings.json`) + minimal Settings dialog (General, Appearance) with three-state theme (system/light/dark). Backend `SettingsService` reads sync at startup, writes via `spawn_blocking`; falls back to defaults on missing/malformed files; future schema bumps go through `Settings::migrate`.
- [x] **Dark mode** persisted via settings store; resolved through `resolveIsDark(theme, prefersDark)`, follows `prefers-color-scheme` when theme = `system`.
- [ ] **Real permission UX** - `PermissionService` replaces `ApproveAllHandler`; modal prompt.
- [ ] **URL elicitation card + `UrlOpener`** with defaults (`https://github.com/login/*` allow-always; `localhost:*` allow-always; everything else ask).
- [ ] **Tracing redaction** snapshot tests; runtime `EnvFilter` reload handle.
- [x] **Frontend store + component tests** to follow the refactor (sessionsStore optimistic flow, ChatPane render).
- [ ] **One Playwright smoke test** (first-run -> create client -> create session -> send -> see streaming reply).
## Tests at a glance
| Surface | Runner | Status |
|---|---|---|
| Frontend unit (`src/lib/__tests__/`, `src/stores/__tests__/`) | Vitest + happy-dom | 32 tests passing |
| Backend lib (`src-tauri/src/*.rs`) | `cargo test --lib` | 6 tests passing (`logging`, `app::settings`) |
| Backend integration (`src-tauri/tests/`) | `cargo test` | 3 snapshots passing (`SessionEventPayload`, `Settings`, `ModelSummary`) |
| E2E (Playwright) | _not yet wired_ | - |
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