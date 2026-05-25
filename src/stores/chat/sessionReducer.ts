// Side-effectful event reducer for SessionRecord.
//
// Extracted from sessionsStore.ts to reduce file size and isolate the
// event-processing logic. Not a pure reducer — triggers Pinia store
// side-effects (toasts, OS notifications) for MCP OAuth and turn-end
// events.

import type { SessionEventPayload } from '@/ipc/types';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useNotificationsStore } from '@/stores/app/notificationsStore';
import { useToastStore } from '@/stores/app/toastStore';
import type { PendingRecordRequest, SessionRecord } from './sessionsStore';

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

/// True when the user can't see this session right now — either
/// because their dockview focus is elsewhere, OR because the app
/// window is hidden / blurred. The OS-notification call sites
/// gate on this so notifications never fire for the session the
/// user is actively watching.
export function shouldFireForRecord(record: SessionRecord): boolean {
  const layoutStore = useLayoutStore();

  if (layoutStore.activeSessionId !== record.id) return true;

  if (typeof document !== 'undefined' && document.hidden) return true;

  if (typeof document !== 'undefined' && !document.hasFocus()) return true;

  return false;
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

  if (['shell', 'bash', 'exec', 'execute'].includes(toolName)) {
    record.commandsRun += 1;

    return;
  }

  if (
    !['edit', 'write', 'apply_patch', 'create', 'str_replace'].some((needle) =>
      toolName.includes(needle),
    )
  ) {
    return;
  }

  const args = d.arguments;

  if (!args || typeof args !== 'object') return;

  const obj = args as Record<string, unknown>;
  const path = obj.path ?? obj.filePath ?? obj.fileName ?? obj.filename ?? obj.targetFile;

  if (typeof path !== 'string' || !path.trim()) return;

  const trimmed = path.trim();

  if (!record.touchedFiles.includes(trimmed)) {
    record.touchedFiles.push(trimmed);
  }
}

// ── Per-event-type handlers ──────────────────────────────────────
// Each handler is a small, focused function keyed by event type.
// The dispatch table at the bottom maps event types to handlers,
// replacing the original CC-60 if/else chain with O(1) lookup.

type EventHandler = (record: SessionRecord, payload: SessionEventPayload) => void;

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
function handleOauthRequired(record: SessionRecord, payload: SessionEventPayload): void {
  const d = (payload.data ?? {}) as {
    serverName?: unknown;
    requestId?: unknown;
  };

  if (typeof d.serverName !== 'string') return;

  const toasts = useToastStore();
  const key = typeof d.requestId === 'string' ? `${record.id}:oauth:${d.requestId}` : null;

  if (!key || !record._toastedOauthRequests.has(key)) {
    if (key) record._toastedOauthRequests.add(key);

    toasts.info(
      'MCP server needs sign-in',
      `${d.serverName}: open the Library panel and click the auth link to complete OAuth.`,
    );
  }
}

function handleOauthCompleted(record: SessionRecord, payload: SessionEventPayload): void {
  const d = (payload.data ?? {}) as { requestId?: unknown };
  const key = typeof d.requestId === 'string' ? `${record.id}:oauth:${d.requestId}` : null;

  if (key && record._toastedOauthRequests.has(key)) {
    record._toastedOauthRequests.delete(key);
    useToastStore().success('MCP signed in', 'Connection established');
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
function handleTurnEnd(record: SessionRecord): void {
  record.isThinking = false;

  const layoutStore = useLayoutStore();

  if (layoutStore.activeSessionId === record.id) return;

  record.unseenTurns += 1;

  if (shouldFireForRecord(record)) {
    useNotificationsStore().notify({
      kind: 'turnEnd',
      title: record.title ?? `Session ${record.id.slice(0, 8)}`,
      body: 'Turn complete.',
      sessionId: record.id,
      tag: `${record.id}:turnEnd`,
    });
  }
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
  'session.start': handleSessionCwd,
  'session.resume': handleSessionCwd,
  'assistant.turn_start': handleTurnStart,
  'assistant.turn_end': handleTurnEnd,
  'session.idle': handleThinkingOff,
  'session.error': handleThinkingOff,
  'permission.completed': handlePendingCompleted,
  'user_input.completed': handlePendingCompleted,
  'elicitation.completed': handlePendingCompleted,
  'exit_plan_mode.completed': handlePendingCompleted,
  'auto_mode_switch.completed': handlePendingCompleted,
};

/// Main event reducer. Dispatches a single SessionEventPayload to
/// the appropriate SessionRecord fields. Called from the store's
/// `handleEvent` and from `drainPending` during session create/resume.
export function applyToRecord(record: SessionRecord, payload: SessionEventPayload): void {
  appendEvent(record, payload);

  if (import.meta.env.DEV) {
    console.debug('[session-event]', payload.eventType, payload.data);
  }

  trackSessionArtifact(record, payload);

  const handler = EVENT_HANDLERS[payload.eventType];

  if (handler) {
    handler(record, payload);
  }
}
