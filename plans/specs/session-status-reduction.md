# Collapse Dual Session-State Reduction

**Status:** Draft — 2026-06-10

---

## Summary

Collapse the duplicated per-event session-status reduction by introducing a shared, pure status-delta reducer for event families that currently update both `SessionRecord` and `ChatAmbient`: title, model/reasoning, current agent, thinking/turn boundary state, and pending requests. `SessionRecord` remains the runtime source of truth for app-wide per-session state; `ChatAmbient` remains the mounted-chat projection for transcript-adjacent UI. The refactor should migrate one event family at a time, backed by table-driven convergence tests that prove both projections receive the same normalized deltas.

---

## Motivation

The owner-store guard already landed; this is not a lint-guard task. The audit confirms #157 is fixed: `sessionReducer.ts` is pure and returns `SessionEffect[]` consumed by `sessionEffects.ts` (`CODE_AUDIT.md:155`, `CODE_AUDIT.md:198`). The same audit notes #151 landed as the owner-write lint guard (`CODE_AUDIT.md:7`, `CODE_AUDIT.md:200`). The remaining problem is architectural duplication: the same SDK events are reduced once into `SessionRecord` for global surfaces and again into `ChatAmbient` for a mounted `ChatWindow`.

The architecture says `SessionRecord` is the runtime source of truth for per-session state (`ARCHITECTURE.md:260-261`), while `processEvents` reduces `SessionEventPayload[]` into chat items and ambient state (`ARCHITECTURE.md:320-324`). Today both layers carry mirror fields and separate handlers. That creates drift risk whenever a new SDK event changes session status.

---

## Current state

### Record-side reduction

- `SessionRecord` owns model, reasoning effort, run mode, title, pending requests, unseen turns, thinking state, turn-boundary trust, and current agent (`src/stores/chat/sessionsStore.ts:54-139`).
- `PendingRecordRequest` is explicitly documented as a per-record mirror of `PendingRequest` in `chatEvents.ts` (`src/stores/chat/sessionsStore.ts:180-184`).
- `sessionReducer.ts` returns `SessionEffect[]` instead of touching toast/notification stores directly (`src/stores/chat/sessionReducer.ts:8-16`).
- Record handlers update model, mode, title, current agent, tasks refresh, plan refresh, OAuth toasts, cwd, thinking, and pending completion through a dispatch table (`src/stores/chat/sessionReducer.ts:369-416`).
- `applyToRecord` always appends the raw event, tracks artifacts, dispatches the event handler, and returns effects (`src/stores/chat/sessionReducer.ts:426-444`).
- `applyPendingToRecord` builds a pending request entry, appends it to `record.pendingRequests`, pushes a synthetic `dafman.pending_request` event for the chat reducer, and returns a waiting-for-input notification effect (`src/stores/chat/sessionReducer.ts:452-545`).

### Ambient-side reduction

- `ChatAmbient` carries title, model, reasoning effort, model-change toast de-dupe, intent, usage, turn-active state, turn-boundary trust, pending requests, and current agent (`src/lib/chatEvents.ts:220-275`).
- `PendingRequest` repeats the same discriminated union shape as `PendingRecordRequest` (`src/lib/chatEvents.ts:238-257`).
- `processEvents` copies the ambient object, builds reducer contexts, dispatches event-family handlers, and returns `{ items, ambient, toasts, idle, error }` (`src/lib/chatEvents.ts:590-624`).
- `sessionMetaHandlers` owns `session.title_changed`, `session.model_change`, `session.usage_info`, `assistant.usage`, `subagent.selected`, and `subagent.deselected` for ambient state (`src/lib/chatEvents/sessionMetaHandlers.ts:21-110`).
- `turnHandlers` owns `assistant.turn_start`, `assistant.turn_end`, and `assistant.intent` for ambient state (`src/lib/chatEvents/turnHandlers.ts:13-29`).
- `notificationHandlers` documents two parallel pending-request queues: `ctx.items[]` and `ctx.ambient.pendingRequests[]` (`src/lib/chatEvents/notificationHandlers.ts:1-17`). It builds pending entries on `dafman.pending_request` and removes them on `dafman.pending_response` / SDK completion (`src/lib/chatEvents/notificationHandlers.ts:108-263`).

### ChatWindow consumption

