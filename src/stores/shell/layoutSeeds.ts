/// Layout serialization and default-layout seeding, extracted from
/// layoutStore.ts. Receives refs as arguments; never calls store
/// hooks at module level.

import type { ShallowRef } from 'vue';
import type { DockviewApi } from 'dockview-core';
import { LEFT_ACTIVITY_TABS, RIGHT_ACTIVITY_TABS, TAB_COMPONENTS } from '@/constants/panels';

export interface SeedsCtx {
  api: ShallowRef<DockviewApi | null>;
  enforceKnownEdgeMinimums: () => void;
}

export function buildLayoutSeeds(ctx: SeedsCtx) {
  const { api, enforceKnownEdgeMinimums } = ctx;

  /// Returns dockview's full serialized layout, or null when the api
  /// isn't ready yet. Callers (settingsStore writers) treat this as an
  /// opaque blob — only dockview interprets it.
  function snapshot(): unknown {
    return api.value?.toJSON() ?? null;
  }

  /// Restores a previously-snapshotted layout. Caller is responsible
  /// for ensuring any session-backed panels referenced by the layout
  /// have been resumed first (so the slot can find their record).
  ///
  /// Wrapped in try/catch because a malformed persisted JSON
  /// (legacy panel ids, dangling group refs, schema drift across
  /// dockview versions) makes `fromJSON` throw — and an unhandled
  /// throw here propagates up through `App.vue`'s async `onMounted`,
  /// preventing `bootStore.markReady()` from ever firing and leaving
  /// the splash stuck on "Applying layout…" / "Restoring sessions…".
  /// Returns true on success, false on a swallowed failure (caller
  /// can fall back to opening the Sessions sidebar at default size).
  function restore(layout: unknown): boolean {
    const dock = api.value;

    if (!dock || !layout || typeof layout !== 'object') return false;

    try {
      dock.fromJSON(layout as Parameters<DockviewApi['fromJSON']>[0]);
      enforceKnownEdgeMinimums();

      return true;
    } catch (err) {
      console.error('[layoutStore.restore] dockview.fromJSON threw — clearing layout', err);

      return false;
    }
  }

  /// Seeds the canonical v2 edge-group layout: a left edge group with
  /// the activity-bar tabs and a right edge group with the right-side
  /// tabs (session details + library). Both groups start collapsed —
  /// the user opens one by clicking its tab in the strip.
  ///
  /// Idempotent: skips work that's already in place. Safe to call
  /// during boot before any chat panel resumes happen.
  ///
  /// Logs total wall time so we can keep the boot-cost gate honest
  /// per plan §4 (>50 ms regression triggers a lazy-mount detour).
  function seedDefaultLayout(): void {
    const dock = api.value;

    if (!dock) return;

    const startedAt = performance.now();

    for (const [position, seeds] of [
      ['left', LEFT_ACTIVITY_TABS],
      ['right', RIGHT_ACTIVITY_TABS],
    ] as const) {
      // Edge group min = max(all tabs' minimums) because dockview's
      // splitview enforces ONE static minimumSize per edge group
      // and there's no clean public API to mutate it after creation
      // (the splitview's view.minimumSize getter reads from a
      // private `_expandedMinimumSize` field set only at addEdgeGroup
      // time). Setting it to the max keeps the most-demanding tab
      // from ever being clipped.
      //
      // Initial size = the FIRST seeded tab's preferred initial,
      // clamped up to the max-min floor if necessary.
      const firstSeed = seeds[0];
      const maxMin = seeds.reduce((acc, s) => Math.max(acc, s.minimumSize), 0);
      const initialSize = Math.max(firstSeed?.initialSize ?? 280, maxMin);
      const minimumSize = maxMin;

      const edge =
        dock.getEdgeGroup(position) ??
        dock.addEdgeGroup(position, {
          id: `edge-${position}`,
          initialSize,
          minimumSize,
          // Explicit collapsedSize: dockview's default is 35px which
          // crowds our 28x28 icons. 44px matches most dockview themes
          // and leaves comfortable padding.
          collapsedSize: 44,
          collapsed: true,
        });

      for (const seed of seeds) {
        if (dock.getPanel(seed.id)) continue;

        dock.addPanel({
          id: seed.id,
          component: seed.component,
          tabComponent: TAB_COMPONENTS.activityTab,
          title: seed.title,
          params: { icon: seed.icon, title: seed.title },
          position: { referenceGroup: edge.id },
        });
      }

      if (!edge.isCollapsed()) edge.collapse();
    }

    const elapsedMs = Math.round(performance.now() - startedAt);

    console.info(`[layoutStore.seedDefaultLayout] seeded edge tabs in ${elapsedMs}ms`);
  }

  return { snapshot, restore, seedDefaultLayout };
}
