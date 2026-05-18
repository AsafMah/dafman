<script setup lang="ts">
// Activity bar — small persistent rail on the far left.
//
// Each item is an icon button that either:
//   - kind: "panel" — toggles a dockview edge panel (Sessions today;
//     Library / Log viewer / MCP status / ... next).
//   - kind: "action" — fires a callback (open settings, switch to dev
//     playground, ...). Action items never carry pressed state.
//
// Items are grouped into a top stack and a bottom stack (`group`
// property). The bottom stack hosts global actions (settings, dev
// wrench) and gets pushed against the bottom edge with margin-top:auto.
// Mirrors VS Code's activity-bar layout.
//
// The rail itself lives OUTSIDE dockview so it survives any layout
// state (including all panels closed).

import { computed, onMounted, ref } from "vue";
import { useLayoutStore } from "../stores/layoutStore";

interface ActivityItemBase {
  id: string;
  icon: string;
  /// Hover tooltip + aria-label. Required since the rail is icon-only.
  title: string;
  /// `"top"` (default) pins to the upper stack, `"bottom"` pins below
  /// `margin-top: auto`. Bottom is for global actions (settings,
  /// dev tools).
  group?: "top" | "bottom";
}

export interface PanelActivityItem extends ActivityItemBase {
  kind: "panel";
  /// Dockview-registered component name rendered when this panel is open.
  component: string;
  /// Initial width in pixels for the expanded panel.
  initialSize: number;
  /// Minimum width below which the user-drag sash bottoms out.
  /// Defaults to dockview's own fallback (`collapsedSize + 50`).
  minimumSize?: number;
}

export interface ActionActivityItem extends ActivityItemBase {
  kind: "action";
  /// Callback invoked on click. The ActivityBar never reflects state
  /// from action items (no pressed indicator).
  onClick: () => void;
}

export type ActivityItem = PanelActivityItem | ActionActivityItem;

const props = defineProps<{
  items: ActivityItem[];
}>();

const layoutStore = useLayoutStore();

const openIds = ref<Set<string>>(new Set());

function syncOpenState() {
  const next = new Set<string>();
  for (const item of props.items) {
    if (item.kind !== "panel") continue;
    if (layoutStore.isPanelOpen(item.id)) next.add(item.id);
  }
  openIds.value = next;
}

onMounted(() => {
  syncOpenState();
});

function activate(item: ActivityItem) {
  if (item.kind === "action") {
    item.onClick();
    return;
  }
  if (layoutStore.isPanelOpen(item.id)) {
    layoutStore.closePanel(item.id);
  } else {
    layoutStore.openEdgePanel("left", {
      id: item.id,
      component: item.component,
      tabComponent: "sidebarTab",
      title: item.title,
      initialSize: item.initialSize,
      ...(item.minimumSize !== undefined
        ? { minimumSize: item.minimumSize }
        : {}),
    });
  }
  // Optimistic flip; the onDidLayoutChange subscription in App.vue
  // reconciles via `sync()` if the layout disagrees.
  syncOpenState();
}

const isOpen = computed(() => (id: string) => openIds.value.has(id));

const topItems = computed(() =>
  props.items.filter((i) => (i.group ?? "top") === "top"),
);
const bottomItems = computed(() =>
  props.items.filter((i) => i.group === "bottom"),
);

defineExpose({ sync: syncOpenState });
</script>

<template>
  <nav class="activity-bar" aria-label="Activity bar">
    <div class="activity-stack">
      <button
        v-for="item in topItems"
        :key="item.id"
        type="button"
        class="activity-button"
        :class="{ 'is-active': item.kind === 'panel' && isOpen(item.id) }"
        :title="item.title"
        :aria-label="item.title"
        :aria-pressed="item.kind === 'panel' ? isOpen(item.id) : undefined"
        @click="activate(item)"
      >
        <i class="pi activity-icon" :class="item.icon" aria-hidden="true" />
      </button>
    </div>
    <div class="activity-stack activity-stack-bottom">
      <button
        v-for="item in bottomItems"
        :key="item.id"
        type="button"
        class="activity-button"
        :class="{ 'is-active': item.kind === 'panel' && isOpen(item.id) }"
        :title="item.title"
        :aria-label="item.title"
        :aria-pressed="item.kind === 'panel' ? isOpen(item.id) : undefined"
        @click="activate(item)"
      >
        <i class="pi activity-icon" :class="item.icon" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.activity-bar {
  flex: 0 0 auto;
  width: 2.75rem;
  display: flex;
  flex-direction: column;
  /* Theme-aware tint via color-mix so the rail gets a slight
   * contrast against the body in both light and dark mode without
   * a :global(.app-dark) override (which doesn't compose with Vue
   * scoped CSS reliably). */
  background: color-mix(in srgb, var(--p-text-color) 4%, var(--p-content-background));
  border-right: 1px solid var(--p-content-border-color);
  overflow-y: auto;
  overflow-x: hidden;
}

.activity-stack {
  display: flex;
  flex-direction: column;
  padding: 0.3rem 0;
  gap: 0.15rem;
}

.activity-stack-bottom {
  margin-top: auto;
  border-top: 1px solid color-mix(in srgb, var(--p-text-color) 8%, transparent);
}

.activity-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  margin: 0 0.175rem;
  background: transparent;
  border: none;
  border-radius: var(--p-border-radius-md);
  color: var(--p-text-muted-color);
  cursor: pointer;
  font-family: inherit;
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
  left: -0.175rem;
  top: 0.4rem;
  bottom: 0.4rem;
  width: 2px;
  border-radius: 1px;
  background: var(--p-primary-color);
}

.activity-icon {
  font-size: 1.1rem;
}
</style>
