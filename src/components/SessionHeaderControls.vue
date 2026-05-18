<script setup lang="ts">
// Per-session controls (model + effort selects, options gear → popover
// with run mode, reasoning view override, session name, compact /
// reset). Designed to be hosted anywhere — inside the dockview
// `rightHeaderActionsComponent` (the production target), or in a
// standalone container.
//
// All state lives on the `SessionRecord` (sessionsStore); this
// component just reads + dispatches actions. Self-contained: takes
// only `sessionId` as a prop.

import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Popover from "primevue/popover";
import Select from "primevue/select";
import type {
  ModelSummary,
  ReasoningVisibility,
  SessionMode,
} from "../ipc/types";
import { useModelsStore } from "../stores/modelsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { basename } from "../stores/layoutStore";
import { invokeCommand } from "../ipc/invoke";

const props = defineProps<{ sessionId: string }>();

const sessionsStore = useSessionsStore();
const modelsStore = useModelsStore();
const { models } = storeToRefs(modelsStore);

onMounted(() => {
  modelsStore.load().catch(() => {
    /* toast already shown by the store */
  });
});

const record = computed(() =>
  sessionsStore.sessions.find((s) => s.id === props.sessionId),
);

const selectedModel = computed<ModelSummary | undefined>(() => {
  const id = record.value?.model;
  return id ? models.value.find((m) => m.id === id) : undefined;
});

const modelOptions = computed(() =>
  models.value.map((m) => ({ label: m.name, value: m.id })),
);

const effortOptions = computed(() =>
  (selectedModel.value?.supportedReasoningEfforts ?? []).map((effort) => ({
    label: effort,
    value: effort,
  })),
);

const modelChoice = computed<string | null>({
  get: () => record.value?.model ?? null,
  set: (value) => {
    if (!value || !record.value) return;
    const fresh = models.value.find((m) => m.id === value);
    const effort = fresh?.supportsReasoningEffort
      ? record.value.reasoningEffort ?? fresh.defaultReasoningEffort ?? null
      : null;
    void sessionsStore.setSessionModel(props.sessionId, value, effort);
  },
});

const effortChoice = computed<string | null>({
  get: () => record.value?.reasoningEffort ?? null,
  set: (value) => {
    if (!value || !record.value?.model) return;
    void sessionsStore.setSessionModel(props.sessionId, record.value.model, value);
  },
});

const modeOptions: { label: string; value: SessionMode }[] = [
  { label: "Interactive", value: "interactive" },
  { label: "Plan", value: "plan" },
  { label: "Autopilot", value: "autopilot" },
];

const modeChoice = computed<SessionMode | null>({
  get: () => record.value?.mode ?? null,
  set: (value) => {
    if (!value || value === record.value?.mode) return;
    void sessionsStore.setSessionMode(props.sessionId, value);
  },
});

const reasoningOptions: { label: string; value: ReasoningVisibility | "default" }[] = [
  { label: "Default", value: "default" },
  { label: "Hidden", value: "hidden" },
  { label: "Compact", value: "compact" },
  { label: "Expanded", value: "expanded" },
];

const reasoningChoice = computed<ReasoningVisibility | "default">({
  get: () => record.value?.reasoningVisibilityOverride ?? "default",
  set: (value) => {
    sessionsStore.setSessionReasoningOverride(props.sessionId, value);
  },
});

const nameDraft = ref<string>(record.value?.title ?? "");

watch(
  () => props.sessionId,
  () => {
    nameDraft.value = record.value?.title ?? "";
  },
);

const optionsMenu = ref<InstanceType<typeof Popover> | null>(null);

function toggleOptions(event: Event) {
  // Pre-fill the rename input with the current title every time the
  // popover opens, so the user sees what's there before editing. Done
  // here (not in a watcher) so an in-flight edit isn't clobbered by a
  // late `session.title_changed` echo while the popover is open.
  nameDraft.value = record.value?.title ?? "";
  optionsMenu.value?.toggle(event);
}

function onRenameSubmit() {
  const trimmed = nameDraft.value.trim();
  if (!trimmed) return;
  nameDraft.value = trimmed;
  void sessionsStore.setSessionName(props.sessionId, trimmed);
}

function onCompactNow() {
  void sessionsStore.compactSessionHistory(props.sessionId);
}

function onResetApprovals() {
  void sessionsStore.resetSessionApprovals(props.sessionId);
}

/// Workspace label shown in the tab strip — basename only, so it
/// stays short. Full absolute path is in the tooltip.
const workspaceLabel = computed(() => basename(record.value?.workingDirectory));

