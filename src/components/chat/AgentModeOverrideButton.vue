<script setup lang="ts">
// One-shot per-message agent-mode override trigger.
//
// Always visible, low-prominence button in the composer toolbar, adjacent
// to ModeButtonGroup. Opens a popover to pick Interactive / Plan / Autopilot
// for the NEXT message only — does NOT mutate the session-wide mode.
//
// When an override is pending the button gains a tinted badge showing the
// active mode icon. Selecting the already-active override clears it.
// The parent (ChatWindow) owns the state via `useComposerAgentMode` and
// passes it down; this component is pure presentation.

import { ref, computed } from 'vue';
import Popover from 'primevue/popover';
import { MODE_OPTIONS } from '@/lib/sessionModeOptions';
import type { SessionMode } from '@/ipc/types';

const props = defineProps<{
  nextMessageMode: SessionMode | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:nextMessageMode': [mode: SessionMode | null];
}>();

const popover = ref<InstanceType<typeof Popover> | null>(null);

function toggle(event: MouseEvent): void {
  popover.value?.toggle(event);
}

function select(mode: SessionMode): void {
  // Selecting the active override again clears it (toggle off).
  emit('update:nextMessageMode', props.nextMessageMode === mode ? null : mode);
  popover.value?.hide();
}

function clear(): void {
  emit('update:nextMessageMode', null);
  popover.value?.hide();
}

const activeOption = computed(() =>
  props.nextMessageMode ? MODE_OPTIONS.find((o) => o.value === props.nextMessageMode) : null,
);

const buttonTitle = computed(() =>
  activeOption.value
    ? `Next message: ${activeOption.value.label} (click to change or clear)`
    : 'Override agent mode for next message only',
);

const buttonClass = computed(() => ({
  'lex-toolbar-btn': true,
  'agent-mode-override-btn': true,
  'is-active': props.nextMessageMode !== null,
  [`mode-override-${props.nextMessageMode}`]: props.nextMessageMode !== null,
}));
</script>

<template>
  <button
    type="button"
    :class="buttonClass"
    :title="buttonTitle"
    :aria-label="buttonTitle"
    :disabled="props.disabled"
    :aria-expanded="!!popover"
    @click="toggle"
  >
    <span class="agent-mode-override-icon">
      <i
        v-if="activeOption"
        :class="activeOption.icon"
        aria-hidden="true"
      />
      <i
        v-else
        class="pi pi-arrow-right-arrow-left"
        aria-hidden="true"
      />
    </span>
    <span
      v-if="activeOption"
      class="agent-mode-override-badge"
      aria-hidden="true"
    />
  </button>

  <Popover
    ref="popover"
    class="agent-mode-override-popover"
    :pt="{ content: { style: 'padding: 0.35rem 0' } }"
  >
    <div
      class="agent-mode-override-menu"
      role="menu"
      aria-label="Override agent mode for next message"
    >
      <p class="agent-mode-override-label">Next message as…</p>
      <button
        v-for="option in MODE_OPTIONS"
        :key="option.value"
        type="button"
        class="agent-mode-override-item"
        :class="{
          'is-selected': props.nextMessageMode === option.value,
          [`mode-item-${option.value}`]: true,
        }"
        role="menuitemradio"
        :aria-checked="props.nextMessageMode === option.value"
        @click="select(option.value)"
      >
        <i
          :class="option.icon"
          aria-hidden="true"
        />
        {{ option.label }}
        <i
          v-if="props.nextMessageMode === option.value"
          class="pi pi-times agent-mode-clear-icon"
          aria-hidden="true"
        />
      </button>
      <div
        v-if="props.nextMessageMode"
        class="agent-mode-override-divider"
      />
      <button
        v-if="props.nextMessageMode"
        type="button"
        class="agent-mode-override-item agent-mode-override-clear"
        role="menuitem"
        @click="clear"
      >
        <i
          class="pi pi-times"
          aria-hidden="true"
        />
        Clear override
      </button>
    </div>
  </Popover>
</template>

<style scoped>
.agent-mode-override-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  min-height: 1.75rem;
  padding: 0 0.4rem;
  border: 0;
  border-radius: var(--p-border-radius-sm, 4px);
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
  font-size: 0.8rem;
  transition:
    background 120ms ease,
    color 120ms ease;
  flex: 0 0 auto;
  align-self: center;
}

.agent-mode-override-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}

.agent-mode-override-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Active = override is pending: tint by mode color */
.agent-mode-override-btn.is-active {
  background: color-mix(in srgb, var(--override-color, var(--p-primary-color)) 14%, transparent);
  color: var(--override-color, var(--p-primary-color));
}

.agent-mode-override-btn.mode-override-interactive {
  --override-color: var(--p-blue-500);
}
.agent-mode-override-btn.mode-override-plan {
  --override-color: var(--p-amber-500);
}
.agent-mode-override-btn.mode-override-autopilot {
  --override-color: var(--p-purple-500);
}

.agent-mode-override-icon .pi {
  font-size: 0.78rem;
}

/* Small dot badge indicating a pending override */
.agent-mode-override-badge {
  position: absolute;
  top: 0.2rem;
  right: 0.2rem;
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 50%;
  background: var(--override-color, var(--p-primary-color));
  pointer-events: none;
}

/* Popover menu */
.agent-mode-override-label {
  margin: 0 0 0.15rem;
  padding: 0.1rem 0.75rem 0.35rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
  border-bottom: 1px solid color-mix(in srgb, var(--p-text-color) 10%, transparent);
}

.agent-mode-override-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.75rem;
  border: 0;
  background: transparent;
  color: var(--p-text-color);
  font-size: 0.82rem;
  text-align: start;
  cursor: pointer;
  border-radius: 0;
  transition: background 100ms ease;
}

.agent-mode-override-item:hover {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
}

.agent-mode-override-item.is-selected {
  color: var(--item-mode-color, var(--p-primary-color));
  background: color-mix(in srgb, var(--item-mode-color, var(--p-primary-color)) 10%, transparent);
}

.agent-mode-override-item.mode-item-interactive {
  --item-mode-color: var(--p-blue-500);
}
.agent-mode-override-item.mode-item-plan {
  --item-mode-color: var(--p-amber-500);
}
.agent-mode-override-item.mode-item-autopilot {
  --item-mode-color: var(--p-purple-500);
}

.agent-mode-override-item .pi {
  font-size: 0.8rem;
  flex: 0 0 auto;
}

/* Push the × clear-icon to the far right */
.agent-mode-clear-icon {
  margin-inline-start: auto;
  font-size: 0.65rem !important;
  opacity: 0.6;
}

.agent-mode-override-divider {
  height: 1px;
  margin: 0.25rem 0.5rem;
  background: color-mix(in srgb, var(--p-text-color) 10%, transparent);
}

.agent-mode-override-clear {
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
}

.agent-mode-override-clear:hover {
  color: var(--p-text-color);
}
</style>
