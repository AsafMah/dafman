/// IPC + state for the Skills tab in the Library panel.
///
/// Phase 28: two-column design — global discovery + per-session override.
/// `skills` holds the global state (from `discoverSkills`); the "This
/// session" column reads from `sessionSkillEnabled` (from
/// `listSessionSkills` for the focused session). The pattern mirrors
/// `useMcpLibrary` — see its inline docs for the rationale.

import { computed, ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { toErrorMessage } from '@/lib/errorMessage';
import { useDelayedLoadedFlag } from '@/composables/library/useDelayedLoadedFlag';

export interface Skill {
  name: string;
  description: string;
  source: string;
  userInvocable: boolean;
  enabled: boolean;
  path?: string;
}

export function useSkillsLibrary() {
  /// Global skill list — from `discoverSkills`, reflects the global
  /// disabled-set. Drives the "Default" column toggle.
  const skills = ref<Skill[]>([]);
  /// Per-session enabled map: name → session-level enabled state.
  /// Built from `listSessionSkills` when a session is focused.
  /// When a skill is absent from this map, `sessionEnabled()` falls
  /// back to the global `skill.enabled`.
  const sessionSkillEnabled = ref<Map<string, boolean>>(new Map());
  const { loaded, beginLoading } = useDelayedLoadedFlag();
  const error = ref<string | null>(null);

  /// Mirrors `useMcpLibrary.getLibrarySession()` — prefer the last
  /// focused chat session for workspace-scoped discovery context,
  /// then fall back through active → any-with-wd → any.
  function getLibrarySession() {
    const sessionsStore = useSessionsStore();
    const layoutStore = useLayoutStore();

    return (
      sessionsStore.getSession(layoutStore.lastFocusedSessionId) ??
      sessionsStore.getSession(layoutStore.activeSessionId) ??
      sessionsStore.sessions.find((s) => s.workingDirectory) ??
      sessionsStore.sessions[0] ??
      null
    );
  }

  const librarySession = computed(() => getLibrarySession());
  const hasLibrarySession = computed(() => librarySession.value !== null);

  async function load(): Promise<void> {
    const finishLoading = beginLoading();

    error.value = null;

    try {
      const session = getLibrarySession();
      const wd = session?.workingDirectory || '';

      // Always load the global skill list so `skills` reflects the
      // global disabled-set regardless of session state (drives the
      // "Default" column). Use the library session's workingDirectory
      // for workspace-scoped discovery, falling back to no WD.
      const globalSkillsPromise = invokeCommand(
        'discoverSkills',
        wd ? { workingDirectory: wd } : {},
      );
      // When a session is focused, also query its per-session skill
      // state so the "This session" column shows the override value.
      const sessionSkillsPromise = session
        ? invokeCommand('listSessionSkills', { sessionId: session.id }).catch(
            () => null as Array<{ name: string; enabled: boolean }> | null,
          )
        : Promise.resolve(null);

      const [globalSkills, sessionSkills] = await Promise.all([
        globalSkillsPromise,
        sessionSkillsPromise,
      ]);

      skills.value = globalSkills;
      sessionSkillEnabled.value = sessionSkills
        ? new Map(sessionSkills.map((s) => [s.name, s.enabled]))
        : new Map();
    } catch (err) {
      error.value = toErrorMessage(err);
    } finally {
      finishLoading();
    }
  }

  /// Toggle a skill's GLOBAL enabled state. Optimistic — flips the
  /// local view first, rolls back + toasts on failure.
  async function setEnabled(skill: Skill, enabled: boolean): Promise<void> {
    skill.enabled = enabled;

    try {
      const disabled = skills.value.filter((s) => !s.enabled).map((s) => s.name);

      await invokeCommand('setGloballyDisabledSkills', { disabledSkills: disabled });
    } catch (err) {
      skill.enabled = !enabled;
      useToastStore().error('Toggle failed', toErrorMessage(err));
    }
  }

  /// Per-session enabled state for the focused session.
  ///
  /// Rule (mirrors MCP sessionEnabled):
  /// - skill present in sessionSkillEnabled map → use map value (session override)
  /// - skill absent (no per-session record) → fall back to global skill.enabled
  function sessionEnabled(name: string): boolean {
    const sessionVal = sessionSkillEnabled.value.get(name);

    if (sessionVal !== undefined) return sessionVal;

    const skill = skills.value.find((s) => s.name === name);

    return skill?.enabled ?? true;
  }

  /// Toggle skill enabled state for the FOCUSED session only.
  /// Does NOT touch the global disabled-set (`setGloballyDisabledSkills`).
  /// Refreshes both global and session state via load().
  async function setSessionEnabled(name: string, enabled: boolean): Promise<void> {
    const session = librarySession.value;

    if (!session) return;

    try {
      await invokeCommand('setSessionSkillEnabled', {
        sessionId: session.id,
        name,
        enabled,
      });
      await load();
    } catch (err) {
      useToastStore().error('Failed to set session skill state', toErrorMessage(err));
    }
  }

  return {
    skills,
    loaded,
    error,
    load,
    setEnabled,
    librarySession,
    hasLibrarySession,
    sessionEnabled,
    setSessionEnabled,
  };
}
