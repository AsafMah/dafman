import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { registerBuiltinCommands, type ConfirmHandle } from '@/lib/registerBuiltinCommands';
import { useCommandRegistry } from '@/stores/shell/commandRegistry';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useSessionsListStore } from '@/stores/chat/sessionsListStore';
import { useClientStore } from '@/stores/app/clientStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
// Lightweight stub for the PrimeVue useConfirm() return value.
// Captures the options object so tests can assert what would be
// shown to the user and decide whether to "accept" or "reject"
// imperatively.
function makeConfirmStub() {
  const calls: Array<{
    message: unknown;
    header: unknown;
    accept?: () => void;
  }> = [];
  const handle: ConfirmHandle = {
    require(options) {
      calls.push({
        message: options.message,
        header: options.header,
        accept: options.accept as undefined | (() => void),
      });
    },
  };
  return { handle, calls };
}

describe('registerBuiltinCommands — Reset Layout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    setRpcBridge(null);
  });

  test('with 0 open sessions, runs immediately without prompting', () => {
    const stub = makeConfirmStub();
    registerBuiltinCommands({ confirm: stub.handle });
    const registry = useCommandRegistry();
    const reset = registry.visibleCommands.find((c) => c.id === 'layout.reset');
    expect(reset).toBeTruthy();
    reset?.run();
    expect(stub.calls).toHaveLength(0);
  });

  test('with 1 open session, runs without prompting (single tab close is low friction)', () => {
    const stub = makeConfirmStub();
    const sessionsStore = useSessionsStore();
    // Push a fake record so sessions.length === 1.
    sessionsStore.sessions.push({
      id: 's1',
      accent: '#000',
      events: [],
      model: null,
      reasoningEffort: null,
      title: null,
      mode: null,
      approveAll: true,
      reasoningVisibilityOverride: 'default',
      workingDirectory: null,
      defaultSendMode: 'steer',
    } as never);
    registerBuiltinCommands({ confirm: stub.handle });
    const registry = useCommandRegistry();
    registry.commands.get('layout.reset')?.run();
    expect(stub.calls).toHaveLength(0);
  });

  test('with 2+ open sessions, asks for confirmation before resetting', () => {
    const stub = makeConfirmStub();
    const sessionsStore = useSessionsStore();
    sessionsStore.sessions.push(
      { id: 's1', events: [] } as never,
      { id: 's2', events: [] } as never,
      { id: 's3', events: [] } as never,
    );
    registerBuiltinCommands({ confirm: stub.handle });
    useCommandRegistry().commands.get('layout.reset')?.run();
    expect(stub.calls).toHaveLength(1);
    expect(String(stub.calls[0]?.message)).toContain('3 open sessions');
    expect(stub.calls[0]?.header).toBe('Reset Layout');
    // The action should fire when accept is invoked. We can't easily
    // assert the side effect (would need a full fake DockviewApi)
    // but we can at least verify accept is supplied.
    expect(stub.calls[0]?.accept).toBeTypeOf('function');
  });

  test("New Session command is hidden when client isn't ready (when() = false)", () => {
    const stub = makeConfirmStub();
    const clientStore = useClientStore();
    expect(clientStore.ready).toBe(false);
    registerBuiltinCommands({ confirm: stub.handle });
    const visible = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(visible).not.toContain('session.new');
  });

  test('New Session command becomes visible when clientStore.ready = true', () => {
    const stub = makeConfirmStub();
    const clientStore = useClientStore();
    clientStore.ready = true;
    registerBuiltinCommands({ confirm: stub.handle });
    const visible = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(visible).toContain('session.new');
  });

  test('session.jump entry absent when session has no open panel in any inner group', () => {
    const stub = makeConfirmStub();
    const sessionsStore = useSessionsStore();
    sessionsStore.sessions.push({
      id: 'not-in-dock',
      accent: '#000',
      events: [],
      model: null,
      reasoningEffort: null,
      title: 'Some title',
      mode: null,
      approveAll: true,
      reasoningVisibilityOverride: 'default',
      workingDirectory: null,
      defaultSendMode: 'steer',
    } as never);
    // groupsStore.innerApis is empty → getPanel finds nothing → no jump entry.
    void useLayoutStore();
    registerBuiltinCommands({ confirm: stub.handle });
    const visible = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(visible).not.toContain('session.jump.not-in-dock');
    // Old session.switch command is removed entirely.
    expect(visible).not.toContain('session.switch');
  });

  test('/model palette command is local and does not send a chat message', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    setRpcBridge({
      async request(name, args) {
        calls.push({ name, args });
        return 'ok';
      },
      onSessionEvent: () => () => {},
      onPendingRequest: () => () => {},
      onLogEvent: () => () => {},
      onAuditEvent: () => () => {},
    } as RpcBridge);
    const sessionsStore = useSessionsStore();
    sessionsStore.sessions.push({
      id: 's1',
      accent: '#000',
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      title: null,
      mode: null,
      approveAll: true,
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
      _toastedOauthRequests: new Set(),
      _toastedNeedsAuth: new Set(),
      _artifactToolCallIds: new Set(),
    });
    const layoutStore = useLayoutStore();
    layoutStore.activeSessionId = 's1';
    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    await useCommandRegistry().commands.get('session.cmd.model')?.run();

    expect(calls.find((c) => c.name === 'sendMessage')).toBeUndefined();
  });
});

