import type {
  AgentInfo,
  AutoModeSwitchRequestData,
  ElicitationRequestData,
  ExitPlanModeRequestData,
  PermissionRequestData,
  SessionEventPayload,
  UserInputRequestData,
} from '@/ipc/types';

export type SessionPendingRequest =
  | {
      kind: 'permission';
      requestId: string;
      message: string;
      request: PermissionRequestData;
    }
  | {
      kind: 'userInput';
      requestId: string;
      message: string;
      request: UserInputRequestData;
    }
  | {
      kind: 'elicitation';
      requestId: string;
      message: string;
      request: ElicitationRequestData;
    }
  | {
      kind: 'exitPlanMode';
      requestId: string;
      message: string;
      request: ExitPlanModeRequestData;
    }
  | {
      kind: 'autoModeSwitch';
      requestId: string;
      message: string;
      request: AutoModeSwitchRequestData;
    };

export type SessionPendingRequestKind = SessionPendingRequest['kind'];

export type SessionPendingRequestPayload =
  | {
      requestId: string;
      kind: 'permission';
      request: PermissionRequestData;
    }
  | {
      requestId: string;
      kind: 'userInput';
      request: UserInputRequestData;
    }
  | {
      requestId: string;
      kind: 'elicitation';
      request: ElicitationRequestData;
    }
  | {
      requestId: string;
      kind: 'exitPlanMode';
      request: ExitPlanModeRequestData;
    }
  | {
      requestId: string;
      kind: 'autoModeSwitch';
      request: AutoModeSwitchRequestData;
    };

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown, key: string): string | null {
  const record = objectRecord(value);

  if (!record) return null;

  const field = record[key];

  return typeof field === 'string' ? field : null;
}

function firstString(value: unknown, keys: readonly string[]): string {
  const record = objectRecord(value);

  if (!record) return '';

  for (const key of keys) {
    const field = record[key];

    if (typeof field === 'string' && field.length > 0) return field;
  }

  return '';
}

function permissionMessage(request: PermissionRequestData): string {
  const summary = stringField(request, 'summary');

  if (summary !== null) return summary;

  return (
    firstString(request, ['description', 'message']) ||
    firstString(request, ['tool', 'toolName']) ||
    'Tool wants permission'
  );
}

function userInputMessage(request: UserInputRequestData): string {
  const question = stringField(request, 'question');

  if (question !== null) return question;

  return firstString(request, ['prompt', 'summary', 'message', 'description']) || 'Awaiting input';
}

function elicitationMessage(request: ElicitationRequestData): string {
  const message = stringField(request, 'message');

  if (message !== null) return message;

  return firstString(request, ['prompt', 'summary', 'description', 'url']) || 'Awaiting input';
}

function exitPlanMessage(request: ExitPlanModeRequestData): string {
  return firstString(request, ['summary']) || 'Plan ready for approval';
}

function autoModeSwitchMessage(request: AutoModeSwitchRequestData): string {
  const errorCode = stringField(request, 'errorCode');

  return errorCode ? `Switch to auto mode after rate limit: ${errorCode}` : 'Switch to auto mode?';
}

export function pendingRequestEntryFromPayload(
  payload: SessionPendingRequestPayload,
): SessionPendingRequest {
  switch (payload.kind) {
    case 'permission':
      return {
        kind: 'permission',
        requestId: payload.requestId,
        message: permissionMessage(payload.request),
        request: payload.request,
      };
    case 'userInput':
      return {
        kind: 'userInput',
        requestId: payload.requestId,
        message: userInputMessage(payload.request),
        request: payload.request,
      };
    case 'elicitation':
      return {
        kind: 'elicitation',
        requestId: payload.requestId,
        message: elicitationMessage(payload.request),
        request: payload.request,
      };
    case 'exitPlanMode':
      return {
        kind: 'exitPlanMode',
        requestId: payload.requestId,
        message: exitPlanMessage(payload.request),
        request: payload.request,
      };
    case 'autoModeSwitch':
      return {
        kind: 'autoModeSwitch',
        requestId: payload.requestId,
        message: autoModeSwitchMessage(payload.request),
        request: payload.request,
      };
  }
}

