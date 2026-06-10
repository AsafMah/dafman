<script setup lang="ts">
/// Software Updates section in Settings.
/// Shows current version + channel, last-check status, and buttons to
/// check for updates and apply a downloaded update.

import { onMounted, ref } from 'vue';
import Button from 'primevue/button';
import { useUpdateStore } from '@/stores/app/updateStore';
import { storeToRefs } from 'pinia';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';
import { useToastStore } from '@/stores/app/toastStore';
import type { AppInfo } from '@/ipc/types';
import { invokeCommand } from '@/ipc/invoke';

defineProps<{ collapsed: boolean }>();
defineEmits<{ (e: 'update:collapsed', value: boolean): void }>();

const updateStore = useUpdateStore();
const toastStore = useToastStore();

const {
  status,
  statusMessage,
  updateAvailable,
  updateReady,
  latestVersion,
  errorMessage,
  isChecking,
  isDownloading,
} = storeToRefs(updateStore);

const appInfo = ref<AppInfo | null>(null);

onMounted(async () => {
  try {
    appInfo.value = await invokeCommand('getAppInfo', {});
  } catch {
    // non-fatal
  }
  // Load any already-known update status without triggering a new check.
  await updateStore.loadInitialStatus().catch(() => {
    /* non-fatal */
  });
});

async function handleCheckForUpdate(): Promise<void> {
  try {
    const result = await updateStore.checkForUpdate();
    if (!result.updateAvailable) {
      toastStore.success('No update available', 'You are on the latest version.');
    }
  } catch (err) {
    toastStore.error('Update check failed', String(err));
  }
}

async function handleDownloadAndApply(): Promise<void> {
  try {
    toastStore.info('Applying update\u2026', 'The app will restart when the update is installed.');
    await updateStore.downloadAndApplyUpdate();
  } catch (err) {
    toastStore.error('Update failed', String(err));
  }
}
</script>

<template>
  <SettingsGroup
    id="updates"
    icon="pi-refresh"
    label="Software Updates"
    :collapsed="collapsed"
    @update:collapsed="$emit('update:collapsed', $event)"
  >
    <div
      v-if="appInfo"
      class="field"
    >
      <p class="field-hint">
        Version <strong>{{ appInfo.version }}</strong> — channel
        <strong>{{ appInfo.channel }}</strong>
      </p>
    </div>

    <div
      v-if="latestVersion && updateAvailable"
      class="field"
    >
      <p class="field-hint">
        Latest available: <strong>{{ latestVersion }}</strong>
      </p>
    </div>

    <div
      v-if="statusMessage"
      class="field"
    >
      <p
        class="field-hint"
        :class="{ 'update-status-error': status === 'error' }"
      >
        {{ statusMessage }}
        <span
          v-if="errorMessage"
          class="update-error-detail"
        >
          &mdash; {{ errorMessage }}
        </span>
      </p>
    </div>

    <div class="field field-inline">
      <Button
        label="Check for updates"
        icon="pi pi-refresh"
        severity="secondary"
        size="small"
        class="field-control"
        :loading="isChecking"
        :disabled="isChecking || isDownloading"
        @click="handleCheckForUpdate"
      />

      <Button
        v-if="updateAvailable && !updateReady"
        label="Download &amp; Apply"
        icon="pi pi-download"
        severity="primary"
        size="small"
        class="field-control"
        :loading="isDownloading"
        :disabled="isDownloading"
        @click="handleDownloadAndApply"
      />

      <Button
        v-if="updateReady"
        label="Restart to apply"
        icon="pi pi-power-off"
        severity="warn"
        size="small"
        class="field-control"
        @click="handleDownloadAndApply"
      />
    </div>

    <div
      v-if="appInfo?.channel === 'dev'"
      class="field"
    >
      <p class="field-hint">Auto-update is disabled on the <code>dev</code> channel.</p>
    </div>
  </SettingsGroup>
</template>

<style scoped>
.update-status-error {
  color: var(--p-red-400);
}
.update-error-detail {
  opacity: 0.7;
  font-size: 0.85em;
}
</style>
