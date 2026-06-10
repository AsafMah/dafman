// Convergence tests for slice-2 status-delta unification (#209).
//
// Each test feeds the same SDK event through both reduction paths and
// asserts that the shared status fields produce identical results:
//
//   Record path:  applyToRecord  (src/stores/chat/sessionReducer.ts)
//   Ambient path: processEvents  (src/lib/chatEvents.ts)
//
// Fields compared: title, model, reasoningEffort, currentAgent,
//   pendingRequests, isThinking↔turnActive, sawTurnBoundary.
//
// Intentional divergences are documented inline — these are cases where
// the ambient side either lacks a handler or applies an additional guard
// (e.g. the sawTurnBoundary guard on session.idle).

import { describe, expect, test } from 'bun:test';
import { defaultAmbient, processEvents, type IdCounter } from '@/lib/chatEvents';
import { reduceSessionStatusEvent, type SessionStatusDelta } from '@/lib/sessionStatus';
import { applyToRecord } from '@/stores/chat/sessionReducer';
import type { SessionEventPayload } from '@/ipc/types';
import type { SessionRecord } from '@/stores/chat/sessionsStore';
import type { ChatAmbient } from '@/lib/chatEvents';

// ── Helpers ───────────────────────────────────────────────────────

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

const NOOP_CTX = { activeSessionId: null as unknown as string };

function evt(eventType: string, data: Record<string, unknown> = {}): SessionEventPayload {
  return { sessionId: 'sess-1', eventType, data };
}

/// Apply events to a fresh record + ambient pair and return both projections.
function runBoth(events: SessionEventPayload[]): {
  record: SessionRecord;
  ambient: ChatAmbient;
} {
  const record = makeRecord();
  const counter: IdCounter = { next: 1 };
  let ambient = defaultAmbient();

  for (const e of events) {
    applyToRecord(record, e, NOOP_CTX);
    ({ ambient } = processEvents([], ambient, [e], counter, { live: true }));
  }

  return { record, ambient };
}

/// Normalized projection for comparison.
function project(r: SessionRecord, a: ChatAmbient) {
  return {
    title_record: r.title,
    title_ambient: a.title,
    model_record: r.model,
    model_ambient: a.model,
    reasoningEffort_record: r.reasoningEffort,
    reasoningEffort_ambient: a.reasoningEffort,
    currentAgent_record: r.currentAgent,
    currentAgent_ambient: a.currentAgent,
    isThinking_record: r.isThinking,
    turnActive_ambient: a.turnActive,
    sawTurnBoundary_record: r.sawTurnBoundary,
    sawTurnBoundary_ambient: a.sawTurnBoundary,
  };
}

// ── reduceSessionStatusEvent unit tests ──────────────────────────

describe('reduceSessionStatusEvent — unit', () => {
  test('session.title_changed → titleChanged delta', () => {
    const delta = reduceSessionStatusEvent(evt('session.title_changed', { title: 'Hello World' }));

    expect(delta).toEqual({ kind: 'titleChanged', title: 'Hello World' });
  });

  test('session.title_changed with empty string → null (no-op)', () => {
    expect(reduceSessionStatusEvent(evt('session.title_changed', { title: '' }))).toBeNull();
  });

  test('session.model_change → modelChanged delta', () => {
    const delta = reduceSessionStatusEvent(
      evt('session.model_change', {
        newModel: 'gpt-4o',
        previousModel: 'gpt-4',
        reasoningEffort: 'high',
        previousReasoningEffort: 'medium',
      }),
    );

    expect(delta).toEqual<SessionStatusDelta>({
      kind: 'modelChanged',
      newModel: 'gpt-4o',
      reasoningEffort: 'high',
      previousModel: 'gpt-4',
      previousReasoningEffort: 'medium',
    });
  });

  test('session.model_change with no newModel → null (no-op)', () => {
    expect(reduceSessionStatusEvent(evt('session.model_change', {}))).toBeNull();
  });

  test('subagent.selected → currentAgentChanged delta', () => {
    const delta = reduceSessionStatusEvent(
      evt('subagent.selected', {
        agentName: 'code-reviewer',
        agentDisplayName: 'Code Reviewer',
        agentDescription: 'Reviews code',
        agentPath: '/path/to/agent',
      }),
    );

    expect(delta).toEqual<SessionStatusDelta>({
      kind: 'currentAgentChanged',
      agent: {
        name: 'code-reviewer',
        displayName: 'Code Reviewer',
        description: 'Reviews code',
        path: '/path/to/agent',
      },
    });
  });

  test('subagent.selected with parentToolCallId → null (transient, no-op)', () => {
    expect(
      reduceSessionStatusEvent(
        evt('subagent.selected', {
          agentName: 'some-agent',
          parentToolCallId: 'tool-call-123',
        }),
      ),
    ).toBeNull();
  });

  test('subagent.selected without agentName → null (no-op)', () => {
    expect(reduceSessionStatusEvent(evt('subagent.selected', {}))).toBeNull();
  });

  test('subagent.deselected → currentAgentChanged with agent=null', () => {
    expect(reduceSessionStatusEvent(evt('subagent.deselected'))).toEqual({
      kind: 'currentAgentChanged',
      agent: null,
    });
  });

  test('assistant.turn_start → turnStarted', () => {
    expect(reduceSessionStatusEvent(evt('assistant.turn_start'))).toEqual({ kind: 'turnStarted' });
  });

  test('assistant.turn_end → turnEnded', () => {
    expect(reduceSessionStatusEvent(evt('assistant.turn_end'))).toEqual({ kind: 'turnEnded' });
  });

  test.each([
    'session.idle',
    'session.error',
    'abort',
    'session.task_complete',
    'dafman.resume_settled',
  ])('%s → thinkingCleared', (eventType) => {
    expect(reduceSessionStatusEvent(evt(eventType))).toEqual({ kind: 'thinkingCleared' });
  });

  test('unrelated event type → null', () => {
    expect(reduceSessionStatusEvent(evt('tool.call'))).toBeNull();
    expect(reduceSessionStatusEvent(evt('assistant.message'))).toBeNull();
  });
});

