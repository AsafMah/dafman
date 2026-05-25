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

import type { SessionEventPayload } from '@/ipc/types';
import { calloutHandlers } from '@/lib/chatEvents/calloutHandlers';
import type { Handler, ReducerContext } from '@/lib/chatEvents/context';
import { lifecycleHandlers } from '@/lib/chatEvents/lifecycleHandlers';
import { messageHandlers } from '@/lib/chatEvents/messageHandlers';
import { notificationHandlers } from '@/lib/chatEvents/notificationHandlers';
import { reasoningHandlers } from '@/lib/chatEvents/reasoningHandlers';
import { sessionMetaHandlers } from '@/lib/chatEvents/sessionMetaHandlers';
import { toolHandlers } from '@/lib/chatEvents/toolHandlers';
import { turnHandlers } from '@/lib/chatEvents/turnHandlers';

export {
  clampOutput,
  pickNumber,
  pickString,
  TOOL_OUTPUT_CAP_BYTES,
} from '@/lib/chatEvents/helpers';

export type SystemSeverity = 'info' | 'warn' | 'error';

export type ToolStatus = 'running' | 'success' | 'error';

export type ChatItem =
  | {
      id: number;
      kind: 'user';
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
      attachments?: import('@/ipc/types').SendMessageAttachment[];
    }
  | {
      id: number;
      kind: 'assistant';
      text: string;
      messageId: string;
      /// Envelope id of the `assistant.message_start` event that
      /// created the item. Stable across deltas.
      eventId?: string;
    }
  | {
      id: number;
      kind: 'reasoning';
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
      kind: 'tool';
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
      kind: 'system';
      text: string;
      severity: SystemSeverity;
    }
  | {
      id: number;
      kind: 'pendingRequest';
      /// Bun-generated id used to correlate the response via
      /// `respondToRequest`. Card is removed from `items` when
      /// either `dafman.pending_response` (immediate user action)
      /// or the SDK's `*.completed` (out-of-band resolution)
      /// arrives.
      requestId: string;
      pendingKind: 'permission' | 'userInput' | 'elicitation' | 'exitPlanMode' | 'autoModeSwitch';
      /// Short human-readable summary used by accessible labels and
      /// as a fallback when the renderer wants a single string.
      message: string;
      /// Full typed payload for the per-kind layout.
      request:
        | import('@/ipc/types').PermissionRequestData
        | import('@/ipc/types').UserInputRequestData
        | import('@/ipc/types').ElicitationRequestData
        | import('@/ipc/types').ExitPlanModeRequestData
        | import('@/ipc/types').AutoModeSwitchRequestData;
    }
  | {
      id: number;
      kind: 'forkNotice';
      /// Anchor for dedup. The CLI emits the same fork session.info
      /// twice in pathological resume flows (live + persisted on next
      /// replay); we collapse them by eventId so users see one chip.
      eventId?: string;
      /// Whether this is the source session ("Forked into X") or the
      /// destination ("Forked from X").
      direction: 'into' | 'from';
      /// Session name as the CLI rendered it (truncated id or
      /// user-supplied). The renderer looks it up in the sessionsStore
      /// to resolve to a clickable id.
      referenceName: string;
    }
  | {
      /// 19c: Sub-agent block, nested inline in the parent chat. Holds
      /// its own `items[]` populated by events fired during the
      /// sub-agent's run (any event with envelope `agentId` matching).
      /// Created on `subagent.started`; status flips to completed /
      /// failed on the matching `subagent.completed` / `.failed` event.
      id: number;
      kind: 'subagent';
      /// SDK's sub-agent instance identifier from the envelope's
      /// `agentId` field. Routing key for nested events.
      agentId: string;
      /// Internal agent name from the `subagent.started.data.agentName`.
      agentName: string;
      /// Human-readable label from `agentDisplayName`.
      displayName: string;
      /// Sub-agent description from `agentDescription`.
      description: string;
      /// Lifecycle status. `running` from start to completion; flips to
      /// `completed` on `subagent.completed`, `failed` on
      /// `subagent.failed` (with `error` set).
      status: 'running' | 'completed' | 'failed';
      /// Started/completed timestamps from the event envelope. ISO 8601
      /// strings to match the rest of the wire shape.
      startedAt?: string;
      completedAt?: string;
      /// Error message when `status === "failed"`. Surfaced in the
      /// SubagentBlock header.
      error?: string;
      /// Nested items produced by THIS sub-agent during its run. The
      /// reducer routes any event with `envelope.agentId === this.agentId`
      /// AND a visual event type (assistant / reasoning / tool / system
      /// notification) into here via a nested ReducerContext over this
      /// items array.
      items: ChatItem[];
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
  /// Currently-selected custom agent for the session, or null when the
  /// default agent is in use. Driven by `subagent.selected` /
  /// `.deselected` events; reflected in the header chip + rail.
  currentAgent: import('@/ipc/types').AgentInfo | null;
};

