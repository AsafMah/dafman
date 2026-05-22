# Tech debt — outstanding findings from the 20c code review

Comprehensive deferred-fix list from the 2026-05-22 code-review sweep
(Phase 20c). Three `code-review` subagents covered: `src-bun/app/sessions.ts`
+ `src/lib/chatEvents.ts` family + `src/stores/sessionsStore.ts` /
`src/App.vue` / `src/components/SessionDetailsPanel.vue`.

Items marked **fixed in 20c** were addressed in `cf0970e` (20a) or
the 20c commit. Items marked **fixed in 21a / 21b** were addressed
in the Phase 21 burn-down. Everything else lives here as a tracked
backlog.

---

## Architectural — sessions.ts is 1451 lines

The biggest file in the codebase. Three natural seams identified:

### A1. Extract `PendingRequestQueue` (`high` payoff) — ✅ **fixed in 21a.1** (`650acfb`)
**Where**: `src-bun/app/sessions.ts:73-469` — `PendingEntry`,
`enqueuePending`, `cancelPending`, `settlePendingForSession`,
`respondToRequest`, `summarizePermission`, plus the three
`onXRequest` handlers. ~400 lines of self-contained subsystem.
**Target**: new `src-bun/app/pendingRequests.ts` exposing
`PendingRequestQueue`. `SessionRegistry` composes it and delegates.
**Win**: makes the queue independently testable; drops `sessions.ts`
to ~1050 lines.

### A2. Extract `McpRegistry` (`medium` payoff) — ✅ **fixed in 21a.2** (`83335c4`)
**Where**: `src-bun/app/sessions.ts:1291-1389` — 9 server-scoped MCP
methods (`listMcpConfigs`, `addMcpConfig`, etc.) that don't touch
session state. Already inconsistent: session-scoped
`setSessionMcpEnabled` lives in the file too.
**Target**: new `src-bun/app/mcpRegistry.ts` for server-scoped ops;
session-scoped `setSessionMcpEnabled` stays in `SessionRegistry`.
**Win**: clearer ownership; lets the future Library panel work
even when no session is open.

### A3. Extract `SkillsRegistry` (`medium` payoff) — ✅ **fixed in 21a.3** (`075bb09`)
**Where**: server-scoped `discoverSkills`/`setGloballyDisabledSkills`
(lines 1417-1451) + session-scoped `listSkills`/`setSkillEnabled`
(lines 1036-1087).
**Target**: `src-bun/app/skillsRegistry.ts` with `GlobalSkills` +
`SessionSkills` classes.

---

## Correctness / safety — defer to a dedicated audit

### S1. Missing `shutdown()` on SessionRegistry (`high`) — ✅ **fixed in 21b**
**Where**: `src-bun/app/sessions.ts` — no method to tear down every
session on app quit. Today each session's pending callbacks would
hang until process exit; the SDK never gets a clean disconnect.
**Fix**: `shutdownAll()` races each `session.disconnect()` against
a 2s `SHUTDOWN_TIMEOUT_MS` per session. Drains the pending queue
up front with `settleAll`. Wired from `SIGTERM` + `SIGINT` in
`src-bun/index.ts`.

### S2. Race in `create()` `earlyForward` (`high`) — ✅ **fixed in 21b**
**Where**: `src-bun/app/sessions.ts:478-495`. `resolvedSessionId`
starts null; if the SDK fires `session.start` before `createSession`
resolves and we set the id, `earlyForward` forwards events with
`"pending"` as the session id. The renderer drops them.
**Fix**: `earlyEventBuffer` collects events until `resolvedSessionId`
is set, then drains through `forward` under the real id.

### S3. Entry deletion before disconnect in `setWorkingDirectory` (`medium`) — ✅ **fixed in 21b**
**Where**: `src-bun/app/sessions.ts:605-608`. `entries.delete(sessionId)`
fires before the awaited `disconnect()`. SDK events during the
disconnect window (`session.end`) get lost because `forward()`
can't find the entry.
**Fix**: delete moved after `await disconnect` in all three teardown
paths (`disconnect`, `deleteCliSession`, `setWorkingDirectory`).

### S4. `unsubscribe()` ordering bug in disconnect paths (`medium`) — ✅ **fixed in 21a.1**
**Where**: `src-bun/app/sessions.ts:606, 670`. `entry.unsubscribe()`
fires before `settlePendingForSession`. If the SDK callback
triggers a new pending request during unsubscribe, it's never
settled.
**Fix**: `removeEntry` helper added in 21a.1 enforces
settle→unsubscribe→delete order; manual teardown paths in 21b also
follow this contract.

