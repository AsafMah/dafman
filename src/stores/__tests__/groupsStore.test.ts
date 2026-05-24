import { describe, expect, it, beforeEach } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import { useGroupsStore, type GroupsConfig } from "../groupsStore";

describe("groupsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("init", () => {
    it("creates a Default group when no config is provided", () => {
      const store = useGroupsStore();
      store.init(null, null);
      expect(store.groups).toHaveLength(1);
      expect(store.groups[0].name).toBe("Default");
      expect(store.groups[0].layout).toBeNull();
      expect(store.activeGroupId).toBe(store.groups[0].id);
    });

    it("restores groups from persisted config", () => {
      const store = useGroupsStore();
      const config: GroupsConfig = {
        activeGroupId: "g2",
        groups: [
          { id: "g1", name: "Work", layout: { panels: [] } },
          { id: "g2", name: "Personal", layout: null },
        ],
      };
      store.init(config, null);
      expect(store.groups).toHaveLength(2);
      expect(store.groups[0].name).toBe("Work");
      expect(store.groups[1].name).toBe("Personal");
      expect(store.activeGroupId).toBe("g2");
    });

    it("falls back to first group if activeGroupId is missing", () => {
      const store = useGroupsStore();
      const config: GroupsConfig = {
        activeGroupId: "",
        groups: [{ id: "g1", name: "A", layout: null }],
      };
      store.init(config, null);
      expect(store.activeGroupId).toBe("g1");
    });
  });

  describe("CRUD", () => {
    it("createGroup appends with auto-name", () => {
      const store = useGroupsStore();
      store.init(null, null);
      const created = store.createGroup();
      expect(store.groups).toHaveLength(2);
      expect(created.name).toBe("Group 2");
      expect(created.layout).toBeNull();
    });

    it("createGroup accepts a custom name", () => {
      const store = useGroupsStore();
      store.init(null, null);
      const created = store.createGroup("My Group");
      expect(created.name).toBe("My Group");
    });

    it("renameGroup changes the name", () => {
      const store = useGroupsStore();
      store.init(null, null);
      const id = store.groups[0].id;
      store.renameGroup(id, "Renamed");
      expect(store.groups[0].name).toBe("Renamed");
    });

    it("deleteGroup removes the group and switches active", () => {
      const store = useGroupsStore();
      store.init(null, null);
      const second = store.createGroup("Second");
      store.switchTo(second.id);
      expect(store.activeGroupId).toBe(second.id);
      store.deleteGroup(second.id);
      expect(store.groups).toHaveLength(1);
      // Should switch to remaining group
      expect(store.activeGroupId).toBe(store.groups[0].id);
    });

    it("deleteGroup refuses to delete the last group", () => {
      const store = useGroupsStore();
      store.init(null, null);
      const result = store.deleteGroup(store.groups[0].id);
      expect(result).toBe(false);
      expect(store.groups).toHaveLength(1);
    });

    it("moveGroup reorders groups", () => {
      const store = useGroupsStore();
      store.init(null, null);
      store.createGroup("B");
      store.createGroup("C");
      const names = () => store.groups.map((g) => g.name);
      expect(names()).toEqual(["Default", "B", "C"]);
      store.moveGroup(0, 2);
      expect(names()).toEqual(["B", "C", "Default"]);
    });
  });

  describe("switchTo", () => {
    it("changes the active group", () => {
      const store = useGroupsStore();
      store.init(null, null);
      const second = store.createGroup();
      store.switchTo(second.id);
      expect(store.activeGroupId).toBe(second.id);
    });

    it("ignores unknown group ids", () => {
      const store = useGroupsStore();
      store.init(null, null);
      const original = store.activeGroupId;
      store.switchTo("nonexistent");
      expect(store.activeGroupId).toBe(original);
    });
  });

  describe("layout snapshots", () => {
    it("saveLayout stores a snapshot for a group", () => {
      const store = useGroupsStore();
      store.init(null, null);
      const id = store.groups[0].id;
      const snapshot = { panels: { p1: {} } };
      store.saveLayout(id, snapshot);
      expect(store.groups[0].layout).toEqual(snapshot);
    });
  });

  describe("toConfig", () => {
    it("serializes groups without live APIs", () => {
      const store = useGroupsStore();
      store.init(null, null);
      store.createGroup("Second");
      const config = store.toConfig();
      expect(config.activeGroupId).toBe(store.activeGroupId);
      expect(config.groups).toHaveLength(2);
      expect(config.groups[0].name).toBe("Default");
      expect(config.groups[1].name).toBe("Second");
    });
  });

  describe("activeGroup", () => {
    it("returns the active group object", () => {
      const store = useGroupsStore();
      store.init(null, null);
      expect(store.activeGroup).toBeTruthy();
      expect(store.activeGroup!.id).toBe(store.activeGroupId);
    });
  });

  describe("sessionCounts", () => {
    it("tracks session count per group", () => {
      const store = useGroupsStore();
      store.init(null, null);
      store.setSessionCount(store.groups[0].id, 3);
      expect(store.sessionCounts.get(store.groups[0].id)).toBe(3);
    });
  });
});
