// Reduces the per-session event stream into a flat list of renderable
// chat items. Lives outside `ChatWindow.vue` so it can be unit-tested
// without happy-dom or PrimeVue.

import type { SessionEventPayload } from "../ipc/types";

export type ChatItem =
  | {
      id: number;
      kind: "user";
      text: string;
    }
  | {
      id: number;
      kind: "assistant";
      text: string;
      messageId: string;
    }
  | {
      id: number;
      kind: "reasoning";
      text: string;
      reasoningId: string;
    }
  | {
      id: number;
      kind: "system";
      text: string;
    };

export type ProcessResult = {
  items: ChatItem[];
  /// True when a `session.idle` event was observed in this batch — the
  /// component clears its "sending" flag on the leading edge of idle.
  idle: boolean;
  /// True when a `session.error` event was observed in this batch.
  error: boolean;
};

export type IdCounter = { next: number };

/// Extracts the first present string field, in order. Used to paper over
/// minor wire-shape drift across SDK versions (e.g. some events use
/// `delta` while the generated structs say `deltaContent`).
function pickString(data: unknown, keys: readonly string[]): string {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string") return v;
  }
  return "";
}

export function processEvents(
  current: ChatItem[],
  newPayloads: SessionEventPayload[],
  counter: IdCounter,
): ProcessResult {
  const items = current.slice();
  let idle = false;
  let error = false;

  const upsertAssistant = (messageId: string): ChatItem => {
    let existing = items.find(
      (i) => i.kind === "assistant" && i.messageId === messageId,
    );
    if (!existing) {
      existing = {
        id: counter.next++,
        kind: "assistant",
        text: "",
        messageId,
      };
      items.push(existing);
    }
    return existing;
  };

  const upsertReasoning = (reasoningId: string): ChatItem => {
    let existing = items.find(
      (i) => i.kind === "reasoning" && i.reasoningId === reasoningId,
    );
    if (!existing) {
      existing = {
        id: counter.next++,
        kind: "reasoning",
        text: "",
        reasoningId,
      };
      items.push(existing);
    }
    return existing;
  };

  for (const payload of newPayloads) {
    const data = payload.data ?? {};
    switch (payload.eventType) {
      case "assistant.message_start": {
        const messageId = pickString(data, ["messageId"]);
        if (messageId) upsertAssistant(messageId);
        break;
      }
      case "assistant.message_delta": {
        const messageId = pickString(data, ["messageId"]);
        const delta = pickString(data, ["deltaContent", "delta", "text"]);
        if (messageId) {
          const msg = upsertAssistant(messageId);
          if (msg.kind === "assistant") msg.text += delta;
        }
        break;
      }
      case "assistant.message": {
        const messageId = pickString(data, ["messageId"]);
        const content = pickString(data, ["content", "text", "message"]);
        if (messageId) {
          const msg = upsertAssistant(messageId);
          if (msg.kind === "assistant") msg.text = content;
        }
        break;
      }
      case "assistant.reasoning_delta": {
        const reasoningId = pickString(data, ["reasoningId"]);
        const delta = pickString(data, [
          "deltaContent",
          "delta",
          "text",
          "reasoningText",
          "reasoning_text",
        ]);
        // Drop events that have neither an id nor any text -- otherwise
        // we render an empty "Thinking..." card after the assistant turn.
        if (!reasoningId && !delta) {
          if (typeof console !== "undefined") {
            console.warn(
              "[chatEvents] assistant.reasoning_delta with no id or text",
              data,
            );
          }
          break;
        }
        const key = reasoningId || "_reasoning_singleton";
        const msg = upsertReasoning(key);
        if (msg.kind === "reasoning") msg.text += delta;
        break;
      }
      case "assistant.reasoning": {
        const reasoningId = pickString(data, ["reasoningId"]);
        const content = pickString(data, [
          "content",
          "text",
          "reasoningText",
          "reasoning_text",
        ]);
        if (!reasoningId && !content) {
          if (typeof console !== "undefined") {
            console.warn(
              "[chatEvents] assistant.reasoning with no id or content",
              data,
            );
          }
          break;
        }
        const key = reasoningId || "_reasoning_singleton";
        const msg = upsertReasoning(key);
        if (msg.kind === "reasoning") {
          msg.text = content || msg.text;
        }
        break;
      }
      case "session.idle": {
        idle = true;
        break;
      }
      case "session.error": {
        const message = pickString(data, ["message"]) || "Unknown session error";
        items.push({
          id: counter.next++,
          kind: "system",
          text: `Session error: ${message}`,
        });
        error = true;
        break;
      }
      default:
        break;
    }
  }

  return { items, idle, error };
}

export function appendUserMessage(
  current: ChatItem[],
  text: string,
  counter: IdCounter,
): ChatItem[] {
  return [...current, { id: counter.next++, kind: "user", text }];
}

export function appendSystemMessage(
  current: ChatItem[],
  text: string,
  counter: IdCounter,
): ChatItem[] {
  return [...current, { id: counter.next++, kind: "system", text }];
}
