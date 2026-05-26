/**
 * Boot-time layout restore + groups v3 migration logic.
 *
 * Used by `App.vue` once on mount; the function captures Pinia stores at
 * call time so it remains a thin composable rather than a constructor.
 *
 * Phase 3 lands the v3 nested-dockview design:
 *  - `groupsStore.hydrate(layout)` normalizes v2 / v3 / empty / corrupt
 *    layouts into a {groups, innerBodiesCache} shape
 *  - we resume the UNION of session ids across all cached inner bodies
 *  - the outer `<DockviewVue>` mounts; on @ready we seed the activity bar
 *    and add one outer body panel per group
 *  - each `GroupPanel.vue` mounts its inner `<DockviewVue>`; on inner
 *    @ready it `fromJSON`s the cached body for its group, which restores
 *    the chat panels with their session ids
 *
 * Persistence: `App.vue` subscribes to outer `onDidLayoutChange` (and per
 * the v3 plan, to each inner via the GroupPanel) and calls
 * `composePersistLayout` (via `groupsStore.serialize`) on debounce.
 */

import { ref } from 'vue';
import { useBootStore } from '@/stores/app/bootStore';
import {
  extractPanelIdsFromBody,
  useGroupsStore,
} from '@/stores/shell/groupsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useToastStore } from '@/stores/app/toastStore';

export interface BootLayout {
  restoreFromLayout: () => Promise<void>;
  flushPendingLayout: () => void;
}

export function useBootLayout(): BootLayout {
  const bootStore = useBootStore();
  const layoutStore = useLayoutStore();
  const sessionsStore = useSessionsStore();
  const settingsStore = useSettingsStore();
  const groupsStore = useGroupsStore();
  const toastStore = useToastStore();

  /// True when the outer api was not yet ready when `restoreFromLayout`
  /// finished. `flushPendingLayout` consumes this once the outer @ready
  /// fires.
  const pendingFlush = ref<boolean>(false);

  async function restoreFromLayout(): Promise<void> {
    const layoutPref = settingsStore.settings.layout;
    console.info('[boot] restoreFromLayout: hydrating groupsStore');

    // Hydrate normalizes v2 legacy / v3 / empty / corrupt all in one
    // path. After this, groupsStore.groups.length >= 1 and the
    // innerBodiesCache holds whatever sessions exist (the union below
    // walks across all groups).
    groupsStore.hydrate(layoutPref);

    // Collect session ids across all groups' cached bodies. v2 migrations
    // produce a single Default group with the legacy body in its cache;
    // v3 layouts may distribute sessions across multiple groups.
    const sessionIds = new Set<string>();
    for (const g of groupsStore.groups) {
      const body = groupsStore.innerBodiesCache[g.id];
      for (const id of extractPanelIdsFromBody(body)) {
        sessionIds.add(id);
      }
    }

    console.info(
      `[boot] restoreFromLayout: ${sessionIds.size} chat sessions to resume across ${groupsStore.groups.length} group(s)`,
    );

    if (sessionIds.size > 0) {
      bootStore.beginSessions(sessionIds.size);
      // Parallel resumes — safe because rpcGuard throws a real Error
      // (encoded AppErrorPayload) so the bridge doesn't swallow it.
      await Promise.all(
        Array.from(sessionIds).map((id) =>
          sessionsStore.restoreSession(id).finally(() => bootStore.markSessionRestored()),
        ),
      );
      console.info('[boot] restoreFromLayout: all resumes settled');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      bootStore.beginApplying();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    pendingFlush.value = true;
    if (layoutStore.api) flushPendingLayout();
  }

  /// Adds an outer body panel for every group in the store. The active
  /// group is activated last so it ends up focused. Called from
  /// `flushPendingLayout` after the outer api is ready and the activity
  /// bar has been seeded.
  function seedOuterGroupPanels(): void {
    const outer = layoutStore.api;
    if (!outer) return;
    let added = 0;
    for (const g of groupsStore.groups) {
      if (outer.getPanel(g.id)) continue;
      outer.addPanel({
        id: g.id,
        component: 'group',
        title: g.name,
        tabComponent: 'groupTab',
        params: { groupId: g.id, color: g.color, name: g.name },
      });
      added += 1;
    }
    console.info(
      `[boot] seedOuterGroupPanels: ${added} group panel(s) added; active=${groupsStore.activeGroupId ?? '(none)'}`,
    );
    if (groupsStore.activeGroupId) {
      const active = outer.getPanel(groupsStore.activeGroupId);
      active?.api.setActive();
    }
  }

  /// Applies the boot intent once the outer api is ready. Safe to call
  /// multiple times; the `pendingFlush` flag guards re-entry.
  function flushPendingLayout(): void {
    if (!pendingFlush.value) return;
    pendingFlush.value = false;

    const outer = layoutStore.api;
    if (!outer) {
      // Should not happen — flushPendingLayout is only called from
      // onDockReady, but be defensive in case future code paths invoke
      // it earlier.
      console.warn('[boot] flushPendingLayout called without outer api');
      pendingFlush.value = true;
      return;
    }

    try {
      // Always seed the activity bar — it lives in the outer dockview's
      // edge groups and is independent of body content.
      layoutStore.seedDefaultLayout();

      // Add a group panel per group. Active one focused last.
      seedOuterGroupPanels();
    } catch (err) {
      console.error('[boot] flushPendingLayout failed', err);
      toastStore.warn(
        'Layout restore failed',
        'The persisted layout could not be applied. Resetting to default.',
      );
      // Fall back to a fresh seed; hydrate already produced a Default
      // group, so re-seeding will recreate the outer panel.
      try {
        layoutStore.seedDefaultLayout();
        seedOuterGroupPanels();
      } catch (err2) {
        console.error('[boot] flushPendingLayout fallback also failed', err2);
      }
    }
  }

  return { restoreFromLayout, flushPendingLayout };
}
