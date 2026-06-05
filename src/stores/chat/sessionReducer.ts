// Side-effectful event reducer for SessionRecord.
//
// Extracted from sessionsStore.ts to reduce file size and isolate the
// event-processing logic. Not a pure reducer — triggers Pinia store
// side-effects (toasts, OS notifications) for MCP OAuth and turn-end
// events.

import type { SessionEventPayload } from '@/ipc/types';
import type { PendingRecordRequest, SessionRecord } from './sessionsStore';

/// A side-effect for the single effects consumer (`sessionEffects.ts`) to
/// run. The reducer stays pure — it mutates the `SessionRecord` (the state
/// transition) and *returns* these instead of touching the toast /
/// notification stores itself (#157).
export type SessionEffect =
  | { kind: 'toast'; severity: 'info' | 'success' | 'warn' | 'error'; title: string; body: string }
  | {
      kind: 'notify';
      notifyKind: 'turnEnd' | 'waitingForInput';
      sessionId: string;
      title: string;
      body: string;
      tag: string;
    };

/// What the reducer needs to know about the rest of the app without
/// importing its stores. Supplied by the caller per event.
export interface ReduceContext {
  /// The dockview panel the user is currently focused on, if any.
  activeSessionId: string | null;
}

/// Per-session live-events cap. Every push above this trims the
/// FRONT of `record.events` and bumps `record.droppedEventCount` by
/// the same amount. Bounded so a long autopilot session can't grow
/// the in-memory event log without limit (the cooked transcript in
/// the chat reducer is independent of this — once an event is
/// processed into `items`, the raw event isn't strictly needed).
/// 5000 covers ~250 normal-turn sessions worth of events at typical
/// ~20 events/turn — way more than any single window of recent
/// activity a user would scroll, while still capping RAM.
export const MAX_EVENTS_PER_SESSION = 5000;

/// Push an event onto the record's event log, trimming the front
/// when it overflows MAX_EVENTS_PER_SESSION. `droppedEventCount`
/// tracks how many events have been discarded from the front since
/// session start so consumers (`ChatWindow.flush`) can compute their
/// absolute progress instead of an index that would shift with each
/// trim. Centralised so every push site bounds memory automatically.
export function appendEvent(record: SessionRecord, payload: SessionEventPayload): void {
  record.events.push(payload);

  if (record.events.length > MAX_EVENTS_PER_SESSION) {
    const overflow = record.events.length - MAX_EVENTS_PER_SESSION;

    record.events.splice(0, overflow);
    record.droppedEventCount += overflow;
  }
}

const SHELL_TOOL_NAMES = new Set(['shell', 'bash', 'exec', 'execute']);
const WRITE_TOOL_NEEDLES = ['edit', 'write', 'apply_patch', 'create', 'str_replace'] as const;
const WRITE_PATH_KEYS = ['path', 'filePath', 'fileName', 'filename', 'targetFile'] as const;

