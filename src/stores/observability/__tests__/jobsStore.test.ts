import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName, JobRecord } from '@/ipc/types';
import { useJobsStore } from '@/stores/observability/jobsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import type { DockviewApi, IDockviewPanel } from 'dockview-core';
import {
  useSessionsStore,
  _resetSessionsStoreForTest,
  type SessionRecord,
} from '@/stores/chat/sessionsStore';

function makeBridge(
  handlers: Partial<{
    [K in CommandName]: (args: CommandMap[K]['args']) => Promise<CommandMap[K]['result']>;
  }> = {},
): {
  bridge: RpcBridge;
  calls: Array<{ name: string; args: unknown }>;
  emitAudit: (entry: import('@/ipc/types').AuditEntry) => void;
} {
  const calls: Array<{ name: string; args: unknown }> = [];
  const auditListeners = new Set<(entry: import('@/ipc/types').AuditEntry) => void>();
  return {
    calls,
    emitAudit: (entry) => {
      for (const l of auditListeners) l(entry);
    },
    bridge: {
      request: (async <N extends CommandName>(name: N, args: CommandMap[N]['args']) => {
        calls.push({ name, args });
        const handler = handlers[name];
        if (handler) {
          return await (handler as (a: CommandMap[N]['args']) => Promise<CommandMap[N]['result']>)(
            args,
          );
        }
        return undefined as CommandMap[N]['result'];
      }) as RpcBridge['request'],
      onSessionEvent: () => () => {},
      onPendingRequest: () => () => {},
      onLogEvent: () => () => {},
      onAuditEvent: (listener) => {
        auditListeners.add(listener);
        return () => auditListeners.delete(listener);
      },
    },
  };
}

function sessionRecord(id = 's1'): SessionRecord {
  return reactive({
    id,
    accent: 'red',
    events: [],
    droppedEventCount: 0,
    model: 'auto',
    reasoningEffort: null,
    mode: 'interactive',
    approveAll: false,
    title: 'Test session',
    reasoningVisibilityOverride: 'default',
    workingDirectory: 'C:\\repo',
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
  }) as SessionRecord;
}

