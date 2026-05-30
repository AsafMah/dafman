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

## Anti-laziness rules (HARD)

Binding, not aspirational — they exist because real regressions kept landing
under the previous lax contract.

**0. Pre-flight check — before EVERY non-trivial change.** Ask:
(1) **Am I being hacky?** — suppressing a warning, hardcoding a workaround,
`_`-prefixing an actually-used var, bumping a complexity cap, `@ts-ignore`,
`eslint-disable`, swallowing an error.
(2) **Am I reinventing the wheel?** — PrimeVue (`ProgressSpinner`, `Dialog`,
`Tooltip`, `Badge`, `Skeleton`, `VirtualScroller`…), VueUse (debounce,
observers, localStorage, clipboard, focus), Vue 3.5+ (`useTemplateRef`, `useId`,
`useModel`), our own composables, or an npm package may already do it.
(3) **Am I acting without research?** — have I read the library's release notes
for the version I'm on, the actual SDK/API surface (incl. `node_modules/…`
source), and the codebase pattern for this surface?
If yes to (1)/(2) or no to (3) — STOP, read first. (90 seconds here saves hours
of rework; precedent: three 2026-05-28 regressions all skipped this.)

**1. Never declare done with half-work.** "It compiles" / "tests pass" is not
done if you skipped `bun run smoke` on a renderer-bundle / CSS-import /
prism-order / Lexical / dockview change, or if a click handler isn't wired up.
If I report it broken after you said done, this rule was violated.

**2. Run the full gate before claiming done.** Minimum: `bun run lint`,
`bun test`, `bun run smoke` (any UI / bundle / SDK / IPC / Lexical change). For
dependency or settings-schema changes, full `bun run check`. Fix failures before
claiming done.

**3. Update the running docs.** Every substantive session: `STATUS.md` (move
open→done, never delete), `DEVLOG.md` (new top H2, lead with the takeaway,
capture wire/SDK facts + dead ends), `CHANGELOG.md` (`## [Unreleased]`,
user-visible), `ARCHITECTURE.md` (if a module/invariant/IPC surface changed),
`plans/DONE.md` (when a GH issue closes, record the capability + receipt; no new
`plans/plan-*` files).

**4. No unverified claims.** Don't claim a CLI/SDK/library behaves a way without
checking — read `node_modules/…` source if needed (precedent: the
`reasoning_opaque` investigation, DEVLOG 2026-05-21 — schema declared
`assistant.reasoning_delta`; the bundled CLI never emitted it). Don't claim a
regression fixed without a before/after test. Don't claim a UI change works
without running it (`bun run dev` / `bun run smoke` / `@testing-library/vue`).

**4a. Dogfood before `task_complete` (UI / IPC).** When a change touches the
composer / Lexical plugins, any `searchWorkspaceFiles` / `pickAttachment` /
`sendMessage` / `pendingRequest` IPC path, dockview layout / panel mount,
groups v3 (`groupsStore` / `useGroupsActions` / `GroupPanel`), settings /
`coerceLayout` / persist, or z-index / stacking decisions:
1. Run the relevant existing E2E flow (`bun run e2e:run -- e2e/full/flows/<flow>.pwtest.ts`); layout/groups/settings changes MUST also pass flows 21–24. (The Tier-3 suite under `e2e/full/flows/` already covers session send/reply, @-picker, permissions + audit, layout/settings restore across restart, groups v3, file-picker/cwd/export persistence, and the details rail — pick the matching flow before adding a new one.)
2. If no flow covers the path, add one in the same PR (flows 21/23 are templates; `bunHarness.restart()` + `__DAFMAN_TEST__` are the primitives).
3. `bun run dev` once and actually exercise the changed flow.
4. Lexical / trigger / DOM-selection work → pop chromium DevTools for stacking + visual.
5. A step that can't be automated (native OS dialog / keyring / OS-modal) → `MANUAL_TESTS.md` (rule 10).
"lint + tests + smoke were green" is NOT a substitute for running the app.

**5. Test-first for behavior changes.** Bug fix → failing test first (or note in
DEVLOG why a test was disproportionately expensive). New behavior → test
alongside the code. (Renderer: `tools/bun-vue-loader.ts`; Lexical:
`src/lexical/__tests__/`; store invariants: `src/stores/__tests__/`.)