// ── Convergence tests ─────────────────────────────────────────────

describe('status delta convergence — record and ambient produce identical results', () => {
  test('title changed with non-empty title', () => {
    const { record, ambient } = runBoth([
      evt('session.title_changed', { title: 'My session title' }),
    ]);

    expect(record.title).toBe('My session title');
    expect(ambient.title).toBe(record.title);
  });

  test('title changed with empty title is a no-op on both sides', () => {
    const { record, ambient } = runBoth([evt('session.title_changed', { title: '' })]);

    expect(record.title).toBeNull();
    expect(ambient.title).toBeNull();
  });

  test('model change sets model and reasoningEffort on both sides', () => {
    const { record, ambient } = runBoth([
      evt('session.model_change', {
        newModel: 'claude-3-opus',
        reasoningEffort: 'high',
        previousModel: 'claude-3-sonnet',
      }),
    ]);

    expect(record.model).toBe('claude-3-opus');
    expect(record.reasoningEffort).toBe('high');
    expect(ambient.model).toBe(record.model);
    expect(ambient.reasoningEffort).toBe(record.reasoningEffort);
  });

  test('model change without effort leaves reasoningEffort unchanged on both sides', () => {
    const { record, ambient } = runBoth([
      evt('session.model_change', { newModel: 'gpt-4o', previousModel: 'gpt-4' }),
    ]);

    expect(record.model).toBe('gpt-4o');
    expect(record.reasoningEffort).toBeNull();
    expect(ambient.model).toBe(record.model);
    expect(ambient.reasoningEffort).toBeNull();
  });

  test('subagent selected — full payload populates currentAgent on both sides', () => {
    const { record, ambient } = runBoth([
      evt('subagent.selected', {
        agentName: 'my-agent',
        agentDisplayName: 'My Agent',
        agentDescription: 'Does things',
      }),
    ]);

    const expected = {
      name: 'my-agent',
      displayName: 'My Agent',
      description: 'Does things',
    };

    expect(record.currentAgent).toEqual(expected);
    expect(ambient.currentAgent).toEqual(record.currentAgent);
  });

  test('subagent selected — defaults displayName/description when missing', () => {
    const { record, ambient } = runBoth([evt('subagent.selected', { agentName: 'bare-agent' })]);

    expect(record.currentAgent?.name).toBe('bare-agent');
    expect(record.currentAgent?.displayName).toBe('bare-agent');
    expect(record.currentAgent?.description).toBe('');
    expect(ambient.currentAgent).toEqual(record.currentAgent);
  });

  test('subagent selected with parentToolCallId is a no-op on both sides (transient)', () => {
    // First set a real agent, then send a transient delegation event.
    const { record, ambient } = runBoth([
      evt('subagent.selected', { agentName: 'real-agent' }),
      evt('subagent.selected', {
        agentName: 'transient',
        parentToolCallId: 'tool-call-xyz',
      }),
    ]);

    expect(record.currentAgent?.name).toBe('real-agent');
    expect(ambient.currentAgent?.name).toBe('real-agent');
  });

  test('subagent deselected clears currentAgent on both sides', () => {
    const { record, ambient } = runBoth([
      evt('subagent.selected', { agentName: 'my-agent' }),
      evt('subagent.deselected'),
    ]);

    expect(record.currentAgent).toBeNull();
    expect(ambient.currentAgent).toBeNull();
  });

  test('turn_start sets isThinking/turnActive + sawTurnBoundary on both sides', () => {
    const { record, ambient } = runBoth([evt('assistant.turn_start')]);

    expect(record.isThinking).toBe(true);
    expect(ambient.turnActive).toBe(true);
    expect(record.sawTurnBoundary).toBe(true);
    expect(ambient.sawTurnBoundary).toBe(true);
  });

  test('turn_start → turn_end clears isThinking/turnActive on both sides', () => {
    const { record, ambient } = runBoth([evt('assistant.turn_start'), evt('assistant.turn_end')]);

    expect(record.isThinking).toBe(false);
    expect(ambient.turnActive).toBe(false);
    expect(record.sawTurnBoundary).toBe(true);
    expect(ambient.sawTurnBoundary).toBe(true);
  });

  test('turn_start → session.idle clears isThinking/turnActive on both sides', () => {
    const { record, ambient } = runBoth([evt('assistant.turn_start'), evt('session.idle')]);

    expect(record.isThinking).toBe(false);
    expect(ambient.turnActive).toBe(false);
  });

  test('session.idle without prior turn_start: record clears isThinking; ambient respects sawTurnBoundary guard', () => {
    // When sawTurnBoundary is false (never seen turn_start), the ambient
    // preserves turnActive because it may be controlled by an external
    // heuristic. This is an intentional divergence: record always clears,
    // ambient uses the guard. Both start at false, so the observable
    // value still matches here.
    const { record, ambient } = runBoth([evt('session.idle')]);

    expect(record.isThinking).toBe(false);
    expect(ambient.turnActive).toBe(false); // starts false, stays false
    expect(ambient.sawTurnBoundary).toBe(false);
  });

  test('turn_start → abort: record clears isThinking; ambient stays active (no abort handler)', () => {
    // `abort` is record-only — no ambient handler. This is an intentional
    // divergence documented by the spec: ambient only clears for session.idle
    // and session.error. Record still uses the shared thinkingCleared delta.
    const { record, ambient } = runBoth([evt('assistant.turn_start'), evt('abort')]);

    expect(record.isThinking).toBe(false);
    expect(ambient.turnActive).toBe(true); // intentional — no ambient handler for abort
  });

  test('turn_start → session.error clears isThinking/turnActive on both sides', () => {
    const { record, ambient } = runBoth([
      evt('assistant.turn_start'),
      evt('session.error', { message: 'something broke' }),
    ]);

    expect(record.isThinking).toBe(false);
    expect(ambient.turnActive).toBe(false);
  });

  test('replayed turn_end clears isThinking but does not increment unseenTurns', () => {
    const record = makeRecord();
    const counter: IdCounter = { next: 1 };
    const ambient0 = defaultAmbient();

    // Prime with a replay turn_start then a replay turn_end
    const turnStart: SessionEventPayload = { ...evt('assistant.turn_start'), replay: true };
    const turnEnd: SessionEventPayload = { ...evt('assistant.turn_end'), replay: true };

    applyToRecord(record, turnStart, NOOP_CTX);
    applyToRecord(record, turnEnd, NOOP_CTX);

    const { ambient } = processEvents([], ambient0, [turnStart, turnEnd], counter, {
      live: false,
    });

    expect(record.isThinking).toBe(false);
    expect(ambient.turnActive).toBe(false);
    expect(record.unseenTurns).toBe(0); // replay must not bump unseen counter
    expect(record.sawTurnBoundary).toBe(true);
  });

  test('full status sequence — title, model, agent, turn, deselect', () => {
    const { record, ambient } = runBoth([
      evt('session.title_changed', { title: 'Refactor auth' }),
      evt('session.model_change', { newModel: 'gpt-4o', previousModel: 'gpt-4' }),
      evt('subagent.selected', { agentName: 'refactor', agentDisplayName: 'Refactor Agent' }),
      evt('assistant.turn_start'),
      evt('assistant.turn_end'),
      evt('subagent.deselected'),
    ]);

    const p = project(record, ambient);

    expect(p.title_record).toBe('Refactor auth');
    expect(p.title_ambient).toBe(p.title_record);

    expect(p.model_record).toBe('gpt-4o');
    expect(p.model_ambient).toBe(p.model_record);

    expect(p.currentAgent_record).toBeNull();
    expect(p.currentAgent_ambient).toBeNull();

    expect(p.isThinking_record).toBe(false);
    expect(p.turnActive_ambient).toBe(false);

    expect(p.sawTurnBoundary_record).toBe(true);
    expect(p.sawTurnBoundary_ambient).toBe(true);
  });
});
