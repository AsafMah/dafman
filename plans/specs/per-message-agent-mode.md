# Per-Message Agent Mode — Composer Mode Picker

**Status:** Draft  
**Date:** 2026-06-06

---

## Summary

Let users select an agent mode (interactive / plan / autopilot) per individual message from the composer instead of only per session. The SDK already supports a per-message `agentMode` field on `session.send()`; the backend (`sessions.ts`) already accepts and forwards it with one-shot semantics; the gap is entirely in the IPC wire and the renderer pipeline. The UI adds a lightweight "next-message mode" override that sits alongside — not replacing — the existing session-level `ModeButtonGroup`.

---

## Motivation

Today the agent mode (interactive / plan / autopilot) is a session-wide setting mutated by `ModeButtonGroup` → `sessionsStore.setSessionMode` → `rpc.setSessionMode`. Switching mode for a single message requires: (1) change the session toggle, (2) send, (3) change it back. This is friction for common patterns like "just plan this one thing" while keeping the default interactive session.

The SDK already accepts `agentMode` per-send (`session.send({ agentMode })`). The backend already resolves it correctly (one-shot semantics proven by `sessions.test.ts:397–401`). Only the IPC wire and renderer are missing.

---

## Current State

### SDK capability

`node_modules/@github/copilot-sdk/dist/types.d.ts:1644`:
```ts
agentMode?: "interactive" | "plan" | "autopilot" | "shell";
```

`node_modules/@github/copilot-sdk/dist/session.js:98-100` (ESM), `cjs/session.js:121-123` (CJS) — both forward `options.agentMode` verbatim on every `session.send()` call.

`node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:881-889`:
```ts
export type SendAgentMode =
  "interactive" | "plan" | "autopilot" | "shell";
```

The `"shell"` value is present in the SDK but absent from dafman's `SessionMode` union (`src-bun/rpc.ts:21`). See Open Question 1.

### Backend (already implemented)

`src-bun/app/chat/sessions.ts:847-852` — `SessionRegistry.send()` already accepts an optional 5th parameter:
```ts
async send(
  sessionId: string,
  text: string,
  mode?: 'enqueue' | 'immediate',
  attachments?: SendMessageAttachment[],
  agentMode?: SessionMode,          // ← already there
): Promise<string>
```

`src-bun/app/chat/sessions.ts:906`:
```ts
const effectiveAgentMode = agentMode ?? this.modeBySession.get(sessionId) ?? 'interactive';
```

The override is **one-shot**: passing an explicit `agentMode` scopes it to that send; `this.modeBySession` (the session-wide store) is not mutated. `sessions.test.ts:397–401` asserts this:
```ts
await reg.send(id, 'plan this', undefined, undefined, 'plan');
expect(fake.lastSentAgentMode).toBe('plan');
expect(fake.currentMode).toBe('interactive'); // session unchanged
```

### IPC wire gap

`src-bun/rpc.ts:684-699` — `sendMessage` params:
```ts
sendMessage: {
  params: {
    sessionId: string;
    text: string;
    mode?: 'enqueue' | 'immediate';   // send-mode (steer/queue)
    attachments?: SendMessageAttachment[];
    // agentMode NOT present
  };
```

`src-bun/index.ts:232-233`:
```ts
sendMessage: rpcGuard(async ({ sessionId, text, mode, attachments }) =>
  sessions.send(sessionId, text, mode, attachments),  // agentMode never forwarded
),
```

### Renderer gap

`src/stores/chat/sessionsStore.ts:681-724` — `sendMessage()` signature does not accept `agentMode`.

`src/composables/useChatSubmit.ts:35-40` — `ChatSubmitTransport.sendMessage` interface does not accept `agentMode`.

`src/lexical/plugins.ts:150-154`:
```ts
export interface ComposerSubmitPayload {
  text: string;
  mode: ComposerSubmitMode;   // send-mode: default | steer | queue | interrupt
  attachments?: SendMessageAttachment[];
  // agentMode NOT present
}
```

### Existing session-level UI

`src/components/chat/ModeButtonGroup.vue` — 3-icon `SelectButton` (Interactive / Plan / Autopilot) mounted in the composer toolbar. It always writes to `SessionRecord.mode` via `setSessionMode`. Mutating it changes the session permanently. The per-message feature must **not** change this component's mutation behaviour.

