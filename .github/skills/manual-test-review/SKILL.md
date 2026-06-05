---
name: manual-test-review
description: >-
  Workflow for REVIEWING the dafman manual-test checklist (MANUAL_TESTS.md) for
  quality and — above all — automatability. Distinct from the `manual-tests`
  skill, which EXECUTES/dogfoods the queue; this one AUDITS the entries
  themselves. TRIGGER when the user says "review the manual tests", "audit
  MANUAL_TESTS", "are these manual tests any good", "can any of these be
  automated", "review the manual-test checklist/coverage", "do we still need
  these manual tests", or when reviewing a PR that adds/changes
  MANUAL_TESTS.md entries. ENFORCES: challenge every "Why not automated" (the
  default assumption is it CAN become an e2e/full flow); each entry must have
  id + Steps + Expected + Why-not-automated + a result line, with a FALSIFIABLE
  Expected; the "Why not automated" must name the SPECIFIC blocking primitive,
  not "needs a real render"; stale hygiene (archive verified sections, drop
  dead-feature/duplicate rows, failed rows must be filed + removed); and verify
  the harness/backend can actually drive a check before recommending conversion.
  A bloated, stale, or "everything is manual" checklist is a smell — most of it
  is automatable through the real-backend e2e/full harness.
---

# Manual-test review (dafman)

`MANUAL_TESTS.md` `## ⏳ Pending verification` accumulates checks that authors
declared un-automatable. Left unreviewed it rots two ways: (1) entries that are
*actually* automatable sit forever as manual debt the user must hand-walk, and
(2) verified / dead-feature / duplicate rows pile up and bury the few real
manual checks. This skill audits the queue, **converts what can be converted
into committed `e2e/full` flows**, and prunes the rest — so the manual list is
only the irreducible OS/visual checks a human truly must eyeball.

Sibling skills: `manual-tests` (executes the queue live with the user as
hands+eyes); `code-audit` (audits prod code quality). This one audits the
*checklist*.

## Hard rules (do not skip)

