// Focused reducer test for the 19a subagent.selected / .deselected
// handlers added to sessionMetaHandlers. Pins both the happy path
// (event → ambient.currentAgent populated) and the disambiguation
// rule (events carrying parentToolCallId are transient delegation
// during fleet/task runs and must NOT change the session-level
// selection).

import { describe, expect, test } from 'bun:test';
import { defaultAmbient, processEvents, type ChatAmbient } from '../../chatEvents';
import type { SessionEventPayload } from '../../../ipc/types';

const TAG: Partial<SessionEventPayload> = { sessionId: 's1' };

function make(eventType: string, data: Record<string, unknown>): SessionEventPayload {
  return { ...TAG, sessionId: 's1', eventType, data } as SessionEventPayload;
}

function runOne(
  event: SessionEventPayload,
  startAmbient: ChatAmbient = defaultAmbient(),
): ChatAmbient {
  const counter = { next: 1 };
  const { ambient } = processEvents([], startAmbient, [event], counter, {
    live: true,
  });
  return ambient;
}

describe('19a: subagent.selected / .deselected handlers', () => {
  test('subagent.selected populates ambient.currentAgent from full payload', () => {
    const ambient = runOne(
      make('subagent.selected', {
        agentName: 'reviewer',
        agentDisplayName: 'Code Reviewer',
        agentDescription: 'Reviews PRs',
        agentPath: 'C:/repo/.github/agents/reviewer.md',
      }),
    );
    expect(ambient.currentAgent).toEqual({
      name: 'reviewer',
      displayName: 'Code Reviewer',
      description: 'Reviews PRs',
      path: 'C:/repo/.github/agents/reviewer.md',
    });
  });

  test('subagent.selected defaults displayName + description when missing', () => {
    const ambient = runOne(
      make('subagent.selected', {
        agentName: 'minimal',
      }),
    );
    expect(ambient.currentAgent).toEqual({
      name: 'minimal',
      displayName: 'minimal',
      description: '',
    });
  });

  test('subagent.selected with parentToolCallId is transient — does NOT change currentAgent', () => {
    // Pre-populate to simulate a previously-selected session agent.
    const start = defaultAmbient();
    start.currentAgent = {
      name: 'reviewer',
      displayName: 'Code Reviewer',
      description: '',
    };
    // SDK fires a `subagent.selected` for a delegated sub-agent during
    // a fleet/task turn. It carries parentToolCallId — we must leave
    // the session-level selection alone (the running-subagent concept
    // is rendered separately in 19c).
    const ambient = runOne(
      make('subagent.selected', {
        agentName: 'delegated-worker',
        agentDisplayName: 'Worker',
        parentToolCallId: 'tool-call-42',
      }),
      start,
    );
    expect(ambient.currentAgent?.name).toBe('reviewer');
  });

  test('subagent.deselected clears ambient.currentAgent', () => {
    const start = defaultAmbient();
    start.currentAgent = {
      name: 'reviewer',
      displayName: 'Code Reviewer',
      description: '',
    };
    const ambient = runOne(make('subagent.deselected', {}), start);
    expect(ambient.currentAgent).toBeNull();
  });

  test('subagent.selected without agentName is a no-op (no shape drift)', () => {
    const ambient = runOne(
      make('subagent.selected', {
        // missing agentName
        agentDisplayName: 'anonymous',
      }),
    );
    expect(ambient.currentAgent).toBeNull();
  });
});
