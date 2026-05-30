<script setup lang="ts">
// Run-mode segmented control. Lifted out of SessionHeaderControls so
// the chat surface can host it on the composer row (left of the
// input) instead of in the per-session header — the user explicitly
// asked for that placement.
//
// Stays bound to `SessionRecord.mode` via `sessionsStore.setSessionMode`
// so any other surface that mutates mode (popover fallback, server-
// initiated /plan, …) stays in sync.

import { computed } from 'vue';
import SelectButton from 'primevue/selectbutton';
import Select from 'primevue/select';
import { MODE_OPTIONS } from '@/lib/sessionModeOptions';
import type { SessionMode } from '@/ipc/types';
import { useSessionsStore } from '@/stores/chat/sessionsStore';

const props = defineProps<{ sessionId: string }>();
const sessionsStore = useSessionsStore();

const record = computed(() => sessionsStore.getSession(props.sessionId));

const modeChoice = computed<SessionMode | null>({
  get: () => record.value?.mode ?? null,
  set: (value) => {
    if (!value || value === record.value?.mode) return;

    void sessionsStore.setSessionMode(props.sessionId, value);
  },
});

const modeClass = computed(() => `mode-${modeChoice.value ?? 'interactive'}`);

/// Icon for the currently-selected mode, used by the compact `Select`
/// trigger so it reads as an icon-only control on narrow panes.
const activeModeIcon = computed(
  () => MODE_OPTIONS.find((o) => o.value === modeChoice.value)?.icon ?? 'pi pi-comments',
);
</script>

<template>
  <SelectButton
    v-if="record"
    v-model="modeChoice"
    :options="MODE_OPTIONS"
    option-label="label"
    option-value="value"
    :allow-empty="false"
    size="small"
    aria-label="Agent run mode"
    class="mode-button-group"
    :class="modeClass"
  >
    <template #option="slotProps">
      <i
        :class="slotProps.option.icon"
        :title="slotProps.option.label"
      />
      <span class="sr-only">{{ slotProps.option.label }}</span>
    </template>
  </SelectButton>
  <!-- Compact icon-only fallback shown on narrow panes (≤620px) where the
       3-icon segmented control would crowd the bottom bar. The toolbar's
       @container query swaps between the two forms. -->
  <Select
    v-if="record"
    v-model="modeChoice"
    :options="MODE_OPTIONS"
    option-label="label"
    option-value="value"
    aria-label="Agent run mode"
    class="mode-select-compact"
    :class="modeClass"
  >
    <template #value>
      <i
        :class="activeModeIcon"
        aria-hidden="true"
      />
    </template>
    <template #option="slotProps">
      <i
        :class="slotProps.option.icon"
        aria-hidden="true"
      />
      <span class="mode-select-compact-label">{{ slotProps.option.label }}</span>
    </template>
  </Select>
</template>

<style scoped>
/* Mode segmented control. Mounted via MessageComposer's `#leading`
 * slot, so it inherits the composer row's `align-items: stretch` —
 * but we pin to the top via `align-self: flex-start` so the control
 * doesn't grow into a tall block when the input expands multiline.
 * That also matches the "not stuck to the bottom" feedback. */
.mode-button-group {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: stretch;
  align-self: center;
}

.mode-button-group :deep(.p-selectbutton) {
  display: inline-flex;
  align-items: stretch;
  border-radius: var(--p-border-radius-sm, 4px);
  overflow: hidden;
  background: color-mix(in srgb, var(--p-text-color) 6%, transparent);
}
.mode-button-group :deep(.p-selectbutton .p-button) {
  height: 1.75rem;
  min-height: 1.75rem;
  padding: 0 0.45rem;
  font-size: 0.8rem;
  background: transparent;
  border: 0;
  color: var(--p-text-muted-color);
  border-radius: 0;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.mode-button-group :deep(.p-selectbutton .p-button:not(.p-togglebutton-checked):hover) {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}
.mode-button-group :deep(.p-selectbutton .p-button.p-togglebutton-checked) {
  background: color-mix(
    in srgb,
    var(--mode-color, var(--accent, var(--p-primary-color))) 22%,
    transparent
  );
  color: var(--mode-color, var(--p-text-color));
  border: 0;
}
.mode-button-group.mode-interactive {
  --mode-color: var(--p-blue-500);
}
.mode-button-group.mode-plan {
  --mode-color: var(--p-amber-500);
}
.mode-button-group.mode-autopilot {
  --mode-color: var(--p-purple-500);
}
.mode-button-group :deep(.p-selectbutton .p-button .pi) {
  font-size: 0.78rem;
}

/* Compact icon-only Select fallback. Hidden by default; the toolbar's
 * `@container (max-width: 620px)` rule below swaps it in for the 3-icon
 * segmented control so the mode picker stays present (not gone) and the
 * bottom bar reflows cleanly on narrow panes. Restores the swap that was
 * dropped in 6343902 — the `.mode-select-shell` it referenced never
 * existed. (Issue #17.) */
.mode-select-compact {
  display: none;
  flex: 0 0 auto;
  align-self: center;
}
.mode-select-compact :deep(.p-select) {
  background: color-mix(in srgb, var(--p-text-color) 6%, transparent);
  border: 0;
  border-radius: var(--p-border-radius-sm, 4px);
  --mode-color: var(--p-blue-500);
}
.mode-select-compact.mode-plan :deep(.p-select) {
  --mode-color: var(--p-amber-500);
}
.mode-select-compact.mode-autopilot :deep(.p-select) {
  --mode-color: var(--p-purple-500);
}
.mode-select-compact :deep(.p-select-label) {
  display: inline-flex;
  align-items: center;
  padding: 0 0.4rem;
  color: var(--mode-color, var(--p-text-color));
}
.mode-select-compact :deep(.p-select-label .pi) {
  font-size: 0.85rem;
}
.mode-select-compact :deep(.p-select-dropdown) {
  width: 1.1rem;
  color: var(--p-text-muted-color);
}
.mode-select-compact-label {
  margin-inline-start: 0.5rem;
}

/* Swap the segmented control for the compact Select once the composer
 * toolbar (container-type: inline-size) drops below 620px. */
@container (max-width: 620px) {
  .mode-button-group {
    display: none;
  }
  .mode-select-compact {
    display: inline-flex;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
