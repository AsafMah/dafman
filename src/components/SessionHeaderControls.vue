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
</script>

<template>
  <div v-if="record" class="session-header-controls">
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
      class="compact-select compact-select-narrow"
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
        <label class="option-row" :for="`mode-${props.sessionId}`">
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
            aria-label="Agent run mode"
          />
        </label>
        <label class="option-row" :for="`reasoning-${props.sessionId}`">
          <span class="option-label">Reasoning view</span>
          <Select
            :input-id="`reasoning-${props.sessionId}`"
            v-model="reasoningChoice"
            :options="reasoningOptions"
            option-label="label"
            option-value="value"
            size="small"
            aria-label="Reasoning visibility for this session"
          />
        </label>
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
  /* When the tab strip is narrow, the trailing controls truncate from
   * the left (model select shrinks first) rather than overflow. */
  min-width: 0;
  flex-wrap: nowrap;
}

/* PrimeVue Select sized to fit comfortably alongside dockview tabs.
 * The value itself shows the model/effort name — labels would just
 * eat horizontal space in the tab strip. */
.compact-select :deep(.p-select) {
  min-width: 7rem;
  max-width: 11rem;
  height: 1.75rem;
}

.compact-select :deep(.p-select-label) {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
}

.compact-select-narrow :deep(.p-select) {
  min-width: 5.5rem;
  max-width: 7rem;
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
</style>
