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

import { pickString } from './helpers';
import type { ChatItem, PendingRequest } from '../chatEvents';
import type {
  AutoModeSwitchRequestData,
  ElicitationRequestData,
  ExitPlanModeRequestData,
  PermissionRequestData,
  UserInputRequestData,
} from '../../ipc/types';
import type { Handler, ReducerContext } from './context';

function describePermission(data: PermissionRequestData | unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as PermissionRequestData).summary === 'string'
  ) {
    return (data as PermissionRequestData).summary;
  }

  return (
    pickString(data, ['summary', 'description', 'message']) ||
    pickString(data, ['tool', 'toolName']) ||
    'Tool wants permission'
  );
}

function describeInput(data: UserInputRequestData | unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as UserInputRequestData).question === 'string'
  ) {
    return (data as UserInputRequestData).question;
  }

  return (
    pickString(data, ['question', 'prompt', 'summary', 'message', 'description']) ||
    'Awaiting input'
  );
}

function describeElicitation(data: ElicitationRequestData | unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as ElicitationRequestData).message === 'string'
  ) {
    return (data as ElicitationRequestData).message;
  }

  return (
    pickString(data, ['message', 'prompt', 'summary', 'description', 'url']) || 'Awaiting input'
  );
}

function describeExitPlan(data: ExitPlanModeRequestData | unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as ExitPlanModeRequestData).summary === 'string'
  ) {
    return (data as ExitPlanModeRequestData).summary;
  }

  return 'Plan ready for approval';
}

function describeAutoModeSwitch(data: AutoModeSwitchRequestData | unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as AutoModeSwitchRequestData).errorCode === 'string'
  ) {
    return `Switch to auto mode after rate limit: ${(data as AutoModeSwitchRequestData).errorCode}`;
  }

  return 'Switch to auto mode?';
}

/// Removes entries from BOTH the ambient queue and the chat-stream
/// items list. `requestId` removes exactly one matching entry;
/// `kind` (used for SDK `_completed`) removes the OLDEST matching
/// entry since the SDK echoes don't carry our generated id.
function removePending(
  ctx: ReducerContext,
  kind: PendingRequest['kind'],
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
    const d = data as
      | {
          requestId?: unknown;
          kind?: unknown;
          request?:
            | PermissionRequestData
            | UserInputRequestData
            | ElicitationRequestData
            | ExitPlanModeRequestData
            | AutoModeSwitchRequestData
            | unknown;
        }
      | undefined;

    if (!d || typeof d.requestId !== 'string' || typeof d.kind !== 'string') {
      return;
    }

    // Idempotency: ignore re-pushes of the same requestId.
    if (ctx.ambient.pendingRequests.some((p) => p.requestId === d.requestId)) {
      return;
    }

    let ambientEntry: PendingRequest | null = null;
    let cardItem: ChatItem | null = null;
    const requestId = d.requestId;
    const id = ctx.counter.next++;

    switch (d.kind) {
      case 'permission': {
        const req = d.request as PermissionRequestData;
        const message = describePermission(req);

        ambientEntry = { kind: 'permission', requestId, message, request: req };
        cardItem = {
          id,
          kind: 'pendingRequest',
          requestId,
          pendingKind: 'permission',
          message,
          request: req,
        };
        break;
      }
      case 'userInput': {
        const req = d.request as UserInputRequestData;
        const message = describeInput(req);

        ambientEntry = { kind: 'userInput', requestId, message, request: req };
        cardItem = {
          id,
          kind: 'pendingRequest',
          requestId,
          pendingKind: 'userInput',
          message,
          request: req,
        };
        break;
      }
      case 'elicitation': {
        const req = d.request as ElicitationRequestData;
        const message = describeElicitation(req);

        ambientEntry = { kind: 'elicitation', requestId, message, request: req };
        cardItem = {
          id,
          kind: 'pendingRequest',
          requestId,
          pendingKind: 'elicitation',
          message,
          request: req,
        };
        break;
      }
      case 'exitPlanMode': {
        const req = d.request as ExitPlanModeRequestData;
        const message = describeExitPlan(req);

        ambientEntry = { kind: 'exitPlanMode', requestId, message, request: req };
        cardItem = {
          id,
          kind: 'pendingRequest',
          requestId,
          pendingKind: 'exitPlanMode',
          message,
          request: req,
        };
        break;
      }
      case 'autoModeSwitch': {
        const req = d.request as AutoModeSwitchRequestData;
        const message = describeAutoModeSwitch(req);

        ambientEntry = { kind: 'autoModeSwitch', requestId, message, request: req };
        cardItem = {
          id,
          kind: 'pendingRequest',
          requestId,
          pendingKind: 'autoModeSwitch',
          message,
          request: req,
        };
        break;
      }
    }

    if (ambientEntry && cardItem) {
      ctx.ambient.pendingRequests.push(ambientEntry);
      ctx.items.push(cardItem);
    }
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
