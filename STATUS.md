# Dafman — Status
> Live progress board. Update this file whenever you finish a milestone item or learn something that changes direction. Keep entries short; link to commits, issues, and `plans/` for detail.
**Active milestone:** **M1 — Make it solid** (see `plans/plan-roadmap.prompt.md`).
## How to use this file
- Tick items in the milestone checklist as PRs land.
- Add a short "Last completed" line so the next agent knows where to start.
- Move items between sections; don''t silently delete.
- Prefer linking to commits / files / plans over re-writing rationale.
---
## Last completed
- `643493d` — `chore(test): ignore insta *.pending-snap artifacts`
- `7d26d5d` — `test(m1): testing baseline (vitest + cargo test + insta + CI)`
- `5e05456` — `feat(m1): swap to Supercharged SDK pin + add tracing observability baseline`
- `0f03190` — `docs(plans): add observability plan`
- `993aeef` — `chore: scaffold standard repo files`
## Next concrete step
**Backend module refactor.** Split `src-tauri/src/lib.rs` into the layout in `plans/plan-architecture.prompt.md`:
- `app/{state,error,events,config}.rs` (introduce `AppError` via `thiserror`).
- `ipc/commands/{client,session,permission,external,ui,settings}.rs`.
- `client/manager.rs`, `sessions/{manager,entry,stream,handler}.rs`, `external/{mod,policy}.rs`, `permissions/{policy,rules,service}.rs`.
Snapshot tests in `src-tauri/tests/ipc_contract.rs` should still pass without changes after the move.
## M0 — Foundations (DONE)
- [x] Tauri 2 + Vue 3 + PrimeVue scaffold.
- [x] Single SDK Client lifecycle.
- [x] Multi-session create / disconnect.
- [x] Streaming chat (per-session deltas).
- [x] Responsive grid with per-session accent color.
## M1 — Make it solid (IN PROGRESS)
Definition of done lives in `plans/plan-roadmap.prompt.md`.
- [x] **SDK swap → Supercharged** (git pin `c5c5757e935152c0850a822532036f3eea2ec78e`).
- [x] **Observability baseline** — `tracing` + `tracing-subscriber` + `tracing-appender`; daily JSON file appender under `app_log_dir()`; dev stderr layer; `EnvFilter` from `DAFMAN_LOG`; `#[tracing::instrument]` on all Tauri commands (secret args skipped).
- [x] **Testing baseline** — Vitest + `@vue/test-utils` + `happy-dom`; `cargo test` + `insta` + `tempfile`; first lib unit test (`logging::init`), first IPC contract snapshot (`SessionEventPayload`); CI runs both.
- [x] **Centralized scripts** in `package.json` (`npm run test`, `npm run lint`, `npm run check`).
- [ ] **Backend module refactor** to the architecture plan layout (`app/`, `ipc/`, `client/`, `sessions/`, `external/`, `permissions/`).
- [ ] **Per-session Tauri channel** (`tauri::ipc::Channel`) returned from `create_session`; drop the global `session-event` filter on the frontend.
- [ ] **Pinia stores** (`clientStore`, `sessionsStore`, `permissionsStore`, `toastStore`); centralize IPC wrappers in `src/ipc/`.
- [ ] **Typed IPC** — hand-mirror in `src/ipc/types.ts`; evaluate `tauri-specta` for M2.
- [ ] **Settings store** on disk (versioned JSON) + minimal Settings dialog (General, Appearance).
- [ ] **Dark mode** persisted via settings store; token-driven.
- [ ] **Real permission UX** — `PermissionService` replaces `ApproveAllHandler`; modal prompt.
- [ ] **URL elicitation card + `UrlOpener`** with defaults (`https://github.com/login/*` allow-always; `localhost:*` allow-always; everything else ask).
- [ ] **Tracing redaction** snapshot tests; runtime `EnvFilter` reload handle.
- [ ] **Frontend store + component tests** to follow the refactor (sessionsStore optimistic flow, ChatPane render).
- [ ] **One Playwright smoke test** (first-run → create client → create session → send → see streaming reply).
## Tests at a glance
| Surface | Runner | Status |
|---|---|---|
| Frontend unit (`src/lib/__tests__/`) | Vitest + happy-dom | 8 tests passing |
| Backend lib (`src-tauri/src/*.rs`) | `cargo test --lib` | 1 test passing |
| Backend integration (`src-tauri/tests/`) | `cargo test` | 1 snapshot passing |
| E2E (Playwright) | _not yet wired_ | — |
## Conventions for agents
- Read `plans/plan-overview.prompt.md` first; it indexes everything else.
- Don''t add ad-hoc CSS hex colors — use `var(--p-*)` PrimeVue tokens. Per-session accent is the only exception.
- Domain modules don''t import `tauri::*`; only `ipc/` and `app/` do.
- Every new Tauri command: `#[tracing::instrument(skip(...))]` with secrets skipped.
- Every new IPC type: add a snapshot test in `src-tauri/tests/ipc_contract.rs` and a TS mirror in `src/ipc/types.ts` (once it exists).
- Run `npm run check` before committing.
- Update this file when you finish a milestone item or change direction.
## Open questions / decisions to make
- Product name (still `dafman`).
- `tauri-specta` adoption timing (currently planned for M2).
- Editor: Monaco vs CodeMirror 6 for the M7 diff viewer.
- MCP scope per release (full vs minimal).