`src/lib/sessionModeOptions.ts:14-18` — `MODE_OPTIONS` list shared by ModeButtonGroup, SessionDetailsPanel, and command palette.

### Send-mode chip (different concept — #177)

`src/components/chat/MessageComposer.vue:496-531` — the Steer / Queue chip is a **delivery** mode (how the message is enqueued to the SDK). This is orthogonal to agent mode (how the agent behaves). The send-mode chip is already styled as a small ambient indicator in the send area. Agent-mode UI must be visually distinct and labelled differently to avoid confusion.

---

## Design

### 1. Naming clarity

| Concept | Type | Where | Controls |
|---|---|---|---|
| **Agent mode** | `"interactive" \| "plan" \| "autopilot"` | per-session (persistent) or per-message (one-shot) | how the agent behaves: asks for approval, plans only, runs unattended |
| **Send mode** | `"steer" \| "queue" \| "interrupt"` | per-message (always transient) | how the message is delivered: inject into current turn, enqueue, or abort-then-send |

These must not be merged into a single control. The existing Steer/Queue chip covers send-mode; this feature adds a separate, optional agent-mode override per message.

### 2. One-shot semantics (backend already correct)

The per-message override is **one-shot**: it applies only to the send it is attached to; the session's `mode` field is not touched. After submit, the override resets to "follow session default". This matches the behaviour already implemented and tested in `sessions.ts:906` and `sessions.test.ts:397–401`. No change to backend semantics needed.

### 3. Wire extension

Three files:

**`src-bun/rpc.ts`** — add optional `agentMode` to `sendMessage.params`:
```ts
sendMessage: {
  params: {
    sessionId: string;
    text: string;
    mode?: 'enqueue' | 'immediate';
    agentMode?: SessionMode;           // ← add
    attachments?: SendMessageAttachment[];
  };
```

**`src-bun/index.ts`** — destructure and forward:
```ts
sendMessage: rpcGuard(async ({ sessionId, text, mode, agentMode, attachments }) =>
  sessions.send(sessionId, text, mode, attachments, agentMode),
),
```

**`src-bun/__tests__/wire-contract.test.ts`** — add a snapshot for `sendMessage` with explicit `agentMode`. The existing snapshots for default and steer/queue modes stay unchanged.

### 4. Renderer pipeline extension

In order from innermost to outermost:

**`src/lexical/plugins.ts`** — extend `ComposerSubmitPayload`:
```ts
export interface ComposerSubmitPayload {
  text: string;
  mode: ComposerSubmitMode;
  agentMode?: SessionMode;         // ← add; undefined = follow session default
  attachments?: SendMessageAttachment[];
}
```

**`src/composables/useChatSubmit.ts`** — extend `ChatSubmitTransport`:
```ts
sendMessage(
  sessionId: string,
  text: string,
  mode: SendMode,
  attachments?: SendMessageAttachment[],
  agentMode?: SessionMode,          // ← add
): Promise<void>;
```
And forward `payload.agentMode` through the `sendMessage` call.

**`src/stores/chat/sessionsStore.ts`** — extend `sendMessage()`:
```ts
async function sendMessage(
  sessionId: string,
  text: string,
  mode: SendMode = 'steer',
  attachments?: ...,
  agentMode?: SessionMode,          // ← add
): Promise<void>
```
Forward to `invokeCommand('sendMessage', { ..., agentMode })`.

**`src/components/chat/ChatWindow.vue`** — update the transport closure:
```ts
transport: {
  sendMessage: (sessionId, text, mode, attachments, agentMode) =>
    sessionsStore.sendMessage(sessionId, text, mode, attachments, agentMode),
},
```

### 5. Composer UI — per-message mode picker

The per-message override needs a lightweight UI that:
- Does not clutter the composer when the user doesn't want it.
- Is clearly distinct from the session-level `ModeButtonGroup` (which already sits in the toolbar).
- Does not look like the send-mode chip (Steer/Queue).

**Recommended approach: "next-message badge" on the existing ModeButtonGroup**

Rather than adding a new, separate control, extend `ModeButtonGroup` to emit an optional **per-message mode** that does NOT call `setSessionMode`. The toggle gains a secondary state:

- **Single-click (current behaviour)**: sets session mode (sticky). `ModeButtonGroup` shows the selected option as active.
- A new "one-shot" affordance: long-press OR a small `⋯` / override button on the group surfaces a menu:
  - "Set as session default" (equivalent to current click)
  - "Send next message as [mode]" (sets a local reactive ref `nextMessageMode` in the composer, cleared after submit)

When `nextMessageMode` is set, the ModeButtonGroup shows a small badge/dot indicator, and the composer send button tooltip reflects the override ("Send in Plan mode").

This avoids adding a second mode-picker widget while surfacing the override cleanly. See Alternatives for other placement options.

**Data flow:**
```
ModeButtonGroup [one-shot trigger]
  → sets composerNextMessageMode (local state in ChatWindow or composer-level composable)
  → ComposerSubmitPayload.agentMode = composerNextMessageMode
  → cleared on successful submit or on composer reset
```

A new composable `useComposerAgentMode(sessionId)` owns:
- `nextMessageMode: Ref<SessionMode | null>` — the one-shot override
- `setNextMessageMode(mode: SessionMode | null)` — set/clear
- `resolveForSubmit()` — returns current value and resets to `null`

`ChatWindow` passes `resolveForSubmit` into `submitMessage`, which injects the result into the payload.

### 6. Issue #40 interaction — plan-mode exit and auto-mode-switch

`onExitPlanModeRequest` and `onAutoModeSwitchRequest` are session-level hooks (not per-message). They fire when the SDK wants to exit plan mode (awaiting user approval) or when the SDK automatically switches mode (rate-limit recovery, etc.).

- **`onExitPlanModeRequest`**: already in `sessionConfigBuilder.ts` (routed to pending queue). #40 asks to surface this via the existing `pendingRequests` modal instead of silent acceptance. This is independent of the per-message feature but interacts with it: if the user has a `nextMessageMode = 'plan'` override queued and the SDK then fires `onExitPlanModeRequest`, the pending modal should fire before the override is consumed. No special handling needed — the events are sequential.
- **`onAutoModeSwitchRequest`**: when the SDK changes mode automatically (e.g. rate-limit drops to interactive), the `SessionRecord.mode` should update, AND `nextMessageMode` (if set to the now-invalid mode) should be cleared or flagged. The auto-switch handler in `sessionConfigBuilder.ts` should emit a `setMode` event that, in the renderer, also clears any pending `nextMessageMode` matching the old value.

### 7. Keyboard shortcut

Issue #41 asks about `Ctrl+Shift+P` for "plan-mode send". This is a direct send: compose text + set `agentMode: 'plan'` + trigger submit — all in one key chord, without interacting with the one-shot picker UI. 

Implementation: register a keydown handler in the composer (`useComposerKeyboardShortcuts` or inline in `MessageComposer.vue`) that calls `triggerSubmit('default')` after setting `nextMessageMode = 'plan'`, then immediately clears it. The chord fires the currently-drafted message in plan mode once.

Cross-reference `plans/specs/keyboard-shortcuts.md` — the shortcut should be registered in the global shortcuts registry to remain discoverable in the palette.

---

## Open Questions

1. **`"shell"` agentMode**: The SDK's `SendAgentMode` includes `"shell"` (`rpc.d.ts:888`) which is absent from dafman's `SessionMode` union (`rpc.ts:21`). Should dafman expose it? It appears to be a "shell-focused UI mode" for the CLI TUI's terminal pane, which may be meaningless in dafman's context. **Recommended default**: exclude `"shell"` from the per-message picker for now; add only if a use case is identified. If excluded, the `agentMode` type in `rpc.ts:sendMessage.params` should remain `SessionMode` (not `SendAgentMode`) to avoid carrying a value dafman can't display.

2. **One-shot vs sticky**: Backend semantics are already one-shot (session mode unchanged). Should the composer UI also be one-shot (auto-clears after submit) or sticky (user must manually clear the override badge)?  
   **Recommended default**: one-shot — clears after submit. Users who want sticky can use the existing `ModeButtonGroup` session-level toggle. Sticky per-message override has no clear advantage over simply changing the session mode.