/// Extract a `path`-shaped string from a tool's `arguments` payload.
/// Returns `null` if none of the well-known keys hold a non-empty
/// string.
function extractTouchedPath(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;

  const obj = args as Record<string, unknown>;

  for (const key of WRITE_PATH_KEYS) {
    const value = obj[key];

    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return null;
}

function trackSessionArtifact(record: SessionRecord, payload: SessionEventPayload): void {
  if (payload.eventType !== 'tool.user_requested' && payload.eventType !== 'tool.execution_start') {
    return;
  }

  const d = payload.data as {
    toolCallId?: unknown;
    toolName?: unknown;
    arguments?: unknown;
  };
  const toolCallId = typeof d.toolCallId === 'string' ? d.toolCallId : null;

  if (toolCallId && record._artifactToolCallIds.has(toolCallId)) return;

  if (toolCallId) record._artifactToolCallIds.add(toolCallId);

  const toolName = typeof d.toolName === 'string' ? d.toolName.toLowerCase() : '';

  if (SHELL_TOOL_NAMES.has(toolName)) {
    record.commandsRun += 1;

    return;
  }

  if (!WRITE_TOOL_NEEDLES.some((needle) => toolName.includes(needle))) {
    return;
  }

  const touchedPath = extractTouchedPath(d.arguments);

  if (!touchedPath) return;

  if (!record.touchedFiles.includes(touchedPath)) {
    record.touchedFiles.push(touchedPath);
  }
}

// ── Per-event-type handlers ──────────────────────────────────────
// Each handler is a small, focused function keyed by event type.
// The dispatch table at the bottom maps event types to handlers,
// replacing the original CC-60 if/else chain with O(1) lookup.

type EventHandler = (
  record: SessionRecord,
  payload: SessionEventPayload,
  ctx: ReduceContext,
  effects: SessionEffect[],
) => void;

// Keep model + reasoning effort in sync with backend-initiated
// changes (rate-limit auto-switch, /model commands, etc.).
function handleModelChange(record: SessionRecord, payload: SessionEventPayload): void {
  const data = payload.data as {
    newModel?: unknown;
    reasoningEffort?: unknown;
  };

  if (typeof data.newModel === 'string') {
    record.model = data.newModel;
  }

  if (typeof data.reasoningEffort === 'string') {
    record.reasoningEffort = data.reasoningEffort;
  }
}

// Backend may auto-switch the agent run mode (e.g. /plan command).
function handleModeChanged(record: SessionRecord, payload: SessionEventPayload): void {
  const data = payload.data as { newMode?: unknown };

  if (data.newMode !== 'interactive' && data.newMode !== 'plan' && data.newMode !== 'autopilot') {
    return;
  }

  record.mode = data.newMode;

  if (data.newMode === 'autopilot' && record.pendingRequests.length > 0) {
    const requestIds = record.pendingRequests.map((p) => p.requestId);

    record.pendingRequests.splice(0, record.pendingRequests.length);

    for (const requestId of requestIds) {
      appendEvent(record, {
        sessionId: record.id,
        eventType: 'dafman.pending_response',
        data: { requestId },
      });
    }
  }
}

// Track the SDK's auto-summarised title for the dockview tab.
function handleTitleChanged(record: SessionRecord, payload: SessionEventPayload): void {
  const title = (payload.data as { title?: unknown }).title;

  if (typeof title === 'string' && title.length > 0) {
    record.title = title;
  }
}

// Session-level custom agent selection for header chip + rail.
function handleSubagentSelected(record: SessionRecord, payload: SessionEventPayload): void {
  const d = (payload.data ?? {}) as {
    agentName?: unknown;
    agentDisplayName?: unknown;
    agentDescription?: unknown;
    agentPath?: unknown;
    parentToolCallId?: unknown;
  };

  if (
    typeof d.agentName === 'string' &&
    (typeof d.parentToolCallId !== 'string' || d.parentToolCallId.length === 0)
  ) {
    record.currentAgent = {
      name: d.agentName,
      displayName: typeof d.agentDisplayName === 'string' ? d.agentDisplayName : d.agentName,
      description: typeof d.agentDescription === 'string' ? d.agentDescription : '',
      ...(typeof d.agentPath === 'string' ? { path: d.agentPath } : {}),
    };
  }
}

function handleSubagentDeselected(record: SessionRecord): void {
  record.currentAgent = null;
}

// Bump the tasks refresh counter so the rail re-reads via `listTasks`.
function handleTasksRefresh(record: SessionRecord): void {
  record.tasksRefreshCounter += 1;
}

function handlePlanChanged(record: SessionRecord): void {
  record.planRefreshCounter += 1;
}

// MCP OAuth lifecycle toasts — nudge the user on `_required`,
// confirm on `_completed`, de-dup by requestId.
function handleOauthRequired(
  record: SessionRecord,
  payload: SessionEventPayload,
  _ctx: ReduceContext,
  effects: SessionEffect[],
): void {
  const d = (payload.data ?? {}) as {
    serverName?: unknown;
    requestId?: unknown;
  };

  if (typeof d.serverName !== 'string') return;

  const key = typeof d.requestId === 'string' ? `${record.id}:oauth:${d.requestId}` : null;

  if (key && record._toastedOauthRequests.has(key)) return;

  if (key) record._toastedOauthRequests.add(key);

  effects.push({
    kind: 'toast',
    severity: 'info',
    title: 'MCP server needs sign-in',
    body: `${d.serverName}: open the Library panel and click the auth link to complete OAuth.`,
  });
}

function handleOauthCompleted(
  record: SessionRecord,
  payload: SessionEventPayload,
  _ctx: ReduceContext,
  effects: SessionEffect[],
): void {
  const d = (payload.data ?? {}) as { requestId?: unknown };
  const key = typeof d.requestId === 'string' ? `${record.id}:oauth:${d.requestId}` : null;

  if (!key || !record._toastedOauthRequests.has(key)) return;

  record._toastedOauthRequests.delete(key);

  effects.push({
    kind: 'toast',
    severity: 'success',
    title: 'MCP signed in',
    body: 'Connection established',
  });
}

// #69: agent-driven OAuth nudge. We deliberately do NOT call
// `eventLog.registerInterest('mcp.oauth_required')` — doing so flips the
// SDK runtime from its browserless-fallback path to one that *blocks* the
// MCP connection awaiting `respondToMcpOAuth(requestId, OAuthClientProvider)`
// (see `buildMcpOAuthHandler` in @github/copilot/sdk). Without a full
// provider implementation that would hang the connection, so the
// `mcp.oauth_required`/`_completed` handlers above stay dormant. Instead we
// surface the runtime's own outcome: when the browserless fallback finds no
// cached token it flips the server to `needs-auth`, which arrives here as a
// `session.mcp_server_status_changed`. We toast a sign-in prompt (the user
// completes it via the Library Sign-in button, which drives `mcp.oauth.login`
// → system browser) and confirm once the server reconnects.
function handleMcpServerStatusChanged(
  record: SessionRecord,
  payload: SessionEventPayload,
  _ctx: ReduceContext,
  effects: SessionEffect[],
): void {
  const d = (payload.data ?? {}) as { serverName?: unknown; status?: unknown };

  if (typeof d.serverName !== 'string') return;

  const name = d.serverName;
  const status = typeof d.status === 'string' ? d.status : '';

  if (status === 'needs-auth') {
    if (record._toastedNeedsAuth.has(name)) return;

    record._toastedNeedsAuth.add(name);

    effects.push({
      kind: 'toast',
      severity: 'warn',
      title: 'MCP server needs sign-in',
      body: `${name} requires authorization. Open the Library panel and click Sign-in to authenticate.`,
    });

    return;
  }

  // Reaching a non-auth-gated state clears the de-dup guard so a later
  // re-auth re-prompts; a transition straight to `connected` after we
  // prompted confirms the recovery.
  if (record._toastedNeedsAuth.delete(name) && status === 'connected') {
    effects.push({
      kind: 'toast',
      severity: 'success',
      title: 'MCP signed in',
      body: `${name} connection established`,
    });
  }
}

// Extract workspace cwd from session.start / session.resume.
function handleSessionCwd(record: SessionRecord, payload: SessionEventPayload): void {
  const ctx = (payload.data as { context?: { cwd?: unknown } }).context;
  const cwd = ctx?.cwd;

  if (typeof cwd === 'string' && cwd.length > 0) {
    record.workingDirectory = cwd;
  }
}

// Mid-turn indicator: flips on at turn_start.
function handleTurnStart(record: SessionRecord): void {
  record.isThinking = true;
  record.sawTurnBoundary = true;
}

// Turn end: clear thinking, fire unseen-activity dot + OS notification
// when the session isn't the dock's active panel.
function handleTurnEnd(
  record: SessionRecord,
  _payload: SessionEventPayload,
  ctx: ReduceContext,
  effects: SessionEffect[],
): void {
  record.isThinking = false;

  if (ctx.activeSessionId === record.id) return;

  record.unseenTurns += 1;

  effects.push({
    kind: 'notify',
    notifyKind: 'turnEnd',
    sessionId: record.id,
    title: record.title ?? `Session ${record.id.slice(0, 8)}`,
    body: 'Turn complete.',
    tag: `${record.id}:turnEnd`,
  });
}

function handleThinkingOff(record: SessionRecord): void {
  record.isThinking = false;
}

// Stale-state cleanup for SDK-emitted `*.completed` events.
const COMPLETED_KIND_MAP: Record<string, PendingRecordRequest['kind']> = {
  'permission.completed': 'permission',
  'user_input.completed': 'userInput',
  'elicitation.completed': 'elicitation',
  'exit_plan_mode.completed': 'exitPlanMode',
  'auto_mode_switch.completed': 'autoModeSwitch',
};

function handlePendingCompleted(record: SessionRecord, payload: SessionEventPayload): void {
  const kind = COMPLETED_KIND_MAP[payload.eventType];

  if (!kind) return;

  const idx = record.pendingRequests.findIndex((p) => p.kind === kind);

  if (idx >= 0) record.pendingRequests.splice(idx, 1);
}

// ── Dispatch table ──────────────────────────────────────────────
// Maps event types to handler functions. Multiple event types can
// share the same handler (e.g. session.start/resume → handleSessionCwd).

const EVENT_HANDLERS: Record<string, EventHandler> = {
  'session.model_change': handleModelChange,
  'session.mode_changed': handleModeChanged,
  'session.title_changed': handleTitleChanged,
  'subagent.selected': handleSubagentSelected,
  'subagent.deselected': handleSubagentDeselected,
  'subagent.started': handleTasksRefresh,
  'subagent.completed': handleTasksRefresh,
  'subagent.failed': handleTasksRefresh,
  'session.background_tasks_changed': handleTasksRefresh,
  'session.plan_changed': handlePlanChanged,
  'mcp.oauth_required': handleOauthRequired,
  'mcp.oauth_completed': handleOauthCompleted,
  'session.mcp_server_status_changed': handleMcpServerStatusChanged,
  'session.start': handleSessionCwd,
  'session.resume': handleSessionCwd,
  'assistant.turn_start': handleTurnStart,
  'assistant.turn_end': handleTurnEnd,
  'session.idle': handleThinkingOff,
  'session.error': handleThinkingOff,
  // Turn terminators that aren't turn_end/idle: a `session.abort()` (stop
  // button / interrupt-send) emits `abort`, and the agent can signal
  // `session.task_complete`. Both end the turn, so clear the spinner.
  // Mapped to handleThinkingOff (not handleTurnEnd) to avoid firing OS
  // notifications + unseenTurns bumps for a turn the user themselves stopped.
  abort: handleThinkingOff,
  'session.task_complete': handleThinkingOff,
  // #20: synthetic terminator appended by the bun resume path when the
  // persisted history ends mid-turn (app killed while the agent was
  // thinking). Clears the stuck spinner. Deliberately NOT mapped to
  // handleTurnEnd — that fires OS notifications + unseenTurns bumps.
  'dafman.resume_settled': handleThinkingOff,
  'permission.completed': handlePendingCompleted,
  'user_input.completed': handlePendingCompleted,
  'elicitation.completed': handlePendingCompleted,
  'exit_plan_mode.completed': handlePendingCompleted,
  'auto_mode_switch.completed': handlePendingCompleted,
};

/// Main event reducer. Dispatches a single SessionEventPayload to
/// the appropriate SessionRecord fields. Called from the store's
/// `handleEvent` and from `drainPending` during session create/resume.
export function applyToRecord(
  record: SessionRecord,
  payload: SessionEventPayload,
  ctx: ReduceContext,
): SessionEffect[] {
  appendEvent(record, payload);

  if (import.meta.env.DEV) {
    console.debug('[session-event]', payload.eventType, payload.data);
  }

  trackSessionArtifact(record, payload);

  const effects: SessionEffect[] = [];

  EVENT_HANDLERS[payload.eventType]?.(record, payload, ctx, effects);

  return effects;
}
