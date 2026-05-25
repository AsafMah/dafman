<script setup lang="ts">
/// Workspaces section of the SettingsPanel — default workspace folder
/// with picker + reveal-in-explorer. Picker state owned by the
/// shared `useFolderPicker` composable.

import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { revealPath } from '@/lib/pathActions';
import { useFolderPicker } from '@/composables/useFolderPicker';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'update:collapsed', value: boolean): void }>();

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

/// Default-workspace draft kept separate from the persisted value so
/// the user can type freely without firing an RPC on every keystroke.
/// Committed on blur / Enter. Synced from the store whenever the
/// canonical value changes (e.g. the startup backfill landed).
const defaultWorkspaceDraft = ref<string>(settings.value.workspaces.defaultWorkspace ?? '');

watch(
  () => settings.value.workspaces.defaultWorkspace,
  (next) => {
    if (next !== defaultWorkspaceDraft.value) {
      defaultWorkspaceDraft.value = next ?? '';
    }
  },
);

async function commitDefaultWorkspace() {
  const next = defaultWorkspaceDraft.value.trim();

  if (next === settings.value.workspaces.defaultWorkspace) return;

  await settingsStore.setDefaultWorkspace(next);
}

const { isPicking: isPickingDefault, pick: pickDefaultFolder } = useFolderPicker();

async function pickDefaultWorkspace() {
  const picked = await pickDefaultFolder(defaultWorkspaceDraft.value.trim() || undefined);

  if (picked) {
    defaultWorkspaceDraft.value = picked;
    await settingsStore.setDefaultWorkspace(picked);
  }
}

async function revealDefaultWorkspace() {
  const path = defaultWorkspaceDraft.value.trim();

  if (!path) return;

  await revealPath(path, "Couldn't reveal folder");
}
</script>

<template>
  <SettingsGroup
    id="workspaces"
    icon="pi-folder"
    label="Workspaces"
    :collapsed="collapsed"
    @update:collapsed="(v) => emit('update:collapsed', v)"
  >
    <div class="field">
      <span
        id="default-workspace-label"
        class="field-label"
      >
        Default workspace
      </span>
      <div class="field-control workspace-row">
        <InputText
          v-model="defaultWorkspaceDraft"
          aria-labelledby="default-workspace-label"
          placeholder="No default"
          size="small"
          @blur="commitDefaultWorkspace"
          @keydown.enter.prevent="commitDefaultWorkspace"
        />
        <Button
          icon="pi pi-folder-open"
          severity="secondary"
          size="small"
          aria-label="Pick default workspace folder"
          :loading="isPickingDefault"
          @click="pickDefaultWorkspace"
        />
        <Button
          v-if="defaultWorkspaceDraft"
          icon="pi pi-external-link"
          severity="secondary"
          size="small"
          aria-label="Reveal default workspace folder"
          @click="revealDefaultWorkspace"
        />
      </div>
      <p class="field-hint">
        Used to pre-fill the path for new sessions. Defaults to
        <code>~/dafman</code> (created on first launch).
      </p>
    </div>
  </SettingsGroup>
</template>
