# AGENTS.md

> Standard agent-instructions file per [agents.md](https://agents.md/).
> Read this first. **The Anti-laziness rules at the bottom are not optional.**

## Project overview

**Dafman** is a desktop UI for the GitHub Copilot CLI, built on
[Electrobun](https://docs.electrobunny.ai/electrobun/) (native webview shell
driven by Bun) with a Vue 3 renderer. Streaming chat with multiple sessions /
workspaces, visible reasoning and tool calls, real permission gates with rule
editor, inline file/image attachments, command palette, dark mode.

- Main process (Bun): TypeScript + `@github/copilot` SDK.
- Renderer: Vue 3 + Vite + TypeScript + PrimeVue (Aura preset) + Pinia.
- One language end-to-end. The repo is **TypeScript + Bun only** — no Rust,
  no Cargo, no Tauri, no Electron.

## Required reading order (for every new session)

1. **`STATUS.md`** — active milestone, last-completed entries, next concrete step.
2. **`DEVLOG.md`** — what the previous agent did, what they found, what's still
   tribal knowledge.
3. **`ARCHITECTURE.md`** — current module map + lifecycle invariants +
   SDK gotchas.
4. **`MANUAL_TESTS.md`** — open manual-test checklist the user runs to
   sign off features. Append a new section per feature you ship
   (per rule #10 below).
5. Whatever **`plans/*.prompt.md`** is relevant to your task (index at
   `plans/plan-overview.prompt.md`).

If your task touches the IPC wire contract, also read `src-bun/rpc.ts` and
`src/ipc/types.ts` — they MUST stay in sync.

## Setup commands

```bash
bun install                   # all deps (renderer + main process + tests)
```

The Copilot CLI binary is bundled as a dep of `@github/copilot`;
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

#### 4a. Dogfood-before-`task_complete` (UI / IPC changes)

Until the real-E2E tier lands (see
[`plans/plan-e2e.prompt.md`](../plans/plan-e2e.prompt.md)), unit tests
+ smoke are **not sufficient** for changes that touch:

- the composer / Lexical plugins
- any `searchWorkspaceFiles` / `pickAttachment` / `sendMessage` /
  `pendingRequest` IPC path
- dockview layout / panel mount
- z-index / stacking-context decisions

Required additional gate before `task_complete`:

1. `bun run dev` once (or `dev:hmr`) — actually exercise the changed
   flow manually. (This single step catches the bug class that
   shipped in commit 7c728e3 — `cwdFor()` returned undefined for
   every session and "No matches" was the result, undetected by
   347 unit tests + smoke + lint.)
2. If touching Lexical / trigger / DOM-selection logic, also pop
   chromium DevTools to check stacking + visual.
3. If a manual step *can't* be turned into an automated test in the
   current suite, add it to `MANUAL_TESTS.md` per rule #10 AND note
   in DEVLOG which automated test would have caught it under the
   planned E2E tier.

The "I ran lint + tests + smoke and they were green" output is
**not** a substitute for actually running the app. Don't dodge.

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

### 9. Spec-interview before you implement

For **any** non-trivial feature — anything touching UI shape, IPC
surface, file layout, or user-visible behavior — interview the user
**before writing code** until you are completely sure of the spec.

- Use the `ask_user` tool with a structured form. Don't ask
  trade-offs in free-form chat.
- Cover every fork that would materially change the implementation:
  scope (one shape vs many), defaults, keyboard / shortcut shape,
  empty/edge states, error states, what existing component is
  replaced vs extended.
- If the design space is large enough that one form can't cover it,
  **remind the user to enter plan mode** and iterate the plan with
  them before exiting.
- Locked specs go in the commit message and (for non-trivial
  features) into the relevant `plans/*.prompt.md` so the next agent
  doesn't re-litigate them.

This rule exists because too many features in this repo were built
on assumed defaults that the user disagreed with, costing rework.
"I assumed you wanted X" is not an acceptable post-hoc justification.

### 10. Ship a manual-test list with every feature

Automated tests cover what you can write. Anything you can't be
confident is correct from `bun run check` alone (hover states,
keyboard flows, OS dialogs, drag-and-drop, multi-window timing,
focus management, real CLI side-effects, accessibility) ships with a
**manual test list**.

Append a checklist to the relevant `DEVLOG.md` entry. Each item must
include:

1. **Steps** — exact clicks / keys / inputs.
2. **Expected result** — what the user should observe.
3. **Why not automated** — one-line reason (e.g. "Playwright can't
   drive the native OS file picker", "depends on Notification API
   permission state", "depends on WebView2 IME shape on Windows").

The user runs the list and reports back. Items that pass get
promoted to "verified" in the DEVLOG entry. Items that fail get
filed back to the open backlog with a repro.

Reason: automated coverage on a desktop app with native dialogs,
OS-keyring, real CLI processes, and a custom IPC bridge will never
be 100%. The manual list is the explicit hand-off of what's *not*
covered, instead of pretending it is.

### 11. Convert every user complaint into tracked acceptance items before coding

When the user reports multiple misses, do **not** rely on memory and do **not**
start patching immediately. First create/check a concrete task list with one
acceptance item per sentence/complaint, then implement against that list.

- If the user says "A, B, C, and D", make four tracked items before editing.
- Keep the list visible while working and mark items done only after the exact
  behavior is verified.
- Add the acceptance items to `MANUAL_TESTS.md` or an E2E test when they involve
  UI/focus/keyboard/scroll/layout behavior.
- If a later fix changes the shape of a previously-approved UI, re-check every
  previous acceptance item for regressions.

This rule exists because the terminal/composer work in May 2026 repeatedly
missed explicit details (two separate buttons, focus transfer, single terminal
renderer ownership, attachment shape, prompt stripping, scroll position) after
the agent started coding from memory instead of a checklist.

### 12. Integration features need an ownership model before UI work

For features that bridge multiple surfaces (composer ↔ terminal ↔ chat ↔
attachments ↔ settings), write down the ownership model before touching UI:

- Which component owns the live resource?
- Can two components mount the same live resource at once?
- What is persisted, and where?
- What is the wire shape?
- What is rendered in the transcript, and in what order?
- What exactly is sent to the SDK/model?

Do not implement UI controls until these answers are explicit in the plan or in
the task list. If the answer changes mid-implementation, stop and update the
plan/checklist first.

Concrete precedent: embedded terminal command mode must define one xterm owner
for a PTY, how command output becomes a result record, how the result becomes a
real file attachment, and where it appears in the chat timeline. "Just show a
terminal" is not enough.

### 13. UI focus, scroll, and responsiveness are first-class acceptance criteria

For composer, terminal, dockview, settings, and other layout work, verification
must cover the actual user-visible interaction, not just DOM existence.

Required checks when touched:

- **Focus:** after clicking a button or switching panels, assert the intended
  input/editor/terminal receives keyboard focus.
- **Scroll:** after loading/resuming history, assert the transcript or terminal
  is at the expected end unless the user intentionally scrolled away.
- **Responsiveness:** run a narrow-pane matrix and assert no horizontal overflow
  or overlap. Pin exact affordance positions when requested (e.g. "left of
  paperclip", "pinned right").
- **Duplicate live surfaces:** assert that two active renderers do not control
  the same live PTY/editor/session resource at once.

Do not call a UI fix done if the E2E only checks that an element is visible.
It must check the requested behavior.

### 14. Prove attachment semantics end-to-end

For any feature that creates an "attachment" pill or sends derived context:

- Verify the pill is represented in the editor.
- Verify deleting the pill removes it from the outgoing payload.
- Verify keeping the pill sends the intended payload shape to the SDK.
- Verify the SDK receives the same content the UI shows.
- Prefer a real file attachment when the user asked for a file; don't silently
  swap to inline prompt text or blob shortcuts.

Add a unit test at the `SessionRegistry.send`/IPC boundary for the final payload
shape. A renderer-only pill test is insufficient.

### 15. Reproduce the user's bug before improving around it

When the user reports a concrete broken output, copy the exact sample into a
test or fixture before fixing. Examples:

- Raw ANSI/OSC output such as `ESC[31;1m...ESC]633;P;Cwd=...BEL` must become a
  fixture for the sanitizer.
- Wrong context-token limits must become normalization tests.
- Repeated command invocation using a stale result must become a re-entry test.

Do not replace the repro with a nearby happy-path test. The bug the user saw is
the test.

### 16. Build vs Buy — search before you write infrastructure

Before writing any "small helper" for infrastructure code (event bus,
debounce, throttle, localStorage persistence, ANSI/log parsing,
extension/MIME maps, color contrast, clipboard, focus management,
resize/intersection observers, fuzzy search, virtual scroll, file-path
manipulation, ID generation, deep-equal, URL parsing, date formatting,
keybinding parsing, regex composition for known formats):

1. **Check `package.json`** — is there already a dep that does it?
2. **Check `@vueuse/core`** — covers most browser-API wrappers.
3. **Check PrimeVue** — covers most UI primitives (tooltips, badges,
   skeletons, spinners, accordions, virtual scroll, scroll panels).
4. **Check npm** — for utility libraries, prefer popular battle-tested
   packages (`strip-ansi`, `mitt`, `@codemirror/language-data` etc.)
5. **Only then** consider writing it yourself.

A 50-line "small helper" today is a 300-line god-helper in six months.
The dafman May 2026 audit identified ~500 lines of hand-rolled
infrastructure (ANSI regex, event bus, listener registry, localStorage
glue, debounce timers, extension maps) every line of which had at least
one subtle bug a library would have fixed for free.

### 17. Install the proper dep instead of maintaining a workaround table

When a library does 90% of what you need and the gap is "it doesn't
know about my niche extensions / dialects / shapes":

- **First option:** install the official sub-package (e.g.
  `@codemirror/lang-vue` for Vue files, `@codemirror/lang-sass` for
  Sass). Most ecosystems split language/dialect packs precisely so you
  pay only for what you use.
- **Second option:** open an issue or PR on the library.
- **Last resort:** add a workaround table in our code.

Workaround tables are the highest-maintenance form of code: invisible
in tests, mutate every time the upstream library updates, and almost
always indicate the gap is closeable by reading the docs more carefully.
If the workaround table grows past 3 entries, it's a smell. (Precedent:
commits `42be1a6` → `032d06d` — agent kept a 4-entry workaround table
for vue/scss/jsonc/pyi instead of installing the obvious deps; user
caught it on review.)

### 18. Never `window.dispatchEvent(new CustomEvent('app:...'))`

The window event bus is untyped global coupling. Use the typed
event bus (`src/lib/bus.ts` once mitt lands; until then use stores or
provide/inject). Window events:

- Have no typing — listeners receive `any`.
- Can't be traced — adding a listener doesn't tell you what dispatches.
- Have no cleanup guarantee — leaked listeners across HMR are routine.
- Cross every component boundary — turns the entire renderer into a
  ball-of-mud message hub.

If you find yourself reaching for a window event "to avoid plumbing
through stores," the answer is to add the field to a store, not to add
another global event. (Precedent: the May 2026 audit found 13 dispatch
sites and 9 listener sites across 9 files — pure spaghetti.)

### 19. Watch for god objects on every change

Before adding code to a file, check its line count:

- **>500 lines:** add to a new file in the same folder.
- **>800 lines:** stop and split the existing file first; do not
  contribute more code to a known god object.
- **>1,200 lines:** the file is a structural bug; fix it before adding
  anything new.

This applies to `.vue` SFCs, Pinia stores, and backend modules
equally. The dafman May 2026 audit's worst offenders all crossed
1,000 lines by accretion of "small additions" — `sessions.ts` (1,929),
`MessageComposer.vue` (1,396), `ChatWindow.vue` (1,209). Each was
born under 400 lines.

### 20. Cyclomatic complexity > 15 is the design talking

ESLint's `complexity` rule fires at CC 15. When you see it:

- **Do not bump the threshold.** That's hiding the problem.
- **Do not extract a 3-line helper to drop CC by 1.** That's cosmetic.
- **Look at the function as a whole.** CC > 15 almost always means
  multiple unrelated concerns are interleaved. Find the natural seam
  (input validation vs orchestration vs side effects; type-A handling
  vs type-B handling) and split there.

If the function genuinely needs the complexity (e.g. parsing a state
machine, validating a deep schema), document why with a comment and
add a `// eslint-disable-next-line complexity` — but explicitly, not
by silencing the rule globally.

### 21. Tables in CODE_AUDIT, STATUS, DEVLOG go stale within weeks

When you complete a refactor that changes a metric the audit tracks
(file size, ESLint warning count, event-bus dispatch count, jscpd
duplication, complexity hotspots, `as unknown as` count), update the
relevant row(s) in the same commit. Don't leave it for the next
audit refresh.

Cheap targeted greps to verify (one-liners):

```pwsh
# File size after split
(Get-Content src/components/Foo.vue).Count

# Event-bus dispatch sites
rg "new CustomEvent\('dafman:" src

# Direct IPC from .vue
rg -t vue "invokeCommand\(" src

# as unknown as count in a file
rg "as unknown as" src/stores/shell/layoutStore.ts | Measure-Object | %{ $_.Count }

# Backend TypeScript errors (NOT in `bun run check` yet — see Phase A.5)
bun run lint:tsc-bun
```

Forgotten rows accumulate into "30-70% drift" between audits, which
turns the audit into vibes and undermines every decision based on it.

### 22. The renderer is fully type-checked; the backend is NOT (yet)

`bun run lint` runs `vue-tsc --noEmit` over the renderer only. The
backend's `tsconfig.bun.json` exists but **isn't gated in `bun run
check`**. As of 2026-05-25 there are 54 TS errors in `src-bun/` —
covering SDK shape drift, stale test fixtures, missing `?.` chains,
and `extension-*` permission kinds we don't know about.

- Run `bun run lint:tsc-bun` to check the backend.
- **Don't add new `src-bun/` errors.** When you touch a file in
  `src-bun/`, run `bun run lint:tsc-bun` and verify your changes
  didn't add to the error count.
- The eventual goal (CODE_AUDIT §8 Phase A.5) is to clear all 54 and
  wire `lint:tsc-bun` into `bun run check`. Until then this rule keeps
  the count from drifting up.

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
- **Never reach for `window.dispatchEvent`/`addEventListener('app:...')`
  for in-app messaging** — see rule 18.
- **Never silence ESLint's `complexity` rule globally to skirt rule 20**
  — disable per-line with justification or fix the design.
- **Never add new `src-bun/` TypeScript errors** (rule 22). When you
  touch any `src-bun/` file, run `bun run lint:tsc-bun` first and
  verify the error count doesn't go up.

## Monorepo / nested AGENTS.md

This repo is a single Bun project: `src-bun/` (main process) + `src/`
(Vue renderer) + `tools/` (Bun plugins) + `e2e/` (Playwright). No nested
`AGENTS.md` files. If we split into multiple Bun workspaces, add `AGENTS.md`
next to each package that has package-specific guidance.
