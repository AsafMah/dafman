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

import { pickString } from './helpers';
import type { Handler } from './context';

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
    if (eventId) {
      const byId = ctx.items.find((i) => i.kind === 'user' && i.messageId === eventId);
      if (byId) {
        if (byId.kind === 'user') {
          if (!byId.eventId && payload.eventId) {
            byId.eventId = payload.eventId;
          }
          // Restore attachments seen on the SDK echo if the optimistic
          // path didn't already carry them (history replay after restart).
          if (!byId.attachments && attachments) {
            byId.attachments = attachments;
          }
        }
        return;
      }
    }
    // U8: backwards loop avoids the [...items].reverse() array copy
    // (which runs on every user.message including the full history
    // replay on resume). Early-break on the most-recent optimistic
    // user message with matching text.
    let optimistic: (typeof ctx.items)[number] | undefined;
    for (let i = ctx.items.length - 1; i >= 0; i--) {
      const item = ctx.items[i];
      if (item && item.kind === 'user' && !item.messageId && item.text === content) {
        optimistic = item;
        break;
      }
    }
    if (optimistic && optimistic.kind === 'user') {
      optimistic.messageId = eventId;
      if (payload.eventId) optimistic.eventId = payload.eventId;
      if (!optimistic.attachments && attachments) {
        optimistic.attachments = attachments;
      }
      return;
    }
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

/// Map the SDK's UserMessageAttachment array (see
/// `@github/copilot` session-events generated types) to our internal
/// `SendMessageAttachment` shape so a sent message rehydrates with
/// its pills after a restart. Unknown attachment kinds (github
/// references etc.) are skipped — the user can still read the prompt
/// text, just without an interactive chip.
function normalizeAttachments(
  data: Record<string, unknown>,
): import('../../ipc/types').SendMessageAttachment[] | undefined {
  const raw = (data as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return undefined;
  const out: import('../../ipc/types').SendMessageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const t = (item as { type?: unknown }).type;
    if (t === 'file') {
      const path = (item as { path?: unknown }).path;
      const displayName = (item as { displayName?: unknown }).displayName;
      if (typeof path === 'string') {
        out.push({
          type: 'file',
          path,
          ...(typeof displayName === 'string' ? { displayName } : {}),
        });
      }
    } else if (t === 'directory') {
      const path = (item as { path?: unknown }).path;
      const displayName = (item as { displayName?: unknown }).displayName;
      if (typeof path === 'string') {
        out.push({
          type: 'directory',
          path,
          ...(typeof displayName === 'string' ? { displayName } : {}),
        });
      }
    } else if (t === 'blob') {
      const blobData = (item as { data?: unknown }).data;
      const mimeType = (item as { mimeType?: unknown }).mimeType;
      const displayName = (item as { displayName?: unknown }).displayName;
      if (typeof blobData === 'string' && typeof mimeType === 'string') {
        out.push({
          type: 'blob',
          data: blobData,
          mimeType,
          ...(typeof displayName === 'string' ? { displayName } : {}),
        });
      }
    } else if (t === 'selection') {
      const filePath = (item as { filePath?: unknown }).filePath;
      const displayName = (item as { displayName?: unknown }).displayName;
      if (typeof filePath === 'string' && typeof displayName === 'string') {
        out.push({
          type: 'selection',
          filePath,
          displayName,
        });
      }
    }
    // unknown kinds (e.g. github_reference) are intentionally dropped
  }
  return out.length > 0 ? out : undefined;
}
