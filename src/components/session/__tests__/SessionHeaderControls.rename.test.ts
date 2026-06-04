import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import PrimeVue from 'primevue/config';
import { createPinia, setActivePinia } from 'pinia';
import SessionHeaderControls from '@/components/session/SessionHeaderControls.vue';
import { emit as busEmit, clear as clearBus } from '@/lib/bus';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName } from '@/ipc/types';
import {
  _resetSessionsStoreForTest,
  useSessionsStore,
  type SessionRecord,
} from '@/stores/chat/sessionsStore';

function makeSession(): SessionRecord {
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

function makeBridge() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const bridge: RpcBridge = {
    request: (async <N extends CommandName>(
      name: N,
      args: CommandMap[N]['args'],
    ): Promise<CommandMap[N]['result']> => {
      calls.push({ name, args });

      if (name === 'listModels') return [] as CommandMap[N]['result'];
      if (name === 'setSessionName') return 'Readable title' as CommandMap[N]['result'];

      return undefined as CommandMap[N]['result'];
    }) as RpcBridge['request'],
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
    onTerminalEvent: () => () => {},
    onCommandResultEvent: () => () => {},
  };

  return { bridge, calls };
}

const stubs = {
  Dialog: {
    props: ['visible', 'header'],
    emits: ['update:visible'],
    template: '<div v-if="visible" role="dialog" :aria-label="header"><slot /></div>',
  },
  InputText: {
    props: ['modelValue', 'id'],
    emits: ['update:modelValue'],
    template:
      '<input :id="id" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  Select: { template: '<div />' },
  TreeSelect: { template: '<div />' },
};

describe('SessionHeaderControls rename bus integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
    clearBus();
  });

  afterEach(() => {
    cleanup();
    setRpcBridge(null);
    clearBus();
    _resetSessionsStoreForTest();
  });

  test('/rename bus event opens the rename dialog and saves the session name', async () => {
    const { bridge, calls } = makeBridge();
    setRpcBridge(bridge);
    useSessionsStore().sessions.push(makeSession());

    const utils = render(SessionHeaderControls, {
      props: { sessionId: 'session-1' },
      global: { plugins: [PrimeVue], stubs },
    });

    busEmit('rename-session', { sessionId: 'session-1' });

    await waitFor(() => utils.getByRole('dialog', { name: 'Rename session' }));

    await fireEvent.update(utils.getByLabelText('Session name'), 'Readable title');
    await fireEvent.click(utils.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        name: 'setSessionName',
        args: { sessionId: 'session-1', name: 'Readable title' },
      }),
    );
  });
});
