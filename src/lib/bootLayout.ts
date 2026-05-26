/**
 * Boot-time layout restore + migration logic, extracted from `App.vue`.
 *
 * Used by `App.vue` once on mount; the function captures Pinia stores at
 * call time so it remains a thin composable rather than a constructor.
 *
 * The three "pending" refs handle the @ready race: the DockviewVue child's
 * onMounted (which fires `@ready`) runs from the parent's onMounted callback
 * stack, but we kick off the async `restoreFromLayout` from the same stack —
 * so the api may or may not be present when we have the layout to apply. The
 * refs let either side wake up the other.
 *
 * Phase 1 extraction is intentionally behavior-preserving: the v3 groups
 * migration is wired in phase 2.
 */

import { ref } from 'vue';
import {
  enforcePersistedEdgeMinimums,
  extractChatPanelIds,
  stripLegacyDetailsPanels,
} from '@/lib/layoutSanitize';
import { LAYOUT_SCHEMA_VERSION } from '@/ipc/types';
import { useBootStore } from '@/stores/app/bootStore';
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
  const toastStore = useToastStore();

  /// Layout-side pending state for the boot race. The dockview @ready event
  /// fires from the child component's `onMounted`, which races our parent's
  /// `onMounted` (which kicks off `restoreFromLayout`). We capture intent
  /// here and `flushPendingLayout` drains it once the api becomes available.
  const pendingRestoreLayout = ref<unknown>(null);
  /// If non-null, a v1 → v2 migration was detected. Drain by calling
  /// `seedDefaultLayout()` + `addPanel(id)` for each resumed session.
  const pendingMigrationSessions = ref<string[] | null>(null);
  /// True when there's no stored layout at all (fresh install or hard reset)
  /// — drain by calling `seedDefaultLayout()` only.
  const pendingFreshSeed = ref<boolean>(false);

  async function restoreFromLayout(): Promise<void> {
    const layoutPref = settingsStore.settings.layout;
    const layout = layoutPref?.dockview;
    const storedVersion = layoutPref?.schemaVersion ?? 1;

    if (storedVersion !== LAYOUT_SCHEMA_VERSION) {
      console.info(
        `[boot] restoreFromLayout: migrating layout v${storedVersion} → v${LAYOUT_SCHEMA_VERSION}`,
      );

      const sessionIds = layout ? extractChatPanelIds(layout) : [];

      if (sessionIds.length > 0) {
        bootStore.beginSessions(sessionIds.length);
        await Promise.all(
          sessionIds.map((id) =>
            sessionsStore.restoreSession(id).finally(() => bootStore.markSessionRestored()),
          ),
        );
        console.info('[boot] restoreFromLayout: migration — all resumes settled');
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        bootStore.beginApplying();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      pendingMigrationSessions.value = sessionIds;

      if (layoutStore.api) flushPendingLayout();

      return;
    }

    if (!layout || typeof layout !== 'object') {
      console.info('[boot] restoreFromLayout: no layout to restore — fresh seed');
      pendingFreshSeed.value = true;

      if (layoutStore.api) flushPendingLayout();

      return;
    }

    // stripLegacyDetailsPanels was a v1 sanitizer for stale per-session
    // session-details panel ids. Still useful for old layouts crossing the
    // v1→v2 boundary. Settings used to be stripped too because v1 didn't
    // always close it cleanly; in v2 Settings is a permanently seeded edge
    // tab so we DO want it preserved in the persisted layout (its expanded
    // width persists across reloads).
    const withoutLegacyDetails = stripLegacyDetailsPanels(layout);
    const sanitized = enforcePersistedEdgeMinimums(withoutLegacyDetails);
    const sessionIds = extractChatPanelIds(sanitized);

    console.info(`[boot] restoreFromLayout: ${sessionIds.length} chat sessions to resume`);

    if (sessionIds.length === 0) {
      pendingRestoreLayout.value = sanitized;

      if (layoutStore.api) flushPendingLayout();

      return;
    }

    bootStore.beginSessions(sessionIds.length);
    // Parallel resumes — safe again now that rpcGuard throws a real Error
    // (encoded AppErrorPayload). Previously this hung because Electrobun's
    // bridge drops non-Error throws (see src-bun/app/errors.ts comment).
    await Promise.all(
      sessionIds.map((id) =>
        sessionsStore.restoreSession(id).finally(() => bootStore.markSessionRestored()),
      ),
    );
    console.info('[boot] restoreFromLayout: all resumes settled, applying layout');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    bootStore.beginApplying();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    pendingRestoreLayout.value = sanitized;

    if (layoutStore.api) flushPendingLayout();
  }

  /// Applies whichever boot intent is set (v2 restore / v1 migration / fresh
  /// seed). Called from both `restoreFromLayout` (when dock is already
  /// ready) and `onDockReady` (when dock becomes ready after
  /// `restoreFromLayout` has already finished). Safe to call multiple
  /// times: each branch nulls its own state once drained.
  function flushPendingLayout(): void {
    if (pendingMigrationSessions.value !== null) {
      layoutStore.seedDefaultLayout();

      for (const id of pendingMigrationSessions.value) {
        layoutStore.addPanel(id);
      }

      pendingMigrationSessions.value = null;
      // Force a persist with the new schemaVersion so subsequent boots take
      // the fast path. The layout-change subscription in onDockReady will
      // fire from the addPanel calls; nudge it with an explicit save so we
      // don't depend on the debounce window.
      void settingsStore.persistLayout(layoutStore.snapshot());

      return;
    }

    if (pendingRestoreLayout.value !== null) {
      const ok = layoutStore.restore(pendingRestoreLayout.value);

      if (!ok) {
        toastStore.warn(
          'Layout restore failed',
          'The persisted dockview JSON was rejected. Resetting to default.',
        );
        layoutStore.seedDefaultLayout();
      } else {
        // Idempotent fill-in for any tabs that didn't exist when the layout
        // was last persisted (e.g. a new activity-bar entry shipped in a
        // code update).
        layoutStore.seedDefaultLayout();
      }

      pendingRestoreLayout.value = null;

      return;
    }

    if (pendingFreshSeed.value) {
      layoutStore.seedDefaultLayout();
      pendingFreshSeed.value = false;
    }
  }

  return { restoreFromLayout, flushPendingLayout };
}
