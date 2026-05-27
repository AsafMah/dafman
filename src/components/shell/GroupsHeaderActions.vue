<script setup lang="ts">
/**
 * Header actions component for the OUTER dockview. Rendered into the
 * right-header-actions slot of every outer group — we filter to only
 * render the + button inside the body group that hosts our group
 * panels (component === 'group').
 *
 * Bug #2 from 2026-05-27: "No + button on groups, so no real way to
 * create new ones, i guess except for the command". This component is
 * the fix — clicking + invokes `useGroupsActions.newGroup()`, which
 * adds a new outer body panel and activates it.
 */

import { computed } from 'vue';
import { useGroupsActions } from '@/composables/useGroupsActions';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import type { IDockviewPanel } from 'dockview-core';

interface HeaderActionParams {
  panels?: IDockviewPanel[];
  activePanel?: IDockviewPanel;
  isGroupActive?: boolean;
}

const props = defineProps<{ params: HeaderActionParams }>();

const groupsActions = useGroupsActions();
const groupsStore = useGroupsStore();

/// Only render the + button inside the body strip that hosts group
/// panels. Detect by checking the panel ids against groupsStore — much
/// cleaner than trying to introspect dockview's panel metadata.
const isGroupsStrip = computed(() => {
  const panels = props.params?.panels ?? [];
  if (panels.length === 0) return false;
  return panels.every((p) => groupsStore.isGroupPanelId(p.id));
});

function onClick(event: MouseEvent): void {
  event.stopPropagation();
  groupsActions.newGroup();
}
</script>

<template>
  <button
    v-if="isGroupsStrip"
    type="button"
    class="groups-new-button"
    title="New group (Ctrl+Shift+G)"
    aria-label="New group"
    @pointerdown.stop
    @click="onClick"
  >
    <i
      class="pi pi-plus"
      aria-hidden="true"
    />
  </button>
</template>

<style scoped>
.groups-new-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Match GroupTab vertical placement so the + lines up with the
   * other tabs' text/X centers. GroupTab uses height: calc(var(...)
   * - 4px) and margin: 2px 4px 0 0; mirror that. */
  height: calc(var(--dv-tabs-and-actions-container-height, 35px) - 4px);
  width: calc(var(--dv-tabs-and-actions-container-height, 35px) - 4px);
  margin: 2px 0 0 4px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.groups-new-button:hover {
  background: var(--p-surface-200);
  color: var(--p-text-color);
}

.groups-new-button:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}
</style>
