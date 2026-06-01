import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, type Component } from 'vue';
import type { DockviewPanelApi } from 'dockview-core';

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
});
