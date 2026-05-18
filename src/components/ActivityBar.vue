<script setup lang="ts">
// Activity bar — small persistent rail on the far left.
//
// Each item is an icon+label button that toggles a dockview edge
// panel. The rail itself lives OUTSIDE dockview so it survives any
// layout state (including all panels closed). Width is fixed at
// ~3rem; clicking an item that's already open closes it.
//
// Currently one item (Sessions); future activities (Library, Log
// viewer, MCP status, …) plug in here as additional buttons.

import { computed, onMounted, ref } from "vue";
import { useLayoutStore } from "../stores/layoutStore";

export interface ActivityItem {
  id: string;
  /// Dockview-registered component name to render inside the edge
  /// panel when this item is opened.
  component: string;
  /// PrimeIcons class name (e.g. "pi-list").
  icon: string;
  /// Two-line vertical label. Empty string → icon-only.
  label: string;
  /// Edge panel title (shown in dockview's tab strip when expanded).
  title: string;
  /// Initial width in pixels for the expanded panel.
  initialSize: number;
}

const props = defineProps<{
  items: ActivityItem[];
}>();

const layoutStore = useLayoutStore();

/// Per-item open flag, kept in lockstep with the dockview layout via
/// `onDidLayoutChange` (registered in App.vue's onDockReady) so that
/// closing a panel via its own X also updates the rail's pressed state.
const openIds = ref<Set<string>>(new Set());

function syncOpenState() {
  const next = new Set<string>();
  for (const item of props.items) {
    if (layoutStore.isPanelOpen(item.id)) next.add(item.id);
  }
  openIds.value = next;
}

onMounted(() => {
  syncOpenState();
});

function toggle(item: ActivityItem) {
  if (layoutStore.isPanelOpen(item.id)) {
    layoutStore.closePanel(item.id);
  } else {
    layoutStore.openEdgePanel("left", {
      id: item.id,
      component: item.component,
      tabComponent: "sidebarTab",
      title: item.title,
      initialSize: item.initialSize,
    });
  }
  // Optimistic flip; the onDidLayoutChange subscription in App.vue
  // will reconcile via the exposed `sync()` method below.
  syncOpenState();
}

const isOpen = computed(() => (id: string) => openIds.value.has(id));

// Expose `sync` so App.vue can refresh the rail after dockview layout
// changes (e.g. user closes the panel via its in-panel X).
defineExpose({ sync: syncOpenState });
</script>

<template>
  <nav class="activity-bar" aria-label="Activity bar">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="activity-button"
      :class="{ 'is-active': isOpen(item.id) }"
      :title="`${item.title} (toggle)`"
      :aria-label="item.title"
      :aria-pressed="isOpen(item.id)"
      @click="toggle(item)"
    >
      <i class="pi activity-icon" :class="item.icon" aria-hidden="true" />
      <span v-if="item.label" class="activity-label">{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.activity-bar {
  flex: 0 0 auto;
  width: 3rem;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0.25rem 0;
  gap: 0.15rem;
  background: var(--p-surface-100);
  border-right: 1px solid var(--p-content-border-color);
  overflow-y: auto;
  overflow-x: hidden;
}

:global(.app-dark) .activity-bar {
  background: var(--p-surface-900);
}

.activity-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.45rem 0.2rem;
  margin: 0 0.2rem;
  background: transparent;
  border: none;
  border-radius: var(--p-border-radius-md);
  color: var(--p-text-muted-color);
  cursor: pointer;
  font-family: inherit;
  /* No fixed height — let label wrap; tall icons take more vertical room. */
  text-align: center;
  position: relative;
}

.activity-button:hover {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}

.activity-button:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}

.activity-button.is-active {
  color: var(--p-primary-color);
}

/* Vertical accent stripe on the active item — mirrors VS Code's
 * activity-bar pattern so the open panel is identifiable at a glance. */
.activity-button.is-active::before {
  content: "";
  position: absolute;
  left: -0.2rem;
  top: 0.25rem;
  bottom: 0.25rem;
  width: 2px;
  border-radius: 1px;
  background: var(--p-primary-color);
}

.activity-icon {
  font-size: 1.05rem;
}

.activity-label {
  font-size: 0.65rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  font-weight: 600;
  line-height: 1.1;
  overflow-wrap: break-word;
  max-width: 100%;
}
</style>