**6. No silent scope / library / approach swaps.** Deviating from the agreed
plan mid-task → stop and tell the user first ("thinking of X instead of Y
because Z — OK?"). Don't bury it in a commit message.

**7. Rubber-duck non-trivial work.** Multiple files, a new pattern, or an
unfamiliar SDK surface → call the `rubber-duck` agent **before** implementing.
Most failed solutions had blind spots a critique would have caught.

**8. Don't be terse where it costs the next agent.** Commit messages explain
**why**, not just what. DEVLOG entries cite receipts (paths, line numbers,
SHAs). Stored memories cite their source so the next agent can re-verify.

**9. Spec-interview before you implement.** Any non-trivial feature (UI shape,
IPC surface, file layout, user-visible behavior) → interview the user with
`ask_user` (structured form, not free-form chat) until the spec is certain:
scope (one shape vs many), defaults, keyboard shape, empty/edge/error states,
replace-vs-extend. Large design space → remind the user to enter plan mode.
Locked specs go in the commit + the Feature issue body. "I assumed you wanted X"
is not acceptable.

**10. Ship a manual-test list with every feature.** Anything `bun run check`
can't confirm (hover, keyboard flows, OS dialogs, drag-drop, multi-window
timing, focus, a11y) → append a checklist to the DEVLOG entry, each item with
**Steps** / **Expected result** / **Why not automated**. The user runs it;
passes get promoted to verified, fails get re-filed with a repro.

**11. Convert every complaint into tracked acceptance items before coding.** I
report multiple misses → make one tracked item per sentence before editing
(don't code from memory). Keep visible; mark done only after verifying the exact
behavior; UI/focus/scroll/layout items → `MANUAL_TESTS.md` or an E2E test. If a
later fix reshapes approved UI, re-check every prior item for regressions.

**12. Integration features need an ownership model before UI work.** For
cross-surface features (composer ↔ terminal ↔ chat ↔ attachments ↔ settings)
write it down first: which component owns the live resource; can two mount it at
once; what's persisted and where; the wire shape; what's rendered in the
transcript and in what order; what's sent to the SDK. Don't build controls until
these are explicit; if an answer changes mid-flight, update the plan first.

**13. Focus, scroll, responsiveness are first-class acceptance criteria.** For
composer / terminal / dockview / settings work, assert the actual interaction,
not DOM existence: focus lands on the intended input after click/switch; scroll
is at the expected end after load/resume (unless the user scrolled away);
narrow-pane matrix has no overflow/overlap (pin exact affordance positions when
asked); two renderers never drive the same live PTY/editor/session. "Element is
visible" is not enough.

**14. Prove attachment semantics end-to-end.** For any attachment pill / derived
context: the pill is represented in the editor; deleting it removes it from the
outgoing payload; keeping it sends the intended shape; the SDK receives what the
UI shows; prefer a real file attachment when I asked for a file. Add a unit test
at the `SessionRegistry.send` / IPC boundary — a renderer-only pill test is
insufficient.

**15. Reproduce my bug before improving around it.** A concrete broken sample
(raw ANSI/OSC like `ESC[31;1m…ESC]633;P;Cwd=…BEL`, wrong token limits,
stale-result re-invocation) becomes a fixture/test before the fix. Don't
substitute a nearby happy path — the bug I saw is the test.

**16. Build vs Buy — search before writing infrastructure.** Before any "small
helper" (event bus, debounce/throttle, localStorage persistence, ANSI/log
parsing, extension/MIME maps, contrast, clipboard, focus, resize/intersection
observers, fuzzy search, virtual scroll, path manipulation, id gen, deep-equal,
URL/date parsing, keybinding parsing): check `package.json`, then `@vueuse/core`,
then PrimeVue, then npm (`strip-ansi`, `mitt`, …) — only then hand-roll. A
50-line helper today is a 300-line god-helper in six months.

**17. Install the proper dep instead of a workaround table.** Library does 90%
and the gap is niche extensions/dialects/shapes → install the official
sub-package (e.g. `@codemirror/lang-vue`, `@codemirror/lang-sass`), or open an
upstream issue/PR; a workaround table is the last resort and a smell past 3
entries (precedent: `42be1a6`→`032d06d`, a 4-entry vue/scss/jsonc/pyi table the
user caught on review).

**18. Never `window.dispatchEvent(new CustomEvent('app:…'))`.** Untyped global
coupling — listeners receive `any`, dispatches are untraceable, listeners leak
across HMR, it turns the renderer into a ball-of-mud message hub. Use the typed
bus (`src/lib/bus.ts`) or a store. To avoid plumbing, add a store field, not
another global event.

