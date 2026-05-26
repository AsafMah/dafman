// Handlers for the assistant + user message stream.
//
// * `assistant.message_start` / `_delta` / `_end-equivalent` build up
//   the streaming bubble.
// * `assistant.message` is the non-streaming variant — replaces the
//   full text in one go.
// * `user.message` dedups against the local optimistic item appended
//   by `appendUserMessage`, then by envelope eventId / data.messageId
//   for history replay. Without these checks resumed sessions
//   double-bubble the live send.

import { pickString } from '@/lib/chatEvents/helpers';
import type { Handler } from '@/lib/chatEvents/context';

export const messageHandlers: Record<string, Handler> = {
  'assistant.message_start': (ctx, data, payload) => {
    const messageId = pickString(data, ['messageId']);

    if (messageId) ctx.upsertAssistant(messageId, payload.eventId);
  },

  'assistant.message_delta': (ctx, data, payload) => {
    const messageId = pickString(data, ['messageId']);
    const delta = pickString(data, ['deltaContent', 'delta', 'text']);

    if (!messageId) return;

    const msg = ctx.upsertAssistant(messageId, payload.eventId);

    if (msg.kind === 'assistant') msg.text += delta;
  },

  'assistant.message': (ctx, data, payload) => {
    const messageId = pickString(data, ['messageId']);
    const content = pickString(data, ['content', 'text', 'message']);

    if (!messageId) return;

    // The CLI delivers reasoning AS PART of `assistant.message`, not on
    // a separate `assistant.reasoning` event. Verified in the bundled
    // CLI's app.js: it emits `assistant.message` with `reasoningText`
    // (readable) + `reasoningOpaque` (Anthropic encrypted) +
    // `encryptedContent` (OpenAI GPT-5.x encrypted) on `data`. No
    // `assistant.reasoning*` events are emitted from these model
    // paths at all — the SDK's schema declares them for forward-compat
    // (and sub-agents may use them), but for the main message stream
    // the reasoning rides this event. So we harvest it here and
    // synthesize a reasoning ChatItem keyed to the messageId so it
    // sits in document order ABOVE the assistant message.
    const reasoningText = pickString(data, ['reasoningText', 'reasoning_text']);
    const reasoningOpaque = pickString(data, [
      'reasoningOpaque',
      'reasoning_opaque',
      'encryptedContent',
      'encrypted_content',
    ]);

    if (reasoningText || reasoningOpaque) {
      // Tie reasoning to its assistant message with a stable id so
      // repeated emits don't dupe and history replay coalesces.
      const reasoningKey = `msg:${messageId}`;
      const reasoningMsg = ctx.upsertReasoning(reasoningKey, payload.eventId);

      if (reasoningMsg.kind === 'reasoning') {
        if (reasoningText) {
          reasoningMsg.text = reasoningText;

          if (reasoningMsg.opaque) reasoningMsg.opaque = false;
        } else if (reasoningOpaque && !reasoningMsg.text) {
          reasoningMsg.opaque = true;
        }
      }
    }

    const msg = ctx.upsertAssistant(messageId, payload.eventId);

    if (msg.kind === 'assistant') msg.text = content;
  },

  'user.message': (ctx, data, payload) => {
    const content = pickString(data, ['content', 'text', 'message']);

    if (!content) return;

    const eventId = payload.eventId ?? pickString(data, ['messageId']) ?? undefined;
    const attachments = normalizeAttachments(data as Record<string, unknown>);

    // 1. Already-known by messageId? Backfill eventId/attachments
    //    and bail — this is the SDK re-echoing an event we've already
    //    materialized (history replay after restart).
    if (eventId && mergeKnownUserMessage(ctx, eventId, payload.eventId, attachments)) {
      return;
    }

    // 2. Optimistic match? An `appendUserMessage` from the composer
    //    inserts a user item with no messageId; the SDK's echo lets
    //    us reconcile that bubble with the real ids.
    if (mergeOptimisticUserMessage(ctx, content, eventId, payload.eventId, attachments)) {
      return;
    }

    // 3. Fresh insert.
    ctx.items.push({
      id: ctx.counter.next++,
      kind: 'user',
      text: content,
      ...(eventId ? { messageId: eventId } : {}),
      ...(payload.eventId ? { eventId: payload.eventId } : {}),
      ...(attachments ? { attachments } : {}),
    });
  },
};

