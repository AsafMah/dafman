<script setup lang="ts">
// Thin (22 px) chrome strip pinned to the very bottom of the app shell.
// Hosts non-panel global actions (Settings, dev wrench) that used to
// live in the bottom group of the custom ActivityBar — now the rail
// itself is replaced by dockview's native vertical-tab strips on the
// left and right edges.
//
// NOT a dockview surface: this is intentional. Dockview's bottom edge
// group is a "drawer" abstraction (full-size panels like terminals /
// logs); a status bar is a thin always-visible strip with multiple
// click targets and live indicators. Different role, different widget.
// We may add a dockview bottom edge in a future plan; the two are not
// in conflict.

import Button from 'primevue/button';
import Tooltip from 'primevue/tooltip';

const vTooltip = Tooltip;

const isDev = import.meta.env.DEV;

const emit = defineEmits<{
  openSettings: [];
  openPlayground: [];
}>();
</script>

<template>
  <footer class="status-bar">
    <div class="status-bar-left">
      <span class="status-bar-brand">dafman</span>
    </div>
    <div class="status-bar-center">
      <!-- Reserved for live indicators (active session, model id,
           current workspace, …). Populated incrementally as needs
           arise; intentionally empty today to keep the chrome calm. -->
    </div>
    <div class="status-bar-right">
      <Button
        v-tooltip.top="'Open dev playground'"
        v-if="isDev"
        class="status-bar-button status-bar-button-dev"
        icon="pi pi-wrench"
        text
        rounded
        size="small"
        aria-label="Open dev playground"
        @click="emit('openPlayground')"
      />
      <Button
        v-tooltip.top="'Settings'"
        class="status-bar-button"
        icon="pi pi-cog"
        text
        rounded
        size="small"
        aria-label="Settings"
        @click="emit('openSettings')"
      />
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  flex: 0 0 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0 0.5rem;
  background: var(--p-surface-200);
  border-top: 1px solid var(--p-surface-300);
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
  user-select: none;
}

.app-dark .status-bar {
  background: var(--p-surface-900);
  border-top-color: var(--p-surface-800);
}

.status-bar-left,
.status-bar-right {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.status-bar-center {
  flex: 1 1 auto;
  display: flex;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
}

.status-bar-brand {
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--p-text-color);
}

/* PrimeVue's text/rounded Button default height is 2rem — too tall
 * for a 22px strip. Override to a tight square. Slightly larger now
 * (20px) so the two icons are unmissable. */
:deep(.status-bar-button) {
  width: 20px !important;
  height: 20px !important;
  padding: 0 !important;
  min-width: 0 !important;
}

:deep(.status-bar-button .p-button-icon) {
  font-size: 0.8rem;
}

:deep(.status-bar-button:hover) {
  background: color-mix(in srgb, var(--p-primary-color) 16%, transparent) !important;
}

/* The dev wrench is only mounted in dev mode (v-if="isDev"). Tint
 * it brand-orange so it's visually distinct from the always-on
 * Settings cog — "this is a dev affordance, not the same as
 * permanent UI." */
:deep(.status-bar-button-dev) {
  color: var(--p-primary-color) !important;
}
</style>