**19. Watch for god objects on every change.** Check line count before adding:
>500 → new file in the same folder; >800 → split first, don't add to it; >1,200
→ fix the structure before anything new. Applies to `.vue` SFCs, Pinia stores,
and backend modules equally (the worst offenders — `sessions.ts`,
`MessageComposer.vue`, `ChatWindow.vue` — all started under 400 lines).

**20. Cyclomatic complexity > 15 is the design talking.** ESLint `complexity`
fires at 15 — don't bump the threshold, don't extract a cosmetic 3-line helper.
Find the real seam (validation vs orchestration vs side effects; type-A vs
type-B handling) and split there. If the complexity is genuinely irreducible
(state machine, deep schema), justify with a comment +
`// eslint-disable-next-line complexity` (per-line, never global).

**21. Audit / STATUS / DEVLOG tables go stale within weeks.** When a refactor
changes a tracked metric (file size, ESLint count, event-bus dispatch count,
jscpd duplication, complexity hotspots, `as unknown as` count), update the row
in the same commit. Quick checks:
```pwsh
(Get-Content src/components/Foo.vue).Count          # file size after a split
rg "new CustomEvent\('dafman:" src                  # event-bus dispatch sites
rg -t vue "invokeCommand\(" src                     # direct IPC from .vue
rg "as unknown as" src/stores/shell/layoutStore.ts | Measure-Object | %{ $_.Count }
bun run lint:tsc-bun                                 # backend TS errors
```

**22. Backend TypeScript gate is active — no new errors.** `tsc -p
tsconfig.bun.json --noEmit` runs as `bun run lint:tsc-bun`, wired into
`bun run check`. Touch any `src-bun/` file → run it first and keep the error
count from rising; treat a Bun/Node/SDK-upgrade regression like any other gate
failure.

**23. SDK bumps are not silent — analyze + update plans.** `@github/copilot` /
`@github/copilot-sdk` ship fast and each patch/beta/minor commonly adds events,
tools, or hooks. On every bump: read the release notes for the **whole version
range**; classify into **breaking** (wire/event/RPC/hook we use — migrate before
merge), **new surfaces** (file one GH issue per useful event/tool/hook with a
`node_modules/@github/copilot/…` source citation, labelled `area:*`), and
**internal** (commit-message note only); update `ARCHITECTURE.md` §SDK gotchas
if a new gotcha appears. **Don't auto-merge even on green CI** — there are zero
tests for surfaces we haven't built.

**24. TypeScript majors are routine — read the changelog, don't panic.** 5.x →
6.0 is the same shape as 5.8 → 5.9; the major number is marketing. On any TS
bump: read the release notes (~5 min), run `bun run lint`, fix surfaced errors
(deprecated option → remove; newly-caught unsafe pattern → narrow; new strict
check → opt in/out). Don't hand-wave with `@ts-ignore` / `_`-prefix / suppressed
rules. `bun run check` is the gate.

---

## Hard rules (do not violate)

In addition to the anti-laziness rules above:

- Never invent direction — a feature not in a GitHub Issue (or `STATUS.md`) → ask first.
- Never commit secrets, tokens, or raw prompt content.
- `src-bun/app/` never imports `electrobun/bun`.
- Never throw raw `Error` from an RPC handler — use `rpcGuard`.
- `bun run check` must stay green.
- Never delete a `STATUS.md` item — move it (open → done), preserve history.
- Never let `plans/DONE.md` drift — ship something matching an issue → close the issue AND record the capability + receipt; no new `plans/plan-*` files.
- Never use `window.dispatchEvent` / `addEventListener('app:…')` for in-app messaging (rule 18).
- Never silence ESLint `complexity` globally (rule 20) — per-line with justification, or fix the design.
- Never add new `src-bun/` TS errors (rule 22) — run `bun run lint:tsc-bun` first and verify the count doesn't rise.
- Never start a non-trivial change without the pre-flight check (rule 0).
- Never merge an SDK bump without analysis (rule 23).

## Monorepo / nested AGENTS.md

Single Bun project: `src-bun/` (main process) + `src/` (Vue renderer) +
`tools/` (Bun plugins) + `e2e/` (Playwright). No nested `AGENTS.md` files. If we
split into multiple Bun workspaces, add `AGENTS.md` next to each package with
package-specific guidance.