function onWorkspaceClick() {
  const path = record.value?.workingDirectory;
  if (!path) return;
  void invokeCommand("revealPath", { path });
}
</script>

<template>
  <div v-if="record" class="session-header-controls">
    <button
      v-if="workspaceLabel"
      type="button"
      class="workspace-chip"
      :title="`Open ${record.workingDirectory ?? ''}`"
      :aria-label="`Open workspace folder ${record.workingDirectory ?? ''}`"
      @click="onWorkspaceClick"
    >
      <i class="pi pi-folder" aria-hidden="true" />
      <span class="workspace-chip-text">{{ workspaceLabel }}</span>
    </button>
    <Select
      :input-id="`model-${props.sessionId}`"
      v-model="modelChoice"
      :options="modelOptions"
      option-label="label"
      option-value="value"
      size="small"
      placeholder="Model"
      :disabled="models.length === 0"
      aria-label="Model for this session"
      class="compact-select"
    />
    <Select
      v-if="selectedModel?.supportsReasoningEffort"
      :input-id="`effort-${props.sessionId}`"
      v-model="effortChoice"
      :options="effortOptions"
      option-label="label"
      option-value="value"
      size="small"
      placeholder="Effort"
      aria-label="Reasoning effort for this session"
      class="compact-select compact-select-effort"
    />
    <Select
      :input-id="`mode-inline-${props.sessionId}`"
      v-model="modeChoice"
      :options="modeOptions"
      option-label="label"
      option-value="value"
      size="small"
      placeholder="Mode"
      :disabled="!record.mode"
      aria-label="Agent run mode"
      class="compact-select compact-select-mode"
    />
    <Select
      :input-id="`reasoning-inline-${props.sessionId}`"
      v-model="reasoningChoice"
      :options="reasoningOptions"
      option-label="label"
      option-value="value"
      size="small"
      placeholder="Reasoning"
      aria-label="Reasoning visibility for this session"
      class="compact-select compact-select-reasoning"
    />
    <Button
      icon="pi pi-cog"
      text
      rounded
      size="small"
      aria-label="Session options"
      aria-haspopup="true"
      @click="toggleOptions"
    />
    <Popover ref="optionsMenu">
      <div class="session-options">
        <div class="option-row option-row-stack">
          <label class="option-label" :for="`name-${props.sessionId}`">
            Session name
          </label>
          <form class="rename-form" @submit.prevent="onRenameSubmit">
            <InputText
              :id="`name-${props.sessionId}`"
              v-model="nameDraft"
              size="small"
              placeholder="Untitled"
            />
            <Button
              type="submit"
              label="Save"
              size="small"
              :disabled="!nameDraft.trim()"
            />
          </form>
        </div>
        <!-- Run mode + reasoning view live inline in the header strip
             when there's room; the popover keeps them as a guaranteed
             fallback so a narrow pane can still reach them. -->
        <label
          class="option-row"
          :for="`mode-${props.sessionId}`"
        >
          <span class="option-label">Run mode</span>
          <Select
            :input-id="`mode-${props.sessionId}`"
            v-model="modeChoice"
            :options="modeOptions"
            option-label="label"
            option-value="value"
            size="small"
            placeholder="Loading..."
            :disabled="!record.mode"
            aria-label="Agent run mode (popover)"
          />
        </label>
        <label
          class="option-row"
          :for="`reasoning-${props.sessionId}`"
        >
          <span class="option-label">Reasoning view</span>
          <Select
            :input-id="`reasoning-${props.sessionId}`"
            v-model="reasoningChoice"
            :options="reasoningOptions"
            option-label="label"
            option-value="value"
            size="small"
            aria-label="Reasoning visibility for this session (popover)"
          />
        </label>
        <div class="option-row option-row-stack">
          <span class="option-label">Workspace</span>
          <div
            class="workspace-path"
            :title="record.workingDirectory ?? 'Default (cli process cwd)'"
          >
            <i class="pi pi-folder" aria-hidden="true" />
            <span class="workspace-path-text">
              {{ record.workingDirectory ?? "Default" }}
            </span>
          </div>
        </div>
        <div class="option-actions">
          <Button
            icon="pi pi-compress"
            label="Compact history"
            size="small"
            severity="secondary"
            @click="onCompactNow"
          />
          <Button
            icon="pi pi-refresh"
            label="Reset approvals"
            size="small"
            severity="secondary"
            @click="onResetApprovals"
          />
        </div>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.session-header-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.4rem;
  height: 100%;
  /* Layout shrinks gracefully on narrow widths: model/effort selects
   * collapse first (flex-shrink); workspace chip drops out below a
   * certain width via a container query; the options gear is the
   * last thing standing because it's the only entry point to mode,
   * rename, compact, etc.
   *
   * NOTE: do NOT set `container-type: inline-size` on this element —
   * it's a shrink-to-fit flex child, so its width is determined by
   * its visible content. Putting the container context here creates a
   * feedback loop: hide a child → container narrows → next breakpoint
   * fires → hide more, until only the gear survives. The container
   * context lives on the host instead (`.chat-tile-header` in
   * ChatWindow.vue), which has a stable width derived from the
   * dockview tile. Queries below resolve against that ancestor. */
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-end;
  flex-wrap: nowrap;
}