/// Merge in-place when we find an existing user item that matches the
/// SDK's `messageId`. Returns `true` when the merge happened so the
/// caller can short-circuit the rest of the flow.
function mergeKnownUserMessage(
  ctx: Parameters<(typeof messageHandlers)['user.message']>[0],
  messageId: string,
  payloadEventId: string | undefined,
  attachments: import('@/ipc/types').SendMessageAttachment[] | undefined,
): boolean {
  const byId = ctx.items.find((i) => i.kind === 'user' && i.messageId === messageId);

  if (!byId || byId.kind !== 'user') return Boolean(byId);

  if (!byId.eventId && payloadEventId) {
    byId.eventId = payloadEventId;
  }

  // Restore attachments seen on the SDK echo if the optimistic
  // path didn't already carry them (history replay after restart).
  if (!byId.attachments && attachments) {
    byId.attachments = attachments;
  }

  return true;
}

/// Reconcile against an optimistic user bubble (one we appended
/// locally before the SDK echoed it). Identifies via the most-recent
/// user item that has no messageId AND matches text. Returns `true`
/// when a merge happened.
///
/// U8: backwards loop avoids the `[...items].reverse()` array copy
/// (which would otherwise run on every user.message including the
/// full history replay on resume).
function mergeOptimisticUserMessage(
  ctx: Parameters<(typeof messageHandlers)['user.message']>[0],
  content: string,
  eventId: string | undefined,
  payloadEventId: string | undefined,
  attachments: import('@/ipc/types').SendMessageAttachment[] | undefined,
): boolean {
  for (let i = ctx.items.length - 1; i >= 0; i--) {
    const item = ctx.items[i];

    if (!item || item.kind !== 'user' || item.messageId || item.text !== content) continue;

    item.messageId = eventId;

    if (payloadEventId) item.eventId = payloadEventId;

    if (!item.attachments && attachments) {
      item.attachments = attachments;
    }

    return true;
  }

  return false;
}

type RawAttachment = Record<string, unknown>;
type NormalizedAttachment = import('@/ipc/types').SendMessageAttachment;

function normalizeFileAttachment(item: RawAttachment): NormalizedAttachment | null {
  const path = item.path;
  const displayName = item.displayName;

  if (typeof path !== 'string') return null;

  return {
    type: 'file',
    path,
    ...(typeof displayName === 'string' ? { displayName } : {}),
  };
}

function normalizeDirectoryAttachment(item: RawAttachment): NormalizedAttachment | null {
  const path = item.path;
  const displayName = item.displayName;

  if (typeof path !== 'string') return null;

  return {
    type: 'directory',
    path,
    ...(typeof displayName === 'string' ? { displayName } : {}),
  };
}

function normalizeBlobAttachment(item: RawAttachment): NormalizedAttachment | null {
  const blobData = item.data;
  const mimeType = item.mimeType;
  const displayName = item.displayName;

  if (typeof blobData !== 'string' || typeof mimeType !== 'string') return null;

  return {
    type: 'blob',
    data: blobData,
    mimeType,
    ...(typeof displayName === 'string' ? { displayName } : {}),
  };
}

function normalizeSelectionAttachment(item: RawAttachment): NormalizedAttachment | null {
  const filePath = item.filePath;
  const displayName = item.displayName;

  if (typeof filePath !== 'string' || typeof displayName !== 'string') return null;

  return {
    type: 'selection',
    filePath,
    displayName,
  };
}

/// Per-type normalizer dispatch. Unknown kinds (e.g.
/// `github_reference`) are intentionally absent — the loop in
/// `normalizeAttachments` drops anything that returns `null` here.
const ATTACHMENT_NORMALIZERS: Record<string, (item: RawAttachment) => NormalizedAttachment | null> =
  {
    file: normalizeFileAttachment,
    directory: normalizeDirectoryAttachment,
    blob: normalizeBlobAttachment,
    selection: normalizeSelectionAttachment,
  };

/// Map the SDK's UserMessageAttachment array (see
/// `@github/copilot` session-events generated types) to our internal
/// `SendMessageAttachment` shape so a sent message rehydrates with
/// its pills after a restart. Unknown attachment kinds (github
/// references etc.) are skipped — the user can still read the prompt
/// text, just without an interactive chip.
function normalizeAttachments(data: Record<string, unknown>): NormalizedAttachment[] | undefined {
  const raw = (data as { attachments?: unknown }).attachments;

  if (!Array.isArray(raw)) return undefined;

  const out: NormalizedAttachment[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const kind = (item as { type?: unknown }).type;

    if (typeof kind !== 'string') continue;

    const normalizer = ATTACHMENT_NORMALIZERS[kind];

    if (!normalizer) continue;

    const normalized = normalizer(item as RawAttachment);

    if (normalized) out.push(normalized);
  }

  return out.length > 0 ? out : undefined;
}
