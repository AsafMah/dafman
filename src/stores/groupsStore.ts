// Groups store — manages named workspace groups. Each group owns a
// body-panel layout snapshot; edge groups (sidebars) are shared.
// Switching groups = save current body → fromJSON with target body +
// current edges. The dockview instance stays mounted.

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { GroupConfig, Layout } from "../ipc/types";
import {
  stripEdges,
  mergeBodyWithEdges,
  edgesOnlyLayout,
  extractChatPanelIds,
} from "../lib/layoutSanitize";
import { useLayoutStore } from "./layoutStore";
import { useSettingsStore } from "./settingsStore";
import { useSessionsStore } from "./sessionsStore";

let idCounter = 0;
function newGroupId(): string {
  return `grp-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export const useGroupsStore = defineStore("groups", () => {
  const groups = ref<GroupConfig[]>([]);
  const activeGroupId = ref<string>("");

  const activeGroup = computed(
    () => groups.value.find((g) => g.id === activeGroupId.value) ?? null,
  );

  const layoutStore = useLayoutStore();
  const settingsStore = useSettingsStore();

  // ── Hydrate / persist ────────────────────────────────────────

  /** Hydrate groups from settings. Call once at boot before layout restore. */
  function hydrate(layout: Layout): void {
    if (layout.groups && layout.groups.length > 0) {
      groups.value = layout.groups.map((g) => ({ ...g }));
      activeGroupId.value = layout.activeGroupId ?? layout.groups[0].id;
    } else {
      // Migration: create "Default" group from legacy single dockview blob
      const defaultId = newGroupId();
      groups.value = [
        {
          id: defaultId,
          name: "Default",
          layout: layout.dockview ? stripEdges(layout.dockview) : null,
        },
      ];
      activeGroupId.value = defaultId;
    }
  }

  /** Persist current groups + activeGroupId + full dockview snapshot to settings. */
  async function persist(): Promise<void> {
    const s = settingsStore.settings;
    // Also save the full dockview snapshot so edge state survives restart
    const api = layoutStore.api;
    const dockview = api ? api.toJSON() : s.layout.dockview;
    await settingsStore.update({
      ...s,
      layout: {
        ...s.layout,
        dockview,
        groups: groups.value.map((g) => ({ ...g })),
        activeGroupId: activeGroupId.value,
      },
    });
  }

  // ── Group CRUD ───────────────────────────────────────────────

  async function createGroup(name: string): Promise<string> {
    const id = newGroupId();
    groups.value.push({ id, name, layout: null });
    await switchGroup(id);
    return id;
  }

  function renameGroup(id: string, name: string): void {
    const g = groups.value.find((g) => g.id === id);
    if (g) g.name = name;
    void persist();
  }

  async function deleteGroup(id: string): Promise<void> {
    if (groups.value.length <= 1) return; // can't delete the last group
    const idx = groups.value.findIndex((g) => g.id === id);
    if (idx < 0) return;

    // If deleting the active group, switch to another first
    if (id === activeGroupId.value) {
      const next = groups.value[idx === 0 ? 1 : idx - 1];
      await switchGroup(next.id);
    }

    // Close sessions that belong ONLY to the deleted group (not shared)
    const deleted = groups.value.find((g) => g.id === id);
    if (deleted?.layout) {
      const deletedSessionIds = extractChatPanelIds(deleted.layout);
      // Collect session IDs from all OTHER groups
      const otherSessionIds = new Set<string>();
      for (const g of groups.value) {
        if (g.id === id) continue;
        if (g.id === activeGroupId.value) {
          // Active group: read from live dockview
          const api = layoutStore.api;
          if (api) {
            for (const sid of extractChatPanelIds(stripEdges(api.toJSON()))) {
              otherSessionIds.add(sid);
            }
          }
        } else if (g.layout) {
          for (const sid of extractChatPanelIds(g.layout)) {
            otherSessionIds.add(sid);
          }
        }
      }
      const sessionsStore = useSessionsStore();
      for (const sid of deletedSessionIds) {
        if (!otherSessionIds.has(sid)) {
          void sessionsStore.closeSession(sid);
        }
      }
    }

    groups.value = groups.value.filter((g) => g.id !== id);
    await persist();
  }

  // ── Switch ───────────────────────────────────────────────────

  /** Save the current body layout into the active group's snapshot. */
  function saveActiveBody(): void {
    const api = layoutStore.api;
    if (!api || !activeGroup.value) return;
    const full = api.toJSON();
    activeGroup.value.layout = stripEdges(full);
  }

  /**
   * Switch to a different group.
   * 1. Cancel pending layout save
   * 2. Set switching = true (suppress closeSession in onDidRemovePanel)
   * 3. Save current body into active group
   * 4. fromJSON with target body + current edges
   * 5. Lazy-resume any missing sessions
   * 6. Set switching = false, persist
   */
  async function switchGroup(targetId: string): Promise<void> {
    if (targetId === activeGroupId.value) return;
    if (layoutStore.switching) return; // prevent re-entrant switches
    const target = groups.value.find((g) => g.id === targetId);
    if (!target) return;
    const api = layoutStore.api;
    if (!api) return;

    const sourceGroupId = activeGroupId.value;
    layoutStore.switching = true;
    try {
      // Save current body into the SOURCE group (not activeGroupId which we're about to change)
      const sourceGroup = groups.value.find((g) => g.id === sourceGroupId);
      if (sourceGroup) {
        const full = api.toJSON();
        sourceGroup.layout = stripEdges(full);
      }
      const currentFull = api.toJSON();

      if (target.layout) {
        // Lazy-resume sessions that aren't yet loaded
        const sessionIds = extractChatPanelIds(target.layout);
        const sessionsStore = useSessionsStore();
        const resumePromises = sessionIds
          .filter((id) => !sessionsStore.sessions.some((s) => s.id === id))
          .map((id) => sessionsStore.restoreSession(id).catch(() => {}));
        await Promise.allSettled(resumePromises);

        // Merge body with current edges and restore
        const merged = mergeBodyWithEdges(target.layout, currentFull);
        const ok = layoutStore.restore(merged);
        if (!ok) {
          // Restore failed — don't change active group
          return;
        }
      } else {
        // Empty group — keep only edges
        const empty = edgesOnlyLayout(currentFull);
        const ok = layoutStore.restore(empty);
        if (!ok) return;
      }

      // Only update activeGroupId after successful restore
      activeGroupId.value = targetId;
    } finally {
      layoutStore.switching = false;
    }

    await persist();
  }

  // ── Group-aware layout save ──────────────────────────────────

  /**
   * Called by scheduleLayoutSave instead of raw persistLayout.
   * Saves the active group's body snapshot and persists all groups.
   */
  async function saveLayout(): Promise<void> {
    if (layoutStore.switching) return; // suppress during switch
    saveActiveBody();
    await persist();
  }

  // ── Session count per group ──────────────────────────────────

  function sessionCount(groupId: string): number {
    const g = groups.value.find((g) => g.id === groupId);
    if (!g) return 0;
    if (g.id === activeGroupId.value) {
      // Active group: count from live dockview snapshot
      const api = layoutStore.api;
      if (!api) return 0;
      return extractChatPanelIds(stripEdges(api.toJSON())).length;
    }
    // Inactive group: count from stored layout
    return g.layout ? extractChatPanelIds(g.layout).length : 0;
  }

  return {
    groups,
    activeGroupId,
    activeGroup,
    hydrate,
    persist,
    createGroup,
    renameGroup,
    deleteGroup,
    switchGroup,
    saveLayout,
    saveActiveBody,
    sessionCount,
  };
});
