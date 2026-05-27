# Plan — Real E2E test tier (2026-05-22)

> **STATUS:** Option A **SHIPPED** in commits this session.
> `bun run e2e` is live with 6 baseline flows. Architecture details
> below remain accurate; "until this lands" rule #4a in AGENTS.md
> still applies for surfaces not covered by E2E.

> User asked: "why don't we have actual for real end-to-end tests?"
> after MANUAL_TESTS.md filled up with items tagged "can't be
> automated without spawning a real CLI / changing settings / etc."
>
> Honest answer: most of those are dodges, not hard walls. This doc
> captures what we have, what's actually impossible, what's cheap,
> and a concrete proposal for closing the gap. Awaiting user
> approval before implementation.

---

## What we have today

| Tier | Tool | Reaches | Misses |
|---|---|---|---|
| **Unit** | `bun test` + happy-dom + fake `RpcBridge` | reducer logic, store invariants, pure helpers, wire-shape snapshots | real DOM, real bun process, real SDK |
| **Renderer smoke** | `bun run smoke` (Playwright + chromium against `vite dev` / `vite preview`) | renderer bundle boots without console errors; basic CSS / DOM | bun process, IPC, SDK |
| **CI Tier-2** | `electrobun build` matrix (Linux + macOS + Windows) | binary compiles | binary is never *driven* |

What's missing: a tier that **drives the full app** (renderer + bun
process + at least a fake SDK + a real fs workspace) and exercises
user flows end-to-end.

---

## The "can't be automated" items in MANUAL_TESTS.md — honest reassessment

| Item | Truly automation-blocked? | Why / how to drive it |
|---|---|---|
| Drive the real Electrobun binary | ⚠️ Hard | WebView2/WKWebView don't expose CDP debug ports by default. **Workaround:** drive the bun process directly via WebSocket transport + a Playwright-launched chromium against `vite preview` wired to that socket. Bypasses the webview entirely. |
| Real Copilot CLI session | ❌ No, dodged | Needs `GH_TOKEN` (or local CLI auth). Once present, `client.createSession({ workingDirectory })` works. Local-only initially is fine. |
| Native OS file dialog | ✅ **Real wall** | OS-modal. Not driveable from Playwright on any platform. Mitigation: stub `Utils.openFileDialog` behind a `DAFMAN_TEST_PICKER_PATH` env var. |
| OS keyring (multi-account future) | ✅ **Real wall** | OS-modal credential dialogs / native auth flows. Use mock keyring in test mode. |
| localStorage persistence across restart | ❌ No, dodged | Playwright `page.reload()` preserves localStorage. Full process restart is also testable. |
| `@.` trigger / arrow-key picker nav | ❌ No, dodged | Real chromium + real Lexical + `page.keyboard.press("...")` drives it. **Would have caught both v1 bugs in 30 seconds.** |
| Permission flow | ❌ No, dodged | Send a prompt that asks the agent to `ls`; assert `PendingRequestCard` shows; click approve; assert audit log entry. |
| Layout restore | ❌ No, dodged | Open panels, kill bun, re-spawn, assert layout JSON applies. |
| Log tail | ❌ No, dodged | Trigger something logged on the bun side, assert it appears in the renderer log viewer. |
| Settings round-trip | ❌ No, dodged | Open settings, change a value, restart bun, re-open settings, assert. |
| Image gen / model-specific reasoning | ⚠️ Hard without real CLI | Mock SDK responses are fine for everything except live model behavior. |

**Bottom line:** ~80% of the manual items are testable today with a
modest harness investment. Only OS-native modals stay manual forever.

---

## Why the current test suite missed the v1 file picker bugs

Concrete: the v1 picker had three production bugs that shipped:

1. **`cwdFor()` returned undefined** for every active session → "No matches" for everyone.
2. **`@.` exited the menu** because Lexical's trigger regex excluded path-nav chars.
3. **Border bled over the popup** due to z-index stacking with the composer focus border.

Why each was missed:

