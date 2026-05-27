/**
 * Shared debounced layout-persist scheduler.
 *
 * The v3 nested-dockview design has TWO categories of layout changes:
 *
 *  1. Outer changes — add/remove group panel, edge group resize,
 *     activity-bar tab visibility. Fired on `outer.onDidLayoutChange`
 *     and subscribed in `App.vue:onDockReady`.
 *
 *  2. Inner changes — add/remove chat session, terminal panel, split
 *     within a group. Fired on the ACTIVE GROUP's inner dockview's own
 *     `onDidLayoutChange` and subscribed in `GroupPanel.vue:onInnerReady`.
 *
 * BOTH need to trigger the same persist path so that the user's
 * sessions don't get silently dropped (the bug the user reported as
 * "Restart didn't load the data" on 2026-05-27 — inner changes were
 * never subscribed and `settings.layout` stayed at the v2 placeholder
 * `{ dockview: null }`).
 *
 * This module is the single shared debounce point. Both subscribers
 * call `schedulePersist()`; the function coalesces frame-rate event
 * floods (drag-resize fires `onDidLayoutChange` once per frame) into a
 * single ~300ms-after-quiet settings write.
 */

import { useGroupsStore } from '@/stores/shell/groupsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSettingsStore } from '@/stores/app/settingsStore';

const DEBOUNCE_MS = 300;

let timer: ReturnType<typeof setTimeout> | null = null;

export function schedulePersist(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const layoutStore = useLayoutStore();
    const groupsStore = useGroupsStore();
    const settingsStore = useSettingsStore();
    const outer = layoutStore.api;
    if (!outer) return;
    const layout = groupsStore.serialize(outer.toJSON());
    void settingsStore.persistGroupedLayout(layout);
  }, DEBOUNCE_MS);
}

/// Cancels any pending save. Used by App.vue's cleanup path AND by
/// HMR's dispose hook below.
export function cancelPendingPersist(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

// HMR cleanup. Without this, a 300 ms-pending persist queued by the
// previous module instance would fire AFTER the new module has loaded,
// reading from a stale Pinia singleton and either silently overwriting
// the live layout with junk or crashing when the old store handles
// have been disposed. Caught in the code-review pass 2026-05-27.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelPendingPersist();
  });
}
