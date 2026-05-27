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
    // Use an existing body group as the reference so the new tab lands
    // in the same horizontal tab strip as the other groups. If somehow
    // no body group exists (e.g. all groups were closed via dockview's
    // own X — currently impossible since we block last-group-close in
    // GroupTab), create one. Direction is always 'within' so groups
    // stay as tabs, never split panes.
    let referenceGroup = layoutStore.firstBodyGroupId();
    if (!referenceGroup) {
      referenceGroup = outer.addGroup().id;
    }
    outer.addPanel({
      id: meta.id,
      component: 'group',
      title: meta.name,
      tabComponent: 'groupTab',
      params: { groupId: meta.id, color: meta.color, name: meta.name },
      position: { referenceGroup, direction: 'within' },
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
      // Explicitly activate the new active group's outer panel so
      // dockview's onDidActivePanelChange fires and bodyApi resolves to
      // the correct inner. Without this, dockview may activate an
      // arbitrary remaining panel (potentially an edge-group panel) and
      // groupsStore.activeGroupId — already updated by deleteGroup
      // above — would diverge from outer.activePanel (code-review
      // finding 2026-05-27, issue 3).
      const newActiveId = groupsStore.activeGroupId;
      if (newActiveId) {
        const next = outer.getPanel(newActiveId);
        next?.api.setActive();
      }
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

    // Activate target first so its inner DockviewVue mounts and registers.
    // Then await the registration via groupsStore.awaitInnerApi — replaces
    // the old requestAnimationFrame guess that could leave the session
    // pruned-but-not-added if the inner api wasn't yet bound (code-review
    // finding 2026-05-27).
    activateGroup(targetGroupId);
    let targetApi;
    try {
      targetApi = await groupsStore.awaitInnerApi(targetGroupId);
    } catch (err) {
      console.warn('[useGroupsActions] timed out waiting for target inner api', targetGroupId, err);
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
