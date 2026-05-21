# AGENTS.md

> Standard agent-instructions file per [agents.md](https://agents.md/).
> Read this first. **The Anti-laziness rules at the bottom are not optional.**

## Project overview

**Dafman** is a desktop UI for the GitHub Copilot CLI, built on
[Electrobun](https://docs.electrobunny.ai/electrobun/) (native webview shell
driven by Bun) with a Vue 3 renderer. Streaming chat with multiple sessions /
workspaces, visible reasoning and tool calls, real permission gates with rule
editor, inline file/image attachments, command palette, dark mode.

- Main process (Bun): TypeScript + `copilot-sdk-supercharged`.
- Renderer: Vue 3 + Vite + TypeScript + PrimeVue (Aura preset) + Pinia.
- One language end-to-end. The repo is **TypeScript + Bun only** — no Rust,
  no Cargo, no Tauri, no Electron.

## Required reading order (for every new session)

1. **`STATUS.md`** — active milestone, last-completed entries, next concrete step.
2. **`DEVLOG.md`** — what the previous agent did, what they found, what's still
   tribal knowledge.
3. **`ARCHITECTURE.md`** — current module map + lifecycle invariants +
   SDK gotchas.
4. Whatever **`plans/*.prompt.md`** is relevant to your task (index at
   `plans/plan-overview.prompt.md`).

If your task touches the IPC wire contract, also read `src-bun/rpc.ts` and
`src/ipc/types.ts` — they MUST stay in sync.

## Setup commands

```bash
bun install                   # all deps (renderer + main process + tests)
```

The Copilot CLI binary is bundled as a dep of `copilot-sdk-supercharged`;
nothing else to install.

## Dev commands

| Want to… | Run |
|---|---|
| Full gate (lint + tests + build + smoke) | `bun run check` |
| Run tests | `bun test` |
| Watch tests | `bun test --watch` |
| Coverage report | `bun test --coverage` |
| Lint (vue-tsc) | `bun run lint` |
| Start the app in dev | `bun run dev` |
| Start with frontend HMR | `bun run dev:hmr` |
| Build a release bundle | `bun run build` |
| Renderer smoke (Playwright + chromium) | `bun run smoke` |

All commands live in `package.json` — that is the single source of truth.

## Code style

### Bun / main process (`src-bun/`)

- **Domain modules under `src-bun/app/` MUST NOT import from
  `electrobun/bun`.** Only `src-bun/index.ts` may touch BrowserWindow /
  BrowserView / Utils. Everything under `src-bun/app/` is framework-agnostic
  so `bun test` can exercise it directly.
- **Never throw raw JS `Error` from RPC handlers.** Wrap every handler with
  `rpcGuard` from `src-bun/app/errors.ts`; unknown failures serialize as
  `AppErrorPayload` discriminated union.
- **No background tasks without lifecycle.** Long-running work (forwarders,
  subscriptions, timers) returns an unsubscribe callback that the registry
  calls on cleanup.
- **Log with structured fields.** `log.info("msg", { key: val })` from
  `src-bun/app/logging.ts`. The JSON-lines layout is part of the wire
  contract for the in-app log viewer.

### TypeScript / Vue (`src/`)

- `strict: true`; SFCs in `<script setup lang="ts">`.
- **No raw `electrobun.rpc.request(...)` in components.** Always go through
  `src/ipc/invoke.ts`; the typed `CommandMap` in `src/ipc/types.ts` is the
  source of truth.
- **No hardcoded hex colors.** Use `var(--p-*)` PrimeVue tokens. Per-session
  accents (`accentForSession` in `src/lib/color.ts`) are the only exception.
- Components are dumb; data + actions live in composables / Pinia stores.
- **Dockview is the layout primitive.** New persistent surfaces (sidebars,
  status bars, log viewer, picker) are dockview **edge groups** via
  `layoutStore.openEdgePanel(position, options)` — not new chrome. The
  ActivityBar rail holds only global toggles.
- **Panel id = session id.** Always `addPanel({ id: sessionId, … })`. Lets us
  extract session ids from the persisted layout JSON via `Object.keys(layout.panels)`.
- **`sessionsStore.SessionRecord` is the runtime source of truth** for
  per-session state. Don't duplicate any of it into the dockview layout
  JSON — that blob is opaque UI shape only.
- **Push session events through `sessionsStore.appendEvent`**, not directly to
  `record.events`. This is what bounds memory to `MAX_EVENTS_PER_SESSION`
  and keeps `droppedEventCount` consistent for consumers.

### SDK gotchas (codified — already burned, don't re-burn)

See `ARCHITECTURE.md` §8 for the full list. Highlights:
- **Bundled CLI JS entrypoint needs Node ≥ 24.** `src-bun/app/client.ts`
  resolves the prebuilt `@github/copilot-${platform}-${arch}` binary to dodge
  this.
- **Permissions are deny-by-default.** Without `onPermissionRequest` wired,
  every tool call silently fails.
- **Reasoning is on `assistant.message`, not `assistant.reasoning*`.**
  `data.reasoningText` / `reasoningOpaque` / `encryptedContent` carry it.
- **dockview-vue panel props re-wrap.** Normalize both shapes.
- **Lexical DecoratorNode handlers must capture data locally** before
  attaching listeners (proxy throws on later reads).
- **Reach for SDK hooks before reimplementing tools.** `onPreToolUse` /
  `onPostToolUse` / `registerTools` / `availableTools` / `excludedTools`
  cover most of what you'd want.

## Testing instructions

- CI is `.github/workflows/ci.yml`. It runs the same scripts you do locally.
- **Always run `bun run check` before claiming a task done.** It runs
  `lint` + `test` + `vite build` + `electrobun build` + Playwright `smoke`.
- One runner everywhere: `bun test`. The Vue SFC loader at
  `tools/bun-vue-loader.ts` is preloaded via `bunfig.toml` so `.vue` files
  import natively into `bun test`.
- Backend tests live under `src-bun/__tests__/`. Renderer tests live next to
  source under `src/**/__tests__/`. Lexical-level tests in
  `src/lexical/__tests__/`. Wire-shape snapshots are bun's built-in
  `toMatchSnapshot()` (no `insta`).
- When you add or change an IPC type, update **both** `src-bun/rpc.ts` and
  the mirror in `src/ipc/types.ts`. Add a wire-shape snapshot in
  `src-bun/__tests__/wire-contract.test.ts`.
- Fix any test or type errors until the whole suite is green.
- **Add or update tests for the code you change, even if nobody asked.**

## PR / commit instructions

- **Title format:** Conventional Commits — `feat:`, `fix:`, `docs:`,
  `chore:`, `test:`, `refactor:`, scoped where helpful (`feat(chat): ...`).
- Always run `bun run check` before pushing.
- Update `STATUS.md` when you complete a milestone item or change direction.
- Update `CHANGELOG.md` under `## [Unreleased]` for user-visible changes.
- Append to `DEVLOG.md` for every substantive session.
- If your change affects direction, update the relevant `plans/` doc.
- Include screenshots / GIFs for UI changes.
- Commits include the `Co-authored-by: Copilot` trailer unless explicitly
  told not to.

## Security considerations

- **Never commit secrets.** GitHub tokens and BYOK credentials live in the
  OS keyring (planned in M4). Logs redact by default
  (see `plans/plan-observability.prompt.md`).
- Every privileged action (file write, shell, network, browser open, MCP
  install) must go through the permission system
  (`plans/plan-toolsAndPermissions.prompt.md`).
- For vulnerabilities, follow [`SECURITY.md`](SECURITY.md) — file privately
  via GitHub Security Advisories. Do not open public issues.

## Architecture pointers

- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — current reality (module map,
  invariants, SDK gotchas). Read this first for any non-trivial task.
- `plans/plan-frontend-shell.prompt.md` — dockview/Vue shell design.
- `plans/plan-sdkAndExternalSurfaces.prompt.md` — SDK pinning, URL/browser
  surface, MCP OAuth, `session.ui`, image generation.
- `plans/plan-toolsAndPermissions.prompt.md` — built-in tools, permission
  model, URL policy, MCP.
- `plans/plan-platformFeatures.prompt.md` — projects, accounts, skills,
  agents, automations.
- `plans/plan-messagingAndUx.prompt.md` — chat UX, reasoning, tools display,
  markdown, settings UI.
- `plans/plan-observability.prompt.md` — logging, tracing, metrics, audit,
  perf budgets.
- `plans/plan-testingStrategy.prompt.md` — test pyramid, fakes, snapshot
  tests, E2E, CI.
- `plans/plan-roadmap.prompt.md` — milestones M0–M7 with definition-of-done.
- `plans/plan-architecture.prompt.md` — **legacy Tauri layout**; historical
  context only.

---

## Anti-laziness rules (HARD)

These exist because real regressions kept landing under the previous lax
contract. Treat them as binding, not aspirational.

### 1. Never declare a task done with half-work

- "It compiles" is not done.
- "Tests pass" is not done if you didn't run `bun run smoke` for any change
  that touches the renderer bundle, CSS imports, prism grammar order,
  Lexical plugins, or dockview wiring.
- "I added the rendering but the click handler isn't hooked up yet" is not
  done. Ship the click handler or don't claim the feature.
- If the user reports a feature is broken after you say it's done, the rule
  was violated. Re-read this list before continuing.

### 2. Always run the full gate before claiming done

Minimum gate:
1. `bun run lint`
2. `bun test`
3. `bun run smoke` (for any UI / bundle / SDK / IPC / Lexical change)

For dependency changes or settings-schema bumps, also `bun run check` (full).
If the gate fails, you fix it before claiming done.

### 3. Always update the running docs

Every substantive session ends with:
- **`STATUS.md`** updated if you completed a milestone item or changed
  direction. Move items from open to done; don't silently delete them.
- **`DEVLOG.md`** gets a new entry (top of file). One H2 per session.
  Lead with the takeaway. Capture investigation notes that don't fit in a
  commit message — wire-protocol facts, SDK quirks, dead ends.
- **`CHANGELOG.md`** under `## [Unreleased]` for any user-visible change.
- **`ARCHITECTURE.md`** updated if you changed a module structure, an
  invariant, or an IPC surface significantly.
- **`plans/*.prompt.md`** updated if your change affects direction. Don't
  let plans drift silently.

### 4. No unverified claims

- Don't claim a CLI / SDK / library behaves a certain way without checking
  it. Read the source if you have to. (Example precedent: the
  `reasoning_opaque` investigation in 2026-05-21's DEVLOG entry — the SDK
  schema declared `assistant.reasoning_delta` events; the bundled CLI never
  emitted them. Reading `node_modules/@github/copilot/app.js` settled it.)
- Don't claim a regression is fixed without a test that fails before and
  passes after. Especially for store / reducer / wire-protocol bugs where
  you can write a unit test cheaply.
- Don't claim a UI change works without running it (`bun run dev`,
  `bun run smoke`, or a unit-test render with `@testing-library/vue`).

