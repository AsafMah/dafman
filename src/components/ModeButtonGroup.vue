<script setup lang="ts">
// Run-mode segmented control. Lifted out of SessionHeaderControls so
// the chat surface can host it on the composer row (left of the
// input) instead of in the per-session header — the user explicitly
// asked for that placement.
//
// Stays bound to `SessionRecord.mode` via `sessionsStore.setSessionMode`
// so any other surface that mutates mode (popover fallback, server-
// initiated /plan, …) stays in sync.

import { computed } from "vue";
import SelectButton from "primevue/selectbutton";
import Select from "primevue/select";
import type { SessionMode } from "../ipc/types";
import { useSessionsStore } from "../stores/sessionsStore";

const props = defineProps<{ sessionId: string }>();
const sessionsStore = useSessionsStore();

const record = computed(() =>
  sessionsStore.sessions.find((s) => s.id === props.sessionId),
);

const modeOptions: { label: string; value: SessionMode; icon: string }[] = [
  { label: "Interactive", value: "interactive", icon: "pi pi-comments" },
  { label: "Plan", value: "plan", icon: "pi pi-list-check" },
  { label: "Autopilot", value: "autopilot", icon: "pi pi-bolt" },
];

const modeChoice = computed<SessionMode | null>({
  get: () => record.value?.mode ?? null,
  set: (value) => {
    if (!value || value === record.value?.mode) return;
    void sessionsStore.setSessionMode(props.sessionId, value);
  },
});

const modeClass = computed(() => `mode-${modeChoice.value ?? "interactive"}`);
</script>

<template>
  <SelectButton
    v-if="record"
    v-model="modeChoice"
    :options="modeOptions"
    option-label="label"
    option-value="value"
    :allow-empty="false"
    size="small"
    aria-label="Agent run mode"
    class="mode-button-group"
    :class="modeClass"
  >
    <template #option="slotProps">
      <i :class="slotProps.option.icon" :title="slotProps.option.label" />
      <span class="sr-only">{{ slotProps.option.label }}</span>
    </template>
  </SelectButton>
  <div v-if="record" class="mode-select-shell">
    <Select
      v-model="modeChoice"
      :options="modeOptions"
      option-label="label"
      option-value="value"
      size="small"
      aria-label="Agent run mode"
      class="mode-select"
      :class="modeClass"
    >
      <template #value="{ value }">
        <span class="mode-select-value">
          <i :class="modeOptions.find((option) => option.value === value)?.icon" aria-hidden="true" />
          <span class="mode-select-current-label">{{ modeOptions.find((option) => option.value === value)?.label ?? "Mode" }}</span>
        </span>
      </template>
      <template #option="{ option }">
        <span class="mode-select-value">
          <i :class="option.icon" aria-hidden="true" />
          <span>{{ option.label }}</span>
        </span>
      </template>
    </Select>
  </div>
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
.mode-select-shell {
  display: none;
  flex: 0 0 auto;
  align-self: center;
}

.mode-select {
  width: 2.4rem;
  min-width: 2.4rem;
}
.mode-select-value {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.mode-select :deep(.p-select-label) {
  padding-inline: 0.45rem 0;
  width: 1.1rem;
  overflow: hidden;
}
.mode-select :deep(.p-select-dropdown) {
  width: 0.8rem;
  min-width: 0.8rem;
  padding-inline: 0;
}
.mode-select-current-label {
  display: none;
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
  transition: background 120ms ease, color 120ms ease;
}
.mode-button-group :deep(.p-selectbutton .p-button:not(.p-togglebutton-checked):hover) {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}
.mode-button-group :deep(.p-selectbutton .p-button.p-togglebutton-checked) {
  background: color-mix(in srgb, var(--mode-color, var(--accent, var(--p-primary-color))) 22%, transparent);
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