1. **Challenge every "Why not automated" — default: it's an e2e/full flow.**
   Most entries claiming "needs a real WebView / live render / dockview repaint"
   are asserting **DOM or store state after a UI action**, which the real-backend
   harness drives fine. Precedent (2026-06-04): TF.1 (#126 popup), DSP.1 (#129
   deleted), SN.1/RP.2/RP.3 (#149 rename) all read "needs real WebView … happy-dom
   can't model" — all three became green flows `26/27/28` against the real
   `test-server` backend in one sitting. Treat "Why not automated" as a claim to
   *disprove*, not accept.
2. **Each entry must have the full shape.** `#### <ID> - <title>` + `Steps:` +
   `Expected:` + `Why not automated:` + a `- [ ] result:` line. Flag any entry
   missing a part.
3. **`Expected` must be FALSIFIABLE.** "Looks right", "renders nicely", "works"
   are not testable. Rewrite to a concrete observable (which element, which
   attribute/text/position, which state). An un-falsifiable check can neither be
   automated nor honestly dogfooded.
4. **The `Why not automated` must name the BLOCKING PRIMITIVE.** "Native OS
   file dialog", "WebView2 IME composition", "perceived animation smoothness",
   "real OAuth redirect" — specific. "Needs a real render" / "live behavior" is
   not a reason; it's the smell of an automatable check mislabeled.
5. **Stale hygiene.** Verified whole sections → `MANUAL_TESTS_archive.md`. Rows
   for reverted/removed features → drop (cite the commit). Duplicates → merge.
   A `❌ FAIL` row must have an issue filed (`manual-test-fail` label) and be
   removed per the file header workflow. Never leave a failed row un-filed.
6. **Verify before recommending conversion.** Before you tell the user "this can
   be an e2e flow", confirm the harness can actually drive it: the selectors
   exist, and the backend RPC is wired (`test-server.ts` is a SUBSET of
   `index.ts` — a missing handler `unknown rpc`s; you may have to add it, as with
   `setSessionName` on 2026-06-04). A conversion you can't stand up is a vibe.

## The automatability test (the core of the review)

For each entry ask: *what does `Expected` actually assert?*

**KEEP manual** (genuinely unautomatable — the harness is headless chromium with
a fake SDK, no OS, one window):

- Native OS surfaces: file/folder dialogs, keyring/credential prompts, UAC,
  notifications, taskbar/title-bar, installer (`install:canary`).
- Real multi-window / multi-process timing the harness can't orchestrate.
- IME composition, real keyboard-layout / dead-key behavior.
- Visual *perception*: flicker, sub-pixel/anti-alias, animation smoothness,
  spinner-orbit-center, theme paint — anything where the assertion is "looks
  smooth/centered", not a measurable rect.
- Real external infra: live OAuth MCP redirect, a real CLI/SDK side-effect the
  `fakeClient` doesn't script.

**CONVERT to `e2e/full`** (automatable in disguise — `Expected` is a measurable
DOM/store fact after a UI action):

- Labels/text after an action — tab title, sidebar row, banner copy.
- State flips — `contenteditable="false"`, disabled buttons, `(deleted)` markers,
  open/active counts.
- Geometry that's actually measurable — popup within viewport
  (`getBoundingClientRect` vs `innerHeight/Width`), not clipped.
- Persistence — set state → reload (or `harness.restart()`) → assert restored
  (`localStorage`, layout).
- Focus / scroll — `document.activeElement`, scrollTop at expected end.

The tell: if the `Expected` could be written as a Playwright `expect(...)`, it's
a flow, not a manual test.

## Workflow

1. **Read the queue.** `MANUAL_TESTS.md ## ⏳ Pending verification` — every
   sub-section + item. Also skim `MANUAL_TESTS_archive.md` to catch duplicates
   of already-verified checks.
2. **Categorize each item**: `keep-manual` / `convert` / `rewrite`
   (shape/Expected broken) / `drop` (stale/dead/duplicate). Record the verdict +
   one-line reason per id.
3. **For `convert` candidates, verify feasibility** against the e2e/full harness
   (selectors + backend RPC + an existing pageHarness helper). Downgrade to
   `keep-manual` only if a *specific* primitive genuinely blocks it.
4. **Produce the review report**: a table (id · verdict · reason · target flow),
   the count of convertible-vs-irreducible, and the worst offenders (vague
   Expected, mislabeled "manual", stale rows).
5. **Act** (with the user's go-ahead for scope):
   - `convert` → write the `e2e/full/flows/NN-*.pwtest.ts` flow(s), run green,
     and switch the manual row to a thin "guarded by flow NN" note or drop it.
   - `rewrite` → fix the entry in place (falsifiable Expected, named primitive).
   - `drop` → remove + (if it was a real fail) file the issue.
   - `archive` → move fully-verified sections to `MANUAL_TESTS_archive.md`.
6. **The conversion attempt is itself a dogfood.** Writing the flow runs the real
   feature — it can surface real bugs. Precedent (2026-06-04): converting the
   rename test exposed #166 (`/rename` opens no dialog because its `area='all'`
   `SessionHeaderControls` host isn't mounted). File those.

## e2e/full harness facts (what makes conversion possible)

- **Real backend, fake SDK.** `spawnBunHarness()` (`e2e/full/harness/bunHarness.ts`)
  spawns `bun src-bun/test-server.ts` (the REAL `src-bun` services + RPC
  handlers, with `fakeClient` as the SDK). The renderer loads the prod bundle at
  `/?testBridge=ws://127.0.0.1:<port>&autosession=1`.
- **Page helpers** (`e2e/full/harness/pageHarness.ts`): `openActivityTab(page,
  "Sessions"|"Terminals"|"Jobs"|"Logs"|"Settings"|"Session details"|"Library")`,
  `openDetailsRail(page)`, `urlFor(harness, …)` (re-derive the URL after
  `harness.restart()`).
- **Assertions**: ordinary Playwright + `page.evaluate(() =>
  el.getBoundingClientRect()/localStorage/document.activeElement)`. To exercise a
  store action with no UI trigger, reach Pinia via
  `document.querySelector('#app').__vue_app__._context.provides` → find the value
  whose `._s instanceof Map` → `._s.get('sessions')` (works in the prod bundle).
- **`test-server.ts` is a hand-maintained SUBSET of `index.ts` handlers.** A
  renderer call to an unwired command returns `unknown rpc: <name>`; add the
  handler mirroring `index.ts` (precedent: `getSessionName`/`setSessionName`,
  2026-06-04). `deleteSession`, `createSession`, `resumeSession`, etc. are
  already wired.
- **Limits**: no OS surfaces, no real SDK behavior beyond the `fakeClient`
  scripts (`__test.setSendScript` via `harness.invokeControl`), one window.

## When NOT to run a full review

- The user points at ONE entry — judge that one; don't audit the whole file.
- `## ⏳ Pending verification` is empty — say so; nothing to review.
- The ask is to *execute* the checklist, not assess it — that's the
  `manual-tests` skill.

## References

- Queue + result-line workflow: `MANUAL_TESTS.md` header.
- Archive: `MANUAL_TESTS_archive.md`.
- Execution counterpart: `skill://manual-tests`.
- Harness: `e2e/full/harness/{bunHarness,pageHarness}.ts`, `e2e/full/flows/*.pwtest.ts`,
  `e2e/full/playwright.config.ts`; backend `src-bun/test-server.ts`.
- Issue workflow + labels: `AGENTS.md` `## Workflow — GitHub Issues + PRs`.