### S5. History replay floods renderer IPC (`medium`) — ✅ **fixed in 21b**
**Where**: `src-bun/app/sessions.ts:568` — `getMessages()` returns
the full transcript and replays synchronously through `forward()`.
For a session with thousands of events, blocks the event loop and
floods Electrobun's IPC queue.
**Fix**: cap at `HISTORY_REPLAY_CAP` (500) trailing events; replay
in `HISTORY_REPLAY_BATCH` (50)-sized chunks with `queueMicrotask`
yields between batches.

### S6. `respondToPending` event rollback **FIXED in 20c**
**Where**: `src/stores/sessionsStore.ts:respondToPending`. 20a fix
restored the pending entry on RPC failure but left the appended
`dafman.pending_response` event in `record.events`. 20c moved the
append into the success branch.

### S7. `setSessionWorkingDirectory` stale record **FIXED in 20c**
**Where**: `src/stores/sessionsStore.ts:setSessionWorkingDirectory`.
Captured `record` before await — could be detached by the time
the RPC resolves. 20c switches to "capture baseWd, re-lookup record
after await".

### S8. O(N²) upsert in chatEvents reducer **FIXED in 20c**
**Where**: `src/lib/chatEvents.ts:upsertAssistant/Reasoning/Tool`.
Was `items.find(...)` per event — streaming a 30-deltas/sec
response into a 200-item session = 6000 ops/sec. 20c adds
ephemeral `Map<id, index>` indices rebuilt per `processEvents`
call. O(1) lookup.

---

## Type safety — low-risk but worth tightening

### T1. Unsafe casts in `summarizePermission` + `forward` (`low`)
**Where**: `src-bun/app/sessions.ts:106, 715`. Cast to
`Record<string, unknown>` without checking it's actually an
object (could be null, array, primitive). Throws if the SDK
emits a malformed event.
**Fix**: guard cast with `value && typeof value === 'object' && !Array.isArray(value)`.

### T2. `dafman.pending_request` event payload cast (`low`)
**Where**: `src/stores/sessionsStore.ts:424`. Casts
`PendingRequestPayload as unknown as Record<string, unknown>` to
fit `SessionEventPayload.data`. Works at runtime but is a
wire-contract leak.
**Fix**: add an explicit `dafman.pending_request` case to the
`SessionEventPayload` discriminated union in `src/ipc/types.ts`.

### T3. Unused exported types from rpc.ts / ipc/types.ts (`low`)
Knip flagged 7 exported types as zero-callers across `src/`,
`src-bun/`, and `e2e/`: `PermissionApprovalRule`, `DafmanRPC`,
`LogLevel`, `LogRecord`, `AuditEntry`, `AppErrorPayload` (in rpc.ts);
`SessionHistoryCompactionResult`, `Appearance`, `ToolsPrefs`,
`Layout`, `Workspaces` (in ipc/types.ts). These are the public IPC
contract — most are probably consumed transitively via the
`CommandMap` `args`/`result` types. Audit individually; some can
be dropped, others should stay even when unused as documentation
of the wire shape.

---

## UX / perf nits

### U1. SessionDetailsPanel over-fetches on tab switch (`low`)
**Where**: `src/components/SessionDetailsPanel.vue:235-268`. Watch
on `sessionId` unconditionally reloads skills + usage + tools +
plan + quota every switch. Five IPC round-trips per click.
**Fix**: per-session cache keyed by sessionId; only load on miss.
Add a manual Refresh button.

### U2. Quota threshold toasts re-fire on tab switch (`low`)
**Where**: `src/components/SessionDetailsPanel.vue:464`. The
`warnedThresholds` Set is scoped to the component instance and is
cleared when `sessionId` changes (line 261). User at 91% sees the
toast every time they switch into the session.
**Fix**: move `warnedThresholds` to module scope (persists across
mounts) or key it by `${sessionId}:${type}:${threshold}` so the
same threshold doesn't re-fire.

### U3. `openSessionsByDefault` silent retry exhaustion (`low`)
**Where**: `src/App.vue:492-508`. Retries 20 times at 50ms intervals
if dockview's `@ready` never fires; logs nothing on exhaustion.
**Fix**: `console.warn` on exhaustion. The boot watchdog at 6s
already catches the case anyway, but the warn helps debugging.

