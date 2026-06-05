// The effects consumer owns the "when do we toast / interrupt the user?"
// policy for BOTH turn-end and waiting-for-input notifications (#157).

import { describe, expect, test, beforeEach } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { runSessionEffects, shouldNotify } from '@/stores/chat/sessionEffects';
import type { SessionEffect } from '@/stores/chat/sessionReducer';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useToastStore } from '@/stores/app/toastStore';
import { useNotificationsStore } from '@/stores/app/notificationsStore';

function captureToasts() {
  const calls: Array<{ severity: string; title: string }> = [];
  const toasts = useToastStore();
  for (const severity of ['info', 'success', 'warn', 'error'] as const) {
    toasts[severity] = (summary: string, detail?: string) => {
      calls.push({ severity, title: summary });
      return { id: 0, severity, summary, detail, life: 0 };
    };
  }
  return calls;
}

function captureNotifications() {
  const calls: Array<{ kind: string; sessionId?: string }> = [];
  const notifications = useNotificationsStore();
  notifications.notify = (payload) => {
    calls.push({ kind: payload.kind, sessionId: payload.sessionId });
    return true;
  };
  return calls;
}

const turnEnd: SessionEffect = {
  kind: 'notify',
  notifyKind: 'turnEnd',
  sessionId: 's1',
  title: 'S1',
  body: 'Turn complete.',
  tag: 's1:turnEnd',
};
const waiting: SessionEffect = {
  kind: 'notify',
  notifyKind: 'waitingForInput',
  sessionId: 's1',
  title: 'S1',
  body: 'needs input',
  tag: 's1:pending:r1',
};

describe('shouldNotify', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.hasFocus = () => true;
  });

  test('fires when the session is not the active panel', () => {
    useLayoutStore().activeSessionId = 'other';
    expect(shouldNotify('s1')).toBe(true);
  });

  test('suppressed when the session is active and the app is focused + visible', () => {
    useLayoutStore().activeSessionId = 's1';
    expect(shouldNotify('s1')).toBe(false);
  });

  test('fires for the active session when the app window is hidden', () => {
    useLayoutStore().activeSessionId = 's1';
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    expect(shouldNotify('s1')).toBe(true);
  });

  test('fires for the active session when the app window is blurred', () => {
    useLayoutStore().activeSessionId = 's1';
    document.hasFocus = () => false;
    expect(shouldNotify('s1')).toBe(true);
  });
});

describe('runSessionEffects', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.hasFocus = () => true;
  });

  test('toasts fire immediately, regardless of which session is active', () => {
    useLayoutStore().activeSessionId = 's1';
    const toasts = captureToasts();

    runSessionEffects([{ kind: 'toast', severity: 'warn', title: 'needs sign-in', body: 'x' }]);

    expect(toasts).toEqual([{ severity: 'warn', title: 'needs sign-in' }]);
  });

  test('both notify kinds are gated by the same visibility policy', () => {
    // Active + visible → both turn-end and waiting-for-input are suppressed.
    useLayoutStore().activeSessionId = 's1';
    const suppressed = captureNotifications();
    runSessionEffects([turnEnd, waiting]);
    expect(suppressed).toEqual([]);

    // Not active → both fire.
    useLayoutStore().activeSessionId = 'other';
    const fired = captureNotifications();
    runSessionEffects([turnEnd, waiting]);
    expect(fired.map((c) => c.kind)).toEqual(['turnEnd', 'waitingForInput']);
  });
});
