import { describe, expect, test } from 'bun:test';
import {
  LOADING_AFFORDANCE_DELAY_MS,
  useDelayedLoadedFlag,
} from '@/composables/library/useDelayedLoadedFlag';

const DELAY_MS = LOADING_AFFORDANCE_DELAY_MS + 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('useDelayedLoadedFlag (#93)', () => {
  test('keeps the visible loading flag true for an instant reload', async () => {
    const { loaded, beginLoading } = useDelayedLoadedFlag();

    beginLoading()();
    expect(loaded.value).toBe(true);

    const finishReload = beginLoading();
    expect(loaded.value).toBe(true);

    finishReload();
    await sleep(DELAY_MS);

    expect(loaded.value).toBe(true);
  });

  test('shows the loading affordance once a reload remains pending', async () => {
    const { loaded, beginLoading } = useDelayedLoadedFlag();

    beginLoading()();

    const finishReload = beginLoading();
    await sleep(DELAY_MS);

    expect(loaded.value).toBe(false);

    finishReload();
    expect(loaded.value).toBe(true);
  });

  test('does not let an older reload finish cancel a newer pending reload', async () => {
    const { loaded, beginLoading } = useDelayedLoadedFlag();

    beginLoading()();

    const finishFirstReload = beginLoading();
    await sleep(LOADING_AFFORDANCE_DELAY_MS / 2);

    const finishSecondReload = beginLoading();
    finishFirstReload();
    await sleep(LOADING_AFFORDANCE_DELAY_MS / 2 + 20);

    expect(loaded.value).toBe(true);

    await sleep(LOADING_AFFORDANCE_DELAY_MS / 2 + 20);
    expect(loaded.value).toBe(false);

    finishSecondReload();
    expect(loaded.value).toBe(true);
  });
});