### 5. Test-first for behavior changes

- Before fixing a bug: write a failing test (or describe in
  `DEVLOG.md` why a test would have been disproportionately expensive).
- Before adding a new behavior: write the test alongside the code, not
  after.
- Renderer-side tests use the Vue SFC loader at `tools/bun-vue-loader.ts`;
  Lexical custom nodes ship a real-editor test under `src/lexical/__tests__/`;
  store invariants live in `src/stores/__tests__/`.

### 6. No silent scope / library / approach swaps

If, mid-task, you find yourself about to deviate from anything that was in
the agreed plan (library, scope, approach, file structure, naming
convention):

- **Stop and tell the user first.** Don't bury the swap in a commit
  message.
- A one-line "I'm thinking of using X instead of Y because Z — OK?" is
  much cheaper than the rollback-and-redo cycle that follows a silent swap.

### 7. Rubber-duck non-trivial work

For any task involving multiple files, a new architectural pattern, or an
unfamiliar SDK surface — call the `rubber-duck` agent **before**
implementing. Most failed solutions had blind spots a critique would have
caught.

### 8. Don't be terse where it costs the next agent

- Commit messages explain **why**, not just what.
- `DEVLOG.md` entries cite the receipts (file paths, line numbers, commit
  SHAs) so the next agent can verify your conclusions.
- Memories you store via `store_memory` are facts the next agent will
  treat as ground truth; cite the source so they can re-verify.

---

## Hard rules (do not violate)

These are the smaller never-cross-this-line items, in addition to the
anti-laziness rules above:

- Never invent direction. If a feature is not in `plans/` or `STATUS.md`,
  ask before adding it.
- Never commit secrets, tokens, or raw prompt content.
- Domain modules under `src-bun/app/` don't import `electrobun/bun`.
- Never throw raw `Error` from an RPC handler — go through `rpcGuard`.
- Tests stay green: `bun run check` must succeed.
- Never delete an item from `STATUS.md`. Move it (open → done) but preserve
  history.
- Never let `plans/` drift silently. Update the relevant doc when reality
  diverges.

## Monorepo / nested AGENTS.md

This repo is a single Bun project: `src-bun/` (main process) + `src/`
(Vue renderer) + `tools/` (Bun plugins) + `e2e/` (Playwright). No nested
`AGENTS.md` files. If we split into multiple Bun workspaces, add `AGENTS.md`
next to each package that has package-specific guidance.
