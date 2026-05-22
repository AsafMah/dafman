// Reduces the per-session event stream into a flat list of renderable
// chat items. Lives outside `ChatWindow.vue` so it can be unit-tested
// without happy-dom or PrimeVue.
//
// **Architecture (post-split):** the reducer is a thin dispatcher
// here; per-family handlers live in `./chatEvents/*Handlers.ts`. To
// add a new event type, register a handler in the appropriate family
// (or create a new family file) — DON'T grow this file. The
// completeness test in `__tests__/chatEvents.test.ts` enforces that
// every dispatched event is either handled or in `IGNORED_EVENTS`.
//
// Shared narrowing helpers (`pickString`, `pickNumber`, `clampOutput`)
// and the `TOOL_OUTPUT_CAP_BYTES` constant are exported from here so
// the handler modules can reuse them without circular imports.

import type { SessionEventPayload } from "../ipc/types";
import { calloutHandlers } from "./chatEvents/calloutHandlers";
import type { Handler, ReducerContext } from "./chatEvents/context";
import { lifecycleHandlers } from "./chatEvents/lifecycleHandlers";
import { messageHandlers } from "./chatEvents/messageHandlers";
import { notificationHandlers } from "./chatEvents/notificationHandlers";
import { reasoningHandlers } from "./chatEvents/reasoningHandlers";
import { sessionMetaHandlers } from "./chatEvents/sessionMetaHandlers";
import { toolHandlers } from "./chatEvents/toolHandlers";
import { turnHandlers } from "./chatEvents/turnHandlers";

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
      /// SDK envelope event id — the anchor used for Truncate / Fork
      /// actions. Populated from the first `user.message` event the
      /// reducer sees for this item.
      eventId?: string;
      /// Attachments inserted INLINE in the composer. Rendered as pills
      /// in the transcript bubble by `UserMessageBody.vue`; pill order
      /// in the text matches array order (the composer's
      /// document-order extraction in `consumeComposerText`).
      attachments?: import("../ipc/types").SendMessageAttachment[];
    }
  | {
      id: number;
      kind: "assistant";
      text: string;
      messageId: string;
      /// Envelope id of the `assistant.message_start` event that
      /// created the item. Stable across deltas.
      eventId?: string;
    }
  | {
      id: number;
      kind: "reasoning";
      text: string;
      reasoningId: string;
      eventId?: string;
      /// True when the SDK supplied `reasoningOpaque` (encrypted
      /// reasoning content, GPT-5.x and similar models) without any
      /// readable `reasoningText`/`content`. We can't decrypt the
      /// payload, but we render a placeholder so the user sees that
      /// reasoning DID happen, just privately.
      opaque?: boolean;
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
      /// First-seen envelope id for this tool — usually the
      /// `tool.execution_start` event. Used as the anchor for
      /// truncate/fork actions invoked from the tool card.
      eventId?: string;
    }
  | {
      id: number;
      kind: "system";
      text: string;
      severity: SystemSeverity;
    }
  | {
      id: number;
      kind: "pendingRequest";
      /// Bun-generated id used to correlate the response via
      /// `respondToRequest`. Card is removed from `items` when
      /// either `dafman.pending_response` (immediate user action)
      /// or the SDK's `*.completed` (out-of-band resolution)
      /// arrives.
      requestId: string;
      pendingKind: "permission" | "userInput" | "elicitation";
      /// Short human-readable summary used by accessible labels and
      /// as a fallback when the renderer wants a single string.
      message: string;
      /// Full typed payload for the per-kind layout.
      request:
        | import("../ipc/types").PermissionRequestData
        | import("../ipc/types").UserInputRequestData
        | import("../ipc/types").ElicitationRequestData;
    }
  | {
      id: number;
      kind: "forkNotice";
      /// Anchor for dedup. The CLI emits the same fork session.info
      /// twice in pathological resume flows (live + persisted on next
      /// replay); we collapse them by eventId so users see one chip.
      eventId?: string;
      /// Whether this is the source session ("Forked into X") or the
      /// destination ("Forked from X").
      direction: "into" | "from";
      /// Session name as the CLI rendered it (truncated id or
      /// user-supplied). The renderer looks it up in the sessionsStore
      /// to resolve to a clickable id.
      referenceName: string;
    };

/// Maximum bytes of partial / result content we keep in memory and
/// render per tool call. Streaming shell tools can emit huge blobs;
/// without a cap the message list grinds to a halt.
export const TOOL_OUTPUT_CAP_BYTES = 64 * 1024;

