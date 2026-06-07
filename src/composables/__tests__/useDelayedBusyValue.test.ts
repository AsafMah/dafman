import { describe, expect, test } from 'bun:test';
import { ref } from 'vue';
import { BUSY_AFFORDANCE_DELAY_MS, useDelayedBusyValue } from '@/composables/useDelayedBusyValue';

const DELAY_MS = BUSY_AFFORDANCE_DELAY_MS + 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('useDelayedBusyValue (#99)', () => {
  test('suppresses visible busy state for instant operations', async () => {
    const busy = ref<string | null>(null);
    const visibleBusy = useDelayedBusyValue(busy);

    busy.value = 'agent-one';
    busy.value = null;
    await sleep(DELAY_MS);

    expect(visibleBusy.value).toBeNull();
  });

  test('shows visible busy state once an operation remains pending', async () => {
    const busy = ref<string | null>(null);
    const visibleBusy = useDelayedBusyValue(busy);

    busy.value = 'agent-one';
    await sleep(DELAY_MS);

    expect(visibleBusy.value).toBe('agent-one');

    busy.value = null;
    expect(visibleBusy.value).toBeNull();
  });

  test('restarts the delay when the pending operation changes', async () => {
    const busy = ref<string | null>(null);
    const visibleBusy = useDelayedBusyValue(busy);

    busy.value = 'agent-one';
    await sleep(BUSY_AFFORDANCE_DELAY_MS / 2);
    busy.value = 'agent-two';
    await sleep(BUSY_AFFORDANCE_DELAY_MS / 2 + 20);

    expect(visibleBusy.value).toBeNull();

    await sleep(BUSY_AFFORDANCE_DELAY_MS / 2 + 20);
    expect(visibleBusy.value).toBe('agent-two');
  });
});
