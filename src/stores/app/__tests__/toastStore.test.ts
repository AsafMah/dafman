import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useToastStore } from '@/stores/app/toastStore';
import type { ToastMessage } from '@/stores/app/toastStore';

describe('toastStore sink', () => {
  beforeEach(() => setActivePinia(createPinia()));

  test('buffers pushes before a sink registers, flushes on register', () => {
    const store = useToastStore();

    store.info('a');
    store.success('b');
    expect(store.pending.length).toBe(2);

    const got: ToastMessage[] = [];

    store.register((m) => got.push(m));

    expect(got.map((m) => m.summary)).toEqual(['a', 'b']);
    expect(store.pending.length).toBe(0);
  });

  test('routes straight to the sink once registered (no buffering)', () => {
    const store = useToastStore();
    const got: ToastMessage[] = [];

    store.register((m) => got.push(m));
    store.warn('w');

    expect(got).toHaveLength(1);
    expect(got[0].summary).toBe('w');
    expect(store.pending.length).toBe(0);
  });

  test('error toasts are sticky (life 0); others auto-dismiss', () => {
    const store = useToastStore();
    const got: ToastMessage[] = [];

    store.register((m) => got.push(m));
    store.error('boom', 'details');
    store.info('hi');

    expect(got[0].life).toBe(0);
    expect(got[1].life).toBeGreaterThan(0);
  });

  test('unregister falls back to buffering', () => {
    const store = useToastStore();
    const got: ToastMessage[] = [];

    store.register((m) => got.push(m));
    store.unregister();
    store.info('queued');

    expect(got).toHaveLength(0);
    expect(store.pending.length).toBe(1);
  });
});
