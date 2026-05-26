// Regression test for the SettingsGroup collapse-button binding.
//
// The bug (introduced by the Phase D.1 split — commit 9125e50):
// SettingsPanel.vue bound the collapse handler as
//   `@update:collapsed="setCollapsed('appearance')"`
// Vue parses this as an INLINE handler — it compiles to
//   `($event) => setCollapsed('appearance')`
// The curried call returns a function, which Vue then DISCARDS.
// The new collapsed value never reaches the reactive map.
//
// Fix: use `v-model:collapsed="collapsed.appearance"` so Vue's
// generated setter writes back to the reactive property directly.
//
// This test mounts SettingsGroup with a writable parent state ref,
// clicks the header, and asserts the state flipped.

import { beforeEach, describe, expect, test } from 'bun:test';
import { defineComponent, h, reactive } from 'vue';
import { mount } from '@vue/test-utils';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';

describe('SettingsGroup collapse binding', () => {
  let parentState: Record<string, boolean>;

  beforeEach(() => {
    parentState = reactive({ appearance: false });
  });

  test('clicking the group header flips parent.collapsed via v-model', async () => {
    const Parent = defineComponent({
      setup: () => ({ state: parentState }),
      render() {
        return h(SettingsGroup, {
          id: 'appearance',
          icon: 'pi-palette',
          label: 'Appearance',
          collapsed: this.state.appearance,
          'onUpdate:collapsed': (v: boolean) => {
            this.state.appearance = v;
          },
        });
      },
    });

    const wrapper = mount(Parent);

    expect(parentState.appearance).toBe(false);
    expect(wrapper.find('.group-header').attributes('aria-expanded')).toBe('true');

    await wrapper.find('.group-header').trigger('click');

    expect(parentState.appearance).toBe(true);
    expect(wrapper.find('.group-header').attributes('aria-expanded')).toBe('false');

    await wrapper.find('.group-header').trigger('click');

    expect(parentState.appearance).toBe(false);
    expect(wrapper.find('.group-header').attributes('aria-expanded')).toBe('true');
  });

  test('regression: inline curried handler `setCollapsed(id)` swallows the event payload', () => {
    // This is the pattern the Phase D.1 split introduced and v2
    // user-facing regression revealed. We don't ship this code
    // anymore; the test documents WHY the pattern is wrong so a
    // future agent doesn't reintroduce it.
    let received: unknown = 'untouched';

    function setCollapsed(_id: string) {
      return (value: boolean) => {
        received = value;
      };
    }

    // Vue's template compiler treats `@event="setCollapsed('id')"`
    // as `($event) => setCollapsed('id')`. The return value is
    // discarded — the inner closure never runs with the payload.
    const compiledHandler = (_$event: unknown) => setCollapsed('appearance');

    compiledHandler(true);

    expect(received).toBe('untouched');
  });
});
