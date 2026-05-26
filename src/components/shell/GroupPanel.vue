<script setup lang="ts">
/**
 * GroupPanel — the outer-body host for one group's inner dockview.
 *
 * The outer dockview's body contains one of these per group; each one
 * renders its own `<DockviewVue>` (the "inner" dockview) which in turn
 * holds the chat / terminal / playground panels for that group.
 *
 * Per the v3 plan, this component:
 *  - registers its inner api with `groupsStore` on `@ready` so the rest
 *    of the app (layoutStore.bodyApi, composePersistLayout) can reach it
 *  - restores the cached inner body via `inner.api.fromJSON(...)` once on
 *    @ready (idempotent — the cache is empty on fresh boot)
 *  - subscribes to inner `onDidRemovePanel` to call `sessionsStore.closeSession`
 *    when a chat tab is closed by the user, skipping during programmatic
 *    moves (the `withMovingSession` flag on groupsStore)
 *  - unregisters on `onBeforeUnmount` AFTER taking a final body snapshot so
 *    state survives the outer's reorder-driven remount
 *
 * Phase 3a: eager mount (no lazy-mount placeholder yet). Per the rubber-duck
 * pass, lazy-mount is deferred to a follow-up commit if boot regresses past
 * the 130 ms gate; eager keeps the data flow simple.
 *
 * Props shape: dockview-vue passes `{ params, api, containerApi, tabLocation }`
 * initially, then re-wraps to `{ params: { params, api, ...} }` on the next
 * `update()`. Same normalization pattern as ChatPanel.vue.
 */

import { computed, onBeforeUnmount } from 'vue';
import {
  DockviewVue,
  type DockviewReadyEvent,
  type DockviewPanelApi,
} from 'dockview-vue';
import type { IDockviewPanel } from 'dockview-core';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';

type UserParams = { groupId?: string; color?: string; name?: string };
type WrappedParams = {
  params?: UserParams;
  api?: DockviewPanelApi;
  containerApi?: unknown;
};
type IncomingParams = UserParams & WrappedParams;

const props = defineProps<{
  params: IncomingParams;
  api?: DockviewPanelApi;
  containerApi?: unknown;
}>();

const userParams = computed<UserParams>(() => {
  const wrapped = props.params?.params;
  return wrapped ?? (props.params as UserParams);
});

const groupId = computed(() => userParams.value.groupId ?? '');

const groupsStore = useGroupsStore();
const sessionsStore = useSessionsStore();

let removeSub: { dispose(): void } | null = null;

function onInnerReady(event: DockviewReadyEvent): void {
  const id = groupId.value;
  if (!id) {
    console.warn('[GroupPanel] @ready without groupId in params; aborting');
    return;
  }

  const inner = event.api;
  groupsStore.registerInnerApi(id, inner);

  // Hydrate from cached body (if any). Phase 3 has no body to restore yet
  // (no sessions in a fresh Default group); the v2 migration in phase 4
  // wiring will populate the cache before this runs for existing users.
  const cached = groupsStore.getCachedInnerBody(id);
  if (cached !== undefined) {
    try {
      inner.fromJSON(cached as Parameters<typeof inner.fromJSON>[0]);
    } catch (err) {
      console.warn('[GroupPanel] inner.fromJSON failed for group', id, err);
    }
  }

  // Per-inner subscription. Closes the session only when the panel is
  // removed by user action (X button, programmatic close via
  // layoutStore.closePanel). Programmatic moves wrap the remove call in
  // `groupsStore.withMovingSession` so this handler skips them.
  removeSub = inner.onDidRemovePanel((panel: IDockviewPanel) => {
    if (groupsStore.isMovingSession(panel.id)) return;
    if (sessionsStore.sessions.some((s) => s.id === panel.id)) {
      void sessionsStore.closeSession(panel.id);
    }
  });
}

onBeforeUnmount(() => {
  const id = groupId.value;
  removeSub?.dispose();
  removeSub = null;
  if (id) {
    // `unregisterInnerApi` snapshots the final body into the cache so the
    // next mount (e.g. after an outer reorder repaint) can restore it.
    groupsStore.unregisterInnerApi(id);
  }
});
</script>

<template>
  <div class="group-panel-root">
    <DockviewVue
      class="group-inner"
      watermark-component="watermark"
      default-tab-component="chatTab"
      @ready="onInnerReady"
    />
  </div>
</template>

<style scoped>
.group-panel-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.group-inner {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
