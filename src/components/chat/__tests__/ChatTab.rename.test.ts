import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent } from 'vue';
import type { Component } from 'vue';
import type { DockviewPanelApi } from 'dockview-core';
import { emit as busEmit, clear as clearBus } from '@/lib/bus';
import { setRpcBridge } from '@/ipc/invoke';
import type { RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName } from '@/ipc/types';
import { _resetSessionsStoreForTest, useSessionsStore } from '@/stores/chat/sessionsStore';
import type { SessionRecord } from '@/stores/chat/sessionsStore';

const ContextMenuStub = defineComponent({
  name: 'ContextMenu',
  props: { model: { type: Array, required: true } },
  methods: {
    show() {
      // no-op
    },
  },
  template: '<div />',
});

mock.module('primevue/contextmenu', () => ({ default: ContextMenuStub }));

// Dynamic import so the `mock.module` above is registered before ChatTab
// (which imports `primevue/contextmenu` at module scope) is evaluated —
// the documented test module-loading-boundary exception to static import.
let ChatTab: Component;

function makeSession(): SessionRecord {
  return {
    id: 's1',
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

function fakePanelApi(overrides: Partial<DockviewPanelApi> = {}): DockviewPanelApi {
  return {
    id: 's1',
    title: 'Session 1',
    isActive: true,
    isMaximized: () => false,
    maximize: () => {},
    exitMaximized: () => {},
    close: () => {},
    onDidTitleChange: () => ({ dispose: () => {} }),
    onDidActiveChange: () => ({ dispose: () => {} }),
    onDidDimensionsChange: () => ({ dispose: () => {} }),
    ...overrides,
  } as unknown as DockviewPanelApi;
}

function renderTab() {
  return render(ChatTab, { props: { params: { sessionId: 's1' }, api: fakePanelApi() } });
}

describe('ChatTab inline rename', () => {
  beforeAll(async () => {
    ChatTab = (await import('@/components/chat/ChatTab.vue')).default as Component;
  });

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

  test('rename-session swaps the title for an inline input and Enter saves', async () => {
    const { bridge, calls } = makeBridge();
    setRpcBridge(bridge);
    useSessionsStore().sessions.push(makeSession());

    const utils = renderTab();

    // No input until the rename is requested — title renders as text.
    expect(utils.queryByLabelText('Session name')).toBeNull();

    busEmit('rename-session', { sessionId: 's1' });

    const input = await waitFor(() => utils.getByLabelText('Session name'));

    await fireEvent.update(input, 'Readable title');
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(calls).toContainEqual({
        name: 'setSessionName',
        args: { sessionId: 's1', name: 'Readable title' },
      }),
    );
  });

  test('Escape cancels without saving and restores the title text', async () => {
    const { bridge, calls } = makeBridge();
    setRpcBridge(bridge);
    useSessionsStore().sessions.push(makeSession());

    const utils = renderTab();

    busEmit('rename-session', { sessionId: 's1' });
    const input = await waitFor(() => utils.getByLabelText('Session name'));

    await fireEvent.update(input, 'Discarded');
    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(utils.queryByLabelText('Session name')).toBeNull());
    expect(calls.find((c) => c.name === 'setSessionName')).toBeUndefined();
  });

  test('ignores rename-session for a different session', async () => {
    const { bridge } = makeBridge();
    setRpcBridge(bridge);
    useSessionsStore().sessions.push(makeSession());

    const utils = renderTab();

    busEmit('rename-session', { sessionId: 'other' });

    expect(utils.queryByLabelText('Session name')).toBeNull();
  });
});
