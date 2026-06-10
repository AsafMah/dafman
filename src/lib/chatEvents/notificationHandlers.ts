// Handlers for permission / user-input / elicitation events.
//
// **Inline-in-chat design:** each pending SDK callback is rendered
// as a card item in the chat stream (not a modal). The card sits
// alongside assistant/user/tool blocks; the user can scroll, switch
// sessions, or keep typing while it's there. Responding (or the
// SDK resolving out-of-band) removes the card.
//
// **State channels (two parallel queues):**
//
//   1. `ctx.items[]` — the chat-stream queue. Cards live here so
//      `ChatWindow.vue` renders them inline.
//   2. `ctx.ambient.pendingRequests[]` — the at-a-glance queue used
//      by ChatTab + SessionsManager dots and the composer banner's
//      counter. Same entries, just mirrored separately so off-panel
//      surfaces don't have to scan `items` (which is unbounded).
//
// Both are populated by the synthetic `dafman.pending_request` event
// the sessionsStore pushes through the reducer. Both are cleared by
// `dafman.pending_response` (immediate user action) or the SDK's
// `*.completed` (out-of-band, stale-cleanup). SDK `*.requested` are
// informational no-ops.

import { pendingRequestEntryFromData, type SessionPendingRequestKind } from '@/lib/sessionStatus';
import type { ChatItem } from '@/lib/chatEvents';
import type { Handler, ReducerContext } from '@/lib/chatEvents/context';

/// Removes entries from BOTH the ambient queue and the chat-stream
/// items list. `requestId` removes exactly one matching entry;
/// `kind` (used for SDK `_completed`) removes the OLDEST matching
/// entry since the SDK echoes don't carry our generated id.
function removePending(
  ctx: ReducerContext,
  kind: SessionPendingRequestKind,
  requestId?: string,
): void {
  // U7: resolve the target requestId up front. If the caller already
  // gave us one, use it; otherwise find the oldest matching kind in
  // the ambient queue and use that id to remove from both lists. This
  // makes the by-kind path symmetric with the by-requestId path and
  // ensures we remove the SAME entry from each list (no risk of
  // removing oldest-by-kind from ambient and oldest-by-kind from
  // items, where they could legitimately differ).
  let targetId = requestId;

  if (!targetId) {
    const found = ctx.ambient.pendingRequests.find((p) => p.kind === kind);

    targetId = found?.requestId;
  }

  if (!targetId) return;

  ctx.ambient.pendingRequests = ctx.ambient.pendingRequests.filter((p) => p.requestId !== targetId);
  const itemIdx = ctx.items.findIndex(
    (i) => i.kind === 'pendingRequest' && i.requestId === targetId,
  );

  if (itemIdx >= 0) ctx.items.splice(itemIdx, 1);
}

export const notificationHandlers: Record<string, Handler> = {
  /// Synthetic event pushed by sessionsStore when the bun-side
  /// pending-request channel fires. Pushes both an ambient entry
  /// (drives dots + banner counter) AND a card item (renders inline
  /// in the chat stream).
  'dafman.pending_request': (ctx, data) => {
    const entry = pendingRequestEntryFromData(data);

    if (!entry) return;

    // Idempotency: ignore re-pushes of the same requestId.
    if (ctx.ambient.pendingRequests.some((p) => p.requestId === entry.requestId)) {
      return;
    }

    const cardItem: ChatItem = {
      id: ctx.counter.next++,
      kind: 'pendingRequest',
      requestId: entry.requestId,
      pendingKind: entry.kind,
      message: entry.message,
      request: entry.request,
    };

    ctx.ambient.pendingRequests.push(entry);
    ctx.items.push(cardItem);
  },

  /// Synthetic event fired by sessionsStore when the user responds.
  /// Removes both the ambient queue entry and the card item by
  /// requestId so the UI clears immediately (don't wait for the
  /// SDK's `_completed` echo, which can lag).
  'dafman.pending_response': (ctx, data) => {
    const d = data as { requestId?: unknown } | undefined;

    if (!d || typeof d.requestId !== 'string') return;

    removePending(ctx, 'permission', d.requestId); // kind is ignored when requestId is supplied — it removes the matching entry regardless of kind.
  },

  // SDK informational events. `*.requested` are no-ops for state
  // purposes (the canonical add path is dafman.pending_request).
  // `*.completed` clears the OLDEST entry of the matching kind, as
  // a stale-cleanup path for SDK-out-of-band resolutions (resume
  // with continuePendingWork, etc.).
  'permission.requested': () => {
    /* informational */
  },
  'permission.completed': (ctx) => {
    removePending(ctx, 'permission');
  },
  'user_input.requested': () => {
    /* informational */
  },
  'user_input.completed': (ctx) => {
    removePending(ctx, 'userInput');
  },
  'elicitation.requested': () => {
    /* informational */
  },
  'elicitation.completed': (ctx) => {
    removePending(ctx, 'elicitation');
  },
  'exit_plan_mode.requested': () => {
    /* informational */
  },
  'exit_plan_mode.completed': (ctx) => {
    removePending(ctx, 'exitPlanMode');
  },
  'auto_mode_switch.requested': () => {
    /* informational */
  },
  'auto_mode_switch.completed': (ctx) => {
    removePending(ctx, 'autoModeSwitch');
  },
};
