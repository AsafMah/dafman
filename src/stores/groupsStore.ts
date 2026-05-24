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

  /** Persist current groups + activeGroupId to settings. */
  async function persist(): Promise<void> {
    const s = settingsStore.settings;
    await settingsStore.update({
      ...s,
      layout: {
        ...s.layout,
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

    // Close sessions that belong to the deleted group
    const deleted = groups.value.find((g) => g.id === id);
    if (deleted?.layout) {
      const sessionIds = extractChatPanelIds(deleted.layout);
      const sessionsStore = useSessionsStore();
      for (const sid of sessionIds) {
        void sessionsStore.closeSession(sid);
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
    const target = groups.value.find((g) => g.id === targetId);
    if (!target) return;
    const api = layoutStore.api;
    if (!api) return;

    layoutStore.switching = true;
    try {
      // Save current body
      saveActiveBody();
      const currentFull = api.toJSON();

      // Set active
      activeGroupId.value = targetId;

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
        layoutStore.restore(merged);
      } else {
        // Empty group — keep only edges
        const empty = edgesOnlyLayout(api.toJSON());
        layoutStore.restore(empty);
      }
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
      // Active group: count from live dockview
      const api = layoutStore.api;
      if (!api) return 0;
      return api.panels
        .filter((p) => {
          const comp = (p as unknown as { view: { contentComponent: string } })
            ?.view?.contentComponent;
          return comp === "chat";
        })
        .length;
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