describe('jobsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
  });

  afterEach(() => {
    setRpcBridge(null);
    _resetSessionsStoreForTest();
  });

  test('refresh loads aggregate jobs and computes active count', async () => {
    const job: JobRecord = {
      id: 's1:t1',
      sessionId: 's1',
      source: 'sdk-task',
      kind: 'agent',
      status: 'running',
      title: 'Explore',
      description: 'Explore repo',
      canCancel: true,
      canRemove: false,
      canPromoteToBackground: false,
      canOpenSession: true,
    };
    const { bridge } = makeBridge({
      listJobs: async () => [job],
    });
    setRpcBridge(bridge);
    const store = useJobsStore();

    await store.refresh();

    expect(store.jobs).toEqual([job]);
    expect(store.activeCount).toBe(1);
    expect(store.hasActiveJobsForSession('s1')).toBe(true);
  });

  test('startAutopilot drives current session mode and send flow', async () => {
    const { bridge, calls } = makeBridge({
      listJobs: async () => [],
      setSessionMode: async () => 'autopilot',
      sendMessage: async () => 'msg-1',
    });
    setRpcBridge(bridge);
    const sessions = useSessionsStore();
    sessions.sessions.push(sessionRecord('s1'));
    const store = useJobsStore();

    await store.startAutopilot('s1', 'Do the work');

    expect(calls.some((c) => c.name === 'setSessionMode')).toBe(true);
    expect(calls.some((c) => c.name === 'sendMessage')).toBe(true);
    expect(store.jobs[0]).toMatchObject({
      sessionId: 's1',
      source: 'autopilot-session',
      status: 'running',
      prompt: 'Do the work',
    });
  });

  test('local autopilot job completes after the session thinking cycle ends', async () => {
    const { bridge } = makeBridge({
      listJobs: async () => [],
      setSessionMode: async () => 'autopilot',
      sendMessage: async () => 'msg-1',
    });
    setRpcBridge(bridge);
    const sessions = useSessionsStore();
    const record = sessionRecord('s1');
    sessions.sessions.push(record);
    const store = useJobsStore();

    await store.startAutopilot('s1', 'Do the work');
    record.isThinking = true;
    await nextTick();
    record.isThinking = false;
    await nextTick();

    expect(store.jobs[0]?.status).toBe('completed');
  });

  test('does not subscribe to the audit channel at store setup (lazy — guards boot smoke)', () => {
    let auditSubscriptions = 0;
    const { bridge } = makeBridge();
    // Count how many times the audit channel is wired.
    const origOnAudit = bridge.onAuditEvent!;
    bridge.onAuditEvent = (listener) => {
      auditSubscriptions += 1;
      return origOnAudit(listener);
    };
    setRpcBridge(bridge);

    // Merely instantiating the store must NOT touch the audit channel —
    // the boot smoke harness boots with a minimal RPC stub that omits
    // the on* channel methods, so an eager subscription crashes it.
    useJobsStore();

    expect(auditSubscriptions).toBe(0);
  });

  test('toolFailure audit entry surfaces SDK error context on the active autopilot job', async () => {
    const { bridge, emitAudit } = makeBridge({
      listJobs: async () => [],
      setSessionMode: async () => 'autopilot',
      sendMessage: async () => 'msg-1',
    });
    setRpcBridge(bridge);
    const sessions = useSessionsStore();
    sessions.sessions.push(sessionRecord('s1'));
    const store = useJobsStore();

    await store.startAutopilot('s1', 'Do the work');

    emitAudit({
      ts: new Date().toISOString(),
      kind: 'toolFailure',
      sessionId: 's1',
      toolName: 'str_replace_editor',
      error: 'old_str not found',
      argKeys: ['command', 'path'],
      argKeyCount: 2,
    });
    await nextTick();

    expect(store.jobs[0]?.latestResponse).toContain('str_replace_editor');
    expect(store.jobs[0]?.latestResponse).toContain('old_str not found');
  });

  test('toolFailure for another session does not touch unrelated jobs', async () => {
    const { bridge, emitAudit } = makeBridge({
      listJobs: async () => [],
      setSessionMode: async () => 'autopilot',
      sendMessage: async () => 'msg-1',
    });
    setRpcBridge(bridge);
    const sessions = useSessionsStore();
    sessions.sessions.push(sessionRecord('s1'));
    const store = useJobsStore();

    await store.startAutopilot('s1', 'Do the work');
    const before = store.jobs[0]?.latestResponse;

    emitAudit({
      ts: new Date().toISOString(),
      kind: 'toolFailure',
      sessionId: 'other-session',
      toolName: 'fetch',
      error: 'timeout',
    });
    await nextTick();

    expect(store.jobs[0]?.latestResponse).toBe(before);
  });

  test('openOwningSession parks a reveal intent for the spawning tool call', async () => {
    const { bridge } = makeBridge();
    setRpcBridge(bridge);
    const layout = useLayoutStore();
    const store = useJobsStore();

    store.openOwningSession('s1', 'tc-42');

    // Consuming returns the toolCallId so the ChatWindow can scroll to
    // the spawning card rather than the top of the transcript (#16).
    expect(layout.pendingReveal['s1']).toEqual({ toolCallId: 'tc-42' });
    expect(layout.consumeReveal('s1')).toEqual({ toolCallId: 'tc-42' });
    expect(layout.consumeReveal('s1')).toBeNull();
  });

  test('openOwningSession without a toolCallId parks a bottom-scroll intent', () => {
    const { bridge } = makeBridge();
    setRpcBridge(bridge);
    const layout = useLayoutStore();
    const store = useJobsStore();

    store.openOwningSession('s1');

    expect(layout.pendingReveal['s1']).toEqual({ toolCallId: undefined });
  });
});

