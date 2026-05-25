// Composable: background tasks list, cancel, remove for the session details rail.

import { ref, type ComputedRef } from 'vue';
import type { TaskInfo } from '@/ipc/types';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

export function useSessionTasks(sessionId: ComputedRef<string>) {
  const toasts = useToastStore();
  const sessionTasks = ref<TaskInfo[]>([]);
  const tasksLoaded = ref(false);
  const tasksError = ref<string | null>(null);
  const taskBusyId = ref<string | null>(null);
  let tasksRequestToken = 0;

  async function loadTasks() {
    if (!sessionId.value) return;

    tasksError.value = null;
    const token = ++tasksRequestToken;

    try {
      const tasks = await invokeCommand('listTasks', {
        sessionId: sessionId.value,
      });

      if (token !== tasksRequestToken) return;

      sessionTasks.value = tasks;
      tasksLoaded.value = true;
    } catch (err) {
      if (token !== tasksRequestToken) return;

      tasksError.value = toErrorMessage(err);
      tasksLoaded.value = true;
    }
  }

  async function cancelTask(task: TaskInfo) {
    if (!sessionId.value || taskBusyId.value) return;

    taskBusyId.value = task.id;

    try {
      await invokeCommand('cancelTask', {
        sessionId: sessionId.value,
        id: task.id,
      });
      toasts.info('Task cancelled', `Cancelled "${task.description || task.id}".`);
    } catch (err) {
      toasts.error('Failed to cancel task', toErrorMessage(err));
    } finally {
      taskBusyId.value = null;
      void loadTasks();
    }
  }

  async function removeTask(task: TaskInfo) {
    if (!sessionId.value || taskBusyId.value) return;

    taskBusyId.value = task.id;

    try {
      await invokeCommand('removeTask', {
        sessionId: sessionId.value,
        id: task.id,
      });
    } catch (err) {
      toasts.error('Failed to remove task', toErrorMessage(err));
    } finally {
      taskBusyId.value = null;
      void loadTasks();
    }
  }

  function reset() {
    sessionTasks.value = [];
    tasksLoaded.value = false;
    tasksError.value = null;
    taskBusyId.value = null;
  }

  return {
    sessionTasks,
    tasksLoaded,
    tasksError,
    taskBusyId,
    loadTasks,
    cancelTask,
    removeTask,
    reset,
  };
}

/// Format `activeTimeMs` (or fall back to `startedAt`→now) as a
/// terse human-readable duration.
export function formatTaskElapsed(task: TaskInfo): string {
  let ms: number | null = null;

  if (typeof task.activeTimeMs === 'number') {
    ms = task.activeTimeMs;
  } else if (task.startedAt) {
    const start = Date.parse(task.startedAt);
    const end = task.completedAt ? Date.parse(task.completedAt) : Date.now();

    if (Number.isFinite(start) && Number.isFinite(end)) ms = end - start;
  }

  if (ms === null) return '';

  if (ms < 1000) return `${ms}ms`;

  const s = Math.round(ms / 1000);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);
  const rem = s % 60;

  if (m < 60) return `${m}m ${rem}s`;

  const h = Math.floor(m / 60);

  return `${h}h ${m % 60}m`;
}

export function taskTitle(task: TaskInfo): string {
  return task.type === 'agent'
    ? task.agentDisplayName || task.agentName || task.agentType
    : task.command || task.description || 'Shell task';
}
