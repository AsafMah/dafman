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
  "assistant.message_start": (ctx, data) => {
    const messageId = pickString(data, ["messageId"]);
    if (messageId) ctx.upsertAssistant(messageId);
  },

  "assistant.message_delta": (ctx, data) => {
    const messageId = pickString(data, ["messageId"]);
    const delta = pickString(data, ["deltaContent", "delta", "text"]);
    if (!messageId) return;
    const msg = ctx.upsertAssistant(messageId);
    if (msg.kind === "assistant") msg.text += delta;
  },

  "assistant.message": (ctx, data) => {
    const messageId = pickString(data, ["messageId"]);
    const content = pickString(data, ["content", "text", "message"]);
    if (!messageId) return;
    const msg = ctx.upsertAssistant(messageId);
    if (msg.kind === "assistant") msg.text = content;
  },

  "user.message": (ctx, data, payload) => {
    const content = pickString(data, ["content", "text", "message"]);
    if (!content) return;
    // Prefer envelope eventId as the stable dedup key; fall back to
    // data.messageId if some SDK variant ever ships it.
    const eventId =
      payload.eventId ?? pickString(data, ["messageId"]) ?? undefined;
    if (eventId) {
      const byId = ctx.items.find(
        (i) => i.kind === "user" && i.messageId === eventId,
      );
      if (byId) return;
    }
    // Adopt the most recent local-only user item with matching text.
    const optimistic = [...ctx.items]
      .reverse()
      .find((i) => i.kind === "user" && !i.messageId && i.text === content);
    if (optimistic && optimistic.kind === "user") {
      optimistic.messageId = eventId;
      return;
    }
    ctx.items.push({
      id: ctx.counter.next++,
      kind: "user",
      text: content,
      ...(eventId ? { messageId: eventId } : {}),
    });
  },
};
