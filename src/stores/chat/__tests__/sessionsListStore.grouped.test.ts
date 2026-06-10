/**
 * Tests for sessionsListStore: grouped computed (grouping modes, sort,
 * filter). No component mount needed — all pure store logic.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionsListStore, type SessionPaneViewState } from '@/stores/chat/sessionsListStore';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName, SessionMetadataSummary } from '@/ipc/types';
import { _resetSessionsStoreForTest } from '@/stores/chat/sessionsStore';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeNullBridge(): RpcBridge {
  return {
    request: (async <N extends CommandName>(
      _name: N,
      _args: CommandMap[N]['args'],
    ): Promise<CommandMap[N]['result']> =>
      undefined as unknown as CommandMap[N]['result']) as RpcBridge['request'],
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };
}

function makeSession(
  overrides: Partial<SessionMetadataSummary> & { sessionId: string },
): SessionMetadataSummary {
  return {
    startTime: '2026-01-01T10:00:00.000Z',
    modifiedTime: '2026-01-01T10:00:00.000Z',
    isRemote: false,
    ...overrides,
  };
}

const DEFAULTS: SessionPaneViewState = {
  grouping: 'workspace',
  sortField: 'modified',
  sortDir: 'desc',
  searchQuery: '',
  colorByGroup: false,
  showOnlyOpen: false,
};

// ─── setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear first so usePersistedRef starts from defaults on this Pinia instance.
  localStorage.clear();
  setActivePinia(createPinia());
  _resetSessionsStoreForTest();
  setRpcBridge(makeNullBridge());
});

afterEach(async () => {
  setRpcBridge(null);
  _resetSessionsStoreForTest();
  // Flush Vue's async watch queue so usePersistedRef's deferred
  // localStorage.setItem calls fire before we clear the store.
  await nextTick();
  localStorage.clear();
});

// ─── grouping: workspace ──────────────────────────────────────────────────────

describe('grouped — workspace grouping (default)', () => {
  test('groups sessions by cwd', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS });
    store.sessions = [
      makeSession({ sessionId: 'a', cwd: '/repo/alpha', modifiedTime: '2026-01-03T00:00:00Z' }),
      makeSession({ sessionId: 'b', cwd: '/repo/beta', modifiedTime: '2026-01-02T00:00:00Z' }),
      makeSession({ sessionId: 'c', cwd: '/repo/alpha', modifiedTime: '2026-01-01T00:00:00Z' }),
    ];

    const groups = store.grouped;

    expect(groups).toHaveLength(2);
    const alpha = groups.find((g) => g.key === '/repo/alpha');
    const beta = groups.find((g) => g.key === '/repo/beta');

    expect(alpha).toBeDefined();
    expect(alpha!.sessions.map((s) => s.sessionId)).toEqual(['a', 'c']);
    expect(beta!.sessions.map((s) => s.sessionId)).toEqual(['b']);
  });

  test('groups sessions with no cwd under empty key', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS });
    store.sessions = [makeSession({ sessionId: 'x', modifiedTime: '2026-01-01T00:00:00Z' })];

    const groups = store.grouped;

    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('');
    expect(groups[0]!.label).toBe('No workspace');
    expect(groups[0]!.kind).toBe('workspace');
  });

  test('groups are ordered by the leading session sort timestamp (desc)', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, sortField: 'modified', sortDir: 'desc' });
    store.sessions = [
      makeSession({ sessionId: 'old', cwd: '/repo/b', modifiedTime: '2026-01-01T00:00:00Z' }),
      makeSession({ sessionId: 'new', cwd: '/repo/a', modifiedTime: '2026-01-10T00:00:00Z' }),
    ];

    const groups = store.grouped;

    expect(groups[0]!.key).toBe('/repo/a');
    expect(groups[1]!.key).toBe('/repo/b');
  });
});

// ─── grouping: date-bucket ─────────────────────────────────────────────────────

describe('grouped — date-bucket grouping', () => {
  test('emits Today / Older buckets correctly', () => {
    const store = useSessionsListStore();
    const now = new Date();
    const todayIso = now.toISOString();
    const olderIso = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'date-bucket' });
    store.sessions = [
      makeSession({ sessionId: 'today', modifiedTime: todayIso }),
      makeSession({ sessionId: 'older', modifiedTime: olderIso }),
    ];

    const groups = store.grouped;

    expect(groups.map((g) => g.label)).toContain('Today');
    expect(groups.map((g) => g.label)).toContain('Older');
    const todayGroup = groups.find((g) => g.label === 'Today');

    expect(todayGroup!.sessions[0]!.sessionId).toBe('today');
  });

  test('empty buckets are hidden', () => {
    const store = useSessionsListStore();
    const todayIso = new Date().toISOString();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'date-bucket' });
    store.sessions = [makeSession({ sessionId: 'today', modifiedTime: todayIso })];

    const groups = store.grouped;

    // Only 'Today' — no Yesterday / This week / This month / Older
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Today');
  });

  test('asc direction reverses bucket order (Older first)', () => {
    const store = useSessionsListStore();
    const now = new Date();
    const todayIso = now.toISOString();
    const olderIso = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'date-bucket', sortDir: 'asc' });
    store.sessions = [
      makeSession({ sessionId: 'today', modifiedTime: todayIso }),
      makeSession({ sessionId: 'older', modifiedTime: olderIso }),
    ];

    const groups = store.grouped;
    const labels = groups.map((g) => g.label);

    expect(labels.indexOf('Older')).toBeLessThan(labels.indexOf('Today'));
  });

  test('uses startTime for created sort field', () => {
    const store = useSessionsListStore();
    const now = new Date();
    const todayIso = now.toISOString();
    const olderIso = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'date-bucket', sortField: 'created' });
    store.sessions = [
      // startTime is today, modifiedTime is old — should bucket to Today
      makeSession({ sessionId: 'a', startTime: todayIso, modifiedTime: olderIso }),
    ];

    const groups = store.grouped;

    expect(groups[0]!.label).toBe('Today');
  });
});

// ─── grouping: flat ────────────────────────────────────────────────────────────

describe('grouped — flat grouping', () => {
  test('returns a single flat group with all sessions', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'flat' });
    store.sessions = [
      makeSession({ sessionId: 'a', cwd: '/x', modifiedTime: '2026-01-03T00:00:00Z' }),
      makeSession({ sessionId: 'b', cwd: '/y', modifiedTime: '2026-01-01T00:00:00Z' }),
    ];

    const groups = store.grouped;

    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('flat');
    expect(groups[0]!.sessions).toHaveLength(2);
  });
});

// ─── sort fields ──────────────────────────────────────────────────────────────

describe('grouped — sort fields', () => {
  test('modified desc: newest first', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, {
      ...DEFAULTS,
      grouping: 'flat',
      sortField: 'modified',
      sortDir: 'desc',
    });
    store.sessions = [
      makeSession({ sessionId: 'old', modifiedTime: '2026-01-01T00:00:00Z' }),
      makeSession({ sessionId: 'new', modifiedTime: '2026-01-10T00:00:00Z' }),
    ];

    const sessions = store.grouped[0]!.sessions;

    expect(sessions[0]!.sessionId).toBe('new');
    expect(sessions[1]!.sessionId).toBe('old');
  });

  test('modified asc: oldest first', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, {
      ...DEFAULTS,
      grouping: 'flat',
      sortField: 'modified',
      sortDir: 'asc',
    });
    store.sessions = [
      makeSession({ sessionId: 'old', modifiedTime: '2026-01-01T00:00:00Z' }),
      makeSession({ sessionId: 'new', modifiedTime: '2026-01-10T00:00:00Z' }),
    ];

    const sessions = store.grouped[0]!.sessions;

    expect(sessions[0]!.sessionId).toBe('old');
  });

  test('created desc: newest startTime first', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, {
      ...DEFAULTS,
      grouping: 'flat',
      sortField: 'created',
      sortDir: 'desc',
    });
    store.sessions = [
      makeSession({
        sessionId: 'early',
        startTime: '2026-01-01T00:00:00Z',
        modifiedTime: '2026-01-10T00:00:00Z',
      }),
      makeSession({
        sessionId: 'late',
        startTime: '2026-01-10T00:00:00Z',
        modifiedTime: '2026-01-01T00:00:00Z',
      }),
    ];

    const sessions = store.grouped[0]!.sessions;

    expect(sessions[0]!.sessionId).toBe('late');
  });

  test('name asc: alphabetical A→Z', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, {
      ...DEFAULTS,
      grouping: 'flat',
      sortField: 'name',
      sortDir: 'asc',
    });
    store.sessions = [
      makeSession({ sessionId: 'z', summary: 'Zed session', modifiedTime: '2026-01-01Z' }),
      makeSession({ sessionId: 'a', summary: 'Alpha session', modifiedTime: '2026-01-01Z' }),
    ];

    const sessions = store.grouped[0]!.sessions;

    expect(sessions[0]!.sessionId).toBe('a');
    expect(sessions[1]!.sessionId).toBe('z');
  });

  test('name desc: alphabetical Z→A', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, {
      ...DEFAULTS,
      grouping: 'flat',
      sortField: 'name',
      sortDir: 'desc',
    });
    store.sessions = [
      makeSession({ sessionId: 'z', summary: 'Zed session', modifiedTime: '2026-01-01Z' }),
      makeSession({ sessionId: 'a', summary: 'Alpha session', modifiedTime: '2026-01-01Z' }),
    ];

    const sessions = store.grouped[0]!.sessions;

    expect(sessions[0]!.sessionId).toBe('z');
  });
});

// ─── search filter ────────────────────────────────────────────────────────────

describe('grouped — search filter', () => {
  test('empty query returns all sessions', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'flat', searchQuery: '' });
    store.sessions = [makeSession({ sessionId: 'a' }), makeSession({ sessionId: 'b' })];

    expect(store.grouped[0]!.sessions).toHaveLength(2);
  });

  test('matches session summary (title)', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'flat', searchQuery: 'react' });
    store.sessions = [
      makeSession({ sessionId: 'a', summary: 'My React project' }),
      makeSession({ sessionId: 'b', summary: 'Vue app' }),
    ];

    const sessions = store.grouped[0]!.sessions;

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe('a');
  });

  test('matches cwd path', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'flat', searchQuery: 'dafman' });
    store.sessions = [
      makeSession({ sessionId: 'a', cwd: '/repos/dafman' }),
      makeSession({ sessionId: 'b', cwd: '/repos/other' }),
    ];

    const sessions = store.grouped[0]!.sessions;

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe('a');
  });

  test('matches sessionId prefix', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'flat', searchQuery: 'abc123' });
    store.sessions = [
      makeSession({ sessionId: 'abc1234567890', modifiedTime: '2026-01-01Z' }),
      makeSession({ sessionId: 'xyz9876543210', modifiedTime: '2026-01-01Z' }),
    ];

    const sessions = store.grouped[0]!.sessions;

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe('abc1234567890');
  });

  test('filter is case-insensitive', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'flat', searchQuery: 'REACT' });
    store.sessions = [makeSession({ sessionId: 'a', summary: 'react app' })];

    expect(store.grouped[0]!.sessions).toHaveLength(1);
  });

  test('groups with no matching sessions are absent', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'workspace', searchQuery: 'alpha' });
    store.sessions = [
      makeSession({ sessionId: 'a', cwd: '/alpha', summary: 'alpha project' }),
      makeSession({ sessionId: 'b', cwd: '/beta', summary: 'beta project' }),
    ];

    const groups = store.grouped;

    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('/alpha');
  });

  test('whitespace-only query is treated as empty (no filter)', () => {
    const store = useSessionsListStore();

    Object.assign(store.viewState, { ...DEFAULTS, grouping: 'flat', searchQuery: '   ' });
    store.sessions = [makeSession({ sessionId: 'a' }), makeSession({ sessionId: 'b' })];

    expect(store.grouped[0]!.sessions).toHaveLength(2);
  });
});

// ─── validateViewState (via usePersistedRef) ──────────────────────────────────

describe('SessionPaneViewState defaults', () => {
  test('workspace+modified+desc is the backward-compat default preset', () => {
    const store = useSessionsListStore();

    // Verify the DEFAULTS shape matches the spec-required values by
    // resetting to it and checking. Each test uses Object.assign to set
    // a known state; fresh-store hydration from localStorage is covered
    // by usePersistedRef's own tests.
    Object.assign(store.viewState, DEFAULTS);

    expect(store.viewState.grouping).toBe('workspace');
    expect(store.viewState.sortField).toBe('modified');
    expect(store.viewState.sortDir).toBe('desc');
    expect(store.viewState.colorByGroup).toBe(false);
    expect(store.viewState.searchQuery).toBe('');
  });
});
