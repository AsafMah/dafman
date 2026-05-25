// Composable: session plan read/write for the session details rail.

import { ref, type ComputedRef } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

export function useSessionPlan(sessionId: ComputedRef<string>) {
  const toasts = useToastStore();
  const planExists = ref(false);
  const planContent = ref<string>('');
  const planEditing = ref(false);
  const planDraft = ref<string>('');
  const planError = ref<string | null>(null);
  const planLoaded = ref(false);

  async function loadPlan() {
    if (!sessionId.value) return;

    planError.value = null;

    try {
      const result = await invokeCommand('readSessionPlan', {
        sessionId: sessionId.value,
      });

      planExists.value = result.exists;
      planContent.value = result.content ?? '';
      planLoaded.value = true;
    } catch (err) {
      planError.value = toErrorMessage(err);
      planLoaded.value = true;
    }
  }

  function startEditPlan() {
    planDraft.value = planContent.value;
    planEditing.value = true;
  }

  async function savePlan() {
    try {
      await invokeCommand('writeSessionPlan', {
        sessionId: sessionId.value,
        content: planDraft.value,
      });
      planContent.value = planDraft.value;
      planExists.value = true;
      planEditing.value = false;
      toasts.success('Plan saved');
    } catch (err) {
      toasts.error('Plan save failed', toErrorMessage(err));
    }
  }

  function cancelEditPlan() {
    planEditing.value = false;
  }

  function resetPlan() {
    planExists.value = false;
    planContent.value = '';
    planEditing.value = false;
    planError.value = null;
    planLoaded.value = false;
  }

  return {
    planExists,
    planContent,
    planEditing,
    planDraft,
    planError,
    planLoaded,
    loadPlan,
    startEditPlan,
    savePlan,
    cancelEditPlan,
    resetPlan,
  };
}
