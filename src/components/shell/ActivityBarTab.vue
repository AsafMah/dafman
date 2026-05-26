<script setup lang="ts">
// Custom dockview tab renderer for activity-bar edge-group panels
// (Sessions, Terminals, Jobs, Logs on the left; Session Details,
// Library on the right). Renders as a single icon + tooltip; the
// strip itself is the activity bar.
//
// We intentionally do NOT attach a click handler. Dockview's native
// tab click handler already does the right thing for edge groups:
//   - inactive tab click  → activates panel + expands the strip
//   - active tab click    → collapses the strip
//   - drag                → drag-out into main grid
// See: node_modules/dockview-core/dist/esm/dockview/components/titlebar/tabs.js:420-443
//
// dockview-vue uses the same VueRenderer for tabs and panels, so the
// prop shape varies: on first mount we get `{ params, api,
// containerApi }` at the top level; on any later `update()`
// everything is re-wrapped into `{ params: { params, api, … } }`.
// We normalize both shapes below.

import { computed } from 'vue';
import type { DockviewPanelApi } from 'dockview-core';
import { usePanelLifecycle } from '@/composables/usePanelLifecycle';

interface TabParams {
  icon?: string;
  title?: string;
}

type WrappedParams = {
  params?: TabParams & { params?: TabParams };
  api?: DockviewPanelApi;
  icon?: string;
  title?: string;
};

const props = defineProps<{
  params: WrappedParams;
  api?: DockviewPanelApi;
}>();

const { isActive } = usePanelLifecycle(props);

// Resolve params through both possible wrap depths.
const resolvedParams = computed<TabParams>(() => {
  const outer = props.params ?? {};
  const inner = (outer.params as TabParams | undefined) ?? {};

  return {
    icon: inner.icon ?? outer.icon ?? 'pi-circle',
    title: inner.title ?? outer.title ?? '',
  };
});

const icon = computed(() => resolvedParams.value.icon ?? 'pi-circle');
const tooltip = computed(() => resolvedParams.value.title ?? '');
</script>

<template>
  <div
    class="activity-bar-tab"
    :class="{ 'is-active': isActive }"
    :title="tooltip"
    :aria-label="tooltip"
    :aria-pressed="isActive"
  >
    <i
      class="pi"
      :class="icon"
      aria-hidden="true"
    />
  </div>
</template>

<style>
/* Custom dockview tab renderer for the activity-bar edge groups.
 *
 * Dockview's vertical strip uses `writing-mode: vertical-rl` on the
 * tabs container, which makes flex layout's main axis vertical. The
 * .dv-tab cells need explicit physical sizing and a forced horizontal
 * writing-mode to render PrimeIcons correctly (the glyph pseudo-
 * element would otherwise inherit the rotated writing-mode).
 *
 * Receipts:
 *   - dockview-core/dist/styles/dockview.css:2866 (vertical-rl on
 *     `.dv-tabs-container.dv-tabs-container-vertical`)
 *   - dockview-core/dist/styles/dockview.css:3166 (vertical actions
 *     container is `flex-direction: column; width: 35px`)
 *   - The 0x0 size bug we hit during integration came from
 *     src/style.css hiding `.dv-edge-group .dv-tabs-and-actions-
 *     container` (a v1 carry-over for the old custom ActivityBar). */
.dv-tab:has(.activity-bar-tab) {
  writing-mode: horizontal-tb !important;
  flex: 0 0 40px !important;
  width: 100% !important;
  height: 40px !important;
  padding: 0 !important;
}

.dv-tab:has(.activity-bar-tab) .dv-vue-part {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100% !important;
  height: 100% !important;
}

.activity-bar-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--p-text-muted-color);
  cursor: pointer;
  user-select: none;
  transition: color 120ms ease;
}

.activity-bar-tab .pi {
  font-size: 1.2rem;
  line-height: 1;
}

.activity-bar-tab:hover {
  color: var(--p-text-color);
}

.activity-bar-tab.is-active {
  color: var(--p-primary-color);
}
</style>
