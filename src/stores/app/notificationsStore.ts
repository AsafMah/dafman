// OS-native notifications wrapper.
//
// Thin store over the browser `Notification` API. Gates every fire
// on:
//   1. Settings toggle for the matching kind (`turnEnd` /
//      `waitingForInput`).
//   2. Browser permission state — if not yet `granted`, the call
//      becomes a no-op. We ask via `requestPermission()` lazily,
//      driven by the Settings UI (NOT on app load — the prompt
//      mid-launch is jarring).
//   3. Should-fire context — the call site decides whether the
//      session is "in the foreground" (active dockview panel + app
//      window focused) and skips firing if it is. We don't need to
//      notify about something the user can already see.
//
// Click handler: focuses the app window via `window.focus()` and
// dispatches a `dafman:focus-session` CustomEvent that App.vue can
// listen for to activate the relevant panel. The receiver is wired
// up at component mount.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useSettingsStore } from '@/stores/app/settingsStore';

export type NotificationKind = 'turnEnd' | 'waitingForInput';

export interface NotifyOptions {
  /// Which settings toggle gates this notification.
  kind: NotificationKind;
  /// Title shown in the OS notification.
  title: string;
  /// Body text.
  body: string;
  /// Session id to surface on click — App.vue activates that panel.
  sessionId?: string;
  /// Optional tag — duplicate notifications with the same tag
  /// collapse in the OS notification tray, so streaming turn-ends
  /// don't flood the user.
  tag?: string;
}

type PermissionState = NotificationPermission | 'unsupported';

export const useNotificationsStore = defineStore('notifications', () => {
  const settingsStore = useSettingsStore();

  const permission = ref<PermissionState>(detectInitialPermission());

  function detectInitialPermission(): PermissionState {
    if (typeof Notification === 'undefined') return 'unsupported';

    return Notification.permission;
  }

  /// Async — pops the OS prompt. Returns the resulting state.
  /// No-ops when notifications aren't supported.
  async function requestPermission(): Promise<PermissionState> {
    if (typeof Notification === 'undefined') {
      permission.value = 'unsupported';

      return 'unsupported';
    }

    if (Notification.permission === 'granted') {
      permission.value = 'granted';

      return 'granted';
    }

    try {
      const result = await Notification.requestPermission();

      permission.value = result;

      return result;
    } catch {
      // Some browsers throw on the legacy callback path; treat as
      // denied so the UI can show the right state.
      permission.value = 'denied';

      return 'denied';
    }
  }

  /// True when we can actually fire a notification right now (kind
  /// is enabled in settings, permission is granted).
  const canFire = computed(() => (kind: NotificationKind): boolean => {
    if (permission.value !== 'granted') return false;

    const prefs = settingsStore.settings.notifications;

    if (!prefs) return false;

    return prefs[kind];
  });

  /// Fire a notification, honoring settings + permission. Returns
  /// `false` if the call was suppressed (toggle off / permission
  /// denied / browser unsupported) so the caller can fall back to
  /// inner indicators alone.
  function notify(options: NotifyOptions): boolean {
    if (!canFire.value(options.kind)) return false;

    try {
      const n = new Notification(options.title, {
        body: options.body,
        tag: options.tag,
        // Future: an icon path here. Branding ticket carries this.
      });

      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* no-op */
        }

        if (options.sessionId) {
          window.dispatchEvent(
            new CustomEvent('dafman:focus-session', {
              detail: { sessionId: options.sessionId },
            }),
          );
        }

        n.close();
      };

      return true;
    } catch (err) {
      // Don't toast — this fires from a hot path (every turn_end).
      console.error('[notifications] new Notification threw', err);

      return false;
    }
  }

  return {
    permission,
    canFire,
    requestPermission,
    notify,
  };
});
