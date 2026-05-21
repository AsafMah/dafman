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

import { pickString } from "../chatEvents";
import type { Handler } from "./context";

export const messageHandlers: Record<string, Handler> = {
  "assistant.message_start": (ctx, data, payload) => {
    const messageId = pickString(data, ["messageId"]);
    if (messageId) ctx.upsertAssistant(messageId, payload.eventId);
  },

  "assistant.message_delta": (ctx, data, payload) => {
    const messageId = pickString(data, ["messageId"]);
    const delta = pickString(data, ["deltaContent", "delta", "text"]);
    if (!messageId) return;
    const msg = ctx.upsertAssistant(messageId, payload.eventId);
    if (msg.kind === "assistant") msg.text += delta;
  },

  "assistant.message": (ctx, data, payload) => {
    const messageId = pickString(data, ["messageId"]);
    const content = pickString(data, ["content", "text", "message"]);
    if (!messageId) return;
    const msg = ctx.upsertAssistant(messageId, payload.eventId);
    if (msg.kind === "assistant") msg.text = content;
  },

  "user.message": (ctx, data, payload) => {
    const content = pickString(data, ["content", "text", "message"]);
    if (!content) return;
    const eventId =
      payload.eventId ?? pickString(data, ["messageId"]) ?? undefined;
    const attachments = normalizeAttachments(data as Record<string, unknown>);
    if (eventId) {
      const byId = ctx.items.find(
        (i) => i.kind === "user" && i.messageId === eventId,
      );
      if (byId) {
        if (byId.kind === "user") {
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
    const optimistic = [...ctx.items]
      .reverse()
      .find((i) => i.kind === "user" && !i.messageId && i.text === content);
    if (optimistic && optimistic.kind === "user") {
      optimistic.messageId = eventId;
      if (payload.eventId) optimistic.eventId = payload.eventId;
      if (!optimistic.attachments && attachments) {
        optimistic.attachments = attachments;
      }
      return;
    }
    ctx.items.push({
      id: ctx.counter.next++,
      kind: "user",
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
): import("../../ipc/types").SendMessageAttachment[] | undefined {
  const raw = (data as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return undefined;
  const out: import("../../ipc/types").SendMessageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = (item as { type?: unknown }).type;
    if (t === "file") {
      const path = (item as { path?: unknown }).path;
      const displayName = (item as { displayName?: unknown }).displayName;
      if (typeof path === "string") {
        out.push({
          type: "file",
          path,
          ...(typeof displayName === "string" ? { displayName } : {}),
        });
      }
    } else if (t === "directory") {
      const path = (item as { path?: unknown }).path;
      const displayName = (item as { displayName?: unknown }).displayName;
      if (typeof path === "string") {
        out.push({
          type: "directory",
          path,
          ...(typeof displayName === "string" ? { displayName } : {}),
        });
      }
    } else if (t === "blob") {
      const blobData = (item as { data?: unknown }).data;
      const mimeType = (item as { mimeType?: unknown }).mimeType;
      const displayName = (item as { displayName?: unknown }).displayName;
      if (typeof blobData === "string" && typeof mimeType === "string") {
        out.push({
          type: "blob",
          data: blobData,
          mimeType,
          ...(typeof displayName === "string" ? { displayName } : {}),
        });
      }
    } else if (t === "selection") {
      const filePath = (item as { filePath?: unknown }).filePath;
      const displayName = (item as { displayName?: unknown }).displayName;
      if (typeof filePath === "string" && typeof displayName === "string") {
        out.push({
          type: "selection",
          filePath,
          displayName,
        });
      }
    }
    // unknown kinds (e.g. github_reference) are intentionally dropped
  }
  return out.length > 0 ? out : undefined;
}