/* Progressive collapse as the tile narrows. Order of removal (least-
 * essential first) — gear is always visible because it's the
 * fallback entry point to the popover where everything still lives.
 *
 *   wide        →  model + effort + workspace + mode + reasoning + gear
 *   < 38rem     →  drop "reasoning"
 *   < 32rem     →  drop "mode"          (still in popover)
 *   < 26rem     →  drop workspace chip
 *   < 20rem     →  drop "effort"
 *   < 14rem     →  drop "model"         (gear only)
 *
 * Numbers are chosen so the next breakpoint kicks in only after the
 * previously-visible items genuinely don't fit at their min-widths
 * (selects ~7-11rem, workspace chip ~14rem, gap ~0.35rem * gaps). */
@container (max-width: 38rem) {
  .compact-select-reasoning {
    display: none;
  }
}
@container (max-width: 32rem) {
  .compact-select-mode {
    display: none;
  }
}
@container (max-width: 26rem) {
  .workspace-chip {
    display: none;
  }
}
@container (max-width: 20rem) {
  .compact-select-effort {
    display: none;
  }
}
@container (max-width: 14rem) {
  .compact-select {
    display: none;
  }
}

/* Workspace chip lives in the tab strip header (right-actions); the
 * basename is the visible label, full path is in the tooltip. The
 * button-with-no-background styling matches PrimeVue's `text` button
 * variant so it reads as a label, not a primary action. */
.workspace-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 14rem;
  min-width: 0;
  height: 1.75rem;
  padding: 0 0.5rem;
  border-radius: var(--p-border-radius-md);
  border: 1px solid transparent;
  background: transparent;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
  cursor: pointer;
  font-family: inherit;
}

.workspace-chip:hover {
  /* Theme-aware: mix the text colour into transparent so the chip
   * gets a faint backdrop on hover that auto-flips between light and
   * dark. `:global(.app-dark)` overrides inside scoped CSS turned
   * out unreliable here. */
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}

.workspace-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* RTL trick keeps the tail visible if the basename itself is long */
  direction: ltr;
}

/* PrimeVue Select sized to fit comfortably alongside dockview tabs.
 * The value itself shows the model/effort name — labels would just
 * eat horizontal space in the tab strip. flex-shrink so the select
 * can compress below its min-width when the tab strip is cramped. */
.compact-select {
  flex: 0 1 auto;
  min-width: 0;
}

.compact-select :deep(.p-select) {
  min-width: 5rem;
  max-width: 11rem;
  height: 1.75rem;
}

.compact-select :deep(.p-select-label) {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compact-select-effort {
  flex: 0 1 auto;
  min-width: 0;
}
.compact-select-effort :deep(.p-select) {
  min-width: 4rem;
  max-width: 7rem;
}

.compact-select-mode {
  flex: 0 1 auto;
  min-width: 0;
}
.compact-select-mode :deep(.p-select) {
  min-width: 5.5rem;
  max-width: 8rem;
}

.compact-select-reasoning {
  flex: 0 1 auto;
  min-width: 0;
}
.compact-select-reasoning :deep(.p-select) {
  min-width: 6rem;
  max-width: 9rem;
}

/* The popover is mounted to the body so it lives outside the cramped
 * tab strip — full-size rows OK here. */
.session-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 18rem;
}

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.option-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}

.option-label {
  font-size: 0.8rem;
  color: var(--p-text-color);
}

.option-row :deep(.p-select) {
  min-width: 9rem;
}

.rename-form {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.rename-form :deep(.p-inputtext) {
  flex: 1 1 auto;
  min-width: 0;
}

.option-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  padding-top: 0.25rem;
  border-top: 1px solid var(--p-content-border-color);
}

.workspace-path {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  min-width: 0;
}

.workspace-path-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
</style>
