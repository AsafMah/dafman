import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { setRpcBridge, type RpcBridge } from '../../ipc/invoke';
import type { CommandMap, CommandName, JobRecord } from '../../ipc/types';
import { useJobsStore } from '../jobsStore';
import { useSessionsStore, _resetSessionsStoreForTest, type SessionRecord } from '../sessionsStore';

function makeBridge(
  handlers: Partial<{
    [K in CommandName]: (args: CommandMap[K]['args']) => Promise<CommandMap[K]['result']>;
  }> = {},
): { bridge: RpcBridge; calls: Array<{ name: string; args: unknown }> } {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
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
      onAuditEvent: () => () => {},
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
    _toastedOauthRequests: new Set<string>(),
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
});
