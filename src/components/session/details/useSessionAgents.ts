// Composable: agent list, select/deselect, source label for the session details rail.

import { ref, type ComputedRef } from 'vue';
import type { AgentInfo } from '@/ipc/types';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';
import type { SessionRecord } from '@/stores/chat/sessionsStore';

export function useSessionAgents(
  sessionId: ComputedRef<string>,
  record: ComputedRef<SessionRecord | undefined>,
) {
  const toasts = useToastStore();
  const sessionAgents = ref<AgentInfo[]>([]);
  const agentsLoaded = ref(false);
  const agentsError = ref<string | null>(null);
  const agentBusyName = ref<string | null>(null);

  async function loadAgents() {
    if (!sessionId.value) return;

    agentsError.value = null;

    try {
      sessionAgents.value = await invokeCommand('listAgents', {
        sessionId: sessionId.value,
      });
      agentsLoaded.value = true;
    } catch (err) {
      agentsError.value = toErrorMessage(err);
      agentsLoaded.value = true;
    }
  }

  async function reloadAgents() {
    if (!sessionId.value) return;

    agentsError.value = null;

    try {
      sessionAgents.value = await invokeCommand('reloadAgents', {
        sessionId: sessionId.value,
      });
      toasts.success('Agents reloaded', `${sessionAgents.value.length} available`);
    } catch (err) {
      agentsError.value = toErrorMessage(err);
      toasts.error('Failed to reload agents', toErrorMessage(err));
    }
  }

  async function selectAgent(name: string) {
    if (!sessionId.value || agentBusyName.value) return;

    agentBusyName.value = name;

    try {
      await invokeCommand('selectAgent', {
        sessionId: sessionId.value,
        name,
      });
    } catch (err) {
      toasts.error('Failed to select agent', toErrorMessage(err));
    } finally {
      agentBusyName.value = null;
    }
  }

  async function deselectAgent() {
    if (!sessionId.value || agentBusyName.value) return;

    agentBusyName.value = '__deselect__';

    try {
      await invokeCommand('deselectAgent', { sessionId: sessionId.value });
    } catch (err) {
      toasts.error('Failed to deselect agent', toErrorMessage(err));
    } finally {
      agentBusyName.value = null;
    }
  }

  function agentSourceLabel(agent: AgentInfo): 'Project' | 'User' | null {
    if (!agent.path) return null;

    const wd = record.value?.workingDirectory;

    if (!wd) return 'User';

    const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
    const projectPrefix = `${norm(wd)}/.github/agents/`;

    return norm(agent.path).startsWith(projectPrefix) ? 'Project' : 'User';
  }

  function reset() {
    sessionAgents.value = [];
    agentsLoaded.value = false;
    agentsError.value = null;
    agentBusyName.value = null;
  }

  return {
    sessionAgents,
    agentsLoaded,
    agentsError,
    agentBusyName,
    loadAgents,
    reloadAgents,
    selectAgent,
    deselectAgent,
    agentSourceLabel,
    reset,
  };
}
