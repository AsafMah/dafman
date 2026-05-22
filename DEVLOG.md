# Development log

> Append-only chronicle of substantive sessions and findings. **Every agent
> session that touches the codebase ends with a new entry here** — investigation
> notes that don't fit a commit message, design decisions taken, dead ends,
> things future-me needs to know but couldn't have learned from the diff alone.
>
> Entries are top-down newest first. One H2 (`## YYYY-MM-DD ...`) per session.
> Inside each entry, lead with the takeaway, then the receipts.

---

## 2026-05-22 — Bug bash: cwd persist, audit hydrate, dir pill, perm summary, reveal, browse split

### Takeaway

User flagged a backlog of bugs in MANUAL_TESTS.md, with **#1 (cwd
not persisting)** as MASSIVE. Fixed end-to-end with 10/10 E2E green
in 16 s wall (was 6 in 12 s):

| Bug | Fix | E2E |
|---|---|---|
| cwd resets to exe folder on restart | Cache `workingDirectory` on `Entry` at create+resume. `resume()` now reads `getSessionMetadata` before SDK call and pins the persisted cwd. Dropped `process.cwd()` fallback in `cwdFor` — silent substitution was the root cause. | F6 cwd-persist (spawn bun#1 wsA → kill → bun#2 wsB shared userdata → resume → assert cwd is A) |
| Export JSON `items: []` | Cascade of cwd bug (no events flowed). | F7 export-items (send, export, parse, assert items contain prompt + reply) |
| Audit JSONL gone after restart | `initAudit` now reads the tail of each JSONL file into the in-memory `recent` ring on startup. Files always persisted on disk; the ring just wasn't hydrated. | F8 audit-rehydrate |
| Reveal opens parent folder | Windows: shell out to `explorer.exe /select,<path>` (canonical Windows reveal idiom). Other platforms keep `Utils.showItemInFolder`. | (manual — OS dialog) |
| Browse… only allowed folders | Native Windows dialogs are file-only OR folder-only — never both. `pickAttachment` now takes `kind: "file" | "directory"`; FilePicker exposes "File…" + "Folder…" buttons. | F9 dir-pill verifies the type+icon round-trip |
| Permission rule shell summary empty | SDK field is `fullCommandText`, not `command`. Updated `summarizePermission` + `PermissionRuleEditor.shellCommand` to read both. Summary now reads e.g. ``Run `git status` ``. | sessions unit test updated |
| Reasoning-hidden showed actions bar | Gate `<MessageActions>` for reasoning items on `reasoningVisibility !== "hidden"`. | (trivial v-if gate; verified by manual) |
| Read/Write rule editor "allow all" only | SDK limit — per-path glob isn't in the rule type union. Added an honest hint in the editor: "Per-path glob rules aren't a Copilot SDK feature." | n/a |
| Permission rule doesn't allow follow-up | **DEFERRED** — likely SDK matcher semantics issue; needs separate investigation. | n/a |

### Fake-client persistence

For the cwd-persistence E2E to work, the test-server's
`FakeCopilotClient` now persists its catalog (sessionId + cwd) to
`<userData>/fake-sessions.json`. A fresh bun subprocess pointed at
the same userData finds the same sessions. Mirrors the real SDK's
on-disk catalog.

### Harness changes

`spawnBunHarness` now accepts an `userData` override + only
auto-nukes the workspace it created (caller-supplied workspaces are
the caller's responsibility). Required for the two-spawn cwd test.

### Test-server control RPCs

Added `__test.recordAudit` so audit-rehydrate tests can deterministically
seed entries without going through the renderer permission flow.

### Tests at a glance

- `bun run lint`: clean.
- `bun test`: **367 pass** (one expected-summary string updated to
  reflect the new shell summary shape).
- `bun run e2e`: **10/10 in 16 s** (was 6/12 s). New flows:
  06-cwd-persist, 07-export-items, 08-audit-rehydrate, 09-dir-pill.

### Still on the board

- `perm-rule-match`: SDK matcher needs investigation. The shape we
  send matches the documented `PermissionDecisionApproveForSessionApproval`
  type but the CLI re-prompts anyway. Possibly needs `git *` glob
  vs literal `git`, or a different shape.
- `at-empty` ("@ doesn't show fuzzy in real app"): expected to be
  fixed by the cwd fix (no events → no UI). User to re-verify
  against `bun run dev` and report.

---

## 2026-05-22 — Real E2E tier shipped (6 flows green, 12 s wall)

### Takeaway

User said "OK that's a priority right now" after I filed the E2E
proposal. Built Option A end-to-end in one session:

- **Bun side**: `src-bun/test-server.ts` runs the same `SessionRegistry`
  + handler surface as production but over `Bun.serve` WebSocket
  instead of Electrobun's webview FFI. `src-bun/app/fakeClient.ts`
  is a minimal SDK mock that captures `onPermissionRequest` so tests
  can drive permission flows via a `__test.triggerPermission` control
  RPC. `src-bun/app/client.ts` gains a `setClientForTest()` injection
  seam.
- **Renderer side**: new `src/ipc/wsBridge.ts` implements `RpcBridge`
  over WebSocket. `src/main.ts` picks it when the page loads with
  `?testBridge=ws://host:port`.
- **Harness**: `e2e/full/harness/bunHarness.ts` spawns the bun
  subprocess per test, waits for `__TEST_SERVER_READY__` marker,
  seeds a temp workspace, exposes ws URL + control-RPC client +
  teardown.
- **Flows**:
  - `01-create-send` — boots app, types "hello", asserts assistant
    reply renders.
  - `02-at-picker` — three tests: @ shows real workspace files,
    `@.` does NOT exit popup (the v1 regression),
    `@./src/` lists children. **Catches the bug class we fought.**
  - `04-toggle-persist` — Alt+H + Alt+I flip toggles, page reload,
    assert checkboxes still checked + localStorage prefs persisted.
  - `05-permission` — fires a fake shell permission request via
    control RPC, asserts `PendingRequestCard` renders, clicks
    "Allow once", asserts the bun-side audit log records
    `decision=approveOnce, permissionKind=shell`.

### Process notes

- This is exactly the harness I should have built BEFORE the v1
  file-picker rebuild. The cwd-resolution bug + `@.` trigger bug
  would have failed `02-at-picker` in <2 seconds. Permission
  audit-log assertions would have caught any IPC drift in the audit
  payload shape. Lesson: ship the harness BEFORE the feature it
  would have caught regressions on.
- Plain `Enter` ≠ send in the composer (it inserts a newline so
  markdown line breaks work). `Ctrl+Enter` is the chord. Learned
  during F1 debugging.
- Lexical's `useMenuAnchorRef` appends the typeahead container to
  `document.body` directly; selectors that locate the picker via
  `.file-picker` (not `.lex-composer-frame .file-picker`) just work.

### Discovered bugs

None. Every existing FilePicker behavior assertion came back green.
The earlier v2 fixes (cwd, trigger punctuation, z-index, split
toggles, persistence) all hold under real chromium.

### Deferred to next pass

- Layout-restore flow (F6): needs the persisted-layout pipeline
  wired into the test-server settings path. Skeleton todo recorded
  in the SQL `todos` table.
- Settings round-trip (F7): same.
- HMR-project flow: easy add later.
- Real-CLI tier (Option B in the plan): opt-in `GH_TOKEN` for
  reasoning / quota / live-CLI permission shape regressions. Pure
  bonus — Option A already catches the bug classes that bit us.

### Files

- `src-bun/test-server.ts` (new entrypoint)
- `src-bun/app/fakeClient.ts` (new mock)
- `src-bun/app/client.ts` (`setClientForTest`)
- `src/ipc/wsBridge.ts` (new)
- `src/main.ts` (bridge selection)
- `src/App.vue` (drop `import.meta.env.DEV` gate on `autosession=1`)
- `e2e/full/playwright.config.ts` (new)
- `e2e/full/harness/bunHarness.ts` (new)
- `e2e/full/flows/{01-create-send,02-at-picker,04-toggle-persist,05-permission}.pwtest.ts`
- `package.json` (e2e + e2e:run scripts)
- `.github/workflows/ci.yml` (e2e:run on ubuntu)
- `plans/plan-e2e.prompt.md` (status: SHIPPED)
- `STATUS.md`, `MANUAL_TESTS.md`, `CHANGELOG.md` updated

### Gate

- `bun run lint`: clean.
- `bun test`: 366 pass.
- `bun run smoke:run` (Tier-1 chromium against vite preview/dev):
  green.
- `bun run e2e:run` (NEW): 6 flows green in 12 s wall.

---

## 2026-05-22 — E2E plan + AGENTS.md rule #4a (dogfood before task_complete)

### Takeaway

User asked: "why don't we have actual for real end-to-end tests?"
after MANUAL_TESTS.md filled with items tagged "can't be automated".

Honest answer: most of those are dodges, not hard walls. Filed a
concrete proposal at **`plans/plan-e2e.prompt.md`** with three
options:

- **A: Minimal harness** (~1 d) — Playwright + chromium + real bun
  subprocess + mocked SDK + real temp-fs. Would have caught all 3
  v1 file-picker bugs.
- **B: A + real-CLI tier** (+1 d) — opt-in real Copilot CLI for
  reasoning / quota / permission shape regressions.
- **C: Status quo** — keep losing trust per regression cycle.

Recommended A; implementation blocked on user approval (autonomous
mode shouldn't burn a day+ of unilateral infrastructure work).

The doc has an honest reassessment table: of ~12 "can't be
automated" classes in MANUAL_TESTS.md, only **2 are real walls**
(native OS file dialog + OS keyring). The other 10 are testable.

### Process rule added

AGENTS.md rule **#4a — Dogfood-before-`task_complete`** for any
change touching composer / Lexical / IPC / dockview / z-index. Was
implicit before; making it explicit because the three v1 file-picker
bugs would all have surfaced from a single `bun run dev` session.
"Lint + test + smoke green" is not a substitute for actually running
the app.

### Files

- `plans/plan-e2e.prompt.md` (new)
- `AGENTS.md` — rule #4a inserted under rule #4
- `STATUS.md` — Tier-2 E2E backlog row points at the new plan

---

## 2026-05-22 — File picker v2: the real fixes (cwd, trigger, toggles, border)

### Takeaway

The v1 file-picker rebuild earlier today shipped with **three critical
bugs the test suite missed entirely**:

1. **"No matches" for every session.** `cwdFor()` only checked
   `client.listSessions()`, which doesn't always contain an active
   session or carry a `cwd` field. The session's working directory
   was never stored on the registry's own `Entry`, so the lookup
   silently returned `undefined` → empty result set → "No matches".
2. **`@.` (and any other path-nav char) exited the popup.** Lexical's
   `useBasicTypeaheadTriggerMatch` default `punctuation` regex
   excludes `.`, `/`, `~`, `\`, `:`, `-` from the match — so the
   moment a user typed any path-nav char after `@`, the trigger
   ended and the popup closed. Path-nav ergonomics were spec'd but
   the trigger didn't allow them.
3. **Single combined toggle** instead of two separate (Hidden vs
   Ignored) toggles with persistence + keyboard shortcuts.

Plus a visual bug — accent-color border bleeding over the popup's
bottom edge.

### Why tests didn't catch any of these

- Bug #1: FilePicker tests use a fake `RpcBridge` that returns canned
  results. They never exercised the `searchWorkspaceFiles` →
  `cwdFor()` path. The bun-side `fileSearch.ts` unit tests gave a
  cwd directly. No integration test ran the whole
  renderer→bun→cwd→walk chain.
- Bug #2: Lexical's TypeaheadMenuPlugin trigger regex runs against
  real contenteditable selection. jsdom + happy-dom both have
  incomplete selection models. The plugin was never exercised
  programmatically in tests.
- Bug #3: The spec interview (rule #9) explicitly asked about the
  toggle; user said "default-filtered, with a toggle in the popup".
  I read that as one toggle; the user clarified later they meant
  two (Hidden + Ignored separately). Spec interview should have
  asked "one or two toggles?" — added that question shape to my
  internal heuristic.

### Fixes

**`src-bun/app/sessions.ts`**:
- `Entry` interface gains `workingDirectory?: string`. Both `create`
  and `resume` paths cache it at registration time.
- `cwdFor()` reads from the entry first; falls back to
  `client.listSessions()`; final fallback is `process.cwd()`.
- `searchWorkspaceFiles` now takes
  `{ includeHidden?, includeIgnored? }` options object.

**`src-bun/app/fileSearch.ts`**:
- `IGNORED_DIRS` and dotfile filters are now two independent gates.
- Cache key extended to `(cwd, includeHidden, includeIgnored)`.
- `FileSearchOptions` type exported for callers.

**`src/components/MentionPlugin.vue`**:
- Trigger `punctuation: ""` so any non-whitespace, non-`@` char
  extends the match — path-nav now works.

**`src/components/FilePicker.vue`** (full rewrite of the v1 toolbar):
- Two checkboxes (Hidden / Ignored) with Alt+H / Alt+I shortcuts
  bound at window level (so the editor-has-focus @-trigger case
  works too).
- Both prefs persist via `localStorage` (`dafman.filePicker.show{Hidden,Ignored}`).
- Each label shows its shortcut hint in a small kbd-style chip.
- `z-index: 1200` + explicit `position: relative` on the picker
  root forces a stacking context above the composer's
  `:focus-within` accent border. Lexical's `useMenuAnchorRef`
  appends the anchor to `document.body` with no z-index, which
  let the composer's accent border paint over the popup's bottom
  edge — fix is on the popup side, not the anchor side.

### Tests added

- fileSearch: 13 unit tests (was 11). New cases: each toggle in
  isolation, both together, the cache-key split.
- FilePicker: 11 tests (was 7). New cases: Ignored toggle
  separately, Alt+H / Alt+I shortcuts, localStorage persistence.

### Gate

- `bun run lint`: clean.
- `bun test`: **366 pass** (was 360).
- `bun run smoke`: prod + HMR green.

### Process lessons (logged here so I actually internalise them)

- **Don't ship without a single live test of the happy path** for a
  rebuild that crosses the IPC boundary. The `cwdFor()` bug would
  have shown up in 30 seconds of `bun run dev` smoke. Rule #4 covers
  this in spirit but not in letter — I'll add a per-feature smoke
  step to my own pre-push checklist.
- **Spec interview needs to probe granularity.** "Filter toggle"
  could mean one or many. Should default to "ask: how many toggles,
  what do they control" when there's more than one filter dimension.
- **Manual test list must be run before the user gets the build**
  where possible. Three of today's 10 v1 items would have caught
  bugs 1+2+border. I closed `task_complete` before any of them had a
  chance to fail.

---

## 2026-05-22 — File picker rebuild (@, paperclip, native dialog)

### Takeaway

Rebuilt the composer's `@`-file picker end-to-end. User reported it
"basically doesn't work"; instead of patching, I rewrote both layers:

- **Bun side**: `fileSearch.ts` now supports two modes (fuzzy on the
  cached workspace index + path-navigation for queries with separators
  / `~` / absolute paths). Results carry `kind: "file" | "directory"`.
  New `includeHidden` toggle bypasses the IGNORED_DIRS + dotfile
  filter; cache is keyed on `(cwd, includeHidden)` so flipping the
  switch in the UI doesn't re-walk.
- **Renderer**: new `FilePicker.vue` is the popup body for both
  entry points. `MentionPlugin.vue` rewritten to use a sentinel
  TypeaheadMenuPlugin option + render FilePicker as the menu UI.
  Paperclip button now opens a PrimeVue Popover hosting the same
  FilePicker with its own search input. Single-pick per popup;
  directories attach as `directory` pills (existing AttachmentNode
  kind + folder icon).
- **New RPC `pickAttachment`**: opens the native OS dialog (files OR
  dirs) and returns `{path, kind}` or null. Powers the Browse… escape
  hatch inside the popup.

### Process notes

- Interview-before-implement (rule #9) shaped the design — `ask_user`
  form locked seven ambiguities (single-pick, directory-pill,
  CLI-style paths, default-filtered toggle, replace MentionPlugin,
  native files+dirs, paperclip opens popup).
- Manual test list ships with the feature (rule #10) — 10 items
  in `MANUAL_TESTS.md` covering @-trigger keyboard nav, path-nav
  shapes, paperclip popover, native dialog, toggle behavior,
  directory pill semantics. All depend on real Lexical / WebView /
  OS dialog interactions that automated tests can't cover.

### Tests added

- `src-bun/__tests__/fileSearch.test.ts` rewritten: 11 tests across
  fuzzy mode + path-nav mode + the hidden toggle.
- `src/components/__tests__/FilePicker.test.ts`: 7 tests covering
  result rendering, single-pick emit shapes (file vs directory),
  toggle wiring, Browse… happy + cancel paths, empty state, internal
  search input mode.
- Wire-contract snapshots for `WorkspaceFileMatch` (with `kind`) and
  `pickAttachment` result shape.

### Decisions

- **Removed the hidden `<input type="file">` paperclip path.** It only
  yielded blobs (no fs path due to WebView2 sandbox), so SDK
  attachments were stuck at `type: "blob"`. The new `pickAttachment`
  RPC returns absolute paths via `Utils.openFileDialog`, letting us
  ship `type: "file"` / `type: "directory"` attachments end-to-end.
  Drag-drop + paste keep the blob path (still needed for pasted
  images, dragged temp files).
- **`displayName` carries the relative path** (e.g. `src/main.ts`) so
  the pill label reads compactly while `path` holds the absolute fs
  path for the SDK.
- **Sentinel option in MentionPlugin** — TypeaheadMenuPlugin needs
  `options.length > 0` to stay mounted; we render a single sentinel
  and route real selection through a `pendingAttachment` tunnel + the
  picker's imperative `pickCurrent()` / `moveHighlight()` API. Editor
  keeps focus; we capture window-level ArrowUp/Down to drive the list.

### Tests at a glance

- `bun run lint`: clean.
- `bun test`: 360 pass (was 347; +13 — 11 fileSearch + 2 wire-shape +
  -7 FilePicker − duplicates from prior pendingRequests churn).
- `bun run smoke`: prod + HMR green (4.6 s wall).

---

## 2026-05-22 — Process rules #9 + #10; workspaces API verdict; manual-test backlog

### Takeaway

Two new hard rules in AGENTS.md:

- **#9 Spec-interview before implementation** — use `ask_user` with a
  structured form for every non-trivial feature. Plan mode if the
  design space is large enough that a single form can't cover it.
- **#10 Manual-test list per feature** — every feature appends a
  checklist to `MANUAL_TESTS.md` with steps / expected / why-not-
  automated. User runs the list and reports back; passing items get
  promoted to verified.

Retroactive `MANUAL_TESTS.md` covers every code-bearing commit since
`52a2956`: ring buffer, reasoning fix, permission rule editor, skills
toggle, observability stack, export, audit log, workspace MCP
discovery.

### Workspaces API verdict — NOT an enforcement surface

User asked whether `rpc.workspaces.*` could power a "files the agent
is allowed to touch" view. After reading the SDK README + the bundled
CLI's `app.js` impl:

- `rpc.workspaces.{getWorkspace,listFiles,readFile,createFile}` targets
  the **session's infinite-sessions state directory** —
  `~/.copilot/session-state/{sessionId}/{checkpoints,plan.md,files}/`.
- It is **not** a permission gate. All paths in those calls are
  **relative to that one directory** — no traversal, no project-cwd
  access.
- Filesystem access against the user's repo is gated by
  `onPermissionRequest` (kind `"read"` / `"write"`, with `fileName`
  populated). **That** is the enforcement layer — and we already
  consume it via PendingRequestCard + PermissionRuleEditor (commit
  `b015d68`).

Useful applications of `rpc.workspaces.*` exist but are different:
plan panel (`plan.md`), per-session generated-files tab, checkpoint
browser. None help with "what can the agent touch in my repo".

Receipts: `node_modules/copilot-sdk-supercharged/dist/generated/rpc.d.ts:2209-2330`
(types + namespace shape), `app.js:1322` (`listWorkspaceFiles` walks
the session state dir), `app.js:7342` (`getWorkspacePath` returns the
session state path), README.md:210-212 (`workspacePath?: string`
property documented).

### Next: @-file picker

Spec locked via `ask_user` (per rule #9): single-pick, directory =
single pill, CLI-style `@/abs`, `@~/`, `@../` paths, default-filtered
fuzzy with a toggle, replace `MentionPlugin.vue`, native dialog button
files + dirs, paperclip opens popup, backend = my call (will use
Bun.glob in the bun process + cache).

Implementing next session.

---

## 2026-05-22 — SDK + CLI deep audit deliverable

### Takeaway

User asked for an exhaustive audit of `copilot-sdk-supercharged` + the
bundled `@github/copilot` CLI to find features missed in our plans.
Earlier session attempted a shallow pass; user pushed back ("I know you
like to be lazy but don't"). This session reads the SDK README
end-to-end (1135 lines), the full `dist/generated/rpc.d.ts` server +
session RPC surface (~2400 lines), and every `added` changelog entry
across 212 versions of `@github/copilot` (436 entries from v0.0.329 to
v1.0.48).

Deliverable: **`plans/plan-sdk-audit.prompt.md`** — categorised
findings (Wire-ready RPCs / Unset config knobs / CLI features /
Truly-new surfaces / Re-evaluated deferrals / Proposed Phases 18–23 /
Open questions). STATUS.md "Next concrete steps" replaced with the new
ordering.

### Why image gen comes back

Earlier I deferred image generation citing "no `responseFormat`
strings in CLI's `app.js`". That was misleading evidence — the SDK
README documents `assistant.image` events and `assistant.content`
mixed content blocks; the format is driven by the model and the
session config, not by string-matching in the CLI source. Re-listed
as Phase 21.

### Why MCP registry promoted ahead of Projects

Highest user-value per day of work; doesn't depend on any other
Phase landing. CLI shipped `copilot mcp` CLI command in 1.0.21
(matching scope on the terminal side); our gap was purely UI.

### Reading order captured for next agent

§I of `plan-sdk-audit.prompt.md` enumerates the exact files + line
ranges so the next session can pick up the cross-reference work
without re-discovering the same sources.

### Receipts

- Audit doc: `plans/plan-sdk-audit.prompt.md` (~520 lines, 9 sections).
- STATUS.md "Next concrete steps" rewritten + new historical-log
  bullet pointing at the audit.
- No code changes this session; the audit *is* the deliverable.
- Methodology + sources listed in §I so the conclusions are
  reproducible.

---

## 2026-05-22 — Export conversation + permission audit log (Phase 3 + Phase 4 start)

### Takeaway
Two clean wins, both ship end-to-end with tests:

**Export conversation.** Per-session gear popover → Export Markdown /
JSON. Renderer builds via `formatConversation` (reuses `processEvents`
so the export tracks what's on screen); bun writes under
`<userData>/exports/<basename(normalize(name))>` with path-traversal
defence; auto-reveals.

**Permission + URL audit log.** `<userData>/audit/permissions.jsonl` +
`urls.jsonl`. Append-only. Records permission decisions (kind,
decision, summary, approval scope/domain) + URL opens
(allowed/blocked + reason). Live tail visible in a new "Activity" tab
of the Diagnostics edge panel — sits alongside the existing logs tab,
same UI primitives. Decision pivot during the session: image gen was
on the next-steps list but isn't safely shippable today (CLI app.js
has no responseFormat handling; no model capability flag surfaces
support), and Tier-2 E2E was 1d-undersized (cross-platform
WebView debugging is its own project). Audit logging was a 1-d
slot that genuinely complements Phase 1's diagnostics work.

### Detail (export)
- `src/lib/exportConversation.ts` — `formatConversation(input, format)`
  + `exportFilenameStem`. Markdown ordering: title + metadata + per
  item (user with attachments, assistant skipping empties, reasoning
  folded inside `<details>` with encrypted variant, tool with
  args/output/result/error, system bubbles with icons). pendingRequest
  items deliberately skipped.
- `src-bun/app/exports.ts` — `saveExportFile` with basename+normalize
  sanitisation. New RPC + 1 wire-shape snapshot.
- `SessionHeaderControls.vue` popover gains the two buttons; dynamic
  imports keep the bundle cost gated.
- 15 markdown + 3 JSON + 3 filename + 3 bun-side tests.

### Detail (audit)
- `src-bun/app/audit.ts` — append-only JSONL writers split by category.
  Per-process ring buffer (500) + subscriber API for live fan-out;
  pattern mirrors `src-bun/app/logging.ts`. `recordPermission` +
  `recordUrl` return `Promise<void>` so tests can deterministically
  await side-effects.
- `SessionRegistry.enqueuePending` extended with optional
  `{ permissionKind, summary }` carried on the entry; recorded on
  every `respondToRequest` decision.
- `index.ts` openUrl handler records the allow/block + reason.
- `getAuditState` RPC + `auditEvent` webview message + bridge.
- `LogViewer.vue` gains a Logs/Activity SelectButton tab; Activity
  view reuses the same row primitives with per-decision colors.
- 4 bun-side tests (perm append + subs + ring; url append + separate
  files; 500 cap; no commingling) + 1 sessions.test integration that
  drives the full SDK→handler→respondToRequest→audit flow + 1 wire
  snapshot.

### Decision pivots logged
- **Image generation deferred.** SDK accepts `responseFormat` +
  `imageOptions` on session.send, but the bundled CLI's `app.js` has
  zero references to either, no model in the catalog exposes a
  capability flag indicating image support, and shipping a
  "Generate image" UI affordance that may always no-op violates
  anti-laziness rule #1 (no half-work). Re-evaluate when a confirmed
  working image-gen model lands.
- **Tier-2 E2E deferred.** Real Electrobun binary E2E requires
  cross-platform WebView debugging ports (WebView2 args on Windows,
  WKWebView remote inspect on macOS, GTK WebKit on Linux) — meaningful
  project, not a 1-d slot. Keeping Tier-1 renderer smoke + the
  Tier-2 build matrix (Phase 1) as the gate for now.
- **Per-session tool toggle deferred.** SDK exposes `availableTools` /
  `excludedTools` only at session create time + a read-only
  `tools.list` RPC. Mid-session mutation isn't documented. Building
  this properly needs a "default excluded tools" Settings panel +
  per-session view with "restart to apply" hint — bigger than 1 d.
  Stays in Phase 4.

### Receipts
- `src/lib/exportConversation.ts`, `src-bun/app/exports.ts`,
  `src-bun/app/audit.ts`, `src/stores/auditStore.ts` (new).
- `src/lib/__tests__/exportConversation.test.ts` (15),
  `src-bun/__tests__/exports.test.ts` (3),
  `src-bun/__tests__/audit.test.ts` (4),
  `src-bun/__tests__/sessions.test.ts` (+1 integration),
  `src-bun/__tests__/wire-contract.test.ts` (+2 snapshots).
- 347 `bun test` pass (was 325), lint clean, smoke green prod + hmr.

---

## 2026-05-21 — Phase 1: observability tail (log viewer + redaction + diagnostics + CI matrix)

### Takeaway
Closed every open M1 observability item in one chunk: in-app log viewer
(`LogViewer.vue`) wired to a live `logEvent` webview message, runtime
log-level toggle that mutates the bun side without restart, redaction
pipeline that strips tokens/prompts/attachment data before anything
reaches disk (12 snapshot tests pin each rule), diagnostics bundle
export that ships pre-redacted logs + a recent.json ring dump + a
settings snapshot + a README to `<userData>/dafman-diagnostics-…`, and
finally a cross-platform `electrobun build` CI matrix (Ubuntu / macOS /
Windows, currently `continue-on-error` until it's stable).

### Detail
- **Redaction (`src-bun/app/redact.ts`).** Two passes per object:
  sensitive keys (`token`/`secret`/`password`/`authorization`/`apiKey`/…)
  → `***`; content keys (`prompt`/`content`/`text`/`data`/`reasoningText`/
  `reasoningOpaque`/`encryptedContent`/`message`/…) → `{len, prefix}`
  shape descriptor. Long strings under unknown keys also get summarised.
  Recursion budget (depth 6) and array cap (32 + tail marker) so a
  pathological payload can't stall the logger.
- **Logger (`src-bun/app/logging.ts`).** Subscribers receive every emitted
  record (no level filter) so the in-app viewer can flip its display
  filter without losing context; the bun-side `level` only gates what
  reaches stderr + the daily file. New API: `setLogLevel`,
  `subscribeLogs`, `recentLogs` (ring of last 1000), `buildRecord` (also
  exported for tests).
- **RPCs.** `getLogState({recentLimit})` returns the live `{level, recent[]}`;
  `setLogLevel({level})` mutates the bun-side config; `exportDiagnostics({})`
  copies all `dafman-*.log` files + dumps recent.json + writes
  settings.json + README into `<userData>/dafman-diagnostics-YYYY-MM-DD-HHMM/`.
  New webview message: `logEvent` for live fan-out. Bridge surface
  (`RpcBridge.onLogEvent`) added; smoke + sessionsStore.restore.test +
  sessionCommands.test stubs updated.
- **Log viewer panel (`LogViewer.vue`).** Activity-bar bottom entry
  (`pi-bars`); on mount fills via `getLogState`, then subscribes to
  `logEvent`. Header row has Active-level dropdown (mutates bun side),
  Display dropdown (renderer-only filter), Search field (substring
  against JSON-serialised record), counts ("N shown / M buffered"),
  Clear, "Export bundle". List uses CSS grid (timestamp / level /
  message + fields beneath) with per-level color hints and a soft
  background tint for warn/error rows. Pause-on-scroll auto-detects so
  the user can scroll up without the tail snapping back; "paused"
  indicator appears in the count row.
- **CI matrix.** Tier-1 stays Linux-only and required (lint + test +
  vite + smoke). New Tier-2 `build-matrix` job runs `bunx electrobun
  build` on `ubuntu-latest` + `macos-latest` + `windows-latest`. Marked
  `continue-on-error: true` so a transient native-toolchain failure
  doesn't block merges; flip to required once it has been green for a
  week.
- **AppError union** gained `Io` variant for the diagnostics file ops.
  Mirrored in `src/ipc/types.ts` + the formatter in `src/ipc/invoke.ts`.

### Receipts
- `src-bun/app/redact.ts`, `src-bun/app/logging.ts` (rewritten),
  `src-bun/app/diagnostics.ts` (new).
- `src/stores/logStore.ts`, `src/components/LogViewer.vue` (new).
- `src-bun/__tests__/redact.test.ts` (12 cases, 1 snapshot),
  `src-bun/__tests__/diagnostics.test.ts` (2 integration tests),
  `src-bun/__tests__/wire-contract.test.ts` (+3 snapshots).
- `.github/workflows/ci.yml` (CI matrix).
- 325 `bun test` pass (was 308), lint clean, smoke green prod + hmr.

### Open question
Should the diagnostics bundle be a real ZIP rather than a directory?
Pragmatic v1 just creates the directory and reveals it — the user has
to zip it themselves before uploading to a bug report. If this proves
annoying we can add a programmatic ZIP step using Bun's archive
primitives.

---

## 2026-05-21 — Audit, ARCHITECTURE.md, anti-laziness AGENTS rules

### Takeaway
Every plan doc was carrying a "post-Electrobun port" header note dating back to
2026-05-17 and the M1 backlog in `STATUS.md` was stale. Two-thirds of the
"M1 still open" items actually shipped weeks ago. Auditing the codebase
against the plans surfaced ~30 RPC handlers, ~30 components, 11 Pinia stores,
and 10 bun-side domain modules already implemented. The remaining real
backlog is Observability tail (log viewer, redaction snapshot tests, runtime
log-level toggle), the M3 URL policy editor, and most of M4-M7. New
`ARCHITECTURE.md` captures the current reality; this `DEVLOG.md` becomes the
running log going forward; AGENTS.md gained hard anti-laziness rules
(below).

### Detail
- Audited every component / store / RPC against `plans/plan-roadmap.prompt.md`.
  Wrote the live state into `ARCHITECTURE.md` and re-organised the
  open-backlog list in `STATUS.md` to reflect what's actually missing.
- Updated `AGENTS.md` with five anti-laziness rules: no half-work, run the
  full check before claiming done, update `STATUS.md` + `CHANGELOG.md` +
  `DEVLOG.md` on every session, no silent doc drift, no unverified claims.
- README rewritten to surface the current feature set (multi-pane streaming
  chat, command palette, MCP-style permission UX, attachments, mermaid,
  dark mode) so first-time visitors don't land on the M0 description.

### Receipts
- `ARCHITECTURE.md` (new) — current module map + invariants + SDK gotchas.
- `DEVLOG.md` (new, this file).
- `AGENTS.md` — Anti-laziness rules section added.
- `STATUS.md` — Next concrete step + M1 / M2+ backlog refreshed.
- `README.md` — Features-today expanded; quick links restructured.

---

## 2026-05-21 — P0/P1 sweep: bounded events, reasoning_opaque, permission rules, session settings

### Takeaway
Four backlog items shipped end-to-end with tests. The
`reasoning_opaque`-displays-empty regression that I had previously patched
with a "Reasoned privately" placeholder was actually a wire-protocol bug:
the CLI delivers reasoning on `assistant.message.data.{reasoningText,
reasoningOpaque, encryptedContent}`, NOT on `assistant.reasoning_delta`.
Found this by reading `node_modules/@github/copilot/app.js:4487`.

### Detail
1. **Bounded `record.events`** (`38d42ca`). Ring-buffer trim at
   `MAX_EVENTS_PER_SESSION = 5000`. Consumers track absolute progress
   (`droppedEventCount + events.length`) instead of array indices so trims
   don't cause re-processing or skipping. Centralised via exported
   `sessionsStore.appendEvent`; every push site migrated. 3 regression tests.
2. **`reasoning_opaque` properly fixed** (`0812f9a`). Investigated CLI source
   — schema declares `assistant.reasoning_delta` / `assistant.reasoning` but
   `app.js` never emits them from the main model path. Reasoning is on
   `assistant.message.data.reasoningText` / `reasoningOpaque` (Anthropic) /
   `encryptedContent` (OpenAI GPT-5.x). Reducer's `assistant.message` handler
   harvests these into a reasoning ChatItem keyed at `msg:${messageId}` placed
   before the assistant bubble. Memory stored: "copilot CLI reasoning events".
3. **Permission rule editor** (`b015d68`). `PermissionRuleEditor.vue` builds
   the SDK's `PermissionDecisionApproveForSessionApproval` union from
   per-kind defaults: shell (commands, first-token prefix), read/write/memory
   (blanket), mcp (this tool vs all tools from server), url (auto-extracted
   domain), custom-tool. New IPC type `PermissionApprovalRule`. 3 new wire
   snapshots.
4. **Session-popover skills + usage metrics** (`a0a3886`). Three new bun RPCs
   (`listSessionSkills`, `setSessionSkillEnabled`, `getSessionUsageMetrics`)
   wired to SDK `rpc.skills.*` + `rpc.usage.getMetrics`. Lazy-fetched on
   popover-open. Errors surface inline because both APIs are `@experimental`
   in the SDK.

### Receipts
- Commits `38d42ca`, `0812f9a`, `b015d68`, `a0a3886`.
- Tests: 308 pass (up from 297 at session start).
- Memory: "copilot CLI reasoning events" (DecoratorNode rule already stored).

---

## How to keep this log useful

- Write entries when:
  - You shipped a substantive change (one or more commits).
  - You investigated something and the conclusion has lasting value
    (wire-protocol facts, SDK quirks, anti-patterns).
  - You hit a dead end worth warning future-you about.
  - You changed direction.
- Skip entries when:
  - You only touched docs.
  - You did a one-line bug fix with a clear commit message.
- Keep entries short. Lead with the takeaway. The diff is in git; here we
  capture what the diff alone wouldn't tell you.