export function pendingRequestEntryFromData(data: unknown): SessionPendingRequest | null {
  const record = objectRecord(data);

  if (!record || typeof record.requestId !== 'string') return null;

  switch (record.kind) {
    case 'permission':
      return pendingRequestEntryFromPayload({
        kind: 'permission',
        requestId: record.requestId,
        request: record.request as PermissionRequestData,
      });
    case 'userInput':
      return pendingRequestEntryFromPayload({
        kind: 'userInput',
        requestId: record.requestId,
        request: record.request as UserInputRequestData,
      });
    case 'elicitation':
      return pendingRequestEntryFromPayload({
        kind: 'elicitation',
        requestId: record.requestId,
        request: record.request as ElicitationRequestData,
      });
    case 'exitPlanMode':
      return pendingRequestEntryFromPayload({
        kind: 'exitPlanMode',
        requestId: record.requestId,
        request: record.request as ExitPlanModeRequestData,
      });
    case 'autoModeSwitch':
      return pendingRequestEntryFromPayload({
        kind: 'autoModeSwitch',
        requestId: record.requestId,
        request: record.request as AutoModeSwitchRequestData,
      });
    default:
      return null;
  }
}

// ── Status delta ─────────────────────────────────────────────────
// Normalized description of what changed in the session status on a
// single SDK event. Pure value — no mutation, no Pinia.
//
// Consumers:
//   - sessionReducer.ts applies deltas to SessionRecord fields.
//   - chatEvents/ handlers apply deltas to ChatAmbient fields.
//   Both sides own their additional non-shared logic (e.g. record
//   keeps unseenTurns / OS notify; ambient keeps toast de-dup).

export type SessionStatusDelta =
  | { kind: 'titleChanged'; title: string }
  | {
      kind: 'modelChanged';
      newModel: string;
      reasoningEffort: string | null;
      previousModel: string | null;
      previousReasoningEffort: string | null;
    }
  | { kind: 'currentAgentChanged'; agent: AgentInfo | null }
  | { kind: 'turnStarted' }
  | { kind: 'turnEnded' }
  | { kind: 'thinkingCleared' };

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/// Derive a normalized status delta from a single SDK event payload.
/// Returns `null` for events that don't affect shared status fields.
///
/// Pure: no mutation, no Pinia, no side effects.
///
/// Both `sessionReducer.ts` (record projection) and `chatEvents/`
/// handlers (ambient projection) call this instead of duplicating
/// the field-extraction logic.
export function reduceSessionStatusEvent(payload: SessionEventPayload): SessionStatusDelta | null {
  const data = payload.data;

  switch (payload.eventType) {
    case 'session.title_changed': {
      const title = nonEmptyString(data.title);

      return title ? { kind: 'titleChanged', title } : null;
    }

    case 'session.model_change': {
      const newModel = nonEmptyString(data.newModel);

      if (!newModel) return null;

      return {
        kind: 'modelChanged',
        newModel,
        reasoningEffort: nonEmptyString(data.reasoningEffort),
        previousModel: nonEmptyString(data.previousModel),
        previousReasoningEffort: nonEmptyString(data.previousReasoningEffort),
      };
    }

    case 'subagent.selected': {
      const agentName = nonEmptyString(data.agentName);

      // No name → informational / transient event; leave currentAgent unchanged.
      if (!agentName) return null;

      // parentToolCallId present → transient sub-agent delegation during a fleet
      // turn, NOT a session-level agent switch. Ignore for header chip / rail.
      const parentToolCallId = nonEmptyString(data.parentToolCallId);

      if (parentToolCallId) return null;

      const agent: AgentInfo = {
        name: agentName,
        displayName: typeof data.agentDisplayName === 'string' ? data.agentDisplayName : agentName,
        description: typeof data.agentDescription === 'string' ? data.agentDescription : '',
        ...(typeof data.agentPath === 'string' ? { path: data.agentPath } : {}),
      };

      return { kind: 'currentAgentChanged', agent };
    }

    case 'subagent.deselected':
      return { kind: 'currentAgentChanged', agent: null };

    case 'assistant.turn_start':
      return { kind: 'turnStarted' };

    case 'assistant.turn_end':
      return { kind: 'turnEnded' };

    // Terminal events: clear thinking without emitting turn-end side effects.
    // Record side uses thinkingCleared for all five; ambient side only has
    // handlers for session.idle and session.error (the others remain record-only
    // to avoid adding new ambient state changes).
    case 'session.idle':
    case 'session.error':
    case 'abort':
    case 'session.task_complete':
    case 'dafman.resume_settled':
      return { kind: 'thinkingCleared' };

    default:
      return null;
  }
}
