// Lazy-loaded model catalog, cached for the session.
//
// The SDK caches `list_models` after the first successful call, but we
// still keep a Pinia-side cache so components don't fire repeated IPCs
// while waiting for the same response. Reset on client recreation if/when
// we ever support that.

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invokeCommand } from '../ipc/invoke';
import type { ModelSummary } from '../ipc/types';
import { useToastStore } from './toastStore';
import { toErrorMessage } from '../lib/errorMessage';

export const useModelsStore = defineStore('models', () => {
  const models = ref<ModelSummary[]>([]);
  const loaded = ref(false);
  const isLoading = ref(false);
  let inflight: Promise<ModelSummary[]> | null = null;

  async function load(): Promise<ModelSummary[]> {
    if (loaded.value) return models.value;
    if (inflight) return inflight;
    isLoading.value = true;
    inflight = (async () => {
      try {
        const next = await invokeCommand('listModels', {});
        models.value = next;
        loaded.value = true;
        return next;
      } catch (err) {
        const message = toErrorMessage(err);
        useToastStore().error('Failed to load models', message);
        throw err;
      } finally {
        isLoading.value = false;
        inflight = null;
      }
    })();
    return inflight;
  }

  function find(id: string): ModelSummary | undefined {
    return models.value.find((m) => m.id === id);
  }

  return { models, loaded, isLoading, load, find };
});
