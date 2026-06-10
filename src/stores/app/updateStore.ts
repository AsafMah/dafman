// Pinia store for in-app auto-update state.
//
// Subscribes to the `updateEvent` push channel on first use and tracks the
// current update status. Exposes `checkForUpdate()` and
// `downloadAndApplyUpdate()` for the Settings section to call.

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invokeCommand, onUpdateEvent } from '@/ipc/invoke';
import type { UpdateCheckResult, UpdateEventPayload, UpdateStatusType } from '@/ipc/types';

export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatusType>('idle');
  const statusMessage = ref<string>('');
  const updateAvailable = ref<boolean>(false);
  const updateReady = ref<boolean>(false);
  const latestVersion = ref<string>('');
  const errorMessage = ref<string>('');
  const progress = ref<number | undefined>(undefined);

  const isChecking = computed(() => status.value === 'checking');
  const isDownloading = computed(
    () => status.value === 'downloading' || status.value === 'applying',
  );

  let _unsubscribe: (() => void) | null = null;

  function _handleEvent(payload: UpdateEventPayload): void {
    status.value = payload.status;
    statusMessage.value = payload.message;
    progress.value = payload.progress;
    errorMessage.value = payload.errorMessage ?? '';

    if (payload.status === 'update-available') {
      updateAvailable.value = true;
    } else if (payload.status === 'no-update') {
      updateAvailable.value = false;
      updateReady.value = false;
    } else if (payload.status === 'complete') {
      updateReady.value = true;
    } else if (payload.status === 'idle') {
      // reset on explicit idle
    }
  }

  function _ensureSubscribed(): void {
    if (_unsubscribe) return;
    _unsubscribe = onUpdateEvent(_handleEvent);
  }

  async function checkForUpdate(): Promise<UpdateCheckResult> {
    _ensureSubscribed();
    status.value = 'checking';
    statusMessage.value = 'Checking for updates\u2026';
    const result = await invokeCommand('checkForUpdate', {});
    // The RPC result reflects the final state; update local state.
    updateAvailable.value = result.updateAvailable;
    updateReady.value = result.updateReady;
    latestVersion.value = result.version;
    if (!result.updateAvailable) {
      status.value = 'no-update';
      statusMessage.value = 'You are on the latest version.';
    }
    return result;
  }

  async function downloadAndApplyUpdate(): Promise<void> {
    _ensureSubscribed();
    await invokeCommand('downloadAndApplyUpdate', {});
    // App will restart; no further state update needed.
  }

  async function loadInitialStatus(): Promise<void> {
    _ensureSubscribed();
    const existing = await invokeCommand('getUpdateStatus', {});
    if (!existing) return;
    updateAvailable.value = existing.updateAvailable;
    updateReady.value = existing.updateReady;
    latestVersion.value = existing.version;
    if (existing.updateAvailable) {
      status.value = 'update-available';
      statusMessage.value = `Update available (${existing.version || existing.hash.slice(0, 8)})`;
    }
  }

  return {
    status,
    statusMessage,
    updateAvailable,
    updateReady,
    latestVersion,
    errorMessage,
    progress,
    isChecking,
    isDownloading,
    checkForUpdate,
    downloadAndApplyUpdate,
    loadInitialStatus,
  };
});
