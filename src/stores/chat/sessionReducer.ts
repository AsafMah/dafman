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

/// Main event reducer. Dispatches a single SessionEventPayload to
/// the appropriate SessionRecord fields. Called from the store's
/// `handleEvent` and from `drainPending` during session create/resume.
export function applyToRecord(record: SessionRecord, payload: SessionEventPayload): void {
  appendEvent(record, payload);

  if (import.meta.env.DEV) {
    console.debug('[session-event]', payload.eventType, payload.data);
  }

  trackSessionArtifact(record, payload);

  // Keep model + reasoning effort in sync with backend-initiated changes
  // (rate-limit auto-switch, /model commands, etc.). The session.model_change
  // event ships both fields when applicable.
  if (payload.eventType === 'session.model_change') {
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
  if (payload.eventType === 'session.mode_changed') {
    const data = payload.data as { newMode?: unknown };

    if (data.newMode === 'interactive' || data.newMode === 'plan' || data.newMode === 'autopilot') {
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
  }

  // Track the SDK's auto-summarised title so the dockview tab can
  // show something meaningful instead of the raw uuid.
  if (payload.eventType === 'session.title_changed') {
    const title = (payload.data as { title?: unknown }).title;

    if (typeof title === 'string' && title.length > 0) {
      record.title = title;
    }
  }

  // 19a: track session-level custom agent selection so the header
  // chip + rail react without mounting the chat panel. Mirror the
  // chat reducer's `ambient.currentAgent` derivation: only treat
  // events that carry `agentName` as session-level selection
  // (transient delegation during fleet/task runs has a
  // `parentToolCallId`).
  if (payload.eventType === 'subagent.selected') {
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
  } else if (payload.eventType === 'subagent.deselected') {
    record.currentAgent = null;
  }

  // 19b.1: refetch the Tasks rail section on subagent.* + the
  // dedicated `session.background_tasks_changed` event the SDK
  // also emits. The wire payload for the started/completed events
  // doesn't carry the full TaskInfo shape, so we just bump the
  // counter and let the rail re-read via `listTasks`.
  if (
    payload.eventType === 'subagent.started' ||
    payload.eventType === 'subagent.completed' ||
    payload.eventType === 'subagent.failed' ||
    payload.eventType === 'session.background_tasks_changed'
  ) {
    record.tasksRefreshCounter += 1;
  }

  if (payload.eventType === 'session.plan_changed') {
    record.planRefreshCounter += 1;
  }

  // 22a: surface MCP OAuth lifecycle as user-visible toasts.
  // `mcp.oauth_required` fires when an MCP server needs sign-in
  // (typically right after the server is configured + connection
  // attempted). The SDK handles the actual flow via
  // `loginToMcpServer` + URL elicitation; here we just nudge the
  // user. `mcp.oauth_completed` fires on success and we
  // de-dup by requestId so we don't show duplicate completion
  // toasts on resume / replay.
  if (payload.eventType === 'mcp.oauth_required') {
    const d = (payload.data ?? {}) as {
      serverName?: unknown;
      requestId?: unknown;
    };

    if (typeof d.serverName === 'string') {
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
  } else if (payload.eventType === 'mcp.oauth_completed') {
    const d = (payload.data ?? {}) as { requestId?: unknown };
    const toasts = useToastStore();
    const key = typeof d.requestId === 'string' ? `${record.id}:oauth:${d.requestId}` : null;

    // Only fire if we toasted the matching `_required`; suppresses
    // stray `_completed` events on resume + the case where another
    // client (e.g. CLI) drove the OAuth flow.
    if (key && record._toastedOauthRequests.has(key)) {
      record._toastedOauthRequests.delete(key);
      toasts.success('MCP signed in', 'Connection established');
    }
  }

  // Both `session.start` (fresh create) and `session.resume` carry
  // `data.context.cwd` from the SDK's `WorkingDirectoryContext`.
  // Resumed sessions don't fire `session.start` again, so we have
  // to listen on both — otherwise the workspace would only appear
  // on freshly-created sessions and never on restored ones.
  if (payload.eventType === 'session.start' || payload.eventType === 'session.resume') {
    const ctx = (payload.data as { context?: { cwd?: unknown } }).context;
    const cwd = ctx?.cwd;

    if (typeof cwd === 'string' && cwd.length > 0) {
      record.workingDirectory = cwd;
    }
  }

  // Mid-turn indicator: flips on at turn_start, off at turn_end /
  // session.idle / session.error. The reducer (`ChatAmbient`)
  // tracks the same thing inside the chat panel; this mirror lives
  // on the record so the tab + sidebar dot react without the
  // panel being mounted.
  if (payload.eventType === 'assistant.turn_start') {
    record.isThinking = true;
    record.sawTurnBoundary = true;
  } else if (payload.eventType === 'assistant.turn_end') {
    record.isThinking = false;
    // Unseen-activity dot + optional OS notification when the
    // session ISN'T the dock's active panel. Cleared on focus by
    // the activeSessionId watcher below.
    const layoutStore = useLayoutStore();

    if (layoutStore.activeSessionId !== record.id) {
      record.unseenTurns += 1;

      if (shouldFireForRecord(record)) {
        const notifications = useNotificationsStore();

        notifications.notify({
          kind: 'turnEnd',
          title: record.title ?? `Session ${record.id.slice(0, 8)}`,
          body: 'Turn complete.',
          sessionId: record.id,
          // Same tag → multiple turn-ends collapse to one entry
          // in the OS tray.
          tag: `${record.id}:turnEnd`,
        });
      }
    }
  } else if (payload.eventType === 'session.idle' || payload.eventType === 'session.error') {
    record.isThinking = false;
  }

  // Stale-state cleanup for SDK-emitted `*.completed` events. The
  // dafman-internal `pendingRequest` channel is the canonical
  // source for adds (handled in `handlePendingRequest` below); we
  // remove on `_completed` as well in case the SDK resolves a
  // callback out-of-band (e.g. resume-with-continue-pending-work
  // re-emits). Best-effort match: remove the OLDEST entry of the
  // same kind since SDK events lack our generated requestId.
  let completedKind: PendingRecordRequest['kind'] | null = null;

  if (payload.eventType === 'permission.completed') completedKind = 'permission';
  else if (payload.eventType === 'user_input.completed') completedKind = 'userInput';
  else if (payload.eventType === 'elicitation.completed') completedKind = 'elicitation';
  else if (payload.eventType === 'exit_plan_mode.completed') completedKind = 'exitPlanMode';
  else if (payload.eventType === 'auto_mode_switch.completed') completedKind = 'autoModeSwitch';

  if (completedKind) {
    const idx = record.pendingRequests.findIndex((p) => p.kind === completedKind);

    if (idx >= 0) record.pendingRequests.splice(idx, 1);
  }
}