- `ChatWindow.vue` now states header controls live elsewhere and the component is “just transcript + composer” (`src/components/chat/ChatWindow.vue:49-52`).
- It delegates event replay to `useChatTimelineState` (`src/components/chat/ChatWindow.vue:113-120`) and sends via `useChatSubmit` (`src/components/chat/ChatWindow.vue:294-307`).
- This means mounted chat windows can consume a shared status projection without becoming the global owner.

---

## Design

### New shared status layer

Add a small shared reducer module under `src/lib/sessionStatus/` (or a single `src/lib/sessionStatus.ts` if the implementation stays compact). It should have no Pinia, Vue, or DOM dependency.

Core concepts:

1. `SessionPendingRequest` — one shared discriminated union replacing both `PendingRecordRequest` and `PendingRequest`.
2. `SessionStatusDelta` — normalized changes emitted from one event or pending push.
3. `reduceSessionStatusEvent(payload, options)` — pure event → deltas.
4. `reducePendingRequestPayload(payload)` — pure pending-channel push → pending-add delta plus the synthetic event data the record still appends.
5. `applyStatusDeltaToRecord(record, delta, ctx)` — record projection and effects.
6. `applyStatusDeltaToAmbient(ambient, delta, ctx)` — mounted-chat projection and chat toasts.

The reducer should produce normalized deltas, not mutate either target. Target-specific appliers remain thin because `SessionRecord` and `ChatAmbient` legitimately differ.

### Shared vs target-only state

| State / event family                                                                                                                                         | Shared delta? | Record projection                                                                               | Ambient projection                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------: | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `session.title_changed`                                                                                                                                      |           Yes | `record.title`                                                                                  | `ambient.title`                                                                                                  |
| `session.model_change`                                                                                                                                       |           Yes | `record.model`, `record.reasoningEffort`                                                        | `ambient.model`, `ambient.reasoningEffort`, model-change toast de-dupe                                           |
| `subagent.selected` / `.deselected`                                                                                                                          |           Yes | `record.currentAgent`                                                                           | `ambient.currentAgent`                                                                                           |
| `assistant.turn_start` / `assistant.turn_end`                                                                                                                |           Yes | `record.isThinking`, `record.sawTurnBoundary`, unseen/notify effects on live off-panel turn end | `ambient.turnActive`, `ambient.sawTurnBoundary`, `intent` cleared                                                |
| `session.idle`, `session.error`, `abort`, `session.task_complete`, `dafman.resume_settled`                                                                   |           Yes | clear `record.isThinking`                                                                       | `idle` / `error` flags remain chat-specific; ambient can clear turn state where applicable                       |
| `dafman.pending_request`                                                                                                                                     |           Yes | shared pending entry in `record.pendingRequests`                                                | same shared entry in `ambient.pendingRequests` plus a `pendingRequest` chat item                                 |
| `dafman.pending_response`, `permission.completed`, `user_input.completed`, `elicitation.completed`, `exit_plan_mode.completed`, `auto_mode_switch.completed` |           Yes | remove matching pending entry                                                                   | remove matching ambient entry and chat item                                                                      |
| `session.mode_changed`                                                                                                                                       |     Partially | `record.mode`; autopilot clears pending and appends response events                             | no direct ambient field today; clearing arrives through synthetic pending-response events for no-behavior-change |
| `session.start`, `session.resume`                                                                                                                            |            No | `record.workingDirectory`                                                                       | no ambient field                                                                                                 |
| `subagent.started/completed/failed`, `session.background_tasks_changed`, `session.plan_changed`                                                              |            No | refresh counters                                                                                | visual subagent lifecycle remains in `processEvents`                                                             |
| `session.usage_info`, `assistant.usage`, `assistant.intent`                                                                                                  |            No | no record field today                                                                           | ambient-only usage / intent                                                                                      |
| tool/message/reasoning/callout visual events                                                                                                                 |            No | artifact tracking only                                                                          | chat items only                                                                                                  |
| OAuth / MCP status toasts                                                                                                                                    |            No | record-side effects and de-dupe sets                                                            | no ambient state                                                                                                 |

### Pending request unification

Start with pending request shape because it is already byte-identical and heavily tested.

- Replace `PendingRecordRequest` and `PendingRequest` with a shared `SessionPendingRequest` export.
- Add `pendingRequestEntryFromPayload(payload)` to produce `{ kind, requestId, message, request }` exactly once.
- `applyPendingToRecord` uses that helper and keeps its current idempotency, synthetic event append, and notification effect (`src/stores/chat/sessionReducer.ts:452-545`).
- `notificationHandlers['dafman.pending_request']` uses the same helper and keeps the chat-item creation local (`src/lib/chatEvents/notificationHandlers.ts:108-214`).
- Removal semantics must remain stable: requestId removal wins; SDK `*.completed` removes the oldest matching kind because those events do not carry the Bun-generated request id (`src/lib/chatEvents/notificationHandlers.ts:81-105`, `src/stores/chat/sessionReducer.ts:356-367`).

