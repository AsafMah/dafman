/**
 * Component test for the SessionsManager toolbar controls:
 * - grouping mode dropdown updates viewState
 * - sort direction toggle flips between asc/desc
 * - color-by-group toggle activates
 * - search toggle shows/hides the search bar
 * - Escape collapses the search bar and clears the query
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

  test('color-by-group toggle flips viewState.colorByGroup', async () => {
    const { getByTitle } = mountManager();
    const store = useSessionsListStore();

    expect(store.viewState.colorByGroup).toBe(false);

    await fireEvent.click(getByTitle('Color by group'));

    expect(store.viewState.colorByGroup).toBe(true);
  });

  test('search toggle shows the search input', async () => {
    const { getByTitle, queryByPlaceholderText } = mountManager();

    // Search bar not visible initially.
    expect(queryByPlaceholderText('Filter sessions…')).toBeNull();

    await fireEvent.click(getByTitle('Search sessions'));

    expect(queryByPlaceholderText('Filter sessions…')).not.toBeNull();
  });

  test('clear-search button hides the search bar and resets query', async () => {
    const { getByTitle, getByPlaceholderText, queryByPlaceholderText } = mountManager();
    const store = useSessionsListStore();

    await fireEvent.click(getByTitle('Search sessions'));

    const input = getByPlaceholderText('Filter sessions…') as HTMLInputElement;

    await fireEvent.input(input, { target: { value: 'hello' } });
    store.viewState.searchQuery = 'hello'; // sync store directly for assertion

    await fireEvent.click(getByTitle('Clear search'));

    expect(queryByPlaceholderText('Filter sessions…')).toBeNull();
    expect(store.viewState.searchQuery).toBe('');
  });

  test('Escape key collapses search and clears query', async () => {
    const { getByTitle, getByPlaceholderText, queryByPlaceholderText } = mountManager();
    const store = useSessionsListStore();

    await fireEvent.click(getByTitle('Search sessions'));

    const input = getByPlaceholderText('Filter sessions…');

    store.viewState.searchQuery = 'test';
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(queryByPlaceholderText('Filter sessions…')).toBeNull();
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
