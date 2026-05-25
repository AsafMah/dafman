<script setup lang="ts">
import { ref, nextTick } from "vue";
import { storeToRefs } from "pinia";
import { useGroupsStore } from "../stores/groupsStore";
import { useConfirm } from "primevue/useconfirm";

const groupsStore = useGroupsStore();
const { groups, activeGroupId } = storeToRefs(groupsStore);
const confirm = useConfirm();

// ── Rename ─────────────────────────────────────────────────────
const renamingId = ref<string | null>(null);
const renameInput = ref<HTMLInputElement | null>(null);
const renameValue = ref("");

function startRename(id: string) {
  const g = groups.value.find((g) => g.id === id);
  if (!g) return;
  renameValue.value = g.name;
  renamingId.value = id;
  nextTick(() => renameInput.value?.select());
}

function commitRename() {
  if (renamingId.value && renameValue.value.trim()) {
    groupsStore.renameGroup(renamingId.value, renameValue.value.trim());
  }
  renamingId.value = null;
}

// ── Context menu ───────────────────────────────────────────────
const contextMenuId = ref<string | null>(null);
const contextMenuPos = ref({ x: 0, y: 0 });

function onContextMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  contextMenuId.value = id;
  contextMenuPos.value = { x: e.clientX, y: e.clientY };

  const close = () => {
    contextMenuId.value = null;
    window.removeEventListener("click", close);
  };
  // Close on next click anywhere
  requestAnimationFrame(() => window.addEventListener("click", close));
}

function handleContextAction(action: "rename" | "delete") {
  const id = contextMenuId.value;
  contextMenuId.value = null;
  if (!id) return;
  if (action === "rename") {
    startRename(id);
  } else if (action === "delete") {
    confirm.require({
      group: "groups-bar",
      message: "Delete this group? Sessions in it will be closed.",
      header: "Delete Group",
      acceptClass: "p-button-danger",
      accept: () => void groupsStore.deleteGroup(id),
    });
  }
}
</script>

<template>
  <!-- Show full bar when 2+ groups; show just the + button when 1 group -->
  <div v-if="groups.length > 1" class="groups-bar">
    <button
      v-for="g in groups"
      :key="g.id"
      class="group-tab"
      :class="{ active: g.id === activeGroupId }"
      @click="groupsStore.switchGroup(g.id)"
      @dblclick="startRename(g.id)"
      @contextmenu="onContextMenu($event, g.id)"
    >
      <template v-if="renamingId === g.id">
        <input
          ref="renameInput"
          v-model="renameValue"
          class="rename-input"
          @blur="commitRename"
          @keydown.enter="commitRename"
          @keydown.escape="renamingId = null"
          @click.stop
        />
      </template>
      <template v-else>
        <span class="group-name">{{ g.name }}</span>
        <span class="group-count">{{ groupsStore.sessionCount(g.id) }}</span>
      </template>
    </button>
    <button class="group-tab add-tab" @click="groupsStore.createGroup('New Group')" title="New Group">
      +
    </button>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenuId"
        class="group-context-menu"
        :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
      >
        <button @click="handleContextAction('rename')">Rename</button>
        <button
          @click="handleContextAction('delete')"
          :disabled="groups.length <= 1"
        >
          Delete
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.groups-bar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 2px 4px;
  background: var(--p-surface-50);
  border-bottom: 1px solid var(--p-surface-200);
  min-height: 28px;
  flex-shrink: 0;
}

:root.p-dark .groups-bar {
  background: var(--p-surface-900);
  border-bottom-color: var(--p-surface-700);
}

.group-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border: 1px solid transparent;
  border-radius: 4px 4px 0 0;
  background: transparent;
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}

.group-tab:hover {
  background: var(--p-surface-100);
  color: var(--p-text-color);
}

:root.p-dark .group-tab:hover {
  background: var(--p-surface-800);
}

.group-tab.active {
  background: var(--p-surface-0);
  color: var(--p-text-color);
  border-color: var(--p-surface-200);
  border-bottom-color: var(--p-surface-0);
}

:root.p-dark .group-tab.active {
  background: var(--p-surface-800);
  border-color: var(--p-surface-700);
  border-bottom-color: var(--p-surface-800);
}

.group-count {
  font-size: 0.7rem;
  background: var(--p-surface-200);
  color: var(--p-text-muted-color);
  border-radius: 8px;
  padding: 0 5px;
  min-width: 16px;
  text-align: center;
}

:root.p-dark .group-count {
  background: var(--p-surface-700);
}

.add-tab {
  color: var(--p-text-muted-color);
  font-weight: bold;
  font-size: 1rem;
  padding: 2px 8px;
}

.rename-input {
  background: var(--p-surface-0);
  color: var(--p-text-color);
  border: 1px solid var(--p-primary-color);
  border-radius: 2px;
  padding: 0 4px;
  font-size: 0.8rem;
  width: 80px;
  outline: none;
}

:root.p-dark .rename-input {
  background: var(--p-surface-800);
}

.group-context-menu {
  position: fixed;
  z-index: 9999;
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  min-width: 100px;
}

:root.p-dark .group-context-menu {
  background: var(--p-surface-800);
  border-color: var(--p-surface-700);
}

.group-context-menu button {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--p-text-color);
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
}

.group-context-menu button:hover {
  background: var(--p-surface-100);
}

:root.p-dark .group-context-menu button:hover {
  background: var(--p-surface-700);
}

.group-context-menu button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
