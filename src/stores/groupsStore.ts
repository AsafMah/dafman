// Groups store — manages switchable workspace groups. Each group holds
// an independent dockview layout snapshot. Only one group is active
// (visible) at a time; switching groups swaps the entire dockview body
// while edge panels (sessions sidebar, settings, etc.) remain shared.
//
// Persistence: groups config is stored in `settings.layout.groups`.
// On first boot (no groups config), the existing single-layout blob
// migrates into a "Default" group.

import { defineStore } from "pinia";
import { computed, ref } from "vue";

/// Serialized state for a single group.
export interface GroupState {
  id: string;
  name: string;
  /// Dockview `toJSON()` snapshot. null when the group has never been
  /// rendered (lazy — created on first switch).
  layout: unknown | null;
}

/// Top-level groups config persisted in settings.
export interface GroupsConfig {
  activeGroupId: string;
  groups: GroupState[];
}

let nextId = 1;
function generateGroupId(): string {
  return `group-${Date.now()}-${nextId++}`;
}

export const useGroupsStore = defineStore("groups", () => {
  const groups = ref<GroupState[]>([]);
  const activeGroupId = ref<string>("");

  const activeGroup = computed(() =>
    groups.value.find((g) => g.id === activeGroupId.value) ?? null,
  );

  /// Number of sessions in each group. Populated externally by
  /// whoever wires session-to-group binding (App.vue / sessionsStore).
  const sessionCounts = ref<Map<string, number>>(new Map());

  // ---------- Initialization ----------

  /// Hydrate from persisted config. If no config exists (first boot or
  /// pre-groups install), create a default group from the legacy layout.
  function init(config: GroupsConfig | null, legacyLayout: unknown | null): void {
    if (config && config.groups.length > 0) {
      groups.value = config.groups;
      activeGroupId.value = config.activeGroupId || config.groups[0].id;
    } else {
      // Migration: wrap the legacy single-layout into a "Default" group.
      const defaultGroup: GroupState = {
        id: generateGroupId(),
        name: "Default",
        layout: legacyLayout,
      };
      groups.value = [defaultGroup];
      activeGroupId.value = defaultGroup.id;
    }
  }

  // ---------- CRUD ----------

  function createGroup(name?: string): GroupState {
    const group: GroupState = {
      id: generateGroupId(),
      name: name ?? `Group ${groups.value.length + 1}`,
      layout: null,
    };
    groups.value.push(group);
    return group;
  }

  function renameGroup(groupId: string, name: string): void {
    const group = groups.value.find((g) => g.id === groupId);
    if (group) group.name = name;
  }

  function deleteGroup(groupId: string): boolean {
    if (groups.value.length <= 1) return false; // can't delete last group
    const idx = groups.value.findIndex((g) => g.id === groupId);
    if (idx === -1) return false;
    groups.value.splice(idx, 1);
    if (activeGroupId.value === groupId) {
      // Switch to the nearest group.
      const nextIdx = Math.min(idx, groups.value.length - 1);
      activeGroupId.value = groups.value[nextIdx].id;
    }
    return true;
  }

  /// Reorder groups (for drag-and-drop in the groups bar).
  function moveGroup(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= groups.value.length) return;
    if (toIndex < 0 || toIndex >= groups.value.length) return;
    const [moved] = groups.value.splice(fromIndex, 1);
    groups.value.splice(toIndex, 0, moved);
  }

  // ---------- Switching ----------

  /// Switch to a different group. The caller (App.vue) is responsible
  /// for snapshotting the outgoing group's layout before calling this,
  /// and restoring the incoming group's layout after.
  function switchTo(groupId: string): void {
    if (!groups.value.find((g) => g.id === groupId)) return;
    activeGroupId.value = groupId;
  }

  // ---------- Layout snapshots ----------

  /// Save a layout snapshot for a group. Called when switching away
  /// from a group or on periodic auto-save.
  function saveLayout(groupId: string, layout: unknown | null): void {
    const group = groups.value.find((g) => g.id === groupId);
    if (group) group.layout = layout;
  }

  // ---------- Persistence ----------

  /// Serialize to the shape stored in settings. If a live dockview API
  /// map is passed, snapshots each group's current layout from it.
  function toConfig(
    liveApis?: Map<string, import("dockview-core").DockviewApi>,
  ): GroupsConfig {
    return {
      activeGroupId: activeGroupId.value,
      groups: groups.value.map((g) => {
        const liveApi = liveApis?.get(g.id);
        return {
          id: g.id,
          name: g.name,
          layout: liveApi ? liveApi.toJSON() : g.layout,
        };
      }),
    };
  }

  function setSessionCount(groupId: string, count: number): void {
    sessionCounts.value.set(groupId, count);
  }

  return {
    // State
    groups,
    activeGroupId,
    activeGroup,
    sessionCounts,
    // Init
    init,
    // CRUD
    createGroup,
    renameGroup,
    deleteGroup,
    moveGroup,
    // Switching
    switchTo,
    // Layout
    saveLayout,
    toConfig,
    // Session counts
    setSessionCount,
  };
});
