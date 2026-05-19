import { beforeEach, describe, expect, test } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import type { DockviewApi } from "dockview-core";
import { useLayoutStore } from "../layoutStore";

// More featureful fake than addPanel.test.ts's — adds `panels`,
// `removePanel`, edge-group helpers so we can exercise `resetToDefault`.
// We could merge the two fakes into a single helper later if a third
// test file needs the same surface; for now keep them isolated so
// changes to one don't accidentally regress the other.

type FakePanel = {
  id: string;
  component: string;
  group: { id: string };
  api: {
    id: string;
    component: string;
    group: { id: string };
    setActive: () => void;
  };
};

type FakeGroup = {
  id: string;
  locationType: "grid" | "edge";
  panels: FakePanel[];
};

interface FakeDock {
  api: DockviewApi;
  removePanelCalls: string[];
  addEdgeGroupCalls: Array<{ position: string; id: string; initialSize?: number }>;
  removeEdgeGroupCalls: string[];
  groups: FakeGroup[];
}

function makeFake(initial: { groups?: Array<{ id: string; locationType: "grid" | "edge"; panelIds: Array<{ id: string; component: string }> }>; edges?: Record<string, { id: string; panelIds: Array<{ id: string; component: string }> }> } = {}): FakeDock {
  const groups: FakeGroup[] = [];
  const edges: Map<string, FakeGroup> = new Map();
  const removePanelCalls: string[] = [];
  const addEdgeGroupCalls: Array<{ position: string; id: string; initialSize?: number }> = [];
  const removeEdgeGroupCalls: string[] = [];
  let nextId = 100;

  function makePanel(id: string, component: string, group: FakeGroup): FakePanel {
    return {
      id,
      component,
      group: { id: group.id },
      api: {
        id,
        component,
        group: { id: group.id },
        setActive() {},
      },
    };
  }

  for (const g of initial.groups ?? []) {
    const group: FakeGroup = { id: g.id, locationType: g.locationType, panels: [] };
    for (const p of g.panelIds) group.panels.push(makePanel(p.id, p.component, group));
    groups.push(group);
  }
  for (const [pos, e] of Object.entries(initial.edges ?? {})) {
    const group: FakeGroup = { id: e.id, locationType: "edge", panels: [] };
    for (const p of e.panelIds) group.panels.push(makePanel(p.id, p.component, group));
    groups.push(group);
    edges.set(pos, group);
  }

  const api = {
    get panels() {
      return groups.flatMap((g) => g.panels.map((p) => p.api));
    },
    get groups() {
      return groups.map((g) => ({
        id: g.id,
        model: { location: { type: g.locationType } },
        panels: g.panels,
      }));
    },
    get activeGroup() {
      return groups[0]
        ? {
            id: groups[0].id,
            model: { location: { type: groups[0].locationType } },
            activePanel: undefined,
          }
        : undefined;
    },
    getPanel(id: string) {
      for (const g of groups) for (const p of g.panels) if (p.id === id) return p.api;
      return undefined;
    },
    addGroup() {
      const g: FakeGroup = { id: `g${nextId++}`, locationType: "grid", panels: [] };
      groups.push(g);
      return { id: g.id };
    },
    addPanel(args: { id: string; component: string; position?: { referenceGroup?: string } }) {
      const refId = args.position?.referenceGroup;
      const target = refId ? groups.find((g) => g.id === refId) : groups[0];
      if (!target) {
        const g: FakeGroup = { id: `g${nextId++}`, locationType: "grid", panels: [] };
        groups.push(g);
        g.panels.push(makePanel(args.id, args.component, g));
        return;
      }
      target.panels.push(makePanel(args.id, args.component, target));
    },
    removePanel(panel: { id: string }) {
      removePanelCalls.push(panel.id);
      for (const g of groups) {
        g.panels = g.panels.filter((p) => p.id !== panel.id);
      }
    },
    getEdgeGroup(position: string) {
      return edges.get(position);
    },
    addEdgeGroup(position: string, opts: { id: string; initialSize?: number }) {
      addEdgeGroupCalls.push({ position, id: opts.id, initialSize: opts.initialSize });
      const g: FakeGroup = { id: opts.id, locationType: "edge", panels: [] };
      groups.push(g);
      edges.set(position, g);
      return g;
    },
    removeEdgeGroup(position: string) {
      removeEdgeGroupCalls.push(position);
      const g = edges.get(position);
      if (g) {
        const idx = groups.indexOf(g);
        if (idx >= 0) groups.splice(idx, 1);
        edges.delete(position);
      }
    },
    onDidActiveGroupChange: () => ({ dispose: () => {} }),
    onDidActivePanelChange: () => ({ dispose: () => {} }),
    onDidRemovePanel: () => ({ dispose: () => {} }),
  } as unknown as DockviewApi;

  return { api, removePanelCalls, addEdgeGroupCalls, removeEdgeGroupCalls, groups };
}

describe("layoutStore.resetToDefault", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("closes every panel and re-opens the Sessions sidebar at default size", () => {
    const dock = makeFake({
      groups: [
        {
          id: "body-1",
          locationType: "grid",
          panelIds: [
            { id: "session-a", component: "chat" },
            { id: "session-b", component: "chat" },
          ],
        },
        {
          id: "body-2",
          locationType: "grid",
          panelIds: [{ id: "playground", component: "playground" }],
        },
      ],
    });
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.resetToDefault();

    expect(dock.removePanelCalls).toEqual(
      expect.arrayContaining(["session-a", "session-b", "playground"]),
    );
    expect(dock.removePanelCalls).toHaveLength(3);

    expect(dock.addEdgeGroupCalls).toHaveLength(1);
    expect(dock.addEdgeGroupCalls[0]?.position).toBe("left");
    expect(dock.addEdgeGroupCalls[0]?.initialSize).toBe(240);
  });

  test("no panels open → still opens the Sessions sidebar (idempotent first-launch reset)", () => {
    const dock = makeFake({});
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.resetToDefault();

    expect(dock.removePanelCalls).toHaveLength(0);
    expect(dock.addEdgeGroupCalls).toHaveLength(1);
  });

  test("Sessions sidebar already open → still resets cleanly", () => {
    const dock = makeFake({
      edges: {
        left: {
          id: "edge-left",
          panelIds: [{ id: "sessions-manager", component: "sessionsManager" }],
        },
      },
    });
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.resetToDefault();

    // The sidebar panel is closed along with everything else; reset
    // then re-creates it in the existing (now-empty) edge group.
    // What matters is the panel is BACK after the reset — not
    // whether a new edge group was created (it isn't, because the
    // existing one is reused).
    expect(dock.removePanelCalls).toContain("sessions-manager");
    expect(dock.api.getPanel("sessions-manager")).toBeDefined();
  });
});