| Bug | Unit tests' blind spot |
|---|---|
| 1 | FilePicker tests use a fake `RpcBridge` returning canned data — never exercise the real `searchWorkspaceFiles` → `sessions.cwdFor` chain. fileSearch unit tests pass a cwd directly. **No test ran the actual end-to-end IPC.** |
| 2 | `useBasicTypeaheadTriggerMatch` runs against contenteditable selection. happy-dom / jsdom both have incomplete selection — the plugin is **never exercised programmatically**. |
| 3 | jsdom doesn't paint. Stacking-context bugs are invisible to it. **Only a real browser catches these.** |

A modest E2E tier with one happy-path "create session → @-pick a
file → submit" test would catch bugs of class 1, 2, and (with
visual regression snapshot) 3.

---

## Proposal — three options, pick one

### Option A: Minimal harness (~1 day) — RECOMMENDED for autonomous mode

**Stack:** Playwright + chromium against `vite preview` + a real
bun subprocess with **mocked Copilot SDK** + real temp-fs workspace.

**Architecture:**
```
e2e/full/
  harness/
    bunHarness.ts        # spawn `bun src-bun/index.ts --test-port=NNN`
    fakeCopilotClient.ts # in-process mock of CopilotClient methods
    pageHarness.ts       # launch chromium, wire bridge to bunHarness port
    fixtures/            # canned SDK event sequences
  flows/
    01-at-picker.pwtest.ts
    02-send-receive.pwtest.ts
    03-permission.pwtest.ts
    04-layout-restore.pwtest.ts
```

**Required code changes:**
- Add a WebSocket-based `RpcBridge` impl alongside the Electrobun
  one (`src/ipc/wsBridge.ts`). Renderer picks based on a
  `?testBridge=ws://localhost:NNN` URL param.
- Add a `--test-port=NNN` flag to `src-bun/index.ts` that spawns
  the same RPC handlers behind a `ws` server instead of (or
  alongside) Electrobun's FFI. Same logic, different transport.
- Add a `--mock-sdk` flag that injects `fakeCopilotClient` instead
  of real `CopilotClient`.

**Catches today:**
- All 3 of the v1 file-picker bugs (cwd resolution, `@.` trigger,
  visual stacking).
- Most permission / layout / settings flows.

**Doesn't catch:**
- Real model behavior (reasoning, image gen).
- Native OS modals (file dialog, keyring).
- WebView2-specific rendering differences.

**Effort:** 1 day for harness + 4-6 baseline tests covering the
flows above.

### Option B: Add real-CLI integration on top of A (~1 more day)

After A lands, add a parallel `bun test:e2e:live` flag that uses
the real `CopilotClient` against the user's existing CLI auth
(local-only at first; CI variant requires `GH_TOKEN` secret +
Copilot subscription).

**Catches additional:**
- Real reasoning event shape regressions.
- Real CLI permission-prompt shape regressions.
- Real model picker / quota / usage metrics.

**Doesn't catch:** native OS modals — those stay manual.

### Option C: Don't build it — keep relying on manual tests + smoke

The status quo. The v1 file-picker class of bug ships, the user
catches it in dogfooding, we fix and re-ship. We lose user trust
faster than we save engineering time.

**Recommended if:** the project is in throwaway-prototype mode.
**Not recommended now** — the user explicitly asked for "actual for
real end-to-end tests."

---

## Recommended first-pass scope (assuming Option A)

If/when the user signs off on Option A:

1. **Harness skeleton** (0.5 d):
   - `bunHarness.ts` — spawn bun subprocess + ws server + teardown.
   - `pageHarness.ts` — chromium + bridge override + per-test
     workspace tempdir.
   - `fakeCopilotClient.ts` — minimal mock implementing
     `createSession` / `on` / `getMessages` / `send`.

