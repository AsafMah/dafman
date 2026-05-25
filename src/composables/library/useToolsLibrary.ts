/// IPC + state for the Tools tab in the Library panel. Wraps
/// `listBuiltinTools` with loaded/error tracking so the component
/// doesn't reach for `invokeCommand` directly.

import { ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { toErrorMessage } from '@/lib/errorMessage';

export interface ToolItem {
  name: string;
  description: string;
  namespacedName?: string;
}

export function useToolsLibrary() {
  const tools = ref<ToolItem[]>([]);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    error.value = null;
    loaded.value = false;

    try {
      tools.value = await invokeCommand('listBuiltinTools', {});
    } catch (err) {
      error.value = toErrorMessage(err);
    } finally {
      loaded.value = true;
    }
  }

  return { tools, loaded, error, load };
}