### U4. SessionDetailsPanel cohesion (`medium`)
**Where**: `src/components/SessionDetailsPanel.vue` — 1100 lines for
8 distinct sections. Reviewer's note: cohesion is reasonable as-is
because all sections share the same sessionId + lifecycle, but if
this hits ~1500 lines or any section becomes reusable elsewhere,
extract.

### U5. `enqueuePending` silent cancel on emit failure (`low`)
**Where**: `src-bun/app/sessions.ts:310-334`. If `emit()` throws
during `enqueuePending`, the function calls `cancelPending` which
resolves the SDK's promise with a typed cancellation. Callers
expecting rejection-on-failure get silent success-as-cancellation.
**Fix**: reject the promise instead of resolving with cancellation
when the failure is on OUR side (emit threw, not user-not-available).

### U6. `cwdFor` async race (`low`)
**Where**: `src-bun/app/sessions.ts:836`. Two concurrent `cwdFor`
calls both call `getSessionMetadata` + both write to
`entry.workingDirectory`. Benign (same value) but wasteful.
**Fix**: check `entry.workingDirectory` after the await; skip if
filled.

### U7. `removePending` double scan (`low`)
**Where**: `src/lib/chatEvents/notificationHandlers.ts:87-94`. When
called without a `requestId`, scans `pendingRequests` AND `items`
arrays separately. Pending queue is small (<5) but the pattern is
asymmetric with the by-requestId path.
**Fix**: single-pass — find the requestId from the ambient queue
entry first, then remove by requestId from both.

### U8. Reverse+find array copy in messageHandlers (`low`)
**Where**: `src/lib/chatEvents/messageHandlers.ts:93-95`. Optimistic
user-message dedup does `[...ctx.items].reverse().find(...)`. Copies
the entire items array. Runs on every `user.message` including
history replay.
**Fix**: manual backwards `for` loop with early break.

---

## Test coverage gaps

### G1. 14 RPC handlers in production missing from test-server (`medium`)
**Where**: bun production has 57 handlers, test-server has 43.
Missing: `getSessionMode`, `setSessionMode`, `getSessionName`,
`setSessionName`, `setSessionWorkingDirectory`,
`compactSessionHistory`, `truncateSessionHistory`, `forkSession`,
`setSessionApproveAll`, `resetSessionApprovals`, `listSessionSkills`,
`setSessionSkillEnabled`, `getSessionUsageMetrics`, `openLogFolder`.
**Win**: E2E can drive every code path; bug regressions get caught.

### G2. No tests for the new compact-row item-expansion logic in SessionDetailsPanel (`low`)
**Where**: 18b shipped expand-on-click for tool / skill descriptions
in the rail. F20 only asserts visibility of `.compact-desc` after
click; no unit-level test for the in-memory `expandedItems` Set
behavior.

### G3. No tests for the new shutdown watchdog (`low`)
**Where**: `src/App.vue:97-115` — the 6s splash watchdog. Functional
but never asserted in a unit test. Would need a mocked bootStore +
fake timers.

---

## Dependency audit (2026-05-22)

### D1. **FIXED in 20c**: safe minor bumps applied
- `@happy-dom/global-registrator` 20.0 → 20.9
- `@vitejs/plugin-vue` 5.2.1 → 5.2.4
- `@vue/compiler-sfc` 3.5.13 → 3.5.34
- `concurrently` 9.1.0 → 9.2.1
- `dockview-vue` 6.3.0 → 6.4.0
- `typescript` 5.6.2 → 5.9.3
- `vite` 6.0.3 → 6.4.2
- `vue` 3.5.13 → 3.5.34
- `vue-tsc` 2.1.10 → 2.2.12

### D2. Deferred dep bumps
- **Lexical 0.38 → 0.44** (6 minors). High risk of breaking the
  editor; defer to a dedicated PR with manual smoke.
- **Katex 0.16 → 0.17**. One major bump; could break math rendering
  in MessageContent. Defer.

### D3. Dev-only suspicious deps (no action — flag for future)
- `@types/bun` is on `latest` — npm-check-updates errored trying
  to compare. Tracked: pin to a specific version.

---

## Ordering note

If you ever want to do an architectural refactor pass (rather than
the surgical sweep 20 was), the natural ordering would be:

1. **A1** — extract `PendingRequestQueue`. Highest payoff, lowest
   risk, makes the rest easier.
2. **S1** — add `shutdown()`. Tied to A1 since the queue needs to
   participate.
3. **S2** — fix `create()` race. Standalone.
4. **A2 + A3** — extract MCP and Skills registries together since
   they share patterns.
5. **G1** — bring test-server up to parity with production.

Anything else is opportunistic.
