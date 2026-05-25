/// IPC + state for the Instructions tab in the Library panel.
/// Wraps `listInstructionSources` with loaded/error tracking so the
/// component doesn't reach for `invokeCommand` directly.

import { ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import type { InstructionSource } from '@/ipc/types';
import { toErrorMessage } from '@/lib/errorMessage';

export function useInstructionsLibrary() {
  const sources = ref<InstructionSource[]>([]);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function load(workingDirectory: string | null | undefined): Promise<void> {
    error.value = null;
    loaded.value = false;

    try {
      sources.value = await invokeCommand(
        'listInstructionSources',
        workingDirectory ? { workingDirectory } : {},
      );
    } catch (err) {
      error.value = toErrorMessage(err);
    } finally {
      loaded.value = true;
    }
  }

  return { sources, loaded, error, load };
}
