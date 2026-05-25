/// Composable wrapper for the OS folder picker IPC. Centralizes the
/// busy-flag + error-toast pattern that was duplicated across
/// SettingsPanel.vue and SessionsManager.vue.
///
/// Usage:
///   const { isPicking, pick } = useFolderPicker();
///   const picked = await pick(currentFolder);

import { ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

export function useFolderPicker(toastMsg = "Couldn't pick folder") {
  const isPicking = ref(false);

  async function pick(startingFolder?: string): Promise<string | null> {
    if (isPicking.value) return null;

    isPicking.value = true;

    try {
      return (await invokeCommand('pickFolder', startingFolder ? { startingFolder } : {})) ?? null;
    } catch (err) {
      useToastStore().error(toastMsg, toErrorMessage(err));

      return null;
    } finally {
      isPicking.value = false;
    }
  }

  return { isPicking, pick };
}