/// A single SDK-blocking pending callback. `requestId` is generated
/// on the bun side (NOT by the SDK — the SDK passes a Promise) so the
/// renderer can correlate the response via `respondToRequest`. The
/// `request` payload is the typed per-kind shape mirrored from
/// `src/ipc/types.ts`.
export type PendingRequest =
  | {
      kind: 'permission';
      requestId: string;
      message: string;
      request: import('@/ipc/types').PermissionRequestData;
    }
  | {
      kind: 'userInput';
      requestId: string;
      message: string;
      request: import('@/ipc/types').UserInputRequestData;
    }
  | {
      kind: 'elicitation';
      requestId: string;
      message: string;
      request: import('@/ipc/types').ElicitationRequestData;
    }
  | {
      kind: 'exitPlanMode';
      requestId: string;
      message: string;
      request: import('@/ipc/types').ExitPlanModeRequestData;
    }
  | {
      kind: 'autoModeSwitch';
      requestId: string;
      message: string;
      request: import('@/ipc/types').AutoModeSwitchRequestData;
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
    currentAgent: null,
  };
}

/// Toast nudges the reducer wants the caller to surface (e.g. model
/// change). Kept as data so the pure reducer doesn't depend on the toast
/// store; the caller drains them.
export type ChatToast = {
  severity: 'success' | 'info' | 'warn' | 'error';
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
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(HANDLERS));

/// Visual event types that get routed to a sub-agent's nested
/// `items[]` when the envelope carries a matching `agentId`. All
/// other events stay at top-level (session lifecycle, ambient/usage
/// updates, pending requests, etc.) so a sub-agent's emission can't
/// corrupt global state — per the 19c rubber-duck #4.
function isVisualEventType(eventType: string): boolean {
  return (
    eventType.startsWith('assistant.') ||
    eventType.startsWith('user.') ||
    eventType.startsWith('tool.') ||
    eventType === 'system.notification'
  );
}

