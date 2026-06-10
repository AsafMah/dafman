import { describe, expect, test } from 'bun:test';
import { defaultAmbient, processEvents, type IdCounter } from '@/lib/chatEvents';
import { pendingRequestEntryFromPayload, type SessionPendingRequest } from '@/lib/sessionStatus';
import { applyPendingToRecord } from '@/stores/chat/sessionReducer';
import type { PendingRequestPayload, SessionEventPayload } from '@/ipc/types';
import type { SessionRecord } from '@/stores/chat/sessionsStore';

function makeRecord(id = 'sess-1'): SessionRecord {
  return {
    id,
    accent: 'accent-1',
    events: [],
    droppedEventCount: 0,
    model: null,
    reasoningEffort: null,
    title: null,
    mode: 'interactive',
    approveAll: false,
    reasoningVisibilityOverride: 'default',
    workingDirectory: null,
    defaultSendMode: 'steer',
    pendingRequests: [],
    unseenTurns: 0,
    isThinking: false,
    sawTurnBoundary: false,
    currentAgent: null,
    tasksRefreshCounter: 0,
    planRefreshCounter: 0,
    touchedFiles: [],
    commandsRun: 0,
    isDeleted: false,
    deletedAt: null,
    _toastedOauthRequests: new Set<string>(),
    _toastedNeedsAuth: new Set<string>(),
    _artifactToolCallIds: new Set<string>(),
  };
}

function pendingEvent(payload: PendingRequestPayload): SessionEventPayload {
  return {
    sessionId: payload.sessionId,
    eventType: 'dafman.pending_request',
    data: {
      sessionId: payload.sessionId,
      requestId: payload.requestId,
      kind: payload.kind,
      request: payload.request,
    },
  };
}

const PENDING_FIXTURES: PendingRequestPayload[] = [
  {
    sessionId: 'sess-1',
    requestId: 'perm-1',
    kind: 'permission',
    request: {
      kind: 'shell',
      toolCallId: 'tool-1',
      summary: 'shell: ls',
      raw: { command: 'ls' },
    },
  },
  {
    sessionId: 'sess-1',
    requestId: 'input-1',
    kind: 'userInput',
    request: {
      question: 'What name should I use?',
      allowFreeform: true,
    },
  },
  {
    sessionId: 'sess-1',
    requestId: 'elicit-1',
    kind: 'elicitation',
    request: {
      message: 'Open OAuth URL?',
      mode: 'url',
      url: 'https://github.com/login/oauth',
    },
  },
  {
    sessionId: 'sess-1',
    requestId: 'plan-1',
    kind: 'exitPlanMode',
    request: {
      summary: 'Review plan',
      planContent: '1. Do the thing',
      actions: ['approve', 'reject'],
      recommendedAction: 'approve',
    },
  },
  {
    sessionId: 'sess-1',
    requestId: 'auto-1',
    kind: 'autoModeSwitch',
    request: {
      errorCode: 'rate_limit_exceeded',
      retryAfterSeconds: 30,
    },
  },
];

describe('sessionStatus pending request convergence', () => {
  test.each(PENDING_FIXTURES)(
    '%s pending payload builds the same record and ambient entry',
    (payload) => {
      const record = makeRecord(payload.sessionId);
      const effects = applyPendingToRecord(record, payload);
      const counter: IdCounter = { next: 1 };
      const result = processEvents([], defaultAmbient(), [pendingEvent(payload)], counter);
      const expected = pendingRequestEntryFromPayload(payload);

      const recordPending: SessionPendingRequest[] = record.pendingRequests;
      const ambientPending: SessionPendingRequest[] = result.ambient.pendingRequests;

      expect(recordPending).toEqual([expected]);
      expect(ambientPending).toEqual([expected]);
      expect(ambientPending).toEqual(recordPending);
      expect(effects).toMatchObject([
        {
          kind: 'notify',
          notifyKind: 'waitingForInput',
          body: expected.message,
          tag: `${payload.sessionId}:pendingRequest:${payload.requestId}`,
        },
      ]);

      const cards = result.items.filter((item) => item.kind === 'pendingRequest');
      expect(cards).toHaveLength(1);
      const card = cards[0];
      expect(card?.kind).toBe('pendingRequest');

      if (card?.kind === 'pendingRequest') {
        expect(card.requestId).toBe(expected.requestId);
        expect(card.pendingKind).toBe(expected.kind);
        expect(card.message).toBe(expected.message);
        expect(card.request).toBe(expected.request);
      }
    },
  );

  test('duplicate requestIds stay idempotent in both pending queues', () => {
    const payload = PENDING_FIXTURES[0];
    const record = makeRecord(payload.sessionId);
    const firstEffects = applyPendingToRecord(record, payload);
    const duplicateEffects = applyPendingToRecord(record, payload);
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [pendingEvent(payload), pendingEvent(payload)],
      counter,
    );
    const expected = pendingRequestEntryFromPayload(payload);

    const recordPending: SessionPendingRequest[] = record.pendingRequests;
    const ambientPending: SessionPendingRequest[] = result.ambient.pendingRequests;

    expect(firstEffects).toHaveLength(1);
    expect(duplicateEffects).toEqual([]);
    expect(recordPending).toEqual([expected]);
    expect(ambientPending).toEqual(recordPending);
    expect(result.items.filter((item) => item.kind === 'pendingRequest')).toHaveLength(1);
  });
});
