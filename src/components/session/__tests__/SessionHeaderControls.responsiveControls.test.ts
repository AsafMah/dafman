/**
 * Regression test for #176: "Allow all" toggle and workspace chip must
 * never be dropped from the DOM — they may collapse to icon-only via
 * CSS at narrow widths, but the elements must always be present and
 * focusable so keyboard/pointer users can still reach them.
 *
 * The width-based CSS hiding is evaluated at runtime by the browser;
 * JSDOM does not apply stylesheets, so we can only assert DOM
 * presence here. The actual CSS rules are verified by reading
 * `MessageComposer.vue` (no `display:none` for approve-all or
 * workspace-chip at narrow breakpoints) and `style.css`
 * (`.dv-tabs-and-actions-container { container-type: inline-size }`
 * so queries fire correctly for `area="all"`).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, render } from '@testing-library/vue';
import PrimeVue from 'primevue/config';
import SessionHeaderControls from '@/components/session/SessionHeaderControls.vue';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName } from '@/ipc/types';
import {
  _resetSessionsStoreForTest,
  useSessionsStore,
  type SessionRecord,
} from '@/stores/chat/sessionsStore';

function makeNullBridge(): RpcBridge {
  return {
    request: (async <N extends CommandName>(
      name: N,
      _args: CommandMap[N]['args'],
    ): Promise<CommandMap[N]['result']> => {
      // Return safe empty-list defaults for commands the component calls
      // at mount time so they don't corrupt store refs.
      if (name === 'listModels') return [] as CommandMap[N]['result'];

      return undefined as CommandMap[N]['result'];
    }) as RpcBridge['request'],
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
    onTerminalEvent: () => () => {},
    onCommandResultEvent: () => () => {},
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'test-session',
    accent: 'var(--p-primary-color)',
    events: [],
    droppedEventCount: 0,
    model: null,
    reasoningEffort: null,
    mode: null,
    approveAll: false,
    title: null,
    reasoningVisibilityOverride: 'default',
    workingDirectory: '/home/user/project',
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

function mountControls(area: 'all' | 'composer-left' | 'composer-right' = 'all') {
  const sessionsStore = useSessionsStore();
  sessionsStore.sessions.push(makeSession());

  return render(SessionHeaderControls, {
    props: { sessionId: 'test-session', area },
    global: { plugins: [PrimeVue] },
  });
}

describe('SessionHeaderControls responsive controls (#176)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
    setRpcBridge(makeNullBridge());
  });

  afterEach(() => {
    setRpcBridge(null);
    cleanup();
  });

  describe('area="all" (dockview tab-header)', () => {
    test('approve-all button is present in the DOM', () => {
      const utils = mountControls('all');
      // aria-label set on the button regardless of approveAll state
      const btn = utils.container.querySelector('.approve-all-button');
      expect(btn).not.toBeNull();
    });

    test('workspace chip is present in the DOM when workingDirectory is set', () => {
      const utils = mountControls('all');
      const chip = utils.container.querySelector('.workspace-chip');
      expect(chip).not.toBeNull();
    });

    test('workspace chip is absent when workingDirectory is falsy', () => {
      const sessionsStore = useSessionsStore();
      sessionsStore.sessions.push(
        makeSession({ id: 'no-dir', workingDirectory: undefined as unknown as string }),
      );
      const utils = render(SessionHeaderControls, {
        props: { sessionId: 'no-dir', area: 'all' },
        global: { plugins: [PrimeVue] },
      });
      const chip = utils.container.querySelector('.workspace-chip');
      expect(chip).toBeNull();
    });
  });

  describe('area="composer-left" (message composer left slot)', () => {
    test('approve-all button is present in the DOM', () => {
      const utils = mountControls('composer-left');
      const btn = utils.container.querySelector('.approve-all-button');
      expect(btn).not.toBeNull();
    });

    test('workspace chip is present in the DOM when workingDirectory is set', () => {
      const utils = mountControls('composer-left');
      const chip = utils.container.querySelector('.workspace-chip');
      expect(chip).not.toBeNull();
    });
  });

  describe('area="composer-right" (message composer right slot)', () => {
    test('approve-all button is NOT rendered (not part of this area)', () => {
      const utils = mountControls('composer-right');
      const btn = utils.container.querySelector('.approve-all-button');
      expect(btn).toBeNull();
    });
  });
});
