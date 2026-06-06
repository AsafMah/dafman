import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, type Component } from 'vue';
import type { DockviewApi, DockviewPanelApi } from 'dockview-core';
import { useGroupsStore } from '@/stores/shell/groupsStore';

const ContextMenuStub = defineComponent({
  name: 'ContextMenu',
  props: {
    model: { type: Array, required: true },
  },
  methods: {
    show() {
      // no-op
    },
  },
  template: '<div />',
});

mock.module('primevue/contextmenu', () => ({ default: ContextMenuStub }));

let ChatTab: Component;

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

function fakeInnerApi(panelIds: string[]): DockviewApi {
  return {
    getPanel: (id: string) => (panelIds.includes(id) ? { id } : undefined),
    panels: panelIds.map((id) => ({ id })),
  } as unknown as DockviewApi;
}

describe('ChatTab maximize action', () => {
  beforeAll(async () => {
    ChatTab = (await import('@/components/chat/ChatTab.vue')).default as Component;
  });

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    cleanup();
  });

  test('renders a maximize action and toggles the dockview panel', async () => {
    let maximized = false;
    let maximizeCalls = 0;
    let restoreCalls = 0;
    const api = fakePanelApi({
      isMaximized: () => maximized,
      maximize: () => {
        maximizeCalls++;
        maximized = true;
      },
      exitMaximized: () => {
        restoreCalls++;
        maximized = false;
      },
    });

    useGroupsStore().registerInnerApi('g1', fakeInnerApi(['s1', 's2']));

    const utils = render(ChatTab, {
      props: {
        params: { sessionId: 's1' },
        api,
      },
    });

    await fireEvent.click(utils.getByLabelText('Maximize session'));

    expect(maximizeCalls).toBe(1);
    expect(restoreCalls).toBe(0);

    await fireEvent.click(utils.getByLabelText('Restore session'));

    expect(maximizeCalls).toBe(1);
    expect(restoreCalls).toBe(1);
  });

  test('hides the maximize action for a single-session group', async () => {
    useGroupsStore().registerInnerApi('g1', fakeInnerApi(['s1']));

    const utils = render(ChatTab, {
      props: { params: { sessionId: 's1' }, api: fakePanelApi() },
    });

    expect(utils.queryByLabelText('Maximize session')).toBeNull();
    // Close stays available regardless of group size.
    expect(utils.queryByLabelText('Close session')).not.toBeNull();
  });
});
