# AGENTS.md
> Standard agent-instructions file per [agents.md](https://agents.md/).
> Stewarded by the Agentic AI Foundation (LF Projects). Read this first.
## Project overview
**Dafman** is a Tauri (Rust + Vue 3) desktop replacement for the GitHub Copilot CLI. Multi-pane streaming chat with multiple sessions/projects/accounts, visible reasoning and tool calls, full permission model, MCP integrations, and an editor surface for diffs and files.
- Backend: Rust + tokio + `github-copilot-sdk` (Supercharged distribution, git-pinned).
- Frontend: Vue 3 + Vite + TypeScript + PrimeVue (Aura preset).
- Always read `STATUS.md` first — it has the active milestone, last-completed commits, and the next concrete step.
- Source of truth for direction is `plans/`; index lives in `plans/plan-overview.prompt.md`.
## Setup commands
```bash
npm install                   # frontend + Tauri deps
# Optional: install the Copilot CLI if it isn''t on PATH already.
# See https://github.com/github/copilot-cli — or set COPILOT_CLI_PATH.
```
## Dev commands
| Want to… | Run |
|---|---|
| run everything (lint + tests + build) | `npm run check` |
| run frontend tests (vitest) | `npm test` |
| run backend tests (cargo) | `npm run test:rust` |
| run both test suites | `npm run test:all` |
| lint everything (vue-tsc + clippy + fmt) | `npm run lint` |
| auto-format Rust | `npm run fmt:rust` |
| start the app in dev | `npm run tauri dev` |
| build a release bundle | `npm run tauri build` |
| watch frontend tests | `npm run test:watch` |
| coverage report | `npm run test:coverage` |
All commands live in `package.json` — that is the single source of truth.
## Code style
### Rust (`src-tauri/`)
- Edition 2021. `cargo fmt` enforced. `cargo clippy -D warnings` enforced.
- **No `unwrap()` in command paths.** Use `AppError` (`thiserror`) and `?`.
- **Domain modules don''t import `tauri::*`.** Only `ipc/` and `app/` may touch Tauri types.
- **Async-correct.** `tokio::sync::Mutex` across `.await`; never `std::sync::Mutex`.
- **`#[tracing::instrument(skip(...))]`** on every Tauri command. Skip secret args; record their `len`.
- Long-running tasks store `JoinHandle`s and abort them on teardown.
### TypeScript / Vue (`src/`)
- `strict: true`, `noUncheckedIndexedAccess: true`.
- **No raw `invoke()` in components.** Wrap in `src/ipc/invoke.ts` (introduced in M1).
- **No hardcoded hex colors.** Use `var(--p-*)` PrimeVue tokens. Per-session accents (`accentForSession` from `src/lib/color.ts`) are the only exception.
- Components are dumb; data + actions live in composables / Pinia stores.
- Vue SFCs in `<script setup lang="ts">`.
## Testing instructions
- CI is `.github/workflows/ci.yml`. It runs the same npm scripts you do locally.
- **Always run `npm run check` before committing.** It runs lint + all tests + build.
- Frontend tests live next to source under `__tests__/` (Vitest, `happy-dom` env).
- Backend unit tests live in `#[cfg(test)] mod tests` inside the module.
- Backend integration tests live in `src-tauri/tests/*.rs` and snapshot IPC wire shapes with `insta` (inline snapshots preferred for small payloads).
- When you add or change an IPC type, update `src-tauri/tests/ipc_contract.rs` and (once introduced) the TS mirror in `src/ipc/types.ts`.
- Fix any test or type errors until the whole suite is green.
- Add or update tests for the code you change, even if nobody asked.
## PR instructions
- **Title format:** Conventional Commits — `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, scoped where helpful (`feat(chat): ...`).
- Always run `npm run check` before pushing.
- Update `STATUS.md` when you complete a milestone item or change direction.
- Update `CHANGELOG.md` under `## [Unreleased]`.
- If your change affects direction, update the relevant document in `plans/`.
- Include screenshots / GIFs for UI changes.
## Security considerations
- **Never commit secrets.** GitHub tokens and BYOK credentials live in the OS keyring (planned in M4). Logs redact by default (`plans/plan-observability.prompt.md`).
- Every privileged action (file write, shell, network, browser open, MCP install) must go through the permission system (`plans/plan-toolsAndPermissions.prompt.md`).
- For vulnerabilities, **do not open a public issue**. Follow [`SECURITY.md`](SECURITY.md) — file privately via GitHub Security Advisories.
## Architecture pointers
- `plans/plan-architecture.prompt.md` — backend & frontend module layout, IPC contract, state, errors, threading.
- `plans/plan-sdkAndExternalSurfaces.prompt.md` — SDK pinning, URL/browser surface, MCP OAuth, `session.ui`, image generation.
- `plans/plan-toolsAndPermissions.prompt.md` — built-in tools, permission model, URL policy, MCP.
- `plans/plan-platformFeatures.prompt.md` — projects, accounts, skills, agents, automations.
- `plans/plan-messagingAndUx.prompt.md` — chat UX, reasoning, tools display, markdown, settings UI.
- `plans/plan-observability.prompt.md` — logging, tracing, metrics, audit, perf budgets.
- `plans/plan-testingStrategy.prompt.md` — test pyramid, fakes, snapshot tests, e2e, CI.
- `plans/plan-roadmap.prompt.md` — milestones M0–M7 with definition-of-done.
## Hard rules (do not violate)
- Never invent direction. If a feature is not in `plans/` or `STATUS.md`, ask before adding it.
- Never commit secrets, tokens, or raw prompt content.
- Domain modules don''t import `tauri::*`.
- No `unwrap()` in command paths.
- Tests stay green: `npm run check` must succeed.
- Update `STATUS.md` after every milestone item.
## Monorepo / nested AGENTS.md
This repo is currently a single crate (`src-tauri`) + a single Vue app (`src/`). No nested `AGENTS.md` files yet. If we split into a Cargo workspace per `plans/plan-architecture.prompt.md` "Build & release" section, add `AGENTS.md` to each crate that has package-specific guidance.