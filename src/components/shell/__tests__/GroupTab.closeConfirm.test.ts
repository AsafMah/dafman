import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, render, fireEvent } from '@testing-library/vue';
import { defineComponent, type Component } from 'vue';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import type { ConfirmationOptions } from 'primevue/confirmationoptions';

const ContextMenuStub = defineComponent({
  name: 'ContextMenu',
  props: {
    model: { type: Array, required: true },
  },
  methods: {
    show() {
      // test stub renders the menu inline instead of opening an overlay
    },
  },
  template: `
    <div>
      <button
        v-for="item in model.filter((entry) => !entry.separator)"
        :key="item.label"
        type="button"
        :disabled="item.disabled"
        @click="item.command?.({ originalEvent: $event, item })"
      >
        {{ item.label }}
      </button>
    </div>
  `,
});

const PopoverStub = defineComponent({
  name: 'Popover',
  methods: {
    show() {
      // no-op
    },
  },
  template: '<div><slot /></div>',
});

const ColorPickerStub = defineComponent({
  name: 'ColorPicker',
  template: '<div />',
});

const confirmCalls: ConfirmationOptions[] = [];

mock.module('primevue/contextmenu', () => ({ default: ContextMenuStub }));
mock.module('primevue/popover', () => ({ default: PopoverStub }));
mock.module('primevue/colorpicker', () => ({ default: ColorPickerStub }));
mock.module('primevue/useconfirm', () => ({
  useConfirm: () => ({
    require: (options: ConfirmationOptions) => confirmCalls.push(options),
    close: () => {},
  }),
}));

let GroupTab: Component;

function renderGroupTab(groupId = 'g1') {
  return render(GroupTab, {
    props: {
      params: { groupId },
    },
    global: {
      plugins: [],
    },
  });
}

function hydrateGroups(innerBodies: Record<string, unknown> = {}) {
  const groups = useGroupsStore();
  groups.hydrate({
    schemaVersion: 3,
    groups: [
      { id: 'g1', name: 'Group 1', color: '#3b82f6' },
      { id: 'g2', name: 'Group 2', color: '#f59e0b' },
    ],
    activeGroupId: 'g1',
    innerBodies,
  });
  return groups;
}

function captureConfirmCalls() {
  confirmCalls.length = 0;

  return confirmCalls;
}

describe('GroupTab close confirmation', () => {
  beforeAll(async () => {
    GroupTab = (await import('@/components/shell/GroupTab.vue')).default as Component;
  });

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    cleanup();
    confirmCalls.length = 0;
  });

  test('close button skips confirmation for an empty group', async () => {
    const groups = hydrateGroups();
    const confirm = captureConfirmCalls();

    const utils = renderGroupTab('g1');

    await fireEvent.click(utils.getByLabelText('Close group'));

    expect(confirm).toHaveLength(0);
    expect(groups.groups.map((g) => g.id)).toEqual(['g2']);
  });

  test('context-menu close skips confirmation for an empty group', async () => {
    const groups = hydrateGroups();
    const confirm = captureConfirmCalls();

    const utils = renderGroupTab('g1');

    await fireEvent.click(utils.getByText('Close group'));

    expect(confirm).toHaveLength(0);
    expect(groups.groups.map((g) => g.id)).toEqual(['g2']);
  });

  test('non-empty groups require a destructive confirmation', async () => {
    hydrateGroups({
      g1: {
        panels: {
          s1: { id: 's1' },
          s2: { id: 's2' },
        },
      },
    });
    const confirm = captureConfirmCalls();

    const utils = renderGroupTab('g1');

    await fireEvent.click(utils.getByLabelText('Close group'));

    expect(confirm).toHaveLength(1);
    expect(confirm[0]).toMatchObject({
      header: 'Close group',
      message: 'Close 2 sessions in "Group 1"? This will close those sessions.',
      icon: 'pi pi-exclamation-triangle',
      acceptProps: { label: 'Close group', severity: 'danger' },
      rejectProps: { label: 'Cancel', severity: 'secondary', text: true },
      defaultFocus: 'reject',
    });
    expect(confirm[0]?.accept).toBeTypeOf('function');
  });
});