3. **UI placement**: Three options detailed in Alternatives below. Decision needed: badge on existing `ModeButtonGroup`, a standalone chip, or a `⋯` hidden menu. **Recommended default**: badge/affordance on existing `ModeButtonGroup` (avoids new chrome, reuses existing component). But the exact interaction model (long-press vs right-click vs secondary button) is UI-implementation specific and needs a prototype or designer input.

4. **Default visibility**: Should the one-shot affordance be always visible (e.g. a small "one-shot" secondary button appears next to the `ModeButtonGroup`) or hidden behind `⋯`? Issue #41 asks this directly. **Recommended default**: always visible but low-prominence (a small `↺` or `1` indicator on the active mode button when an override is pending; the affordance to set it is a secondary click/hover action on the group). Zero visual cost when not in use.

5. **`nextMessageMode` ownership**: Should the per-message mode state live in a local composable scoped to `ChatWindow`, or in `sessionsStore` (so it persists across layout reloads and is visible to other surfaces)? **Recommended default**: local composable scoped to `ChatWindow` — it's ephemeral UI state, not session data. If it ever needs to survive a layout remount, promote it to the store.

6. **Keyboard shortcut conflicts**: `Ctrl+Shift+P` is used by VS Code for the command palette and may conflict with dafman's own palette shortcut. Check `plans/specs/keyboard-shortcuts.md` for the registered chord map before committing this binding. **Recommended default**: defer the exact chord; make the chord configurable via the keyboard shortcuts system (issue #31).

7. **`onAutoModeSwitchRequest` + pending `nextMessageMode`**: If the SDK fires `onAutoModeSwitchRequest` while `nextMessageMode` is set, should dafman silently clear the override or warn the user? **Recommended default**: clear silently and show a toast: "Agent mode changed by SDK — per-message override cancelled."

---

## Alternatives / Options

### UI placement

| Option | Description | Tradeoffs | Recommendation |
|---|---|---|---|
| A — Badge on existing `ModeButtonGroup` | Extend `ModeButtonGroup` with a one-shot trigger (long-press, right-click, or secondary button). The group badge shows a dot when override is set. | Reuses existing component; no new chrome; requires interaction design for "two actions on one control" | **Recommended** |
| B — Standalone chip next to send-mode chip | A second `agent-mode-chip` in the send area, styled like the Steer/Queue chip. Always shows the override if set; shows "Session" or blank when following default. | Simpler implementation; adds visual chrome to already-busy send row; risks confusion with send-mode chip | Use if Option A proves too complex to design cleanly |
| C — Hidden behind `⋯` overflow menu | A `⋯` button in the toolbar reveals a popover with both send-mode and agent-mode overrides for the next message. | Zero clutter; per issue #41's suggestion; lowest discoverability; doesn't support the keyboard shortcut directly | Use if discoverability is not a priority and toolbar space is tight |

### Sticky vs one-shot semantics

| Option | Description | Tradeoffs |
|---|---|---|
| One-shot (recommended) | Override clears after each submit | Matches backend implementation; no double-state confusion with session toggle |
| Sticky until cleared | Override persists until user explicitly clears it | Easier for a "do everything in plan mode for a while" workflow; but redundant with the session-mode toggle; harder to reason about |

### setSessionMode-then-send vs native per-message agentMode

| Option | Description | Tradeoffs |
|---|---|---|
| Native `agentMode` on send (recommended) | Pass `agentMode` in `sendMessage` payload; backend already handles it | Session mode unchanged; one-shot; clean; already tested |
| setSessionMode-then-send | Call `setSessionMode` before send, then revert | Causes two extra RPC calls; risks race conditions; no atomic "revert"; incorrect if send fails; **do not use** |

---

## Implementation Phases

### Phase 1 — Wire gap (no UI; unblocks everything else)

1. `src-bun/rpc.ts`: add `agentMode?: SessionMode` to `sendMessage.params` (line ~694).
2. `src-bun/index.ts`: destructure and forward `agentMode` into `sessions.send()` (line ~232).
3. `src-bun/__tests__/wire-contract.test.ts`: add snapshot for `sendMessage` with explicit `agentMode: 'plan'`.
4. `src/stores/chat/sessionsStore.ts`: add `agentMode?: SessionMode` param to `sendMessage()`; forward in `invokeCommand` call.
5. `src/lexical/plugins.ts`: add `agentMode?: SessionMode` to `ComposerSubmitPayload`.
6. `src/composables/useChatSubmit.ts`: extend `ChatSubmitTransport.sendMessage` and forward through the call chain.
7. `src/components/chat/ChatWindow.vue`: forward `agentMode` through the transport closure.

