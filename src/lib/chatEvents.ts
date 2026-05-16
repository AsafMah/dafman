// Reduces the per-session event stream into a flat list of renderable
// chat items. Lives outside `ChatWindow.vue` so it can be unit-tested
// without happy-dom or PrimeVue.

import type { SessionEventPayload } from "../ipc/types";

export type SystemSeverity = "info" | "warn" | "error";

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
      severity: SystemSeverity;
    };

/// Ambient state derived from the event stream that is shown OUTSIDE the
/// scrollable message list (header title/model, intent pill above the
/// streaming bubble, footer usage pill, "thinking" indicator). Kept
/// separately from `items` so the message list doesn't grow with
/// transient signals.
export type ChatAmbient = {
  /// Session title from `session.title_changed`, if any.
  title: string | null;
  /// Current model id from `session.model_change`, if any.
  model: string | null;
  /// Latest `assistant.intent.intent`. Cleared on `assistant.turn_end`.
  intent: string | null;
  /// Latest `session.usage_info` snapshot. Updated in place.
  usage: { currentTokens: number; tokenLimit: number } | null;
  /// True between `assistant.turn_start` and `assistant.turn_end`. When
  /// we never see the boundaries (older SDKs, non-streaming models) the
  /// caller falls back to its own heuristic.
  turnActive: boolean;
  /// True once we've observed at least one turn_start so the caller knows
  /// it can trust `turnActive` going forward.
  sawTurnBoundary: boolean;
};

export function defaultAmbient(): ChatAmbient {
  return {
    title: null,
    model: null,
    intent: null,
    usage: null,
    turnActive: false,
    sawTurnBoundary: false,
  };
}

/// Toast nudges the reducer wants the caller to surface (e.g. model
/// change). Kept as data so the pure reducer doesn't depend on the toast
/// store; the caller drains them.
export type ChatToast = {
  severity: "success" | "info" | "warn" | "error";
  summary: string;
  detail?: string;
};

export type ProcessResult = {
  items: ChatItem[];
  ambient: ChatAmbient;
  toasts: ChatToast[];
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

function pickNumber(data: unknown, keys: readonly string[]): number | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export function processEvents(
  current: ChatItem[],
  ambient: ChatAmbient,
  newPayloads: SessionEventPayload[],
  counter: IdCounter,
): ProcessResult {
  const items = current.slice();
  const next: ChatAmbient = { ...ambient };
  const toasts: ChatToast[] = [];
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

  const pushSystem = (text: string, severity: SystemSeverity) => {
    items.push({ id: counter.next++, kind: "system", text, severity });
  };

  for (const payload of newPayloads) {
    const data = payload.data ?? {};
    switch (payload.eventType) {
      // --- Message stream ---
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
      // --- Reasoning ---
      case "assistant.reasoning_delta": {
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
        if (!content) {
          const hasExistingItem =
            reasoningId &&
            items.some(
              (i) => i.kind === "reasoning" && i.reasoningId === reasoningId,
            );
          if (!hasExistingItem) {
            // OpenAI's opaque reasoning blob, or genuinely empty. Drop.
            break;
          }
        }
        const key = reasoningId || "_reasoning_singleton";
        const msg = upsertReasoning(key);
        if (msg.kind === "reasoning") {
          msg.text = content || msg.text;
        }
        break;
      }
      // --- Turn boundaries / intent ---
      case "assistant.turn_start": {
        next.turnActive = true;
        next.sawTurnBoundary = true;
        next.intent = null;
        break;
      }
      case "assistant.turn_end": {
        next.turnActive = false;
        next.sawTurnBoundary = true;
        next.intent = null;
        break;
      }
      case "assistant.intent": {
        const intent = pickString(data, ["intent"]);
        if (intent) next.intent = intent;
        break;
      }
      // --- Session metadata ---
      case "session.title_changed": {
        const title = pickString(data, ["title"]);
        if (title) next.title = title;
        break;
      }
      case "session.model_change": {
        const newModel = pickString(data, ["newModel"]);
        const prev = pickString(data, ["previousModel"]);
        if (newModel) {
          next.model = newModel;
          toasts.push({
            severity: "info",
            summary: "Model changed",
            detail: prev ? `${prev} → ${newModel}` : newModel,
          });
        }
        break;
      }
      case "session.usage_info":
      case "assistant.usage": {
        const current = pickNumber(data, ["currentTokens", "inputTokens"]);
        const limit = pickNumber(data, ["tokenLimit"]);
        if (current !== null && limit !== null) {
          next.usage = { currentTokens: current, tokenLimit: limit };
        } else if (current !== null && next.usage) {
          next.usage = { ...next.usage, currentTokens: current };
        }
        break;
      }
      // --- Inline callouts ---
      case "session.info": {
        const message = pickString(data, ["message"]);
        const tip = pickString(data, ["tip"]);
        if (message) pushSystem(tip ? `${message} (${tip})` : message, "info");
        break;
      }
      case "session.warning": {
        const message = pickString(data, ["message"]);
        if (message) pushSystem(message, "warn");
        break;
      }
      case "system.notification": {
        const content = pickString(data, ["content"]);
        if (content) pushSystem(content, "info");
        break;
      }
      case "session.truncation": {
        const removed = pickNumber(data, [
          "messagesRemovedDuringTruncation",
        ]);
        pushSystem(
          removed
            ? `Context truncated (${removed} messages removed).`
            : "Context truncated.",
          "info",
        );
        break;
      }
      case "session.compaction_start": {
        pushSystem("Compacting conversation...", "info");
        break;
      }
      case "session.compaction_complete": {
        const err = pickString(data, ["errorMessage"]);
        pushSystem(
          err ? `Compaction failed: ${err}` : "Compaction complete.",
          err ? "warn" : "info",
        );
        break;
      }
      case "model.call_failure": {
        const errMsg = pickString(data, ["errorMessage"]) || "Model call failed";
        const status = pickNumber(data, ["statusCode"]);
        pushSystem(
          status ? `${errMsg} (HTTP ${status})` : errMsg,
          "error",
        );
        break;
      }
      // --- Lifecycle ---
      case "session.idle": {
        idle = true;
        if (next.sawTurnBoundary) next.turnActive = false;
        next.intent = null;
        break;
      }
      case "session.error": {
        const message = pickString(data, ["message"]) || "Unknown session error";
        pushSystem(`Session error: ${message}`, "error");
        error = true;
        next.turnActive = false;
        next.intent = null;
        break;
      }
      // --- Explicitly ignored (handled elsewhere or non-displayable) ---
      case "assistant.streaming_delta": // duplicates message_delta
      case "system.message": // raw system prompt; not user-facing
      case "user.message": // we render user input from our own append
      case "session.tools_updated":
      case "session.skills_loaded":
      case "session.custom_agents_updated":
      case "session.mcp_servers_loaded":
      case "session.mcp_server_status_changed":
      case "session.extensions_loaded":
      case "pending_messages.modified":
      case "session.context_changed":
      case "session.start":
      case "session.resume":
      case "session.shutdown":
        break;
      default:
        break;
    }
  }

  return { items, ambient: next, toasts, idle, error };
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
  severity: SystemSeverity = "error",
): ChatItem[] {
  return [
    ...current,
    { id: counter.next++, kind: "system", text, severity },
  ];
}
