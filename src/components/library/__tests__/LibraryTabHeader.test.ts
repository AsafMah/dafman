import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, ref } from 'vue';
import LibraryTabHeader from '@/components/library/LibraryTabHeader.vue';
import type { LibraryTabHeaderAction } from '@/components/library/libraryTabHeader';

afterEach(() => {
  cleanup();
});

describe('LibraryTabHeader', () => {
  test('renders a shared header row with labelled actions and metadata', () => {
    const actions: LibraryTabHeaderAction[] = [
      {
        key: 'refresh',
        label: 'Refresh',
        icon: 'pi pi-refresh',
        ariaLabel: 'Refresh agents list',
        title: 'Refresh agents list',
      },
      { key: 'new', label: 'New agent', icon: 'pi pi-plus', variant: 'primary' },
    ];

    const utils = render(LibraryTabHeader, {
      props: { actions },
      slots: { default: '<span>2 agents</span>' },
    });

    expect(utils.getByText('2 agents')).toBeDefined();
    const refresh = utils.getByRole('button', { name: 'Refresh agents list' });
    const create = utils.getByRole('button', { name: 'New agent' });

    expect(refresh.getAttribute('title')).toBe('Refresh agents list');
    expect(refresh.classList.contains('library-tab-header__action')).toBe(true);
    expect(create.classList.contains('library-tab-header__action')).toBe(true);
    expect(utils.container.querySelector('.library-tab-header__actions')?.children.length).toBe(2);
  });

  test('emits action keys and does not emit for disabled actions', async () => {
    const actions: LibraryTabHeaderAction[] = [
      { key: 'refresh', label: 'Refresh', icon: 'pi pi-refresh' },
      { key: 'new', label: 'New agent', icon: 'pi pi-plus', disabled: true },
    ];

    const utils = render(LibraryTabHeader, { props: { actions } });

    await fireEvent.click(utils.getByRole('button', { name: 'Refresh' }));
    await fireEvent.click(utils.getByRole('button', { name: 'New agent' }));

    expect(utils.emitted('action')).toEqual([['refresh']]);
    expect(utils.getByRole('button', { name: 'New agent' }).hasAttribute('disabled')).toBe(true);
  });

  test('keeps action props reactive for tab-specific disabled states', async () => {
    const Host = defineComponent({
      components: { LibraryTabHeader },
      setup() {
        const enabled = ref(false);
        return { enabled };
      },
      computed: {
        actions(): LibraryTabHeaderAction[] {
          return [
            {
              key: 'new',
              label: 'New agent',
              icon: 'pi pi-plus',
              disabled: !this.enabled,
              title: this.enabled ? 'Create agent' : 'Open a session first',
            },
          ];
        },
      },
      template:
        '<LibraryTabHeader :actions="actions" @action="$emit(\'action\', $event)" />' +
        '<button type="button" @click="enabled = true">Enable</button>',
    });

    const utils = render(Host);
    const create = () => utils.getByRole('button', { name: 'New agent' });

    expect(create().hasAttribute('disabled')).toBe(true);
    expect(create().getAttribute('title')).toBe('Open a session first');

    await fireEvent.click(utils.getByRole('button', { name: 'Enable' }));

    expect(create().hasAttribute('disabled')).toBe(false);
    expect(create().getAttribute('title')).toBe('Create agent');
  });
});