// ─── Helper: minimal session record shape for sessionsStore ──────────────────
function makeSessionRecord(id: string, title: string | null = null): never {
  return {
    id,
    accent: '#aabbcc',
    events: [],
    droppedEventCount: 0,
    model: null,
    reasoningEffort: null,
    title,
    mode: null,
    approveAll: true,
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
    _toastedOauthRequests: new Set(),
    _toastedNeedsAuth: new Set(),
    _artifactToolCallIds: new Set(),
  } as never;
}

// ─── Helper: minimal SessionMetadataSummary shape ────────────────────────────
function makeMetaSummary(
  sessionId: string,
  opts: { summary?: string; cwd?: string; mtime?: string } = {},
) {
  return {
    sessionId,
    summary: opts.summary,
    cwd: opts.cwd,
    startTime: '2024-01-01T00:00:00.000Z',
    modifiedTime: opts.mtime ?? '2024-01-01T00:00:00.000Z',
    isRemote: false,
  };
}

describe('registerBuiltinCommands — session.jump and session.resume', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setRpcBridge({
      async request() {
        // Return an empty list for listSessions so catalog refresh never throws.
        return [] as never;
      },
      onSessionEvent: () => () => {},
      onPendingRequest: () => () => {},
      onLogEvent: () => () => {},
      onAuditEvent: () => () => {},
    } as RpcBridge);
  });
  afterEach(() => {
    setRpcBridge(null);
  });

  test('session.jump entry appears when session has a panel in groupsStore.innerApis', () => {
    const sessionsStore = useSessionsStore();
    const groupsStore = useGroupsStore();

    sessionsStore.sessions.push(makeSessionRecord('sess-open', 'My Open Session'));

    // Simulate a mounted inner dockview that contains 'sess-open'.
    groupsStore.innerApis = {
      'group-1': {
        getPanel: (id: string) => (id === 'sess-open' ? ({} as never) : undefined),
      } as never,
    };

    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    const ids = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(ids).toContain('session.jump.sess-open');
    expect(ids).not.toContain('session.resume.sess-open');
  });

  test('session.resume entry appears for catalog-only (on-disk) session', () => {
    const sessionsListStore = useSessionsListStore();
    sessionsListStore.sessions.push(makeMetaSummary('sess-disk', { summary: 'Disk Session' }));

    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    const ids = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(ids).toContain('session.resume.sess-disk');
    expect(ids).not.toContain('session.jump.sess-disk');
  });

  test('open session is NOT surfaced as resume even if it appears in the catalog', () => {
    const sessionsStore = useSessionsStore();
    const sessionsListStore = useSessionsListStore();
    const groupsStore = useGroupsStore();

    sessionsStore.sessions.push(makeSessionRecord('sess-both', 'Open And On-Disk'));
    sessionsListStore.sessions.push(makeMetaSummary('sess-both', { summary: 'Open And On-Disk' }));
    groupsStore.innerApis = {
      'group-1': {
        getPanel: (id: string) => (id === 'sess-both' ? ({} as never) : undefined),
      } as never,
    };

    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    const ids = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(ids).toContain('session.jump.sess-both');
    expect(ids).not.toContain('session.resume.sess-both');
  });

  test('resume entries are capped at 20 most-recent closed sessions', () => {
    const sessionsListStore = useSessionsListStore();

    // Push 25 closed sessions (none are open).
    for (let i = 0; i < 25; i++) {
      sessionsListStore.sessions.push(
        makeMetaSummary(`sess-${i}`, {
          mtime: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        }),
      );
    }

    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    const resumeIds = useCommandRegistry()
      .visibleCommands.map((c) => c.id)
      .filter((id) => id.startsWith('session.resume.'));
    expect(resumeIds).toHaveLength(20);
  });

  test('session.browseAll entry appears when closed sessions exceed 20', () => {
    const sessionsListStore = useSessionsListStore();

    for (let i = 0; i < 21; i++) {
      sessionsListStore.sessions.push(makeMetaSummary(`sess-${i}`));
    }

    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    const ids = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(ids).toContain('session.browseAll');
  });

  test('session.browseAll entry absent when closed sessions are 20 or fewer', () => {
    const sessionsListStore = useSessionsListStore();

    for (let i = 0; i < 20; i++) {
      sessionsListStore.sessions.push(makeMetaSummary(`sess-${i}`));
    }

    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    const ids = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(ids).not.toContain('session.browseAll');
  });

  test('jump entries ordered before resume entries in the Sessions group', () => {
    const sessionsStore = useSessionsStore();
    const sessionsListStore = useSessionsListStore();
    const groupsStore = useGroupsStore();

    sessionsStore.sessions.push(makeSessionRecord('open-1', 'Open'));
    sessionsListStore.sessions.push(makeMetaSummary('closed-1', { summary: 'Closed' }));
    groupsStore.innerApis = {
      'group-1': {
        getPanel: (id: string) => (id === 'open-1' ? ({} as never) : undefined),
      } as never,
    };

    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    const sessionIds = useCommandRegistry()
      .visibleCommands.map((c) => c.id)
      .filter((id) => id.startsWith('session.jump.') || id.startsWith('session.resume.'));
    const jumpIdx = sessionIds.findIndex((id) => id === 'session.jump.open-1');
    const resumeIdx = sessionIds.findIndex((id) => id === 'session.resume.closed-1');
    expect(jumpIdx).toBeGreaterThanOrEqual(0);
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
    expect(jumpIdx).toBeLessThan(resumeIdx);
  });

  test('session.switch command no longer exists', () => {
    registerBuiltinCommands({ confirm: makeConfirmStub().handle });
    expect(useCommandRegistry().commands.has('session.switch')).toBe(false);
  });
});
