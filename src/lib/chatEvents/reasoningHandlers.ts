// Reasoning-stream handlers. The SDK ships reasoning as a separate
// channel from the visible message text — we render it via
// `ReasoningBlock.vue` (collapsed by default; expanded mode shows
// the full chain-of-thought).
//
// `_delta` events stream in chunks like the message stream;
// `assistant.reasoning` is the non-streaming variant.

import { pickString } from "../chatEvents";
import type { Handler } from "./context";

const REASONING_SINGLETON_KEY = "_reasoning_singleton";

export const reasoningHandlers: Record<string, Handler> = {
  "assistant.reasoning_delta": (ctx, data, payload) => {
    const reasoningId = pickString(data, ["reasoningId"]);
    const delta = pickString(data, [
      "deltaContent",
      "delta",
      "text",
      "reasoningText",
      "reasoning_text",
    ]);
    if (!reasoningId && !delta) {
      if (typeof console !== "undefined") {
        console.warn(
          "[chatEvents] assistant.reasoning_delta with no id or text",
          data,
        );
      }
      return;
    }
    const key = reasoningId || REASONING_SINGLETON_KEY;
    const msg = ctx.upsertReasoning(key, payload.eventId);
    if (msg.kind === "reasoning") msg.text += delta;
  },

  "assistant.reasoning": (ctx, data, payload) => {
    const reasoningId = pickString(data, ["reasoningId"]);
    const content = pickString(data, [
      "content",
      "text",
      "reasoningText",
      "reasoning_text",
    ]);
    if (!content) {
      const hasExistingItem =
        reasoningId &&
        ctx.items.some(
          (i) => i.kind === "reasoning" && i.reasoningId === reasoningId,
        );
      if (!hasExistingItem) return;
    }
    const key = reasoningId || REASONING_SINGLETON_KEY;
    const msg = ctx.upsertReasoning(key, payload.eventId);
    if (msg.kind === "reasoning") {
      msg.text = content || msg.text;
    }
  },
};
