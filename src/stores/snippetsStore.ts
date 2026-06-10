/// Pinia store for the Prompt Snippet Library.
///
/// Holds the in-memory snippet list and delegates persistence to the
/// Bun-side `SnippetService` via RPC. Components should call `loadAll()`
/// on mount; subsequent save/remove calls update local state + backend.

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import type { Snippet } from '@/ipc/types';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

export { type Snippet };

export const useSnippetsStore = defineStore('snippets', () => {
  const snippets = ref<Snippet[]>([]);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function loadAll(): Promise<void> {
    error.value = null;

    try {
      const result = await invokeCommand('listSnippets', {});

      snippets.value = Array.isArray(result) ? result : [];
      loaded.value = true;
    } catch (err) {
      error.value = toErrorMessage(err);
    }
  }

  async function save(snippet: Snippet): Promise<boolean> {
    try {
      // Auto-assign id + timestamps if creating new
      const now = new Date().toISOString();
      const prepared: Snippet = {
        ...snippet,
        id: snippet.id || crypto.randomUUID(),
        createdAt: snippet.createdAt || now,
        updatedAt: now,
      };

      await invokeCommand('saveSnippet', { snippet: prepared });

      const idx = snippets.value.findIndex((s) => s.id === prepared.id);

      if (idx >= 0) {
        snippets.value[idx] = prepared;
      } else {
        snippets.value.push(prepared);
      }

      return true;
    } catch (err) {
      const toasts = useToastStore();

      toasts.error('Failed to save snippet', toErrorMessage(err));

      return false;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await invokeCommand('deleteSnippet', { id });

      const idx = snippets.value.findIndex((s) => s.id === id);

      if (idx >= 0) snippets.value.splice(idx, 1);

      return true;
    } catch (err) {
      const toasts = useToastStore();

      toasts.error('Failed to delete snippet', toErrorMessage(err));

      return false;
    }
  }

  return { snippets, loaded, error, loadAll, save, remove };
});