### Model/title/current-agent unification

Move the parsing logic for `session.title_changed`, `session.model_change`, and session-level `subagent.selected` / `.deselected` into the shared reducer.

- Preserve transient sub-agent disambiguation: `subagent.selected` with a non-empty `parentToolCallId` must not change `currentAgent` (`src/lib/chatEvents/sessionMetaHandlers.ts:76-96`, `src/stores/chat/sessionReducer.ts:165-188`).
- Preserve chat-only model-change toast policy: replay and initial setup suppress toasts (`src/lib/chatEvents/sessionMetaHandlers.ts:1-8`, `src/lib/chatEvents/sessionMetaHandlers.ts:36-58`). The shared delta can carry `previousModel`, `newModel`, and effort fields; the ambient applier owns whether to toast.

### Thinking-state unification

Move shared parsing for turn boundaries and terminal events into status deltas.

- `assistant.turn_start` sets active/thinking and trust flags.
- `assistant.turn_end` clears active/thinking and clears intent. Record applier still owns `unseenTurns` and OS notification effects because those depend on active dock panel and replay (`src/stores/chat/sessionReducer.ts:318-348`).
- `session.idle`, `session.error`, `abort`, `session.task_complete`, and `dafman.resume_settled` clear record thinking without emitting turn-end side effects (`src/stores/chat/sessionReducer.ts:399-416`).
- `assistant.intent` remains ambient-only.

### Convergence test

Add a table-driven convergence test that feeds the same event sequence into:

1. a minimal `SessionRecord` through record appliers, and
2. `defaultAmbient()` through ambient appliers / `processEvents`.

Then compare a normalized projection:

- `title`
- `model`
- `reasoningEffort`
- `currentAgent`
- `pendingRequests` (kind, requestId, message)
- `isThinking` ↔ `turnActive`
- `sawTurnBoundary`

Representative rows:

- title changed with non-empty title.
- model change with reasoning effort and previous model.
- subagent selected, transient subagent selected with `parentToolCallId`, then deselected.
- turn start → turn end; turn start → idle; turn start → abort.
- pending permission push → pending response by requestId.
- pending user-input push → unrelated permission completed no-op → user-input completed clears.
- duplicate pending request id is idempotent.
- replayed turn end clears thinking but does not increment `unseenTurns` or notify.

Keep existing store and chat tests; the convergence test proves the new shared layer is actually shared.

---

## Open Questions

1. **Should `session.mode_changed` clear ambient pending directly?**
   - Option A: no, keep current behavior; record appends `dafman.pending_response` events when autopilot clears pending, and mounted chat sees those.
   - Option B: shared delta clears pending in both projections from the original `session.mode_changed` event.
   - **Recommended default:** Option A for the first pass. It preserves event-log semantics and avoids a subtle double-clear path.

2. **Where should model-change toast de-dupe live?**
   - Option A: keep `lastModelChangeToastKey` ambient-only.
   - Option B: move toast de-dupe into shared status state.
   - **Recommended default:** Option A. The toast is a mounted transcript concern, not a global `SessionRecord` invariant.

3. **Should `usage` become record-level state?**
   - **Recommended default:** no. Usage is currently ambient-only (`src/lib/chatEvents.ts:226-229`) and there is no cross-pane consumer cited by the audit. Keep this refactor scoped to mirrored fields.

4. **Should record and ambient share one applier?**
   - **Recommended default:** no. Share parsing and delta production; keep target appliers separate because record effects (`unseenTurns`, notifications, bounded event log) and ambient effects (chat items, toasts, idle/error flags) differ.

---

## Alternatives

### Alternative A — shared normalized status delta layer

**Pros**

- Removes duplicated event parsing without forcing `SessionRecord` and `ChatAmbient` into one data structure.
- Lets record-side and ambient-side effects stay in their proper owners.
- Supports incremental event-family migration.
- Table-driven convergence tests become straightforward.

**Cons**

- Introduces one more abstraction in an already event-heavy path.
- Requires discipline to keep visual chat-item events out of the status reducer.

### Alternative B — make `ChatAmbient` derive directly from `SessionRecord`

**Pros**

