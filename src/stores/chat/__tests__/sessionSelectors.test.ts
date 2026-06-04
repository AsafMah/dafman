// Resolution-order tests for the session display-title / status
// selectors. These pin the single-owner contract from issue #149: the
// open record wins, the durable catalog summary is the fallback, and
// the short GUID is the last resort.

import { describe, expect, test, beforeEach } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionsStore, type SessionRecord } from '@/stores/chat/sessionsStore';
import { useSessionsListStore } from '@/stores/chat/sessionsListStore';
import { useSessionSelectors } from '@/stores/chat/sessionSelectors';
import type { SessionMetadataSummary } from '@/ipc/types';

function makeRecord(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    accent: '#000',
    events: [],
    droppedEventCount: 0,
    model: null,
    reasoningEffort: null,
    title: null,
    mode: null,
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
    ...overrides,
  };
}

function catalogEntry(sessionId: string, summary?: string): SessionMetadataSummary {
  return { sessionId, startTime: '', modifiedTime: '', isRemote: false, summary };
}

describe('useSessionSelectors.displayTitle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('open record title wins over the catalog summary', () => {
    useSessionsStore().sessions.push(makeRecord('s1', { title: 'Live title' }));
    useSessionsListStore().sessions.push(catalogEntry('s1', 'Stale catalog summary'));

    expect(useSessionSelectors().displayTitle('s1')).toBe('Live title');
  });

  test('falls back to the catalog summary when the record has no title', () => {
    useSessionsStore().sessions.push(makeRecord('s1', { title: null }));
    useSessionsListStore().sessions.push(catalogEntry('s1', 'Catalog summary'));

    expect(useSessionSelectors().displayTitle('s1')).toBe('Catalog summary');
  });

  test('uses the catalog summary for a closed session (no open record)', () => {
    useSessionsListStore().sessions.push(catalogEntry('closed-1', 'Closed session'));

    expect(useSessionSelectors().displayTitle('closed-1')).toBe('Closed session');
  });

  test('falls back to the short GUID when neither title nor summary exists', () => {
    useSessionsStore().sessions.push(makeRecord('0123456789abcdef', { title: null }));

    // shortPanelTitle truncates a >12-char id to the first 8 chars + ellipsis.
    expect(useSessionSelectors().displayTitle('0123456789abcdef')).toBe('01234567…');
  });

  test('treats a whitespace-only record title as empty and falls through', () => {
    useSessionsStore().sessions.push(makeRecord('s1', { title: '   ' }));
    useSessionsListStore().sessions.push(catalogEntry('s1', 'Catalog summary'));

    expect(useSessionSelectors().displayTitle('s1')).toBe('Catalog summary');
  });
});

describe('useSessionSelectors.sessionStatus', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('reflects the open record liveness fields', () => {
    useSessionsStore().sessions.push(
      makeRecord('s1', { isThinking: true, unseenTurns: 3, isDeleted: false }),
    );

    expect(useSessionSelectors().sessionStatus('s1')).toEqual({
      isThinking: true,
      unseenTurns: 3,
      isDeleted: false,
    });
  });

  test('reports the deleted tombstone from the record', () => {
    useSessionsStore().sessions.push(makeRecord('s1', { isDeleted: true }));

    expect(useSessionSelectors().sessionStatus('s1').isDeleted).toBe(true);
  });

  test('defaults to inert status for an unknown session', () => {
    expect(useSessionSelectors().sessionStatus('missing')).toEqual({
      isThinking: false,
      unseenTurns: 0,
      isDeleted: false,
    });
  });
});
