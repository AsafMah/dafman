// Composable: session skills list + toggle for the session details rail.

import { ref, type ComputedRef } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { toErrorMessage } from '@/lib/errorMessage';
import { emit as busEmit } from '@/lib/bus';
import { PANEL_IDS } from '@/constants/panels';

export type SessionSkill = {
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  userInvocable: boolean;
};

export function useSessionSkills(sessionId: ComputedRef<string>) {
  const layoutStore = useLayoutStore();
  const sessionSkills = ref<SessionSkill[]>([]);
  const skillsLoaded = ref(false);
  const skillsError = ref<string | null>(null);

  async function loadSkills() {
    if (!sessionId.value) return;

    skillsError.value = null;

    try {
      sessionSkills.value = await invokeCommand('listSessionSkills', {
        sessionId: sessionId.value,
      });
      skillsLoaded.value = true;
    } catch (err) {
      skillsError.value = toErrorMessage(err);
      skillsLoaded.value = true;
    }
  }

  async function toggleSkill(skill: SessionSkill) {
    const next = !skill.enabled;

    skill.enabled = next;

    try {
      await invokeCommand('setSessionSkillEnabled', {
        sessionId: sessionId.value,
        name: skill.name,
        enabled: next,
      });
    } catch {
      skill.enabled = !next;
    }
  }

  /// Opens the Library activity-bar panel and switches it to the
  /// Skills tab.
  function openSkillsLibrary() {
    try {
      localStorage.setItem('dafman.library.activeTab', 'skills');
    } catch {
      /* private mode — ignore */
    }

    busEmit('library-activate-tab', { tab: 'skills' });
    // Library lives on the right edge in v2.
    layoutStore.activateEdgePanel(PANEL_IDS.library, 'right');
  }

  function reset() {
    sessionSkills.value = [];
    skillsLoaded.value = false;
    skillsError.value = null;
  }

  return {
    sessionSkills,
    skillsLoaded,
    skillsError,
    loadSkills,
    toggleSkill,
    openSkillsLibrary,
    reset,
  };
}
