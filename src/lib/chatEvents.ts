// Reduces the per-session event stream into a flat list of renderable
// chat items. Lives outside `ChatWindow.vue` so it can be unit-tested
// without happy-dom or PrimeVue.

import type { SessionEventPayload } from "../ipc/types";

export type SystemSeverity = "info" | "warn" | "error";

export type ToolStatus = "running" | "success" | "error";

export type ChatItem =
  | {
      id: number;
      kind: "user";
      text: string;
      /// SDK envelope event id, set when the item originates from (or
      /// has been reconciled with) a `user.message` event. Locally
      /// appended optimistic items leave this `undefined` until the
      /// matching echo arrives; the reducer then adopts it in place
      /// rather than duplicating the bubble.
      messageId?: string;
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
      kind: "tool";
      toolCallId: string;
      toolName: string;
      mcpServerName?: string;
      mcpToolName?: string;
      args?: Record<string, unknown>;
      status: ToolStatus;
      /// Latest progress notification text (e.g. from an MCP server's
      /// `tool.execution_progress`). Overwritten on each event.
      progressMessage?: string;
      /// Accumulated `tool.execution_partial_result.partialOutput`,
      /// capped to `TOOL_OUTPUT_CAP_BYTES` to keep the renderer happy
      /// with shell commands that print megabytes.
      partialOutput: string;
      /// Final result content from `tool.execution_complete`. We prefer
      /// `result.detailedContent` (full content for UI) over
      /// `result.content` (LLM-truncated). Also capped.
      resultContent?: string;
      errorMessage?: string;
      errorCode?: string;
      /// Sub-agent that produced this tool call, when applicable.
      agentId?: string;
    }
  | {
      id: number;
      kind: "system";
      text: string;
      severity: SystemSeverity;
    };

/// Maximum bytes of partial / result content we keep in memory and
/// render per tool call. Streaming shell tools can emit huge blobs;
/// without a cap the message list grinds to a halt.
export const TOOL_OUTPUT_CAP_BYTES = 64 * 1024;

function clampOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_CAP_BYTES) return text;
  const head = text.slice(0, TOOL_OUTPUT_CAP_BYTES);
  return `${head}\n... [output truncated: ${text.length - TOOL_OUTPUT_CAP_BYTES} more bytes]`;
}

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
  /// Current reasoning effort from `session.model_change`, if any.
  reasoningEffort: string | null;
  /// Last model-change notification signature, used to suppress duplicate
  /// SDK events without hiding later distinct model changes.
  lastModelChangeToastKey: string | null;
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
    reasoningEffort: null,
    lastModelChangeToastKey: null,
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

  /// Upserts a `kind: "tool"` item keyed by `toolCallId`. `fallbackName`
  /// is used when the first event we observe is a partial/progress and
  /// we don't have the real tool name yet — replaced by later
  /// `execution_start` metadata.
  const upsertTool = (
    toolCallId: string,
    fallbackName?: string,
  ): ChatItem => {
    let existing = items.find(
      (i) => i.kind === "tool" && i.toolCallId === toolCallId,
    );
    if (!existing) {
      existing = {
        id: counter.next++,
        kind: "tool",
        toolCallId,
        toolName: fallbackName ?? `tool ${toolCallId.slice(0, 8)}`,
        status: "running",
        partialOutput: "",
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
      // --- User echo ---
      // The SDK emits `user.message` both as an echo of the live send
      // and during history replay on resume. Dedup against the local
      // optimistic item appended by `appendUserMessage` (matched by
      // text + missing messageId) so the bubble doesn't double on
      // live sends; otherwise append a new item so resumed sessions
      // show the user side of the transcript.
      case "user.message": {
        const content = pickString(data, ["content", "text", "message"]);
        if (!content) break;
        // Prefer the envelope-level event id (`payload.eventId`) as a
        // stable dedup key; fall back to data.messageId if some SDK
        // variant ever ships it. Either way, items with the same key
        // are coalesced.
        const eventId =
          payload.eventId ?? pickString(data, ["messageId"]) ?? undefined;
        if (eventId) {
          const byId = items.find(
            (i) => i.kind === "user" && i.messageId === eventId,
          );
          if (byId) break;
        }
        // Adopt the most recent local-only user item with matching text.
        const optimistic = [...items].reverse().find(
          (i) => i.kind === "user" && !i.messageId && i.text === content,
        );
        if (optimistic && optimistic.kind === "user") {
          optimistic.messageId = eventId;
          break;
        }
        items.push({
          id: counter.next++,
          kind: "user",
          text: content,
          ...(eventId ? { messageId: eventId } : {}),
        });
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
      // --- Tool calls ---
      // Tool items are keyed by `toolCallId`. Status transitions are
      // monotonic: once a tool reaches `success` / `error` we don't
      // regress to `running` even if a delayed `start` / `user_requested`
      // arrives. Result-content priority is `detailedContent ?? content`
      // (the SDK's `content` is LLM-truncated; `detailedContent` is the
      // full UI/timeline blob).
      case "tool.user_requested":
      case "tool.execution_start": {
        const toolCallId = pickString(data, ["toolCallId"]);
        const toolName = pickString(data, ["toolName"]);
        if (!toolCallId) break;
        const item = upsertTool(toolCallId, toolName || undefined);
        if (item.kind !== "tool") break;
        if (toolName) item.toolName = toolName;
        const args = (data as Record<string, unknown>).arguments;
        if (args && typeof args === "object") {
          item.args = args as Record<string, unknown>;
        }
        const mcpServer = pickString(data, ["mcpServerName"]);
        if (mcpServer) item.mcpServerName = mcpServer;
        const mcpTool = pickString(data, ["mcpToolName"]);
        if (mcpTool) item.mcpToolName = mcpTool;
        if (payload.agentId) item.agentId = payload.agentId;
        // Never overwrite a terminal status — late `start` events can
        // arrive after `complete` in pathological ordering.
        if (item.status === "running") item.status = "running";
        break;
      }
      case "tool.execution_partial_result": {
        const toolCallId = pickString(data, ["toolCallId"]);
        const partial = pickString(data, ["partialOutput"]);
        if (!toolCallId || !partial) break;
        const item = upsertTool(toolCallId);
        if (item.kind !== "tool") break;
        item.partialOutput = clampOutput(item.partialOutput + partial);
        break;
      }
      case "tool.execution_progress": {
        const toolCallId = pickString(data, ["toolCallId"]);
        const progress = pickString(data, ["progressMessage"]);
        if (!toolCallId) break;
        const item = upsertTool(toolCallId);
        if (item.kind !== "tool") break;
        if (progress) item.progressMessage = progress;
        break;
      }
      case "tool.execution_complete": {
        const toolCallId = pickString(data, ["toolCallId"]);
        if (!toolCallId) break;
        const item = upsertTool(toolCallId);
        if (item.kind !== "tool") break;
        const success = (data as { success?: unknown }).success === true;
        item.status = success ? "success" : "error";
        const result = (data as { result?: unknown }).result;
        if (result && typeof result === "object") {
          // detailedContent is the full UI blob; content may be truncated for the LLM.
          const detailed = pickString(result, ["detailedContent", "content"]);
          if (detailed) item.resultContent = clampOutput(detailed);
        }
        const err = (data as { error?: unknown }).error;
        if (err && typeof err === "object") {
          const message = pickString(err, ["message"]);
          if (message) item.errorMessage = message;
          const code = pickString(err, ["code"]);
          if (code) item.errorCode = code;
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
        const effort = pickString(data, ["reasoningEffort"]);
        const prevEffort = pickString(data, ["previousReasoningEffort"]);
        if (newModel) {
          next.model = newModel;
          if (effort) next.reasoningEffort = effort;
          const key = [prev, newModel, prevEffort, effort].join("\0");
          const modelDetail = prev ? `${prev} → ${newModel}` : newModel;
          const detail = effort
            ? prevEffort && prevEffort !== effort
              ? `${modelDetail} (${prevEffort} → ${effort} effort)`
              : `${modelDetail} (${effort} effort)`
            : modelDetail;
          if (next.lastModelChangeToastKey !== key) {
            toasts.push({
              severity: "info",
              summary: "Model changed",
              detail,
            });
            next.lastModelChangeToastKey = key;
          }
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
      // Adjacent tool-ish surfaces we deliberately don't render yet:
      // - permission.* — pending the permission-modal UX (will gate tool calls).
      // - elicitation.* / user_input.* — pending the elicitation UX.
      // - external_tool.* — client-side custom tools; surface once we register any.
      // - command.* — TUI slash-command lifecycle (not relevant in the desktop UI).
      // - subagent.* / hook.* / sampling.* / mcp_oauth.* — surfaced later.
      case "permission.requested":
      case "permission.completed":
      case "user_input.requested":
      case "user_input.completed":
      case "elicitation.requested":
      case "elicitation.completed":
      case "external_tool.requested":
      case "external_tool.completed":
      case "command.queued":
      case "command.execute":
      case "command.completed":
      case "subagent.started":
      case "subagent.completed":
      case "subagent.failed":
      case "subagent.selected":
      case "subagent.deselected":
      case "hook.start":
      case "hook.end":
      case "sampling.requested":
      case "sampling.completed":
      case "mcp.oauth_required":
      case "mcp.oauth_completed":
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
