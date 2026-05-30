// Regression test for issue #17 — the composer-footer mode selector lost
// its narrow-mode (compact icon-only Select) form when commit 6343902
// removed the @container hide of `.mode-button-group` and the swap to a
// `.mode-select-shell` that never existed. The mode picker then either
// stayed as the wide 3-icon segmented control or, per the user, "ruined"
// the bottom bar resize on narrow panes.
//
// The compact form is swapped in by a CSS @container query, which has no
// layout in happy-dom, so we can't assert visibility here. What we CAN
// (and must) assert is that BOTH forms are rendered — the regression was
// that the compact form was entirely absent from the DOM. The actual
// width-based swap is covered by the smoke run + MANUAL_TESTS.

import { describe, expect, test, beforeEach } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { render, cleanup } from '@testing-library/vue';
import PrimeVue from 'primevue/config';
import ModeButtonGroup from '@/components/chat/ModeButtonGroup.vue';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import type { SessionMode } from '@/ipc/types';

function seedSession(id: string, mode: SessionMode) {
  const store = useSessionsStore();
  store.sessions.push({ id, mode } as unknown as (typeof store.sessions)[number]);
}

function mount(sessionId = 's1') {
  return render(ModeButtonGroup, {
    props: { sessionId },
    global: { plugins: [PrimeVue], stubs: { teleport: true } },
  });
}

describe('ModeButtonGroup compact fallback (#17)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    cleanup();
  });

  test('renders both the segmented control and the compact Select', () => {
    seedSession('s1', 'interactive');
    const { container } = mount('s1');

    expect(container.querySelector('.mode-button-group')).not.toBeNull();
    expect(container.querySelector('.mode-select-compact')).not.toBeNull();
  });

  test('compact Select reflects the active mode via its class + icon', () => {
    seedSession('s1', 'plan');
    const { container } = mount('s1');

    const compact = container.querySelector('.mode-select-compact');
    expect(compact).not.toBeNull();
    expect(compact?.classList.contains('mode-plan')).toBe(true);
    // The icon-only trigger shows the plan icon (pi pi-list-check).
    expect(compact?.querySelector('.p-select-label .pi-list-check')).not.toBeNull();
  });

  test('renders nothing until a session record exists', () => {
    const { container } = mount('missing');
    expect(container.querySelector('.mode-button-group')).toBeNull();
    expect(container.querySelector('.mode-select-compact')).toBeNull();
  });
});
