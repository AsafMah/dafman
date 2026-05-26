/**
 * Composable orchestrating groups CRUD across the three stores that need
 * to be kept consistent: `groupsStore` (meta), `layoutStore` (outer dock
 * + inner registry routing), and `sessionsStore` (close on group delete /
 * move).
 *
 * Lives in `composables/` rather than inside any store so that:
 *  - the cross-store dance is testable independently of dockview
 *  - `groupsStore` stays a pure data layer
 *  - `layoutStore` doesn't need to import sessionsStore (it doesn't today)
 *
 * Phase 4 surface: `newGroup`, `deleteGroup`, `moveSessionToGroup`,
 * `activateGroup`. Phase 6 builds the right-click menu on top of
 * `moveSessionToGroup`.
 */

import { useGroupsStore } from '@/stores/shell/groupsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';

export interface GroupsActions {
  /// Creates a new group + adds an outer body panel + activates it.
  /// Returns the new group id, or null if the outer api isn't ready.
  newGroup: (name?: string) => string | null;
  /// Removes a group: closes its sessions, removes the outer body
  /// panel, deletes the group meta. No-op if it's the last group.
  deleteGroup: (id: string) => void;
  /// Moves a session into the target group. Prunes from the current
  /// group (mounted or cached) then adds to the target's inner api.
  /// If the target's inner isn't mounted yet, activates the target
  /// outer panel first to trigger lazy mount.
  moveSessionToGroup: (sessionId: string, targetGroupId: string) => Promise<void>;
  /// Activates the outer body panel for the given group id (programmatic
  /// equivalent of the user clicking the group's tab).
  activateGroup: (id: string) => void;
}

export function useGroupsActions(): GroupsActions {
  const groupsStore = useGroupsStore();
  const layoutStore = useLayoutStore();
  const sessionsStore = useSessionsStore();

  function newGroup(name?: string): string | null {
    const outer = layoutStore.api;
    if (!outer) return null;
    const meta = groupsStore.createGroup(name);
    outer.addPanel({
      id: meta.id,
      component: 'group',
      title: meta.name,
      tabComponent: 'groupTab',
      params: { groupId: meta.id, color: meta.color, name: meta.name },
    });
    const panel = outer.getPanel(meta.id);
    panel?.api.setActive();
    return meta.id;
  }

  function deleteGroup(id: string): void {
    if (groupsStore.groups.length <= 1) return;
    const outer = layoutStore.api;

    // `groupsStore.deleteGroup` already moves activeGroupId to a sibling,
    // returns the session ids that were in the deleted group, and clears
    // the cache + registry entry. Close those sessions, then remove the
    // outer body panel.
    const closedIds = groupsStore.deleteGroup(id);
    for (const sid of closedIds) {
      void sessionsStore.closeSession(sid);
    }
    if (outer) {
      const panel = outer.getPanel(id);
      if (panel) outer.removePanel(panel);
    }
  }

  function activateGroup(id: string): void {
    const outer = layoutStore.api;
    if (!outer) return;
    const panel = outer.getPanel(id);
    panel?.api.setActive();
  }

  async function moveSessionToGroup(
    sessionId: string,
    targetGroupId: string,
  ): Promise<void> {
    if (targetGroupId === groupsStore.activeGroupId) return;
    const target = groupsStore.groups.find((g) => g.id === targetGroupId);
    if (!target) return;

    // Activate target first so its inner DockviewVue mounts and registers
    // an api. If lazy-mount lands later this will need to await a
    // "registered" signal; for v3 eager-mount the api is available
    // immediately after activate.
    activateGroup(targetGroupId);
    // Yield one tick so the activate event propagates to the inner
    // GroupPanel and Vue settles.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const targetApi = groupsStore.innerApis[targetGroupId];
    if (!targetApi) {
      console.warn('[useGroupsActions] target inner api not registered after activate', targetGroupId);
      return;
    }

    // Strip from any other group (mounted or cached) — the one-only
    // invariant. `groupsStore` wraps each removal in withMovingSession
    // so the per-inner onDidRemovePanel handler skips closeSession.
    groupsStore.pruneSessionFromAllGroups(sessionId, targetGroupId);

    // Add to the target inner. We don't have to pass a title (the
    // chat title resolver lookups it via sessionsStore on mount).
    targetApi.addPanel({
      id: sessionId,
      component: 'chat',
      params: { sessionId },
    });
  }

  return { newGroup, deleteGroup, moveSessionToGroup, activateGroup };
}