2. **Flow tests** (0.5 d total, ~30 min each):
   - **F1 — Create + send:** create session in temp repo, send
     "hello", assert assistant message event arrives + renders.
   - **F2 — @-picker happy path:** focus composer, type `@READ`,
     ArrowDown, Enter, assert pill at right path. **(Would have
     caught v1 bug #1.)**
   - **F3 — @-picker path-nav:** type `@./src/`, assert results,
     pick. **(Would have caught v1 bug #2.)**
   - **F4 — Permission flow:** trigger a fake shell request,
     assert PendingRequestCard, click Approve, assert audit entry.
   - **F5 — Layout restore:** open 2 panels, kill bun, re-spawn,
     assert both restored.
   - **F6 — Settings round-trip:** flip dark mode, restart bun,
     assert dark.

3. **CI integration:**
   - New job `e2e-full` on `ubuntu-latest` only (Windows/macOS
     deferred per cost).
   - 5 min budget; fail PR on red.

---

## Open questions awaiting user input

1. **Option A vs B vs C?** A is the recommended minimal.
2. **Mock SDK vs real CLI for CI?** Mock is cheaper + deterministic.
3. **Where does this slot in the Phase ordering?** Sensible spot:
   between Phase 18 (Skills + MCP) and Phase 19 (Agents + Tasks),
   so the new flows have something meaningful to exercise.
4. **Native dialog stub strategy?** Two options:
   - (a) `DAFMAN_TEST_PICKER_PATH` env var — `Utils.openFileDialog`
     short-circuits to return that path when set.
   - (b) Don't stub at all; mark those tests `.skip`.
   Lean toward (a) so we get coverage of the `pickAttachment` →
   `addAttachment` → submit chain.

---

## Until this lands

Pre-commit checklist additions for **any UI/IPC-touching change**:

1. Run `bun run dev` once. Exercise the changed surface manually.
   (This alone would have caught the cwd bug.)
2. If touching Lexical / trigger / DOM-selection logic, also pop a
   real chromium DevTools open. (Would have caught the `@.` bug.)
3. Update MANUAL_TESTS.md with anything new; don't ship without it.

I'm adding these to AGENTS.md rule #4.

---

## Decision log

- **Plan filed but not implemented.** User asked "why don't we
  have these"; this doc answers + proposes. Implementation
  blocked on user approval (autonomous mode shouldn't burn a day+
  of unilateral infrastructure work).
- **Mocked SDK by default.** Determinism > realism for the first
  pass. Real CLI as opt-in tier later.
- **Local-only initially.** No `GH_TOKEN` secret in CI until real-
  CLI tier lands.

---

## 2026-05-27 additions (Groups v3 sprint)

### Probe tier — between smoke and full E2E

A new pattern emerged during the groups v3 sprint: targeted Playwright probes written as one-off Node scripts (`tools/probe-*.ts`) that drive a running `vite preview` instance via the same `window.__DAFMAN_TEST_RPC__` stub the smoke uses. Differs from smoke in three ways:

1. **Per-bug, not per-feature.** Smoke proves the bundle boots; a probe proves a *specific user-reported bug* is fixed.
2. **Drives the app via `window.__DAFMAN_TEST__`** (commands + addPanel + store-state dump). Lets the probe exercise state transitions without simulating keyboard / mouse.
3. **Throwaway by convention.** Each probe is committed alongside the fix and kept as a regression artifact; the next bug gets a new probe rather than extending the old one.

Reference: `tools/probe-groups-bugs.ts` (commit `17b2123` → `e0de0b8`). Caught 4 user-reported bugs in v3 that smoke + unit tests had passed clean.

**When to write a probe:**

- User reports a concrete behavior bug (e.g. "sessions go nowhere", "restart didn't load the data").
- The bug shape is hard to express as a fake-DockviewApi unit test.
- Smoke is too coarse — passes structurally but misses semantic issues.

**When NOT to write a probe:**

- The bug is a unit-testable invariant (use a unit test against `groupsStore` / `composePersistLayout` etc.).
- The bug is purely visual / responsive (use `bun run inspect` ad hoc instead).
- The full real-Electrobun E2E tier finally lands and covers the same path.

### Real-DockviewComponent test harness (mandatory for v3 surface)

Rubber-duck pre-implementation pass (2026-05-27) flagged: any test that exercises dockview state SHOULD mount a real `DockviewComponent` in a jsdom container instead of using `as unknown as DockviewApi` fakes. Pattern already established in `src/lib/__tests__/composePersistLayout.test.ts` — feeds helper outputs through `new DockviewComponent({...}).fromJSON(out)` and asserts no throw.

Currently the v3 stores (`groupsStore`, `useGroupsActions`) still use minimal fakes. They pass, but they pass the same way v1/v2's tests passed while the feature broke at runtime. **Action:** when the next v3-area regression surfaces, upgrade those tests to real-DockviewComponent fixtures.
