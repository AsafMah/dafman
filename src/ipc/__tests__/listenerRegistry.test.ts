import { describe, expect, test, mock } from 'bun:test';
import { createListenerRegistry } from '@/ipc/listenerRegistry';
import type { SessionEventPayload } from '@/ipc/types';

function fakeSessionEvent(): SessionEventPayload {
  return {
    sessionId: 's1',
    eventType: 'system.heartbeat',
    data: {},
    timestamp: new Date().toISOString(),
  };
}

describe('createListenerRegistry', () => {
  test('subscribe + dispatch delivers payload to all listeners', () => {
    const reg = createListenerRegistry();
    const a = mock(() => {});
    const b = mock(() => {});
    reg.onSessionEvent(a);
    reg.onSessionEvent(b);

    const payload = fakeSessionEvent();
    reg.dispatchSessionEvent(payload);

    expect(a).toHaveBeenCalledWith(payload);
    expect(b).toHaveBeenCalledWith(payload);
  });

  test('unsubscribe callback stops further delivery', () => {
    const reg = createListenerRegistry();
    const a = mock(() => {});
    const off = reg.onSessionEvent(a);

    reg.dispatchSessionEvent(fakeSessionEvent());
    off();
    reg.dispatchSessionEvent(fakeSessionEvent());

    expect(a).toHaveBeenCalledTimes(1);
  });

  test('listener exception is isolated; other listeners still receive', () => {
    const reg = createListenerRegistry();
    const errSpy = mock(() => {});
    const originalError = console.error;
    console.error = errSpy as unknown as typeof console.error;

    const exploding = mock(() => {
      throw new Error('boom');
    });
    const good = mock(() => {});

    reg.onSessionEvent(exploding);
    reg.onSessionEvent(good);

    try {
      reg.dispatchSessionEvent(fakeSessionEvent());
    } finally {
      console.error = originalError;
    }

    expect(exploding).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
  });

  test('channels are isolated from each other', () => {
    const reg = createListenerRegistry();
    const sess = mock(() => {});
    const term = mock(() => {});

    reg.onSessionEvent(sess);
    reg.onTerminalEvent(term);

    reg.dispatchSessionEvent(fakeSessionEvent());

    expect(sess).toHaveBeenCalledTimes(1);
    expect(term).not.toHaveBeenCalled();
  });

  test('dispatching with no listeners is a no-op', () => {
    const reg = createListenerRegistry();
    expect(() => reg.dispatchSessionEvent(fakeSessionEvent())).not.toThrow();
  });

  test('same listener subscribed twice receives once (Set semantics)', () => {
    const reg = createListenerRegistry();
    const fn = mock(() => {});

    reg.onSessionEvent(fn);
    reg.onSessionEvent(fn);

    reg.dispatchSessionEvent(fakeSessionEvent());

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
