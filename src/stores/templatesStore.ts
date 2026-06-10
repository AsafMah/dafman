/// Pinia store for Session Config Templates (#243).
///
/// Holds the in-memory template list and delegates persistence to the
/// Bun-side `TemplateService` via RPC. Components should call `loadAll()`
/// on mount; subsequent save/remove/apply/capture calls update local state
/// and the backend.

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import type { ApplyTemplateResult, SessionTemplate } from '@/ipc/types';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

export type { SessionTemplate, ApplyTemplateResult };

export const useTemplatesStore = defineStore('templates', () => {
  const templates = ref<SessionTemplate[]>([]);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function loadAll(): Promise<void> {
    error.value = null;

    try {
      const result = await invokeCommand('listTemplates', {});

      templates.value = Array.isArray(result) ? result : [];
      loaded.value = true;
    } catch (err) {
      error.value = toErrorMessage(err);
    }
  }

  async function save(template: SessionTemplate): Promise<boolean> {
    try {
      await invokeCommand('saveTemplate', { template });

      const idx = templates.value.findIndex((t) => t.id === template.id);

      if (idx >= 0) {
        templates.value[idx] = template;
      } else {
        templates.value.push(template);
      }

      return true;
    } catch (err) {
      useToastStore().error('Failed to save template', toErrorMessage(err));

      return false;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await invokeCommand('deleteTemplate', { id });

      const idx = templates.value.findIndex((t) => t.id === id);

      if (idx >= 0) templates.value.splice(idx, 1);

      return true;
    } catch (err) {
      useToastStore().error('Failed to delete template', toErrorMessage(err));

      return false;
    }
  }

  async function apply(sessionId: string, templateId: string): Promise<ApplyTemplateResult | null> {
    try {
      return await invokeCommand('applyTemplate', { sessionId, templateId });
    } catch (err) {
      useToastStore().error('Failed to apply template', toErrorMessage(err));

      return null;
    }
  }

  async function capture(sessionId: string, name: string): Promise<SessionTemplate | null> {
    try {
      const result = await invokeCommand('captureTemplate', { sessionId, name });

      templates.value.push(result);

      return result;
    } catch (err) {
      useToastStore().error('Failed to capture template', toErrorMessage(err));

      return null;
    }
  }

  return { templates, loaded, error, loadAll, save, remove, apply, capture };
});
