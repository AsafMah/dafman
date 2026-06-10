import type {
  AutoModeSwitchRequestData,
  ElicitationRequestData,
  ExitPlanModeRequestData,
  PermissionRequestData,
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
