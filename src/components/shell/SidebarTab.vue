<script setup lang="ts">
// Custom dockview tab renderer for sidebar / edge-group panels
// (Sessions Manager, future Library, Log viewer, …). Replaces
// dockview's default tab so the X lives on the right and the chrome
// matches the rest of the app instead of dockview's stock styling.

import { usePanelLifecycle } from '@/composables/usePanelLifecycle';

type WrappedParams = {
  params?: Record<string, unknown>;
  api?: import('dockview-core').DockviewPanelApi;
};

const props = defineProps<{
  params: WrappedParams;
  api?: import('dockview-core').DockviewPanelApi;
}>();

const { title, isActive, close: onClose } = usePanelLifecycle(props);
</script>

<template>
  <div
    class="sidebar-tab"
    :class="{ 'is-active': isActive }"
    :title="title"
  >
    <span class="sidebar-tab-title">{{ title }}</span>
    <button
      type="button"
      class="sidebar-tab-close"
      aria-label="Close panel"
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
.sidebar-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 100%;
  padding: 0 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
  background: transparent;
  cursor: pointer;
  user-select: none;
  /* Sit flush against the sidebar body; no rounded corners so the X
   * doesn't visually float above the content. */
  min-width: 0;
}

.sidebar-tab.is-active {
  color: var(--p-text-color);
}

.sidebar-tab-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-tab-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
  cursor: pointer;
  opacity: 0.7;
  transition:
    opacity 120ms ease,
    background 120ms ease,
    color 120ms ease;
}

.sidebar-tab:hover .sidebar-tab-close,
.sidebar-tab-close:focus-visible {
  opacity: 1;
  color: var(--p-text-color);
}

.sidebar-tab-close:hover {
  background: color-mix(in srgb, var(--p-text-color) 12%, transparent);
}
</style>
