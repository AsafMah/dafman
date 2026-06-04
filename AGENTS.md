# AGENTS.md

> Standard agent-instructions file per [agents.md](https://agents.md/).
> Read this first. **The Anti-laziness rules are not optional.**

## Project overview

**Dafman** — desktop UI for the GitHub Copilot CLI, on
[Electrobun](https://docs.electrobunny.ai/electrobun/) (native webview + Bun)
with a Vue 3 renderer. Streaming multi-session chat, visible reasoning + tool
calls, permission gates with rule editor, file/image attachments, command
palette, dark mode.

- Main process (Bun): TypeScript + `@github/copilot` SDK.
- Renderer: Vue 3 + Vite + TypeScript + PrimeVue (Aura preset) + Pinia.
- **TypeScript + Bun only** — no Rust, Cargo, Tauri, or Electron.

## Required reading (every new session)

1. **`STATUS.md`** — active milestone, last-done, next concrete step.
2. **`DEVLOG.md`** — what the previous agent did / found / left as tribal knowledge.
3. **`ARCHITECTURE.md`** — module map, lifecycle invariants, SDK gotchas.
4. **`MANUAL_TESTS.md`** — manual-test checklist; append a section per feature you ship (rule 10).
5. **`plans/DONE.md`** — shipped-capabilities matrix. Open work is in **GitHub
   Issues** (`gh issue list`; see Workflow). Pre-migration backlog frozen at
   `plans/TODO_archive.md`; `plans/_archive/` is historical and NOT kept current.

If your task touches the IPC wire contract, also read `src-bun/rpc.ts` and
`src/ipc/types.ts` — they MUST stay in sync.

## Setup

```bash
bun install   # all deps (renderer + main + tests); the CLI binary ships with @github/copilot
```

## Dev commands

| Want to… | Run |
|---|---|
| Full gate (lint + tests + build + smoke) | `bun run check` |
| Tests / watch / coverage | `bun test` / `bun test --watch` / `bun test --coverage` |
| Lint (vue-tsc) | `bun run lint` |
| Start app / with HMR | `bun run dev` / `bun run dev:hmr` |
| Build release bundle | `bun run build` |
| Renderer smoke (Playwright + chromium) | `bun run smoke` |
| Live-app DOM/CSS inspection | `bun run inspect <selector>` (`tools/inspect.ts`) |

`package.json` is the single source of truth for scripts.

### `bun run inspect` — diagnostic ladder

For "visual reality ≠ what the code says" bugs (missing icons, blank panels, a
CSS rule that *should* apply but doesn't, 0×0 elements). Stop at the first rung
that answers:

1. **`ide_search_text` the suspect class / selector** (JetBrains MCP). A stale
   `display:none` in our own CSS surfaces in ~200 ms; most "why doesn't this
   style apply" lands here.
2. **`ide_diagnostics`** on the file you're editing.
3. **`bun run inspect <selector> --rules`** against a running `bun run hmr` (or
   `vite preview` after `bun run build`) — bounding rect, computed styles, and
   the full matching CSS cascade (Chrome DevTools "Computed" panel). Defaults to
   HMR on port `5173`; pass `--url` for another Vite/preview server, and
   `--rpc-stub` if you have no backend bridge (else the boot splash never
   dismisses).
4. **Playwright `e2e/probe-*.pwtest.ts`** — only when the bug needs controlled
   stubs / clean storage; delete before commit.
5. **JetBrains debugger MCP** — JS runtime state, NOT DOM/CSS.

(Motivating trap: 2026-05-26 burned ~45 min on a Playwright probe to find a
`display:none !important` in `src/style.css` that an `ide_search_text` of the
class name would have surfaced instantly.)

## Code style

### Bun / main process (`src-bun/`)

- **`src-bun/app/` MUST NOT import `electrobun/bun`.** Only `src-bun/index.ts`
  touches BrowserWindow / BrowserView / Utils, so `bun test` can exercise
  `app/` directly.
- **Never throw raw `Error` from RPC handlers** — wrap with `rpcGuard`
  (`src-bun/app/errors.ts`); failures serialize as `AppErrorPayload`.
- **No background task without lifecycle** — long-running work (forwarders,
  subscriptions, timers) returns an unsubscribe callback the registry calls on
  cleanup.
- **Structured logs** — `log.info("msg", { key: val })` (`src-bun/app/logging.ts`);
  the JSON-lines layout is a wire contract for the in-app log viewer.

### TypeScript / Vue (`src/`)

- `strict: true`; SFCs `<script setup lang="ts">`.
- **No raw `electrobun.rpc.request(...)` in components** — go through
  `src/ipc/invoke.ts`; the typed `CommandMap` in `src/ipc/types.ts` is the truth.
- **No hardcoded hex** — use `var(--p-*)` PrimeVue tokens; per-session accents
  (`accentForSession`, `src/lib/color.ts`) are the only exception.
- Components are dumb; data + actions live in composables / Pinia stores.
- **Dockview is the layout primitive** — new persistent surfaces (sidebars,
  status bars, log viewer, picker) are dockview edge groups via
  `layoutStore.openEdgePanel(position, options)`, not new chrome. The
  ActivityBar rail holds only global toggles.
- **Panel id = session id** — always `addPanel({ id: sessionId, … })` so session
  ids are recoverable via `Object.keys(layout.panels)`.
- **`sessionsStore.SessionRecord` is the runtime source of truth** for
  per-session state — never duplicate it into the dockview layout JSON (opaque
  UI shape only).
- **Push session events through `sessionsStore.appendEvent`**, not
  `record.events` — bounds memory to `MAX_EVENTS_PER_SESSION` and keeps
  `droppedEventCount` consistent.

### Working on Windows — write files as LF

The repo is **LF-only** (`.gitattributes` `* text=auto eol=lf`, `.editorconfig`, prettier `endOfLine: "lf"`, `core.autocrlf=false`). Write through the `create` / `edit` tools or `bun` / `node` — they honour the EOL config. PowerShell `Set-Content` / `Out-File` / `>` / `echo` emit CRLF and make git nag on `git add` (the blob still commits as LF — just noise); if you dirty the tree that way, `git add --renormalize .` fixes it.

### SDK gotchas (don't re-burn; full list in `ARCHITECTURE.md` §8)

- **Bundled CLI JS needs Node ≥ 24** — `src-bun/app/client.ts` resolves the
  prebuilt `@github/copilot-${platform}-${arch}` binary to dodge it.
- **Permissions deny-by-default** — without `onPermissionRequest` wired, every
  tool call silently fails.
- **Reasoning is on `assistant.message`**, not `assistant.reasoning*`
  (`data.reasoningText` / `reasoningOpaque` / `encryptedContent` carry it).
- **Tool/session-lifecycle hooks live under `config.hooks`** (`SessionHooks`),
  NOT top-level like `onPermissionRequest` — top-level type-checks but is
  silently ignored.
- **dockview-vue panel props re-wrap** after `update()` — normalize both shapes.
- **Lexical DecoratorNode handlers must capture data locally** before attaching
  listeners (the proxy throws on later reads).
- **Reach for SDK hooks before reimplementing tools** — `onPreToolUse` /
  `onPostToolUse` / `registerTools` / `availableTools` / `excludedTools`.

## Testing

- CI (`.github/workflows/ci.yml`) runs the same scripts you do locally.
- **`bun run check` before claiming done** — `lint` + `test` + `vite build` +
  `electrobun build` + Playwright `smoke`.
- One runner: `bun test`. The Vue SFC loader (`tools/bun-vue-loader.ts`,
  preloaded via `bunfig.toml`) imports `.vue` natively.
- Tests live: backend `src-bun/__tests__/`; renderer `src/**/__tests__/`;
  Lexical `src/lexical/__tests__/`. Wire-shape snapshots use bun's
  `toMatchSnapshot()` (no `insta`).
- IPC type change → update **both** `src-bun/rpc.ts` and `src/ipc/types.ts`,
  plus a snapshot in `src-bun/__tests__/wire-contract.test.ts`.
- **Add/update tests for the code you change, even if nobody asked.**

## PR / commit

- **Conventional Commits** titles (`feat:`, `fix:`, `docs:`, `chore:`, `test:`,
  `refactor:`, scoped e.g. `feat(chat): …`).
- `bun run check` before pushing.
- Update `STATUS.md` (milestone/direction), `CHANGELOG.md` (`## [Unreleased]`,
  user-visible), `DEVLOG.md` (every substantive session); screenshots/GIFs for UI.
- Commits include the `Co-authored-by: Copilot` trailer unless told otherwise.

## Workflow — GitHub Issues + PRs

Open work lives in **GitHub Issues** (moved from `plans/TODO.md` 2026-05-28).

**Where work lives:** Issues (`gh issue list`; templates in
`.github/ISSUE_TEMPLATE/`) · Milestones (`Sprint B/C/D/E`, `M1 — Features`) ·
Labels (`bug`/`enhancement`/`tech-debt`/`manual-test-fail`/`regression`/`docs`/`security`;
sprint; status `needs-spec`/`pending-dogfood`/`blocked`/`automerge`; `area:*`;
`prio:p0/p1/p2`) · Project board `dafman work`
(`Backlog → Sprint → In progress → Pending dogfood → Done`).
`plans/TODO_archive.md` is frozen — no new rows. In `MANUAL_TESTS.md`,
`❌ Failing` rows are now `manual-test-fail` issues; the `⏳ Pending verification`
section is the gate for Pending-dogfood → Done.

**Opening an issue** — use a template (`.github/ISSUE_TEMPLATE/`): Bug
(Steps/Expected/Actual/Concrete sample/Env — rule 15) · Feature
(Problem/Shape/Acceptance — rule 9) · Tech debt
(Current/Target/Build-vs-buy/Verification — rule 16). Discussions for open
questions; security via private GHSA.

**PR workflow:**
- PR required for `src/` or `src-bun/` (CI gates merge); docs-only / CI-only can direct-push.
- Branch `<sprint-or-type>/<short-slug>`; PR title Conventional Commits; link `Fixes #N` / `Refs #N`.
- Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`) — its anti-laziness checklist IS the gate; don't tick what you haven't verified.
- Run `bun run pr:review` (or the `code-review` subagent) before requesting merge; address findings or note them as deliberate.
- Required checks: `lint`, `test`, `smoke`, `e2e`, `build-matrix (ubuntu-latest)`.
- `automerge` label squash-merges once required checks pass (mainly Dependabot patches).

**gh cheat-sheet:**
```pwsh
gh issue list --milestone "Sprint B"
gh issue list --label manual-test-fail --state open
gh issue create --template bug_report.yml
gh pr create --draft --title "feat(chat): foo" --body "Fixes #N"
bun run pr:review            # code-review subagent on current branch
```

## Security

- **Never commit secrets.** Tokens / BYOK creds → OS keyring (planned); logs
  redact by default (`src-bun/app/redact.ts`).
- Every privileged action (file write, shell, network, browser open, MCP
  install) goes through the permission system (`src/components/permissions/`).
- Vulnerabilities → `SECURITY.md` (private GHSA), never public issues.

## Architecture pointers

- **`ARCHITECTURE.md`** — current module map, invariants, SDK gotchas. Read first for non-trivial work.
- **`plans/DONE.md`** — every shipped capability, by topic, with code receipts.
- **GitHub Issues** (`gh issue list`) — every open feature / gap / known tech debt. Pre-migration backlog frozen at `plans/TODO_archive.md`.
- **`plans/_archive/`** — historical design docs; context only, not updated. If
  an archived fact matters, lift it into `plans/DONE.md`, a GH Issue, or
  `ARCHITECTURE.md`.

---

## Working rules

These exist because real regressions kept landing. Two kinds:

- **[GATE]** — a check fails the build (`bun run check` / CI). You can't merge past it; don't argue with it, fix it.
- **[JUDGMENT]** — no machine catches it, so it's on you. This is where the list earns its keep.

**Meta-rule: prefer a gate to a reminder.** When a mistake recurs, the fix is a mechanical check, not another [JUDGMENT] bullet — prose you have to remember is a latent regression. The conflict-marker bug merged *twice* as a reminder before it became `lint:markers`; the electrobun-import rules sat as prose for months before becoming ESLint errors (#152). Before adding a rule here, ask: can this be a gate?

### Gate index — the [GATE] rules, enforced for you

| Gate | Command | What it catches |
|---|---|---|
| Renderer types | `bun run lint` (vue-tsc) | `src/` type errors |
| Backend types | `bun run lint:tsc-bun` | new `src-bun/` TS errors — keep the count from rising |
| Bun-entry reachability | `bun run lint:bun` | dead relative imports from the bun entrypoint |
| ESLint | `bun run lint:eslint` | complexity > 15 (no global silencing); `src-bun/app/` and renderer must not import `electrobun` (only `index.ts` / `electrobunBridge.ts` may); style |
| Unit tests + wire snapshot | `bun test` | logic regressions; **IPC `rpc.ts` ↔ `types.ts` drift** (`wire-contract.test.ts`) |
| Conflict markers | `bun run lint:markers` | `<<<<<<<` / `|||||||` / `>>>>>>>` in any *tracked* file (incl. Markdown) |
| Renderer smoke / full E2E | `bun run smoke` / `bun run e2e:run` | bundle boots without console errors; core flows |
| Build matrix | `electrobun build` | native bundler / signing / dist regressions |

All wired into `bun run check` and CI. **`bun run check` must stay green — non-negotiable.** Some [JUDGMENT] rules below have a gate *planned* (file-size guard, owner-store writes, rename-all-surfaces E2E — issues #150/#151); when it lands, the rule moves up here.

### 1. Done means verified behavior, not a green checkmark. [JUDGMENT]

"It compiles" / "tests pass" is not done.
- Renderer-bundle / CSS-import / prism-order / Lexical / dockview change, or any click handler → run `bun run smoke`. If I report it broken after you said done, this rule was violated.
- **No unverified claims.** Don't assert a CLI/SDK/library behaves a way without reading `node_modules/…` source (precedent: `reasoning_opaque`, DEVLOG 2026-05-21 — the schema declared `assistant.reasoning_delta`; the bundled CLI never emitted it). No "regression fixed" without a before/after test.
- **Dogfood UI/IPC before `task_complete`.** Touching the composer / Lexical plugins, any `searchWorkspaceFiles` / `pickAttachment` / `sendMessage` / `pendingRequest` path, dockview/panel mount, groups v3, settings / `coerceLayout` / persist, or z-index / stacking: run the matching `e2e/full/flows/<flow>.pwtest.ts` (layout/groups/settings MUST also pass flows 21–24); if none covers it, add one (flows 21/23 are templates; `bunHarness.restart()` + `__DAFMAN_TEST__` are the primitives). Then `bun run dev` and actually exercise it; Lexical / DOM-selection → pop chromium DevTools for stacking + visual. "lint + tests + smoke were green" is NOT running the app.
- **Assert the interaction, not DOM existence**: focus lands on the intended input after click/switch; scroll sits at the expected end after load/resume (unless the user scrolled away); the narrow-pane matrix has no overflow/overlap (pin exact affordance positions when asked); two renderers never drive the same live PTY / editor / session.
- **Attachment semantics end-to-end**: the pill is represented in the editor; deleting it removes it from the outgoing payload; the SDK receives what the UI shows; prefer a real file attachment when I asked for a file. Add a test at the `SessionRegistry.send` / IPC boundary — a renderer-only pill test is insufficient.
- A step nothing can automate (native OS dialog / keyring / OS-modal, hover, drag-drop, multi-window timing, a11y) → append it to `MANUAL_TESTS.md` with **Steps / Expected / Why not automated**; the user runs it, passes get promoted, fails get re-filed with a repro.

### 2. Research before you write. [JUDGMENT]

Pre-flight every non-trivial change: **(1) Am I being hacky?** — suppressing a warning, hardcoding a workaround, `_`-prefixing an actually-used var, bumping a complexity cap, `@ts-ignore`, `eslint-disable`, swallowing an error. **(2) Am I reinventing the wheel?** — PrimeVue (`ProgressSpinner`, `Dialog`, `Tooltip`, `Badge`, `Skeleton`, `VirtualScroller`…), VueUse (debounce, observers, clipboard, focus), Vue 3.5+ (`useTemplateRef`, `useId`, `useModel`), our composables, or an npm package may already do it. **(3) Have I researched?** — the library's release notes for the version I'm on, the real SDK/API surface (incl. `node_modules/…` source), the codebase pattern for this surface. Yes to (1)/(2) or no to (3) → STOP, read first (precedent: three 2026-05-28 regressions all skipped this).
- **Build vs buy.** Before any "small helper" (event bus, debounce/throttle, persistence, ANSI/log parsing, MIME maps, contrast, clipboard, observers, fuzzy search, virtual scroll, path / URL / date parsing, id gen, deep-equal, keybinding parsing): check `package.json` → `@vueuse/core` → PrimeVue → npm (`strip-ansi`, `mitt`, …), only then hand-roll. A 50-line helper today is a 300-line god-helper in six months.
- **Install the proper dep, not a workaround table.** Library does 90% and the gap is niche dialects/shapes → install the official sub-package (`@codemirror/lang-vue`, `@codemirror/lang-sass`, …) or open upstream; a workaround table is the last resort and smells past 3 entries (precedent `42be1a6`→`032d06d`).
- **Rubber-duck non-trivial work** (multiple files / a new pattern / an unfamiliar SDK surface) → call the `rubber-duck` agent **before** implementing. Most failed solutions had a blind spot a critique would have caught.

### 3. Spec and own the model before building. [JUDGMENT]

- **Spec-interview** any non-trivial feature (UI shape, IPC surface, file layout, user-visible behavior) with `ask_user` (structured form, not free-form chat) until scope (one shape vs many), defaults, keyboard shape, empty/edge/error states, and replace-vs-extend are certain. Large design space → remind the user to enter plan mode. The locked spec goes in the commit + the Feature issue body. "I assumed you wanted X" is not acceptable.
- **Ownership model first for cross-surface features** (composer ↔ terminal ↔ chat ↔ attachments ↔ settings): which component owns the live resource; can two mount it at once; what's persisted and where; the wire shape; what's rendered in the transcript and in what order; what's sent to the SDK. Don't build controls on an unclear model; if an answer changes mid-flight, update the plan first.

### 4. Test-first; the bug I showed you is the test. [JUDGMENT] (tests themselves [GATE])

- Bug fix → a test that fails on current code and passes after the fix (or a DEVLOG note why a direct test was disproportionately expensive — then dig deeper, the hard-to-test surface usually means the bug isn't understood yet).
- A concrete broken sample I paste (raw ANSI/OSC like `ESC[31;1m…ESC]633;P;Cwd=…BEL`, wrong token limits, stale-result re-invocation) becomes a fixture **before** the fix — don't substitute a nearby happy path.
- New behavior → test alongside the code; add/update tests for code you change even if nobody asked. (Renderer: `tools/bun-vue-loader.ts`; Lexical: `src/lexical/__tests__/`; store invariants: `src/stores/__tests__/`.)

### 5. No silent swaps; turn complaints into tracked items. [JUDGMENT]

- Deviating from the agreed plan mid-task (scope, library, approach) → stop and tell the user first ("thinking of X instead of Y because Z — OK?"). Don't bury it in a commit message.
- I report multiple misses → make one tracked acceptance item per sentence **before** editing (don't code from memory). Keep them visible; mark done only after verifying the exact behavior (UI / focus / scroll / layout → `MANUAL_TESTS.md` or an E2E test). If a later fix reshapes approved UI, re-check every prior item for regressions.

### 6. Keep the running docs and the handoff honest. [JUDGMENT]

- Every substantive session: `STATUS.md` (move open→done, **never delete an item** — preserve history), `DEVLOG.md` (new top H2, lead with the takeaway, cite receipts — paths / line numbers / SHAs — and capture dead ends), `CHANGELOG.md` (`## [Unreleased]`, user-visible), `ARCHITECTURE.md` (if a module / invariant / IPC surface changed), `plans/DONE.md` (when a GH issue closes — record the capability + receipt; **no new `plans/plan-*` files**).
- When a refactor changes a tracked metric (file size, ESLint count, event-bus dispatch count, complexity hotspots, `as unknown as` count), update the row in the same commit — STATUS / DEVLOG / audit tables go stale within weeks.
- Commit messages explain **why**, not just what; stored memories cite their source so the next agent can re-verify. Don't be terse where it costs the next agent.

### 7. Respect the structure. [GATE: complexity · JUDGMENT: file size — gate planned #150]

- **God objects** — check the line count before adding: >500 → new file in the same folder; >800 → split first, don't add to it; >1,200 → fix the structure before anything new. Applies to `.vue` SFCs, Pinia stores, and backend modules equally (`sessions.ts`, `MessageComposer.vue`, `ChatWindow.vue` all started under 400 lines).
- **Complexity > 15 is the design talking** — ESLint `complexity` fires at 15; don't bump the threshold, don't extract a cosmetic 3-line helper. Find the real seam (validation vs orchestration vs side effects). Genuinely irreducible (state machine, deep schema) → justify with `// eslint-disable-next-line complexity` (per-line, never global).
- **`SessionRecord` is the runtime source of truth** — never duplicate a session's title / status / liveness into a second store or the dockview layout JSON (owner-store ESLint guard planned, #151). This is the seam most propagation bugs live on (#129/#133/#134).

### 8. Dependency & SDK/TS bumps are not silent. [JUDGMENT]

- **SDK bumps** (`@github/copilot` / `@github/copilot-sdk`) — each patch/beta/minor commonly adds events, tools, or hooks. Read the release notes for the **whole version range**; classify: **breaking** (wire/event/RPC/hook we use → migrate before merge), **new surfaces** (one GH issue per useful event/tool/hook with a `node_modules/@github/copilot/…` source citation, labelled `area:*`), **internal** (commit-message note). Update `ARCHITECTURE.md` §SDK gotchas on a new gotcha. **Don't auto-merge even on green CI** — there are zero tests for surfaces we haven't built.
- **TS majors** are routine — 5.x→6.0 is 5.8→5.9 in disguise. Read the notes (~5 min), run `bun run lint`, fix surfaced errors (deprecated option → remove; newly-caught unsafe pattern → narrow). No `@ts-ignore` / `_`-prefix / suppressed rules.

---

## Non-negotiables (no machine to stop you)

- **Never invent direction** — a feature not in a GitHub Issue (or `STATUS.md`) → ask first (rule 3).
- **Never commit secrets**, tokens, or raw prompt content (see Security; logs redact via `src-bun/app/redact.ts`).
- **Never throw raw `Error` from an RPC handler** — wrap with `rpcGuard` (`src-bun/app/errors.ts`); failures serialize as `AppErrorPayload`.
- **Never use `window.dispatchEvent` / `addEventListener('app:…')`** for in-app messaging — use the typed bus (`src/lib/bus.ts`) or a store field. Untyped global coupling hands listeners `any`, leaks across HMR, and turns the renderer into a ball-of-mud message hub.

## Monorepo / nested AGENTS.md

Single Bun project: `src-bun/` (main process) + `src/` (Vue renderer) + `tools/` (Bun plugins) + `e2e/` (Playwright). No nested `AGENTS.md` files. If we split into multiple Bun workspaces, add `AGENTS.md` next to each package with package-specific guidance.
