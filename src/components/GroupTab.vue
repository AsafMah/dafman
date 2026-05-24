<script setup lang="ts">
// Custom dockview tab renderer for group tabs in the outer (shell)
// dockview. Shows group name + session count badge. Used as the
// `tabComponent` for group panels.
//
// Follows the same prop-shape normalization as ChatTab.vue.

import { computed, ref, watchEffect, onBeforeUnmount } from "vue";
import type { DockviewPanelApi } from "dockview-core";
import { useGroupsStore } from "../stores/groupsStore";

type UserParams = { groupId?: string };
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

const panelApi = computed<DockviewPanelApi | undefined>(
  () => props.api ?? props.params?.api,
);

const groupId = computed(() => {
  const fromUserParams =
    props.params?.params?.groupId ?? props.params?.groupId;
  return fromUserParams ?? panelApi.value?.id ?? "";
});

const group = computed(() =>
  groupsStore.groups.find((g) => g.id === groupId.value),
);

const title = ref<string>(panelApi.value?.title ?? "");
const isActive = ref<boolean>(panelApi.value?.isActive ?? false);

let unsubTitle: (() => void) | null = null;
let unsubActive: (() => void) | null = null;

watchEffect((onCleanup) => {
  const api = panelApi.value;
  if (!api) return;
  title.value = api.title ?? "";
  isActive.value = api.isActive;
  unsubTitle?.();
  unsubActive?.();
  const titleSub = api.onDidTitleChange((e) => {
    title.value = e.title ?? "";
  });
  const activeSub = api.onDidActiveChange(() => {
    isActive.value = api.isActive;
  });
  unsubTitle = () => titleSub.dispose();
  unsubActive = () => activeSub.dispose();
  onCleanup(() => {
    unsubTitle?.();
    unsubActive?.();
    unsubTitle = null;
    unsubActive = null;
  });
});

onBeforeUnmount(() => {
  unsubTitle?.();
  unsubActive?.();
});

const displayTitle = computed(() => group.value?.name ?? title.value ?? "Group");

const sessionCount = computed(() =>
  groupsStore.sessionCounts.get(groupId.value) ?? 0,
);

function onClose(event: MouseEvent) {
  event.stopPropagation();
  if (groupsStore.groups.length <= 1) return; // can't close last group
  groupsStore.deleteGroup(groupId.value);
  panelApi.value?.close();
}

function onDoubleClick() {
  // Future: inline rename
}
</script>

<template>
  <div
    class="group-tab"
    :class="{ 'group-tab-active': isActive }"
    :title="displayTitle"
    @dblclick="onDoubleClick"
  >
    <span class="group-tab-title">{{ displayTitle }}</span>
    <span v-if="sessionCount > 0" class="group-tab-badge">
      {{ sessionCount }}
    </span>
    <button
      v-if="groupsStore.groups.length > 1"
      class="group-tab-close"
      aria-label="Close group"
      @pointerdown.stop
      @click.stop="onClose"
    >
      <i class="pi pi-times" />
    </button>
  </div>
</template>

<style scoped>
.group-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--p-text-muted-color);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}

.group-tab-active {
  color: var(--p-text-color);
  border-bottom-color: var(--p-primary-color);
}

.group-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.group-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color);
  font-size: 10px;
  font-weight: 600;
}

.group-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
  border-radius: 3px;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}

.group-tab:hover .group-tab-close {
  opacity: 1;
}

.group-tab-close:hover {
  background: var(--p-surface-200);
  color: var(--p-text-color);
}

:root.app-dark .group-tab-close:hover {
  background: var(--p-surface-700);
}
</style>
