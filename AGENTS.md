# AGENTS.md
> Standard agent-instructions file per [agents.md](https://agents.md/).
> Stewarded by the Agentic AI Foundation (LF Projects). Read this first.

## Project overview
**Dafman** is a desktop replacement for the GitHub Copilot CLI, built on **[Electrobun](https://docs.electrobunny.ai/electrobun/)** (native webview shell driven by Bun) with a Vue 3 renderer. Multi-pane streaming chat with multiple sessions/projects/accounts, visible reasoning and tool calls, full permission model, MCP integrations, and an editor surface for diffs and files.
- Main process (Bun): TypeScript + `copilot-sdk-supercharged` (npm).
- Renderer: Vue 3 + Vite + TypeScript + PrimeVue (Aura preset) + Pinia.
- One language end-to-end. The repo is **TypeScript + Bun only** — no Rust, no Cargo, no Tauri.
- Always read `STATUS.md` first — it has the active milestone, last-completed commits, and the next concrete step.
- Source of truth for direction is `plans/`; index lives in `plans/plan-overview.prompt.md`.

## Setup commands
```bash
bun install                   # all deps (renderer + main process + tests)
```
The Copilot CLI is bundled as a dep of `copilot-sdk-supercharged`; nothing else to install.

## Dev commands
| Want to… | Run |
|---|---|
| run everything (lint + tests + build) | `bun run check` |
| run tests (bun test) | `bun test` |
| watch tests | `bun test --watch` |
| coverage report | `bun test --coverage` |
| lint everything (vue-tsc -b) | `bun run lint` |
| start the app in dev | `bun run dev` |
| start dev with frontend HMR | `bun run dev:hmr` |
| build a release bundle | `bun run build` |

All commands live in `package.json` — that is the single source of truth.

## Code style
### Bun / main process (`src-bun/`)
- **Domain modules don't import from `electrobun/bun`.** Only `src-bun/index.ts` may touch BrowserWindow / BrowserView / Utils. Everything under `src-bun/app/` is framework-agnostic so `bun test` can exercise it directly.
- **Never throw raw JS `Error` from RPC handlers.** Wrap every handler with `rpcGuard` (`src-bun/app/errors.ts`); unknown failures serialize as `AppErrorPayload` discriminated union.
- **No background tasks without lifecycle.** Long-running work (forwarders, subscriptions) returns an unsubscribe callback that the registry calls on cleanup.
- **Log with structured fields.** Use `log.info("msg", { key: val })` from `src-bun/app/logging.ts`; the JSON-lines layout is part of the wire contract for the in-app log viewer.

### TypeScript / Vue (`src/`)
- `strict: true`.
- **No raw `electrobun.rpc.request(...)` in components.** Wrap in `src/ipc/invoke.ts`; the typed `CommandMap` in `src/ipc/types.ts` is the source of truth.
- **No hardcoded hex colors.** Use `var(--p-*)` PrimeVue tokens. Per-session accents (`accentForSession` from `src/lib/color.ts`) are the only exception.
- Components are dumb; data + actions live in composables / Pinia stores.
- Vue SFCs in `<script setup lang="ts">`.

## Testing instructions
- CI is `.github/workflows/ci.yml`. It runs the same scripts you do locally.
- **Always run `bun run check` before committing.** It runs `lint` + `test` + `vite build` + `electrobun build`.
- One runner everywhere: `bun test`. The Vue SFC loader at `tools/bun-vue-loader.ts` is preloaded via `bunfig.toml` so `.vue` files import natively into `bun test`.
- Backend tests live under `src-bun/__tests__/`. Renderer tests live next to source under `src/**/__tests__/`. Wire-shape snapshots are bun's built-in `toMatchSnapshot()` (no `insta`).
- When you add or change an IPC type, update both `src-bun/rpc.ts` (single source of truth) and the TS mirror in `src/ipc/types.ts`. Add a wire-shape snapshot in `src-bun/__tests__/wire-contract.test.ts`.
- Fix any test or type errors until the whole suite is green.
- Add or update tests for the code you change, even if nobody asked.

## PR instructions
- **Title format:** Conventional Commits — `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, scoped where helpful (`feat(chat): ...`).
- Always run `bun run check` before pushing.
- Update `STATUS.md` when you complete a milestone item or change direction.
- Update `CHANGELOG.md` under `## [Unreleased]`.
- If your change affects direction, update the relevant document in `plans/`.
- Include screenshots / GIFs for UI changes.

## Security considerations
- **Never commit secrets.** GitHub tokens and BYOK credentials live in the OS keyring (planned in M4). Logs redact by default (`plans/plan-observability.prompt.md`).
- Every privileged action (file write, shell, network, browser open, MCP install) must go through the permission system (`plans/plan-toolsAndPermissions.prompt.md`).
- For vulnerabilities, **do not open a public issue**. Follow [`SECURITY.md`](SECURITY.md) — file privately via GitHub Security Advisories.

## Architecture pointers
- `plans/plan-architecture.prompt.md` — backend & frontend module layout, IPC contract, state, errors.
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
- Domain modules under `src-bun/app/` don't import `electrobun/bun`.
- Never throw raw `Error` from an RPC handler — go through `rpcGuard`.
- Tests stay green: `bun run check` must succeed.
- Update `STATUS.md` after every milestone item.

## Monorepo / nested AGENTS.md
This repo is a single Bun project: `src-bun/` (main process) + `src/` (Vue renderer) + `tools/` (Bun plugins). No nested `AGENTS.md` files. If we split into multiple Bun workspaces, add `AGENTS.md` next to each package that has package-specific guidance.