- Fewer fields duplicated at runtime.
- Simple mental model for header/title/model/current-agent.

**Cons**

- Breaks replay isolation: `ChatWindow` reduces only the mounted event window, while `SessionRecord` owns a bounded event buffer and global status.
- Does not naturally handle chat-only state like `intent`, `usage`, model-change toast de-dupe, idle/error flags, or inline pending cards.
- Couples transcript rendering to Pinia more tightly.

### Alternative C — keep duplication and rely on tests

**Pros**

- Lowest code churn.
- Existing tests already cover many individual cases (`src/stores/chat/__tests__/sessionsStore.restore.test.ts:214-330`, `src/lib/chatEvents/__tests__/notificationHandlers.test.ts:39-163`).

**Cons**

- Does not address the audit issue.
- Every new SDK event still requires two reducers to be updated manually.
- Tests prove specific symptoms, not a single parsing source.

**Decision:** choose Alternative A, phased conservatively.

---

## Implementation phases

1. **Unify pending-request type and builder.**
   - Add shared `SessionPendingRequest` and `pendingRequestEntryFromPayload`.
   - Replace `PendingRecordRequest` and `PendingRequest` aliases.
   - Keep record and chat handlers in place but make both call the shared builder.
   - Add duplicate/idempotency tests around the helper.

2. **Introduce status deltas for title/model/current-agent.**
   - Add `reduceSessionStatusEvent` for `session.title_changed`, `session.model_change`, `subagent.selected`, and `subagent.deselected`.
   - Update `sessionReducer.ts` and `sessionMetaHandlers.ts` to consume those deltas.
   - Add the first convergence table for these events.

3. **Migrate thinking and turn-boundary status.**
   - Add deltas for turn start/end and terminal clearing events.
   - Keep record-only unseen/notify logic in the record applier.
   - Keep ambient-only `assistant.intent` in `turnHandlers`.
   - Extend convergence tests with turn sequences and replay behavior.

4. **Migrate pending add/remove events.**
   - Make `dafman.pending_request`, `dafman.pending_response`, and SDK completion events emit shared pending deltas.
   - Keep chat-item creation/removal local to notification handlers, but source queue mutation from the shared delta.
   - Extend convergence tests for mismatched completion kind, duplicate ids, and requestId removal.

5. **Fold record-only mode interactions carefully.**
   - Keep `session.mode_changed` record-owned initially.
   - If the first four phases are stable, optionally emit a record-only `modeChanged` delta from the shared reducer for parsing consistency.
   - Do not make ambient own `mode` unless a mounted UI actually needs it.

6. **Delete mirror comments and enforce ownership in tests.**
   - Remove comments saying record and ambient “mirror” each other where shared deltas now own parsing.
   - Keep split-invariant tests for chat event family ownership (`src/lib/chatEvents/__tests__/split.test.ts:172-210`).
   - Add regression rows whenever a future SDK event mutates shared status.

---

## References

- `CODE_AUDIT.md:155`, `CODE_AUDIT.md:198`, `CODE_AUDIT.md:200` — #157 and #151 current state.
- `ARCHITECTURE.md:320-339` — chat event reducer families.
- `src/stores/chat/sessionsStore.ts:54-139` — `SessionRecord` mirrored status fields.
- `src/stores/chat/sessionsStore.ts:180-184` — `PendingRecordRequest` mirror comment.
- `src/stores/chat/sessionReducer.ts:8-16`, `src/stores/chat/sessionReducer.ts:369-444`, `src/stores/chat/sessionReducer.ts:452-545` — pure reducer, dispatch, pending push.
- `src/lib/chatEvents.ts:220-275`, `src/lib/chatEvents.ts:590-624` — `ChatAmbient` and `processEvents`.
- `src/lib/chatEvents/sessionMetaHandlers.ts:21-110`, `src/lib/chatEvents/turnHandlers.ts:13-29`, `src/lib/chatEvents/notificationHandlers.ts:1-17` — duplicated event-family status reduction.
- `src/stores/chat/__tests__/sessionsStore.restore.test.ts:214-330`, `src/lib/chatEvents/__tests__/notificationHandlers.test.ts:39-163` — current behavior coverage to preserve.

---

## Recommended first PR

Extract only the shared pending-request union and builder, then update both `applyPendingToRecord` and `notificationHandlers['dafman.pending_request']` to call it. This deletes the byte-identical `PendingRecordRequest` / `PendingRequest` duplication first, has clear tests, and does not yet alter event dispatch or thinking/model/title semantics.
