# Copilot / agent instructions for Dafman
You are working on **Dafman** — a Tauri (Rust + Vue 3) desktop replacement for the GitHub Copilot CLI. Before doing anything substantive, read:
1. `STATUS.md` — current progress and the next concrete step.
2. `plans/plan-overview.prompt.md` — vision, principles, decisions register, document index.
3. `plans/plan-architecture.prompt.md` — backend & frontend module layout, IPC contract, state, errors.
4. `plans/plan-roadmap.prompt.md` — milestones M0–M7. We''re in M1.
When in doubt, the plan in `plans/` is the source of truth.
## Hard rules
- **Never invent direction.** If a feature is not in `plans/` or `STATUS.md`, ask before adding it.
- **Update `STATUS.md`** whenever you finish a milestone item or change direction.
- **Never commit secrets.** Tokens live in the OS keyring (see `plans/plan-platformFeatures.prompt.md`); logs redact them by default (see `plans/plan-observability.prompt.md`).
- **Tests stay green.** Run `npm run check` before committing.
- **No `unwrap()` in command paths.** Use `AppError` (`thiserror`).
- **Domain modules don''t import `tauri::*`.** Only `ipc/` and `app/` know about Tauri.
- **`var(--p-*)` PrimeVue tokens** for colors. Per-session accents (`accentForSession`) are the only exception.
- **`#[tracing::instrument(skip(...))]`** on every new Tauri command; skip secret args, record their `len`.
## Useful commands (single source of truth)
| Want to… | Run |
|---|---|
| run everything (lint + tests + build) | `npm run check` |
| run frontend tests | `npm test` |
| run backend tests | `npm run test:rust` |
| run both test suites | `npm run test:all` |
| run lint (clippy + fmt + vue-tsc) | `npm run lint` |
| start the app in dev | `npm run tauri dev` |
| build a release bundle | `npm run tauri build` |
## File conventions
- Frontend tests live next to source under `__tests__/` (Vitest, `happy-dom`).
- Backend unit tests live in `#[cfg(test)] mod tests` inside the module.
- Backend integration tests live in `src-tauri/tests/*.rs` and snapshot IPC shapes via `insta` (inline snapshots preferred for small payloads).
- Plan documents follow `plan-<name>.prompt.md` and live in `plans/`.
## Pull request checklist
- [ ] `STATUS.md` updated.
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`.
- [ ] Tests added or updated.
- [ ] `npm run check` is green.
- [ ] Plan docs in `plans/` updated if you changed direction.