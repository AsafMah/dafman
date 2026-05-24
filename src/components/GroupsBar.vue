<script setup lang="ts">
// Horizontal bar showing group tabs above the dockview body. Only
// visible when the app is in groups mode (2+ groups). Provides:
// - click to switch groups
// - "+" button to create a new group
// - close button per group (when >1 group)
// - double-click to rename

import { computed, ref, nextTick } from "vue";
import { useGroupsStore } from "../stores/groupsStore";
import { useLayoutStore } from "../stores/layoutStore";

const groupsStore = useGroupsStore();
const layoutStore = useLayoutStore();

const editingId = ref<string | null>(null);
const editInput = ref<HTMLInputElement | null>(null);

const groups = computed(() => groupsStore.groups);
const activeId = computed(() => groupsStore.activeGroupId);

function switchTo(id: string) {
  groupsStore.switchTo(id);
  // Activate the group's panel in the shell dockview so dockview
  // makes it visible and fires onDidActivePanelChange.
  const shell = layoutStore.shellApi;
  if (shell) {
    const panel = shell.getPanel(`group-${id}`);
    if (panel) panel.api.setActive();
  }
}

function addGroup() {
  const g = groupsStore.createGroup();
  layoutStore.addGroupPanel(g.id, g.name);
}

function startRename(id: string) {
  editingId.value = id;
  nextTick(() => {
    editInput.value?.focus();
    editInput.value?.select();
  });
}

function finishRename(id: string, name: string) {
  const trimmed = name.trim();
  if (trimmed) {
    groupsStore.renameGroup(id, trimmed);
  }
  editingId.value = null;
}

function closeGroup(id: string) {
  if (groups.value.length <= 1) return;
  layoutStore.removeGroupPanel(id);
}

function sessionCount(id: string): number {
  return groupsStore.sessionCounts.get(id) ?? 0;
}
</script>

<template>
  <div class="groups-bar">
    <div
      v-for="g in groups"
      :key="g.id"
      class="group-tab"
      :class="{ 'group-tab--active': g.id === activeId }"
      @click="switchTo(g.id)"
      @dblclick.stop="startRename(g.id)"
    >
      <template v-if="editingId === g.id">
        <input
          ref="editInput"
          class="group-tab__rename"
          :value="g.name"
          @blur="finishRename(g.id, ($event.target as HTMLInputElement).value)"
          @keydown.enter="finishRename(g.id, ($event.target as HTMLInputElement).value)"
          @keydown.escape="editingId = null"
          @click.stop
        />
      </template>
      <template v-else>
        <span class="group-tab__name">{{ g.name }}</span>
        <span v-if="sessionCount(g.id) > 0" class="group-tab__badge">
          {{ sessionCount(g.id) }}
        </span>
      </template>
      <button
        v-if="groups.length > 1"
        class="group-tab__close"
        aria-label="Close group"
        @pointerdown.stop
        @click.stop="closeGroup(g.id)"
      >
        <i class="pi pi-times" />
      </button>
    </div>
    <button class="groups-bar__add" aria-label="New group" @click="addGroup">
      <i class="pi pi-plus" />
    </button>
  </div>
</template>

<style scoped>
.groups-bar {
  display: flex;
  align-items: stretch;
  gap: 0;
  height: 32px;
  min-height: 32px;
  padding: 0 4px;
  background: var(--p-surface-100);
  border-bottom: 1px solid var(--p-surface-300);
  overflow-x: auto;
  overflow-y: hidden;
  user-select: none;
}

:root.app-dark .groups-bar {
  background: var(--p-surface-900);
  border-bottom-color: var(--p-surface-700);
}

.group-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--p-text-muted-color);
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}

.group-tab:hover {
  color: var(--p-text-color);
}

.group-tab--active {
  color: var(--p-text-color);
  border-bottom-color: var(--p-primary-color);
}

.group-tab__name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.group-tab__badge {
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

.group-tab__close {
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

.group-tab:hover .group-tab__close {
  opacity: 1;
}

.group-tab__close:hover {
  background: var(--p-surface-200);
  color: var(--p-text-color);
}

:root.app-dark .group-tab__close:hover {
  background: var(--p-surface-700);
}

.group-tab__rename {
  width: 100px;
  font-size: 12px;
  padding: 1px 4px;
  border: 1px solid var(--p-primary-color);
  border-radius: 3px;
  background: var(--p-surface-0);
  color: var(--p-text-color);
  outline: none;
}

:root.app-dark .group-tab__rename {
  background: var(--p-surface-800);
}

.groups-bar__add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  border: none;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
  border-radius: 3px;
  margin: 4px 2px;
  transition: background 0.15s, color 0.15s;
}

.groups-bar__add:hover {
  background: var(--p-surface-200);
  color: var(--p-text-color);
}

:root.app-dark .groups-bar__add:hover {
  background: var(--p-surface-700);
}
</style>
