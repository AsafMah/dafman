/// IPC + state for the Skills tab in the Library panel. Handles the
/// session-vs-global routing the SDK requires (`listSessionSkills` +
/// `setSessionSkillEnabled` when a session is open, otherwise the
/// global `discoverSkills` + `setGloballyDisabledSkills` fallback).

import { ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { toErrorMessage } from '@/lib/errorMessage';

export interface Skill {
  name: string;
  description: string;
  source: string;
  userInvocable: boolean;
  enabled: boolean;
  path?: string;
}

export function useSkillsLibrary() {
  const skills = ref<Skill[]>([]);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  function getSessionId(): string | undefined {
    const sessionsStore = useSessionsStore();
    const activeId = useLayoutStore().activeSessionId;
    const active = activeId ? sessionsStore.getSession(activeId) : undefined;

    return active?.id ?? sessionsStore.sessions[0]?.id;
  }

  async function load(): Promise<void> {
    error.value = null;
    loaded.value = false;

    try {
      const sessionsStore = useSessionsStore();
      const sessionId = getSessionId();

      if (sessionId) {
        skills.value = await invokeCommand('listSessionSkills', { sessionId });
      } else {
        const wd = sessionsStore.sessions.find((s) => s.workingDirectory)?.workingDirectory || '';

        skills.value = await invokeCommand('discoverSkills', wd ? { workingDirectory: wd } : {});
      }
    } catch (err) {
      error.value = toErrorMessage(err);
    } finally {
      loaded.value = true;
    }
  }

  /// Toggle one skill. Optimistic — flips the local view first, then
  /// rolls back + toasts on failure.
  async function setEnabled(skill: Skill, enabled: boolean): Promise<void> {
    skill.enabled = enabled;

    try {
      const sessionId = getSessionId();

      if (sessionId) {
        await invokeCommand('setSessionSkillEnabled', {
          sessionId,
          name: skill.name,
          enabled,
        });
      } else {
        const disabled = skills.value.filter((s) => !s.enabled).map((s) => s.name);

        await invokeCommand('setGloballyDisabledSkills', { disabledSkills: disabled });
      }
    } catch (err) {
      skill.enabled = !enabled;
      useToastStore().error('Toggle failed', toErrorMessage(err));
    }
  }

  return { skills, loaded, error, load, setEnabled };
}