Acceptance: existing `sessions.test.ts:385-408` (test `#35`) passes unchanged; `wire-contract.test.ts` snapshots updated.

### Phase 2 — Keyboard shortcut (Ctrl+Shift+P one-shot plan send)

8. Add keydown handler in `MessageComposer.vue` (or `useComposerKeyboardShortcuts` if it exists): `Ctrl+Shift+P` → set `nextMessageMode = 'plan'` → `triggerSubmit('default')`.
9. Register the shortcut in the keyboard-shortcuts registry (cross-ref `plans/specs/keyboard-shortcuts.md` for exact chord — verify no conflict).
10. Test: submit with keyboard shortcut sends `agentMode: 'plan'` without changing `SessionRecord.mode`.

Acceptance: keyboard shortcut fires a plan-mode send; session mode not mutated; chord registered in palette.

### Phase 3 — Composer UI (one-shot mode picker)

11. Create `src/composables/useComposerAgentMode.ts` — owns `nextMessageMode` ref, `setNextMessageMode`, `resolveForSubmit`.
12. Resolve Open Question 3 (UI placement) before implementation. Implement the chosen option in `ModeButtonGroup.vue` or as a new chip component.
13. Wire `resolveForSubmit()` into `ChatWindow.submitMessage` → injects into `ComposerSubmitPayload.agentMode`.
14. Add visual indicator (badge/chip) that reflects pending override.
15. Clear `nextMessageMode` on successful submit.

Acceptance: user can set a per-message mode via UI; submit sends correct `agentMode`; session mode unchanged post-submit; indicator visible while override is pending; clears after send.

### Phase 4 — Issue #40 integration

16. `onExitPlanModeRequest`: surface via `pendingRequests` modal (per #40 acceptance). No changes needed to per-message-mode pipeline.
17. `onAutoModeSwitchRequest`: in the handler, after updating `SessionRecord.mode`, also clear any `nextMessageMode` that is no longer valid; emit toast.

---

## References

- `issue://41` — source issue (UX side of per-message agentMode)
- `issue://40` — `onExitPlanModeRequest` + `onAutoModeSwitchRequest` handlers
- `plans/specs/copilot-sdk-update.md` — capability audit; per-message agentMode not listed as a gap (backend already implemented)
- `plans/specs/keyboard-shortcuts.md` — shortcut registry; verify `Ctrl+Shift+P` before committing
- `node_modules/@github/copilot-sdk/dist/types.d.ts:1644` — `agentMode` field on SDK message options
- `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:881-889` — `SendAgentMode` union (includes `"shell"`)
- `node_modules/@github/copilot-sdk/dist/session.js:98-100` — ESM send path forwarding `agentMode`
- `src-bun/app/chat/sessions.ts:847-852` — `SessionRegistry.send()` signature (5th param `agentMode`)
- `src-bun/app/chat/sessions.ts:906` — one-shot resolution: `effectiveAgentMode = agentMode ?? sessionMode ?? 'interactive'`
- `src-bun/__tests__/sessions.test.ts:385-408` — test `#35`; one-shot semantics proven
- `src-bun/rpc.ts:18-21` — `SessionMode` union; `sendMessage.params:684-699`
- `src-bun/index.ts:232-233` — `sendMessage` handler (missing `agentMode` forwarding)
- `src/components/chat/ModeButtonGroup.vue:1-31` — session-level mode picker; `setSessionMode` call
- `src/lib/sessionModeOptions.ts:14-18` — `MODE_OPTIONS` shared constant
- `src/components/chat/MessageComposer.vue:496-531` — send-mode chip (Steer/Queue); distinct from agent mode
- `src/lexical/plugins.ts:148-154` — `ComposerSubmitMode`, `ComposerSubmitPayload`
- `src/composables/useChatSubmit.ts:32-104` — `ChatSubmitTransport`, `sendMessage` data-flow
- `src/stores/chat/sessionsStore.ts:49-57,681-724` — `SendMode`, `sendMessage()`, `setSessionMode()`
- `src/components/chat/ChatWindow.vue:295-307,319-335` — transport closure, `submitMessage`
