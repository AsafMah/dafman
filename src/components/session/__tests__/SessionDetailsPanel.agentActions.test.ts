import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import PrimeVue from 'primevue/config';
import SessionDetailsPanel from '@/components/session/SessionDetailsPanel.vue';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { AgentInfo, CommandMap, CommandName } from '@/ipc/types';
import {
  _resetSessionsStoreForTest,
  useSessionsStore,
  type SessionRecord,
} from '@/stores/chat/sessionsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';

const agents = [
  { name: 'reviewer', displayName: 'Reviewer', description: 'Reviews changes' },
  { name: 'builder', displayName: 'Builder', description: 'Builds changes' },
  { name: 'writer', displayName: 'Writer', description: 'Writes docs' },
] satisfies AgentInfo[];

interface BridgeHandle {
  calls: Array<{ name: string; args: unknown }>;
  bridge: RpcBridge;
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function makeBridge(): BridgeHandle {
  const calls: BridgeHandle['calls'] = [];

  return {
    calls,
    bridge: {
      request: (async <N extends CommandName>(
        name: N,
        args: CommandMap[N]['args'],
      ): Promise<CommandMap[N]['result']> => {
        calls.push({ name, args });

        if (name === 'listAgents') return agents as CommandMap[N]['result'];
        if (name === 'selectAgent') return pending<CommandMap[N]['result']>();
        if (name === 'deselectAgent') return pending<CommandMap[N]['result']>();
        if (name === 'listTasks') return [] as CommandMap[N]['result'];
        if (name === 'listBuiltinTools') return [] as CommandMap[N]['result'];
        if (name === 'listSessionMcpServers') return [] as CommandMap[N]['result'];
        if (name === 'listSessionSkills') return [] as CommandMap[N]['result'];
        if (name === 'getSessionUsageMetrics') return {} as CommandMap[N]['result'];
        if (name === 'getAccountQuota') return {} as CommandMap[N]['result'];
        if (name === 'readSessionPlan') {
          return { exists: false, content: null, path: null } as CommandMap[N]['result'];
        }

        return undefined as CommandMap[N]['result'];
      }) as RpcBridge['request'],
      onSessionEvent: () => () => {},
      onPendingRequest: () => () => {},
      onLogEvent: () => () => {},
      onAuditEvent: () => () => {},
      onTerminalEvent: () => () => {},
      onCommandResultEvent: () => () => {},
    },
  };
}

function makeSession(currentAgent: AgentInfo | null): SessionRecord {
  return {
    id: 'session-1',
    accent: 'var(--p-primary-color)',
    events: [],
    droppedEventCount: 0,
    model: null,
    reasoningEffort: null,
    mode: null,
    approveAll: false,
    title: null,
    reasoningVisibilityOverride: 'default',
    workingDirectory: 'C:\\repo',
    defaultSendMode: 'steer',
    pendingRequests: [],
    unseenTurns: 0,
    isThinking: false,
    sawTurnBoundary: false,
    currentAgent,
    tasksRefreshCounter: 0,
    planRefreshCounter: 0,
    touchedFiles: [],
    commandsRun: 0,
    _toastedOauthRequests: new Set<string>(),
    _toastedNeedsAuth: new Set<string>(),
    _artifactToolCallIds: new Set<string>(),
  };
}

function mountPanel(currentAgent: AgentInfo | null): ReturnType<typeof render> & {
  calls: BridgeHandle['calls'];
} {
  const handle = makeBridge();
  setRpcBridge(handle.bridge);

  const sessionsStore = useSessionsStore();
  sessionsStore.sessions.push(makeSession(currentAgent));
  useLayoutStore().setActiveSessionId('session-1');

  const utils = render(SessionDetailsPanel, {
    global: {
      plugins: [PrimeVue],
      stubs: {
        MessageContent: { props: ['text'], template: '<div>{{ text }}</div>' },
      },
    },
  });

  return Object.assign(utils, { calls: handle.calls });
}

function selectCalls(calls: BridgeHandle['calls']): BridgeHandle['calls'] {
  return calls.filter((call) => call.name === 'selectAgent');
}

describe('SessionDetailsPanel agent action busy state (#127)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
    localStorage.setItem('dafman.details.section.agents', '1');
  });

  afterEach(() => {
    setRpcBridge(null);
    cleanup();
    localStorage.clear();
  });

  test('select disables only the clicked row while the global handler guard blocks concurrency', async () => {
    const utils = mountPanel(agents[0]);

    const reviewerDeselect = await waitFor(() =>
      utils.getByRole('button', { name: 'Deselect agent Reviewer' }),
    );
    const builderSelect = utils.getByRole('button', { name: 'Select agent Builder' });
    const writerSelect = utils.getByRole('button', { name: 'Select agent Writer' });

    await fireEvent.click(builderSelect);
    await waitFor(() => expect(builderSelect).toHaveProperty('disabled', true));

    expect(reviewerDeselect).toHaveProperty('disabled', false);
    expect(writerSelect).toHaveProperty('disabled', false);

    await fireEvent.click(writerSelect);
    expect(selectCalls(utils.calls)).toHaveLength(1);
    expect(selectCalls(utils.calls)[0]?.args).toEqual({ sessionId: 'session-1', name: 'builder' });
  });

  test('deselect disables only the active row while other rows stay visually stable', async () => {
    const utils = mountPanel(agents[0]);

    const reviewerDeselect = await waitFor(() =>
      utils.getByRole('button', { name: 'Deselect agent Reviewer' }),
    );
    const builderSelect = utils.getByRole('button', { name: 'Select agent Builder' });
    const writerSelect = utils.getByRole('button', { name: 'Select agent Writer' });

    await fireEvent.click(reviewerDeselect);
    await waitFor(() => expect(reviewerDeselect).toHaveProperty('disabled', true));

    expect(builderSelect).toHaveProperty('disabled', false);
    expect(writerSelect).toHaveProperty('disabled', false);

    await fireEvent.click(builderSelect);
    expect(selectCalls(utils.calls)).toHaveLength(0);
  });
});