export function clampOutput(text: string): string {
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
  /// Queue of SDK-blocking requests currently waiting on the user.
  /// New requests append; responses or matching `_completed` events
  /// remove by requestId. The render layer surfaces the head: banner
  /// in ChatWindow, modal opens for the first pending across all
  /// sessions (preferring the active one). Multiple in flight is
  /// rare in practice but the SDK is allowed to re-enter — we don't
  /// drop later requests just because we're showing an earlier one.
  pendingRequests: PendingRequest[];
};

/// A single SDK-blocking pending callback. `requestId` is generated
/// on the bun side (NOT by the SDK — the SDK passes a Promise) so the
/// renderer can correlate the response via `respondToRequest`. The
/// `request` payload is the typed per-kind shape mirrored from
/// `src/ipc/types.ts`.
export type PendingRequest =
  | {
      kind: "permission";
      requestId: string;
      message: string;
      request: import("../ipc/types").PermissionRequestData;
    }
  | {
      kind: "userInput";
      requestId: string;
      message: string;
      request: import("../ipc/types").UserInputRequestData;
    }
  | {
      kind: "elicitation";
      requestId: string;
      message: string;
      request: import("../ipc/types").ElicitationRequestData;
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
    pendingRequests: [],
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
export function pickString(data: unknown, keys: readonly string[]): string {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string") return v;
  }
  return "";
}

export function pickNumber(
  data: unknown,
  keys: readonly string[],
): number | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/// Combined dispatch table, built once at module init. Ordering of
/// the spread doesn't matter — there are no overlapping keys between
/// the family modules (verified by the `no duplicate handlers` test).
const HANDLERS: Record<string, Handler> = {
  ...messageHandlers,
  ...reasoningHandlers,
  ...toolHandlers,
  ...turnHandlers,
  ...sessionMetaHandlers,
  ...calloutHandlers,
  ...lifecycleHandlers,
  ...notificationHandlers,
};

/// Visible to tests for the "every event is handled or ignored"
/// completeness check.
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set(
  Object.keys(HANDLERS),
);

export function processEvents(
  current: ChatItem[],
  ambient: ChatAmbient,
  newPayloads: SessionEventPayload[],
  counter: IdCounter,
  opts: { live?: boolean } = {},
): ProcessResult {
  const items = current.slice();
  const next: ChatAmbient = { ...ambient };
  const toasts: ChatToast[] = [];
  let idle = false;
  let error = false;
  const isLive = opts.live ?? true;

  const upsertAssistant = (messageId: string, eventId?: string): ChatItem => {
    let existing = items.find(
      (i) => i.kind === "assistant" && i.messageId === messageId,
    );
    if (!existing) {
      existing = {
        id: counter.next++,
        kind: "assistant",
        text: "",
        messageId,
        ...(eventId ? { eventId } : {}),
      };
      items.push(existing);
    } else if (eventId && existing.kind === "assistant" && !existing.eventId) {
      existing.eventId = eventId;
    }
    return existing;
  };

  const upsertReasoning = (reasoningId: string, eventId?: string): ChatItem => {
    let existing = items.find(
      (i) => i.kind === "reasoning" && i.reasoningId === reasoningId,
    );
    if (!existing) {
      existing = {
        id: counter.next++,
        kind: "reasoning",
        text: "",
        reasoningId,
        ...(eventId ? { eventId } : {}),
      };
      items.push(existing);
    } else if (eventId && existing.kind === "reasoning" && !existing.eventId) {
      existing.eventId = eventId;
    }
    return existing;
  };

  const upsertTool = (
    toolCallId: string,
    fallbackName?: string,
    eventId?: string,
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
        ...(eventId ? { eventId } : {}),
      };
      items.push(existing);
    } else if (eventId && existing.kind === "tool" && !existing.eventId) {
      existing.eventId = eventId;
    }
    return existing;
  };

  const pushSystem = (text: string, severity: SystemSeverity) => {
    items.push({ id: counter.next++, kind: "system", text, severity });
  };

  const ctx: ReducerContext = {
    items,
    ambient: next,
    toasts,
    counter,
    isLive,
    setIdle() {
      idle = true;
    },
    setError() {
      error = true;
    },
    upsertAssistant,
    upsertReasoning,
    upsertTool,
    pushSystem,
  };

  for (const payload of newPayloads) {
    const handler = HANDLERS[payload.eventType];
    if (!handler) continue; // ignored or unknown — same effect either way
    const data = payload.data ?? {};
    handler(ctx, data, payload);
  }

  return { items, ambient: next, toasts, idle, error };
}

export function appendUserMessage(
  current: ChatItem[],
  text: string,
  counter: IdCounter,
  attachments?: import("../ipc/types").SendMessageAttachment[],
): ChatItem[] {
  return [
    ...current,
    {
      id: counter.next++,
      kind: "user",
      text,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    },
  ];
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