/// Per-buffer ReducerContext factory. Returns a context whose
/// `items` + `upsert*` closures all operate on the given items
/// array. The `setIdle` / `setError` flags are shared so a
/// nested sub-agent's lifecycle event can still bubble up the
/// session-level signal (currently those events don't reach
/// nested contexts because they're not "visual", but the shape
/// is uniform either way).
function makeReducerCtx(opts: {
  items: ChatItem[];
  ambient: ChatAmbient;
  toasts: ChatToast[];
  counter: IdCounter;
  isLive: boolean;
  setIdle: () => void;
  setError: () => void;
}): ReducerContext {
  const { items, ambient, toasts, counter, isLive, setIdle, setError } = opts;
  const assistantIdx = new Map<string, number>();
  const reasoningIdx = new Map<string, number>();
  const toolIdx = new Map<string, number>();

  for (let i = 0; i < items.length; i++) {
    const it = items[i];

    if (it.kind === 'assistant' && it.messageId) assistantIdx.set(it.messageId, i);
    else if (it.kind === 'reasoning' && it.reasoningId) reasoningIdx.set(it.reasoningId, i);
    else if (it.kind === 'tool' && it.toolCallId) toolIdx.set(it.toolCallId, i);
  }

  const upsertAssistant = (messageId: string, eventId?: string): ChatItem => {
    const cached = assistantIdx.get(messageId);
    let existing = cached !== undefined ? items[cached] : undefined;

    if (!existing) {
      existing = {
        id: counter.next++,
        kind: 'assistant',
        text: '',
        messageId,
        ...(eventId ? { eventId } : {}),
      };
      assistantIdx.set(messageId, items.length);
      items.push(existing);
    } else if (eventId && existing.kind === 'assistant' && !existing.eventId) {
      existing.eventId = eventId;
    }

    return existing;
  };
  const upsertReasoning = (reasoningId: string, eventId?: string): ChatItem => {
    const cached = reasoningIdx.get(reasoningId);
    let existing = cached !== undefined ? items[cached] : undefined;

    if (!existing) {
      existing = {
        id: counter.next++,
        kind: 'reasoning',
        text: '',
        reasoningId,
        ...(eventId ? { eventId } : {}),
      };
      reasoningIdx.set(reasoningId, items.length);
      items.push(existing);
    } else if (eventId && existing.kind === 'reasoning' && !existing.eventId) {
      existing.eventId = eventId;
    }

    return existing;
  };
  const upsertTool = (toolCallId: string, fallbackName?: string, eventId?: string): ChatItem => {
    const cached = toolIdx.get(toolCallId);
    let existing = cached !== undefined ? items[cached] : undefined;

    if (!existing) {
      existing = {
        id: counter.next++,
        kind: 'tool',
        toolCallId,
        toolName: fallbackName ?? `tool ${toolCallId.slice(0, 8)}`,
        status: 'running',
        partialOutput: '',
        ...(eventId ? { eventId } : {}),
      };
      toolIdx.set(toolCallId, items.length);
      items.push(existing);
    } else if (eventId && existing.kind === 'tool' && !existing.eventId) {
      existing.eventId = eventId;
    }

    return existing;
  };
  const pushSystem = (text: string, severity: SystemSeverity) => {
    items.push({ id: counter.next++, kind: 'system', text, severity });
  };

  return {
    items,
    ambient,
    toasts,
    counter,
    isLive,
    setIdle,
    setError,
    upsertAssistant,
    upsertReasoning,
    upsertTool,
    pushSystem,
  };
}

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
  const setIdle = () => {
    idle = true;
  };
  const setError = () => {
    error = true;
  };

  const topCtx = makeReducerCtx({
    items,
    ambient: next,
    toasts,
    counter,
    isLive,
    setIdle,
    setError,
  });

  /// 19c: per-running-subagent nested contexts. Populated lazily on
  /// `subagent.started`, drained on `subagent.completed/.failed`.
  /// Pre-built from any in-progress SubagentChatItems already in the
  /// items buffer so a fresh `processEvents` call (resume / replay)
  /// can continue routing into them.
  const nestedByAgentId = new Map<string, { item: ChatItem; ctx: ReducerContext }>();

  for (const it of items) {
    if (it.kind === 'subagent' && it.status === 'running') {
      nestedByAgentId.set(it.agentId, {
        item: it,
        ctx: makeReducerCtx({
          items: it.items,
          ambient: next,
          toasts,
          counter,
          isLive,
          setIdle,
          setError,
        }),
      });
    }
  }

  for (const payload of newPayloads) {
    const eventType = payload.eventType;
    const envelopeAgentId = (payload as { agentId?: string }).agentId;

    // 19c: sub-agent lifecycle is handled inline so we can mutate
    // the nestedByAgentId map. `subagent.selected/.deselected` stay
    // in sessionMetaHandlers (those are session-level picker events,
    // not per-turn delegation — see 19a).
    if (eventType === 'subagent.started') {
      if (typeof envelopeAgentId !== 'string' || envelopeAgentId.length === 0) {
        // No envelope agentId means we can't route subsequent events
        // to this sub-agent — drop the visual block but log so the
        // issue surfaces in diagnostics.

        console.warn('subagent.started with no envelope agentId; ignoring', payload);
        continue;
      }

      // If this agentId already has a SubagentChatItem (rare —
      // shouldn't fire twice in normal flow; defensive against
      // replay), skip the duplicate.
      if (nestedByAgentId.has(envelopeAgentId)) continue;

      const d = (payload.data ?? {}) as {
        agentName?: unknown;
        agentDisplayName?: unknown;
        agentDescription?: unknown;
      };
      const subItem: ChatItem = {
        id: counter.next++,
        kind: 'subagent',
        agentId: envelopeAgentId,
        agentName: typeof d.agentName === 'string' ? d.agentName : envelopeAgentId,
        displayName:
          typeof d.agentDisplayName === 'string'
            ? d.agentDisplayName
            : typeof d.agentName === 'string'
              ? d.agentName
              : envelopeAgentId,
        description: typeof d.agentDescription === 'string' ? d.agentDescription : '',
        status: 'running',
        ...(payload.timestamp ? { startedAt: payload.timestamp } : {}),
        items: [],
      };

      items.push(subItem);
      nestedByAgentId.set(envelopeAgentId, {
        item: subItem,
        ctx: makeReducerCtx({
          items: subItem.items,
          ambient: next,
          toasts,
          counter,
          isLive,
          setIdle,
          setError,
        }),
      });
      continue;
    }

    if (eventType === 'subagent.completed' || eventType === 'subagent.failed') {
      if (typeof envelopeAgentId !== 'string' || envelopeAgentId.length === 0) continue;

      // Find the SubagentChatItem by agentId. We rely on the
      // nestedByAgentId map (built from items[]) so this is O(1).
      const slot = nestedByAgentId.get(envelopeAgentId);

      if (slot && slot.item.kind === 'subagent') {
        slot.item.status = eventType === 'subagent.failed' ? 'failed' : 'completed';

        if (payload.timestamp) slot.item.completedAt = payload.timestamp;

        if (eventType === 'subagent.failed') {
          const errMsg = (payload.data as { error?: unknown }).error;

          if (typeof errMsg === 'string') slot.item.error = errMsg;
        }

        // Drop from the routing map — subsequent events with this
        // (now-stale) agentId won't get routed back into the
        // completed sub-agent.
        nestedByAgentId.delete(envelopeAgentId);
      }

      continue;
    }

    // Pick the ctx based on routing rules:
    // - visual event type AND envelope.agentId in active nested map
    //   → route to that sub-agent's nested context
    // - everything else → top-level context
    const nestedSlot =
      typeof envelopeAgentId === 'string' && envelopeAgentId.length > 0
        ? nestedByAgentId.get(envelopeAgentId)
        : undefined;
    const ctx = nestedSlot && isVisualEventType(eventType) ? nestedSlot.ctx : topCtx;
    const handler = HANDLERS[eventType];

    if (!handler) continue;

    const data = payload.data ?? {};

    handler(ctx, data, payload);
  }

  return { items, ambient: next, toasts, idle, error };
}

export function appendUserMessage(
  current: ChatItem[],
  text: string,
  counter: IdCounter,
  attachments?: import('@/ipc/types').SendMessageAttachment[],
): ChatItem[] {
  return [
    ...current,
    {
      id: counter.next++,
      kind: 'user',
      text,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    },
  ];
}

export function appendSystemMessage(
  current: ChatItem[],
  text: string,
  counter: IdCounter,
  severity: SystemSeverity = 'error',
): ChatItem[] {
  return [...current, { id: counter.next++, kind: 'system', text, severity }];
}
