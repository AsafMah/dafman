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
  >
    <template #option="slotProps">
      <i :class="slotProps.option.icon" :title="slotProps.option.label" />
      <span class="sr-only">{{ slotProps.option.label }}</span>
    </template>
  </SelectButton>
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
  align-self: flex-start;
}
.mode-button-group :deep(.p-selectbutton) {
  display: inline-flex;
  align-items: stretch;
}
.mode-button-group :deep(.p-selectbutton .p-button) {
  /* Match SplitButton (send) size on the right so the row reads as
   * three equal-height chrome blocks. */
  height: auto;
  min-height: 2.25rem;
  padding: 0 0.6rem;
  font-size: 0.9rem;
  /* Idle: subtle accent tint so the control still reads as part of the
   * session, but doesn't compete with the input. */
  background: color-mix(in srgb, var(--accent, var(--p-primary-color)) 8%, var(--p-content-background));
  border-color: color-mix(in srgb, var(--accent, var(--p-primary-color)) 35%, var(--p-content-border-color));
  color: var(--p-text-color);
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.mode-button-group :deep(.p-selectbutton .p-button:not(.p-togglebutton-checked):hover) {
  background: color-mix(in srgb, var(--accent, var(--p-primary-color)) 18%, var(--p-content-background));
}
/* Selected button picks up the full accent — mirrors the SubmitButton
 * styling in `lexical.css` so the row's two accented actions match. */
.mode-button-group :deep(.p-selectbutton .p-button.p-togglebutton-checked) {
  background: var(--accent, var(--p-primary-color));
  border-color: var(--accent, var(--p-primary-color));
  color: var(--p-primary-contrast-color, white);
}
.mode-button-group :deep(.p-selectbutton .p-button .pi) {
  font-size: 0.95rem;
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
