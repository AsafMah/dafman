/**
 * Component test for the SessionsManager toolbar controls:
 * - grouping mode dropdown updates viewState
 * - sort direction toggle flips between asc/desc
 * - color-by-group is always on (no toggle)
 * - search input is always visible inline; Escape/clear reset the query
 * - show-only-open toggle filters to open sessions
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, render, fireEvent } from '@testing-library/vue';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import SessionsManager from '@/components/session/SessionsManager.vue';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName } from '@/ipc/types';
import { _resetSessionsStoreForTest } from '@/stores/chat/sessionsStore';
import { useSessionsListStore } from '@/stores/chat/sessionsListStore';

function makeNullBridge(): RpcBridge {
  return {
    request: (async <N extends CommandName>(
      name: N,
      _args: CommandMap[N]['args'],
    ): Promise<CommandMap[N]['result']> => {
      if (name === 'listSessions') return [] as CommandMap[N]['result'];

      return undefined as unknown as CommandMap[N]['result'];
    }) as RpcBridge['request'],
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };
}

function mountManager() {
  return render(SessionsManager, {
    global: { plugins: [PrimeVue, ConfirmationService] },
  });
}

describe('SessionsManager toolbar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
    setRpcBridge(makeNullBridge());
  });

  afterEach(() => {
    setRpcBridge(null);
    _resetSessionsStoreForTest();
    cleanup();
  });

  test('renders the refresh button', () => {
    const { getByTitle } = mountManager();

    expect(getByTitle('Refresh')).toBeDefined();
  });

  test('renders the sort direction toggle', () => {
    const { getByTitle } = mountManager();

    // Default is desc — button should show "descending" label.
    const btn = getByTitle('Sort descending');

    expect(btn).toBeDefined();
  });

  test('sort direction toggle flips viewState.sortDir', async () => {
    const { getByTitle } = mountManager();
    const store = useSessionsListStore();

    expect(store.viewState.sortDir).toBe('desc');

    await fireEvent.click(getByTitle('Sort descending'));

    expect(store.viewState.sortDir).toBe('asc');
  });

  test('show-only-open toggle flips viewState.showOnlyOpen', async () => {
    const { getByTitle } = mountManager();
    const store = useSessionsListStore();

    expect(store.viewState.showOnlyOpen).toBe(false);

    await fireEvent.click(getByTitle('Show only open sessions'));

    expect(store.viewState.showOnlyOpen).toBe(true);
  });

  test('search input is always visible in the toolbar', () => {
    const { queryByPlaceholderText } = mountManager();

    // Inline search input is always present — no toggle required.
    expect(queryByPlaceholderText('Filter…')).not.toBeNull();
  });

  test('clear-search button resets the query without hiding the input', async () => {
    const { getByTitle, getByPlaceholderText, queryByPlaceholderText } = mountManager();
    const store = useSessionsListStore();

    const input = getByPlaceholderText('Filter…') as HTMLInputElement;

    await fireEvent.input(input, { target: { value: 'hello' } });
    store.viewState.searchQuery = 'hello'; // sync store directly for assertion

    await fireEvent.click(getByTitle('Clear search'));

    // Input stays visible; only the query is cleared.
    expect(queryByPlaceholderText('Filter…')).not.toBeNull();
    expect(store.viewState.searchQuery).toBe('');
  });

  test('Escape key clears the search query without hiding the input', async () => {
    const { getByPlaceholderText, queryByPlaceholderText } = mountManager();
    const store = useSessionsListStore();

    const input = getByPlaceholderText('Filter…');

    store.viewState.searchQuery = 'test';
    await fireEvent.keyDown(input, { key: 'Escape' });

    // Input stays visible; query is cleared.
    expect(queryByPlaceholderText('Filter…')).not.toBeNull();
    expect(store.viewState.searchQuery).toBe('');
  });

  test('searchQuery is reset to empty on mount', () => {
    const store = useSessionsListStore();

    // Pre-load a stale search query (simulating what might be in viewState
    // before mount resets it).
    store.viewState.searchQuery = 'stale-query';

    mountManager();

    // onMounted should reset it to ''.
    expect(store.viewState.searchQuery).toBe('');
  });
});