// ─── #173 cross-group Go-to-session ──────────────────────────────────────────

describe('openOwningSession — cross-group navigation (#173)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
  });

  afterEach(() => {
    setRpcBridge(null);
    _resetSessionsStoreForTest();
  });

  test('reveals existing panel in a non-active group without adding a duplicate', () => {
    const { bridge } = makeBridge({ listJobs: async () => [] });
    setRpcBridge(bridge);

    const layout = useLayoutStore();
    const groups = useGroupsStore();
    const store = useJobsStore();

    // Fake inner api for group 'g2' that already owns session 's1'.
    const innerPanelSetActive = { called: false };
    const fakeInner = {
      getPanel(id: string) {
        if (id !== 's1') return undefined;
        return {
          id: 's1',
          api: {
            setActive() {
              innerPanelSetActive.called = true;
            },
          },
        } as unknown as IDockviewPanel;
      },
    } as unknown as DockviewApi;

    // Fake outer api: has a panel for group 'g2'.
    const outerPanelSetActive = { called: false };
    const fakeOuterPanel = {
      id: 'g2',
      api: {
        setActive() {
          outerPanelSetActive.called = true;
        },
      },
    };
    layout.setApi({
      getPanel(id: string) {
        return id === 'g2'
          ? (fakeOuterPanel as unknown as ReturnType<DockviewApi['getPanel']>)
          : undefined;
      },
      // minimal stubs so setApi doesn't blow up
      onDidActiveGroupChange: () => ({ dispose: () => {} }),
      onDidActivePanelChange: () => ({ dispose: () => {} }),
      onDidRemovePanel: () => ({ dispose: () => {} }),
      onDidAddPanel: () => ({ dispose: () => {} }),
      onDidAddGroup: () => ({ dispose: () => {} }),
      getEdgeGroup: () => undefined,
      activeGroup: null,
      groups: [],
      activePanel: null,
    } as unknown as DockviewApi);

    // Register the fake inner so groupsStore.innerApis['g2'] = fakeInner.
    groups.registerInnerApi('g2', fakeInner);

    // Track addPanel calls (should NOT be called — panel already exists).
    const addedPanels: string[] = [];
    const originalAdd = layout.addPanel.bind(layout);
    (layout as unknown as Record<string, unknown>).addPanel = (
      ...args: Parameters<typeof originalAdd>
    ) => {
      addedPanels.push(args[0] as string);
      return originalAdd(...args);
    };

    store.openOwningSession('s1', 'tc-1');

    // The outer group panel and the inner chat panel should both be activated.
    expect(outerPanelSetActive.called).toBe(true);
    expect(innerPanelSetActive.called).toBe(true);

    // addPanel must NOT have been called — the session already exists.
    expect(addedPanels).toHaveLength(0);

    // Reveal intent should still be parked.
    expect(layout.pendingReveal['s1']).toEqual({ toolCallId: 'tc-1' });
  });
});

// ─── #36 tool-failure survives turn-complete ─────────────────────────────────

