import { afterEach, describe, expect, mock, test } from 'bun:test';
import { clear, emit, on } from '@/lib/bus';

describe('app bus', () => {
  afterEach(() => {
    clear();
  });

  test('emit delivers payload to subscribed listeners', () => {
    const h = mock(() => {});
    on('focus-session', h);

    emit('focus-session', { sessionId: 's1' });

    expect(h).toHaveBeenCalledWith({ sessionId: 's1' });
  });

  test('unsubscribe stops further delivery', () => {
    const h = mock(() => {});
    const off = on('focus-session', h);

    emit('focus-session', { sessionId: 's1' });
    off();
    emit('focus-session', { sessionId: 's2' });

    expect(h).toHaveBeenCalledTimes(1);
  });

  test('listener exception is isolated; other listeners still fire', () => {
    const original = console.error;
    const errSpy = mock(() => {});
    console.error = errSpy as unknown as typeof console.error;

    const exploding = mock(() => {
      throw new Error('boom');
    });
    const good = mock(() => {});

    on('focus-session', exploding);
    on('focus-session', good);

    try {
      emit('focus-session', { sessionId: 's1' });
    } finally {
      console.error = original;
    }

    expect(exploding).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
  });

  test('channels are isolated from each other', () => {
    const a = mock(() => {});
    const b = mock(() => {});

    on('focus-session', a);
    on('focus-composer', b);

    emit('focus-session', { sessionId: 's1' });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  test('clear(key) removes only that channel', () => {
    const a = mock(() => {});
    const b = mock(() => {});

    on('focus-session', a);
    on('focus-composer', b);

    clear('focus-session');

    emit('focus-session', { sessionId: 's1' });
    emit('focus-composer', { sessionId: 's1' });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('clear() removes every channel', () => {
    const a = mock(() => {});
    const b = mock(() => {});

    on('focus-session', a);
    on('focus-composer', b);

    clear();

    emit('focus-session', { sessionId: 's1' });
    emit('focus-composer', { sessionId: 's1' });

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  test('emit with no subscribers is a no-op', () => {
    expect(() => emit('focus-session', { sessionId: 's1' })).not.toThrow();
  });
});
