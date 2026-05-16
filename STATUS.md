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
- `1b8f7de` - `refactor(backend): split lib.rs into app/ + ipc/commands/ with AppError`
- `b073ead` - `docs: adopt AGENTS.md standard at repo root (agents.md spec)`
- `0e1587d` - `chore: centralize dev commands in package.json + add STATUS.md + copilot-instructions`
- `7d26d5d` - `test(m1): testing baseline (vitest + cargo test + insta + CI)`
- `5e05456` - `feat(m1): swap to Supercharged SDK pin + add tracing observability baseline`
## Next concrete step
**Per-session Tauri channel** (`tauri::ipc::Channel<T>`). Replace the global `session-event` with a channel handle returned from `create_session`; the frontend subscribes directly per pane and drops the `payload.sessionId === sessionId` filter in `ChatWindow.vue`. `src-tauri/tests/ipc_contract.rs` already imports the real `SessionEventPayload`, so renaming/moving fields will fail loudly.
After that, in order:
1. **Pinia stores** (`clientStore`, `sessionsStore`, `permissionsStore`, `toastStore`) + central `src/ipc/invoke.ts` wrapper.
2. **Settings store on disk** (versioned JSON) + minimal Settings dialog persisting dark mode.
3. **Real permission UX** (`PermissionService` -> modal prompt).
4. **URL elicitation card + `UrlOpener`** with policy defaults.
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
- [ ] **Per-session Tauri channel** (`tauri::ipc::Channel`) returned from `create_session`; drop the global `session-event` filter on the frontend.
- [ ] **Pinia stores** (`clientStore`, `sessionsStore`, `permissionsStore`, `toastStore`); centralize IPC wrappers in `src/ipc/`.
- [ ] **Typed IPC** - hand-mirror in `src/ipc/types.ts`; evaluate `tauri-specta` for M2.
- [ ] **Settings store** on disk (versioned JSON) + minimal Settings dialog (General, Appearance).
- [ ] **Dark mode** persisted via settings store; token-driven.
- [ ] **Real permission UX** - `PermissionService` replaces `ApproveAllHandler`; modal prompt.
- [ ] **URL elicitation card + `UrlOpener`** with defaults (`https://github.com/login/*` allow-always; `localhost:*` allow-always; everything else ask).
- [ ] **Tracing redaction** snapshot tests; runtime `EnvFilter` reload handle.
- [ ] **Frontend store + component tests** to follow the refactor (sessionsStore optimistic flow, ChatPane render).
- [ ] **One Playwright smoke test** (first-run -> create client -> create session -> send -> see streaming reply).
## Tests at a glance
| Surface | Runner | Status |
|---|---|---|
| Frontend unit (`src/lib/__tests__/`) | Vitest + happy-dom | 8 tests passing |
| Backend lib (`src-tauri/src/*.rs`) | `cargo test --lib` | 1 test passing (`logging`) |
| Backend integration (`src-tauri/tests/`) | `cargo test` | 1 snapshot passing |
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