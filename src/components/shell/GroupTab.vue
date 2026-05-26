<script setup lang="ts">
/**
 * GroupTab — custom tab renderer for the OUTER dockview's body panels
 * (each panel = one group). Mirrors ChatTab.vue's design language but
 * showing group meta (color dot + name + session count badge).
 *
 * Wired in App.vue via `<DockviewVue>`'s `tab-components` map under the
 * `groupTab` name. Each outer body panel is added with
 * `tabComponent: 'groupTab'` and `params: { groupId }`.
 *
 * Phase 3b shipping minimum: render + close X. Right-click rename / color
 * picker / delete confirm comes in Phase 4 alongside multi-group CRUD.
 */

import { computed } from 'vue';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import { useGroupsActions } from '@/composables/useGroupsActions';
import { useConfirm } from 'primevue/useconfirm';
import { usePanelLifecycle } from '@/composables/usePanelLifecycle';

type UserParams = { groupId?: string };
type WrappedParams = {
  params?: UserParams;
  api?: import('dockview-core').DockviewPanelApi;
};
type IncomingParams = UserParams & WrappedParams;

const props = defineProps<{
  params: IncomingParams;
  api?: import('dockview-core').DockviewPanelApi;
}>();

const { panelApi, isActive } = usePanelLifecycle(props);
const groupsStore = useGroupsStore();
const groupsActions = useGroupsActions();
const confirm = useConfirm();

const groupId = computed(
  () => props.params?.params?.groupId ?? props.params?.groupId ?? panelApi.value?.id ?? '',
);

const meta = computed(() => groupsStore.groups.find((g) => g.id === groupId.value) ?? null);

const displayName = computed(() => meta.value?.name ?? '');

const color = computed(() => meta.value?.color ?? 'var(--p-primary-color)');

/// Session count from the inner dockview, if mounted. We can't easily
/// derive it from the cached body either since the cache lags one event,
/// but for inactive groups the cache is the freshest source we have.
const sessionCount = computed(() => {
  const id = groupId.value;
  const api = groupsStore.innerApis[id];
  if (api) return api.panels.length;
  const cached = groupsStore.innerBodiesCache[id];
  if (!cached || typeof cached !== 'object') return 0;
  const panels = (cached as Record<string, unknown>).panels;
  if (!panels || typeof panels !== 'object') return 0;
  return Object.keys(panels as Record<string, unknown>).length;
});

function onClose(event: MouseEvent): void {
  event.stopPropagation();
  const id = groupId.value;
  if (!id) return;

  // Deleting the last group is a no-op at the store level. UX: confirm
  // with the user before closing all sessions in this group.
  if (groupsStore.groups.length <= 1) return;

  const count = sessionCount.value;
  const detail =
    count > 0
      ? `Close ${count} session${count === 1 ? '' : 's'} in "${displayName.value}"?`
      : `Close empty group "${displayName.value}"?`;

  confirm.require({
    target: event.currentTarget as HTMLElement,
    message: detail,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Close',
    rejectLabel: 'Cancel',
    accept: () => {
      // useGroupsActions.deleteGroup handles the full orchestration:
      // closes sessions in this group, removes the outer body panel,
      // calls groupsStore.deleteGroup. Idempotent + safe.
      groupsActions.deleteGroup(id);
    },
  });
}
</script>

<template>
  <div
    class="group-tab"
    :class="{ 'group-tab-active': isActive }"
    :style="{ '--group-color': color }"
    :title="displayName"
  >
    <span
      class="group-tab-dot"
      aria-hidden="true"
    />
    <span class="group-tab-title">{{ displayName }}</span>
    <span
      v-if="sessionCount > 0"
      class="group-tab-badge"
      :aria-label="`${sessionCount} session${sessionCount === 1 ? '' : 's'}`"
    >{{ sessionCount }}</span>
    <button
      v-if="groupsStore.groups.length > 1"
      type="button"
      class="group-tab-close"
      aria-label="Close group"
      @pointerdown.stop
      @click="onClose"
    >
      <i
        class="pi pi-times"
        aria-hidden="true"
      />
    </button>
  </div>
</template>

<style scoped>
.group-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  margin: 2px 4px 0 0;
  border-top-left-radius: var(--p-border-radius-xl);
  border-top-right-radius: var(--p-border-radius-xl);
  border-bottom: 2px solid transparent;
  background: color-mix(
    in srgb,
    var(--group-color) 6%,
    var(--dv-inactivegroup-visiblepanel-tab-background-color, var(--p-surface-100))
  );
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  line-height: 1.25;
  max-width: 16rem;
  min-width: 0;
  height: calc(var(--dv-tabs-and-actions-container-height, 35px) - 4px);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-bottom-color 120ms ease;
}

.group-tab-active {
  background: color-mix(in srgb, var(--group-color) 18%, var(--p-content-background));
  color: var(--p-text-color);
  font-weight: 500;
  border-bottom-color: var(--group-color);
  /* Push the tab's bottom edge over the body to visually merge. */
  margin-bottom: -1px;
  padding-bottom: calc(0.3rem + 1px);
}

.group-tab:not(.group-tab-active):hover {
  background: color-mix(in srgb, var(--group-color) 12%, var(--p-content-background));
  color: var(--p-text-color);
}

.group-tab-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--group-color);
  flex: 0 0 auto;
}

.group-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}

.group-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--group-color) 28%, transparent);
  color: var(--p-text-color);
  font-size: 0.7rem;
  font-weight: 500;
  flex: 0 0 auto;
}

.group-tab-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease;
}

.group-tab:hover .group-tab-close,
.group-tab-active .group-tab-close,
.group-tab-close:focus-visible {
  opacity: 0.85;
}

.group-tab-close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--group-color) 35%, transparent);
}
</style>