describe('tool-failure latestResponse survives turn-complete transition (#36)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
  });

  afterEach(() => {
    setRpcBridge(null);
    _resetSessionsStoreForTest();
  });

  test('hadToolFailureThisTurn prevents turn-complete from overwriting failure message', async () => {
    const { bridge, emitAudit } = makeBridge({
      listJobs: async () => [],
      setSessionMode: async () => 'autopilot',
      sendMessage: async () => 'msg-1',
    });
    setRpcBridge(bridge);
    const sessions = useSessionsStore();
    const record = sessionRecord('s1');
    sessions.sessions.push(record);
    const store = useJobsStore();

    await store.startAutopilot('s1', 'Do the work');

    // Simulate turn start: isThinking → true (seenThinking set in watcher)
    record.isThinking = true;
    await nextTick();

    // Tool failure fires BEFORE the turn ends
    emitAudit({
      ts: new Date().toISOString(),
      kind: 'toolFailure',
      sessionId: 's1',
      toolName: 'bash',
      error: 'command not found',
    });
    await nextTick();

    // Turn ends
    record.isThinking = false;
    await nextTick();

    // The tool-failure message must survive — 'Turn complete' must NOT have
    // overwritten it.
    expect(store.jobs[0]?.latestResponse).toContain('bash');
    expect(store.jobs[0]?.latestResponse).toContain('command not found');
    expect(store.jobs[0]?.latestResponse).not.toBe('Turn complete');
  });

  test('Turn complete is written when no tool failure fired this turn', async () => {
    const { bridge } = makeBridge({
      listJobs: async () => [],
      setSessionMode: async () => 'autopilot',
      sendMessage: async () => 'msg-1',
    });
    setRpcBridge(bridge);
    const sessions = useSessionsStore();
    const record = sessionRecord('s1');
    sessions.sessions.push(record);
    const store = useJobsStore();

    await store.startAutopilot('s1', 'Do the work');
    record.isThinking = true;
    await nextTick();
    record.isThinking = false;
    await nextTick();

    expect(store.jobs[0]?.latestResponse).toBe('Turn complete');
  });
});

// ─── #174 panel-close preserves session with active jobs ─────────────────────

describe('panel-close does not delete session with active jobs (#174)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
  });

  afterEach(() => {
    setRpcBridge(null);
    _resetSessionsStoreForTest();
  });

  test('closing a panel while a background job is running skips closeSession', async () => {
    const disconnectCalls: string[] = [];
    const { bridge } = makeBridge({
      listJobs: async () => [],
      disconnectSession: async (args) => {
        const id = (args as { sessionId: string }).sessionId;
        disconnectCalls.push(id);
        return id;
      },
      setSessionMode: async () => 'autopilot',
      sendMessage: async () => 'msg-1',
    });
    setRpcBridge(bridge);
    const sessions = useSessionsStore();
    const record = sessionRecord('s1');
    sessions.sessions.push(record);
    const store = useJobsStore();

    // Start an autopilot job so 's1' has an active running job.
    await store.startAutopilot('s1', 'Run in background');

    // Confirm the job is active.
    expect(store.hasActiveJobsForSession('s1')).toBe(true);

    // Simulate what GroupPanel's onDidRemovePanel handler does:
    // if there are active jobs, it must NOT call closeSession.
    if (!store.hasActiveJobsForSession('s1')) {
      await sessions.closeSession('s1');
    }

    // disconnectSession must NOT have been called.
    expect(disconnectCalls).toHaveLength(0);

    // Session record must still be alive in the store.
    expect(sessions.sessions.some((s) => s.id === 's1')).toBe(true);
  });

  test('closing a panel with no active jobs calls closeSession normally', async () => {
    const disconnectCalls: string[] = [];
    const { bridge } = makeBridge({
      listJobs: async () => [],
      disconnectSession: async (args) => {
        const id = (args as { sessionId: string }).sessionId;
        disconnectCalls.push(id);
        return id;
      },
    });
    setRpcBridge(bridge);
    const sessions = useSessionsStore();
    const record = sessionRecord('s1');
    sessions.sessions.push(record);
    const store = useJobsStore();

    // No active jobs for 's1'.
    expect(store.hasActiveJobsForSession('s1')).toBe(false);

    // Simulate GroupPanel handler: no active jobs → closeSession is called.
    if (!store.hasActiveJobsForSession('s1')) {
      await sessions.closeSession('s1');
    }

    // disconnectSession should have been called.
    expect(disconnectCalls).toContain('s1');
    // Session removed from store.
    expect(sessions.sessions.some((s) => s.id === 's1')).toBe(false);
  });
});
