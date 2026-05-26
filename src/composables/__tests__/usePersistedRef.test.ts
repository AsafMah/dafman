import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { nextTick } from 'vue';
import { usePersistedRef } from '@/composables/usePersistedRef';

describe('usePersistedRef', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('returns default when key is missing', () => {
    const state = usePersistedRef('missing', { count: 0 });

    expect(state.value).toEqual({ count: 0 });
  });

  test('hydrates from existing JSON in localStorage', () => {
    localStorage.setItem('preset', JSON.stringify({ count: 7 }));

    const state = usePersistedRef('preset', { count: 0 });

    expect(state.value).toEqual({ count: 7 });
  });

  test('writes mutations back synchronously by default', async () => {
    const state = usePersistedRef('out', 'a');

    state.value = 'b';
    await nextTick();

    expect(localStorage.getItem('out')).toBe(JSON.stringify('b'));
  });

  test('throttled writes coalesce', async () => {
    const state = usePersistedRef('throttled', 0, { throttleMs: 50 });

    state.value = 1;
    state.value = 2;
    state.value = 3;
    await nextTick();

    expect(localStorage.getItem('throttled')).toBeNull();

    await new Promise((r) => setTimeout(r, 75));

    expect(localStorage.getItem('throttled')).toBe('3');
  });

  test('falls back to default on malformed JSON', () => {
    localStorage.setItem('bad', '{not json');

    const state = usePersistedRef('bad', 'fallback');

    expect(state.value).toBe('fallback');
  });

  test('validate() can reject parsed values', () => {
    localStorage.setItem('typed', JSON.stringify({ wrong: true }));

    const state = usePersistedRef<{ count: number }>(
      'typed',
      { count: 0 },
      {
        validate: (parsed) => {
          if (
            parsed &&
            typeof parsed === 'object' &&
            'count' in parsed &&
            typeof (parsed as { count?: unknown }).count === 'number'
          ) {
            return parsed as { count: number };
          }
          return null;
        },
      },
    );

    expect(state.value).toEqual({ count: 0 });
  });

  test('validate() can normalise parsed values', () => {
    localStorage.setItem('map', JSON.stringify({ a: 'x', b: 123, c: null }));

    const state = usePersistedRef<Record<string, string>>(
      'map',
      {},
      {
        validate: (parsed) => {
          if (!parsed || typeof parsed !== 'object') return null;
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string') out[k] = v;
          }
          return out;
        },
      },
    );

    expect(state.value).toEqual({ a: 'x' });
  });

  test('cap() trims values before write', async () => {
    const state = usePersistedRef('capped', '', { cap: (v) => v.slice(-3) });

    state.value = 'hello';
    await nextTick();

    expect(localStorage.getItem('capped')).toBe(JSON.stringify('llo'));
  });

  test('persistence failures are swallowed', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded');
    };

    try {
      const state = usePersistedRef('explodes', 0);
      state.value = 5;
      await nextTick();
      expect(state.value).toBe(5);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
