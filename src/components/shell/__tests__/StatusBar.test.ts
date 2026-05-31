/// StatusBar release-channel pill (channel indicator feature).
///
/// The pill must only mount for non-stable channels (`dev` / `canary`),
/// carry the channel name as text, and tint via a per-channel class.
/// We mock `useAppInfo` (rather than the RPC bridge) so each case can set
/// a distinct channel — the real composable caches its one-shot fetch at
/// module scope, which would otherwise pin the first test's value.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ref } from 'vue';
import { cleanup, render } from '@testing-library/vue';
import type { AppInfo } from '@/ipc/types';

const appInfoRef = ref<AppInfo | null>(null);

mock.module('@/composables/useAppInfo', () => ({
  useAppInfo: () => ({ appInfo: appInfoRef }),
}));

import StatusBar from '@/components/shell/StatusBar.vue';

beforeEach(() => {
  appInfoRef.value = null;
});

afterEach(() => {
  cleanup();
});

describe('StatusBar — release-channel pill', () => {
  test('shows a canary pill tinted via channel-pill-canary', () => {
    appInfoRef.value = { channel: 'canary', version: '0.1.0' };

    const { getByText } = render(StatusBar);
    const pill = getByText('canary');

    expect(pill.classList.contains('channel-pill')).toBe(true);
    expect(pill.classList.contains('channel-pill-canary')).toBe(true);
  });

  test('shows a dev pill tinted via channel-pill-dev', () => {
    appInfoRef.value = { channel: 'dev', version: '0.1.0' };

    const { getByText } = render(StatusBar);
    const pill = getByText('dev');

    expect(pill.classList.contains('channel-pill-dev')).toBe(true);
  });

  test('hides the pill on a stable build', () => {
    appInfoRef.value = { channel: 'stable', version: '0.1.0' };

    const { queryByText } = render(StatusBar);

    expect(queryByText('stable')).toBeNull();
  });

  test('hides the pill when app info is unavailable', () => {
    appInfoRef.value = null;

    const { container } = render(StatusBar);

    expect(container.querySelector('.channel-pill')).toBeNull();
  });
});
