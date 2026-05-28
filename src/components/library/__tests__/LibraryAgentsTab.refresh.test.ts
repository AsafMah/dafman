import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { h, nextTick, ref, type Component } from 'vue';
import type { AgentFileEntry } from '@/ipc/types';

const files = ref<AgentFileEntry[]>([]);
const loaded = ref(true);
const loading = ref(false);
const error = ref<string | null>(null);
let loadCalls: Array<string | undefined> = [];

const loadMock = mock(async (sessionId?: string) => {
  loadCalls.push(sessionId);
});
const writeMock = mock(async () => null as string | null);
const readMock = mock(async () => null);
const removeMock = mock(async () => null as boolean | null);
const selectAgentMock = mock(async () => {});
const deselectAgentMock = mock(async () => {});

mock.module('@/composables/library/useAgentsLibrary', () => ({
  useAgentsLibrary: () => ({
    files,
    loaded,
    loading,
    error,
    load: loadMock,
    write: writeMock,
    read: readMock,
    remove: removeMock,
  }),
}));

mock.module('@/components/session/details/useSessionAgents', () => ({
  useSessionAgents: () => ({
    selectAgent: selectAgentMock,
    deselectAgent: deselectAgentMock,
    agentBusyName: ref<string | null>(null),
  }),
}));

let LibraryAgentsTab: Component;

beforeAll(async () => {
  LibraryAgentsTab = (await import('@/components/library/LibraryAgentsTab.vue')).default;
});

function mountTab() {
  return render(
    {
      setup() {
        return () => h(LibraryAgentsTab);
      },
    },
    { global: { plugins: [PrimeVue] } },
  );
}

describe('LibraryAgentsTab refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    files.value = [];
    loaded.value = true;
    loading.value = false;
    error.value = null;
    loadCalls = [];
  });

  afterEach(() => {
    cleanup();
  });

  test('clicking the refresh button reloads the agents list', async () => {
    mountTab();
    await nextTick();

    expect(loadCalls).toEqual([undefined]);

    await fireEvent.click(screen.getByLabelText('Refresh agents list'));
    await nextTick();

    expect(loadCalls).toEqual([undefined, undefined]);
  });
});
