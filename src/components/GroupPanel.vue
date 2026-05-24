<script setup lang="ts">
// Dockview panel component that renders a nested DockviewVue inside a
// group tab of the outer (shell) dockview. Each group gets its own
// independent dockview instance with its own body panels (chat sessions,
// terminals). Edge panels are NOT used inside group dockviews — they
// live in the outer shell dockview and are shared across all groups.
//
// Registered globally in main.ts as "groupPanel".

import { computed, onBeforeUnmount } from "vue";
import { DockviewVue, type DockviewReadyEvent } from "dockview-vue";
import type { DockviewPanelApi } from "dockview-core";
import { useGroupsStore } from "../stores/groupsStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useJobsStore } from "../stores/jobsStore";
import { useToastStore } from "../stores/toastStore";

type UserParams = { groupId?: string; groupName?: string; pendingLayout?: unknown };
type WrappedParams = {
  params?: UserParams;
  api?: DockviewPanelApi;
};
type IncomingParams = UserParams & WrappedParams;

const props = defineProps<{
  params: IncomingParams;
  api?: DockviewPanelApi;
}>();

const groupsStore = useGroupsStore();
const layoutStore = useLayoutStore();
const sessionsStore = useSessionsStore();
const jobsStore = useJobsStore();
const toastStore = useToastStore();

const userParams = computed<UserParams>(() => {
  const p = props.params;
  if (p && typeof p === "object" && "params" in p && p.params) {
    return p.params;
  }
  return (p as UserParams) ?? {};
});

const groupId = computed(() => userParams.value.groupId ?? "");

function onReady(event: DockviewReadyEvent) {
  const id = groupId.value;
  if (!id) return;

  // Register this group's dockview API with the layout store.
  layoutStore.registerGroupApi(id, event.api);

  // If this is the active group, make it the body API.
  if (groupsStore.activeGroupId === id) {
    layoutStore.setBodyApi(event.api);
  }

  // Handle session panel removal inside this group's dockview.
  event.api.onDidRemovePanel((panel) => {
    if (sessionsStore.sessions.some((s) => s.id === panel.id)) {
      const record = sessionsStore.getSession(panel.id);
      const sessionBusy =
        jobsStore.hasActiveJobsForSession(panel.id) ||
        record?.isThinking ||
        (record?.pendingRequests?.length ?? 0) > 0;
      if (sessionBusy) {
        toastStore.info(
          "Session detached",
          "Session is still busy. Reopen from the Sessions sidebar.",
        );
      } else {
        void sessionsStore.closeSession(panel.id);
      }
    }
  });

  // Restore the group's layout from the pending data passed via params.
  const pendingLayout = userParams.value.pendingLayout;
  if (pendingLayout && typeof pendingLayout === "object") {
    try {
      event.api.fromJSON(
        pendingLayout as Parameters<typeof event.api.fromJSON>[0],
      );
    } catch (err) {
      console.error(`[GroupPanel] fromJSON failed for group ${id}`, err);
    }
  }
}

onBeforeUnmount(() => {
  const id = groupId.value;
  if (id) {
    layoutStore.unregisterGroupApi(id);
  }
});
</script>

<template>
  <div class="group-panel">
    <DockviewVue
      class="group-dock"
      watermark-component="watermark"
      default-tab-component="chatTab"
      @ready="onReady"
    />
  </div>
</template>

<style scoped>
.group-panel {
  width: 100%;
  height: 100%;
  display: flex;
  min-width: 0;
  min-height: 0;
}

.group-dock {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}
</style>
