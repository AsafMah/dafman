// The single consumer of session reducer effects (#157).
//
// `sessionReducer.ts` is pure — it mutates the `SessionRecord` and returns
// `SessionEffect[]`. This module is the one place that turns those into
// real UI side-effects, so the "when do we toast / interrupt the user?"
// policy lives in exactly one spot instead of smeared across the reducer
// and the store.

import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useNotificationsStore } from '@/stores/app/notificationsStore';
import { useToastStore } from '@/stores/app/toastStore';
import type { SessionEffect } from './sessionReducer';

/// True when a session isn't visible to the user right now — focus is on
/// another panel, or the app window is hidden / blurred. OS notifications
/// gate on this so we never interrupt the session the user is watching.
export function shouldNotify(sessionId: string): boolean {
  if (useLayoutStore().activeSessionId !== sessionId) return true;

  if (typeof document !== 'undefined' && document.hidden) return true;

  if (typeof document !== 'undefined' && !document.hasFocus()) return true;

  return false;
}

/// Run reducer effects: toasts fire immediately; OS notifications fire
/// only when the owning session isn't being watched. Both turn-end and
/// waiting-for-input notifications flow through here.
export function runSessionEffects(effects: readonly SessionEffect[]): void {
  for (const effect of effects) {
    if (effect.kind === 'toast') {
      useToastStore()[effect.severity](effect.title, effect.body);
      continue;
    }

    if (!shouldNotify(effect.sessionId)) continue;

    useNotificationsStore().notify({
      kind: effect.notifyKind,
      title: effect.title,
      body: effect.body,
      sessionId: effect.sessionId,
      tag: effect.tag,
    });
  }
}
