// notificationsStore tests. The `Notification` constructor isn't
// available in happy-dom by default, so we stub it before each test.
// The store gates fire() on three things:
//   1. browser permission === 'granted'
//   2. settings toggle for the matching kind
//   3. the should-fire context check (done at the call site, not here)
//
// These tests cover (1) and (2). The "is the session foregrounded?"
// gate lives in sessionsStore and is covered there.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { useNotificationsStore } from '../notificationsStore';
import { useSettingsStore } from '../settingsStore';

interface FakeNotification {
  title: string;
  body: string | undefined;
  tag: string | undefined;
  onclick: (() => void) | null;
  close(): void;
}

let constructed: FakeNotification[] = [];
let permissionState: NotificationPermission = 'granted';

class StubNotification {
  static permission: NotificationPermission = 'granted';
  static async requestPermission(): Promise<NotificationPermission> {
    return permissionState;
  }
  title: string;
  body: string | undefined;
  tag: string | undefined;
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.body = options?.body;
    this.tag = options?.tag;
    constructed.push(this as unknown as FakeNotification);
  }
  close() {}
}

function installStubs(state: NotificationPermission = 'granted') {
  constructed = [];
  permissionState = state;
  StubNotification.permission = state;
  (globalThis as unknown as { Notification: typeof StubNotification }).Notification =
    StubNotification;
}

function uninstallStubs() {
  // happy-dom doesn't ship Notification; remove our stub so the
  // store's "unsupported" path is reachable in dedicated tests.
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
}

describe('notificationsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    installStubs('granted');
  });

  afterEach(() => {
    uninstallStubs();
  });

  test('permission picks up Notification.permission on init', () => {
    const store = useNotificationsStore();
    expect(store.permission).toBe('granted');
  });

  test('notify() fires when settings + permission allow', () => {
    const store = useNotificationsStore();
    const settings = useSettingsStore();
    // Default settings.notifications has waitingForInput=true.
    settings.settings.notifications = { turnEnd: true, waitingForInput: true };
    const fired = store.notify({
      kind: 'waitingForInput',
      title: 'Test',
      body: 'hi',
      sessionId: 's1',
    });
    expect(fired).toBe(true);
    expect(constructed).toHaveLength(1);
    expect(constructed[0]?.title).toBe('Test');
  });

  test('notify() suppressed when matching settings toggle is off', () => {
    const store = useNotificationsStore();
    const settings = useSettingsStore();
    settings.settings.notifications = { turnEnd: false, waitingForInput: true };
    const fired = store.notify({
      kind: 'turnEnd',
      title: 'Test',
      body: 'hi',
    });
    expect(fired).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  test("notify() suppressed when permission isn't granted", () => {
    installStubs('denied');
    const store = useNotificationsStore();
    const settings = useSettingsStore();
    settings.settings.notifications = { turnEnd: true, waitingForInput: true };
    const fired = store.notify({
      kind: 'waitingForInput',
      title: 'T',
      body: 'B',
    });
    expect(fired).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  test('requestPermission resolves through Notification.requestPermission', async () => {
    installStubs('default');
    const store = useNotificationsStore();
    expect(store.permission).toBe('default');
    permissionState = 'granted';
    StubNotification.permission = 'granted';
    const result = await store.requestPermission();
    expect(result).toBe('granted');
    expect(store.permission).toBe('granted');
  });

  test('notify() returns false silently when Notification is unsupported', () => {
    uninstallStubs();
    const store = useNotificationsStore();
    const settings = useSettingsStore();
    settings.settings.notifications = { turnEnd: true, waitingForInput: true };
    expect(store.permission).toBe('unsupported');
    const fired = store.notify({
      kind: 'waitingForInput',
      title: 'T',
      body: 'B',
    });
    expect(fired).toBe(false);
  });
});
