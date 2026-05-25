<script setup lang="ts">
/// Appearance + reasoning + default-model section of the SettingsPanel.
/// Owns the bindings to `settings.appearance.*` via the typed setters
/// on `settingsStore` (`setTheme`, `setReasoningVisibility`, etc.).
///
/// Extracted from SettingsPanel.vue's 100-line inline section so each
/// settings category is independently navigable / testable. Collapse
/// state is still owned by the parent shell.

import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useModelsStore } from '@/stores/library/modelsStore';
import type { ModelSummary, ReasoningVisibility, ThemeChoice } from '@/ipc/types';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'update:collapsed', value: boolean): void }>();

const settingsStore = useSettingsStore();
const modelsStore = useModelsStore();
const { settings } = storeToRefs(settingsStore);
const { models } = storeToRefs(modelsStore);

const themeOptions: { label: string; value: ThemeChoice }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

const reasoningOptions: { label: string; value: ReasoningVisibility }[] = [
  { label: 'Hidden', value: 'hidden' },
  { label: 'Compact', value: 'compact' },
  { label: 'Expanded', value: 'expanded' },
];

const defaultModelOptions = computed<Array<ModelSummary | { id: ''; name: string }>>(() => [
  { id: '', name: 'CLI default' },
  ...models.value,
]);

const defaultModel = computed<string>({
  get: () => settings.value.appearance.defaultModelId ?? '',
  set: (value) => {
    const model = models.value.find((m) => m.id === value);
    const effort = model?.supportsReasoningEffort
      ? (settings.value.appearance.defaultReasoningEffort ?? model.defaultReasoningEffort)
      : null;

    void settingsStore.setDefaultModel(value, effort);
  },
});

const selectedDefaultModel = computed(() =>
  models.value.find((m) => m.id === defaultModel.value),
);

const defaultReasoningOptions = computed(() => [
  { label: 'Model default', value: null as string | null },
  ...(selectedDefaultModel.value?.supportedReasoningEfforts ?? []).map((effort) => ({
    label: effort,
    value: effort,
  })),
]);

const defaultReasoning = computed<string | null>({
  get: () => settings.value.appearance.defaultReasoningEffort ?? null,
  set: (value) => {
    void settingsStore.setDefaultModel(defaultModel.value, value);
  },
});

const theme = computed<ThemeChoice>({
  get: () => settings.value.appearance.theme,
  set: (value) => {
    void settingsStore.setTheme(value);
  },
});

const reasoningVisibility = computed<ReasoningVisibility>({
  get: () => settings.value.appearance.reasoningVisibility,
  set: (value) => {
    void settingsStore.setReasoningVisibility(value);
  },
});

const streaming = computed<boolean>({
  get: () => settings.value.appearance.streaming ?? false,
  set: (value) => {
    void settingsStore.setStreaming(value);
  },
});

const enableMermaid = computed<boolean>({
  get: () => settings.value.appearance.enableMermaid ?? false,
  set: (value) => {
    void settingsStore.setEnableMermaid(value);
  },
});
</script>

<template>
  <SettingsGroup
    id="appearance"
    icon="pi-palette"
    label="Appearance"
    :collapsed="collapsed"
    @update:collapsed="(v) => emit('update:collapsed', v)"
  >
    <label
      class="field"
      for="theme-select"
    >
      <span class="field-label">Theme</span>
      <Select
        id="theme-select"
        v-model="theme"
        :options="themeOptions"
        option-label="label"
        option-value="value"
        size="small"
        filter
        class="field-control"
      />
    </label>

    <label
      class="field"
      for="reasoning-select"
    >
      <span class="field-label">Reasoning visibility</span>
      <Select
        id="reasoning-select"
        v-model="reasoningVisibility"
        :options="reasoningOptions"
        option-label="label"
        option-value="value"
        size="small"
        filter
        class="field-control"
      />
      <p class="field-hint">
        Default for new chats. Each session can override this from its header.
      </p>
    </label>
    <label
      class="field"
      for="default-model-select"
    >
      <span class="field-label">Default model</span>
      <Select
        id="default-model-select"
        v-model="defaultModel"
        :options="defaultModelOptions"
        option-label="name"
        option-value="id"
        size="small"
        filter
        class="field-control"
      />
      <p class="field-hint">
        Used for newly-created sessions. Existing sessions keep their current model.
      </p>
    </label>
    <label
      v-if="selectedDefaultModel?.supportsReasoningEffort"
      class="field"
      for="default-reasoning-select"
    >
      <span class="field-label">Default reasoning effort</span>
      <Select
        id="default-reasoning-select"
        v-model="defaultReasoning"
        :options="defaultReasoningOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="field-control"
      />
    </label>
    <div class="field field-inline">
      <label class="field-inline-label">
        <ToggleSwitch v-model="streaming" />
        <span>Stream assistant replies</span>
      </label>
      <p class="field-hint">
        Off (default): the agent's reply appears in one chunk per turn. On: text streams in
        word-by-word (livelier, but can jitter under heavy load). Takes effect on the
        <strong>next</strong> session you create.
      </p>
    </div>
    <div class="field field-inline">
      <label class="field-inline-label">
        <ToggleSwitch v-model="enableMermaid" />
        <span>Render mermaid diagrams</span>
      </label>
      <p class="field-hint">
        Off (default): <code>```mermaid</code> fences render as plain code blocks. On:
        lazy-loads the mermaid library on first use and renders the diagram inline. Adds ~800 KB
        to the chunk fetched when you first open a chat with a diagram.
      </p>
    </div>
  </SettingsGroup>
</template>
