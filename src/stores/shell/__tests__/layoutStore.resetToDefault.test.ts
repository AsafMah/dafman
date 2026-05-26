import { beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import type { DockviewApi } from 'dockview-core';
import { useLayoutStore } from '@/stores/shell/layoutStore';

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
    isActive: boolean;
    setActive: () => void;
  };
};

type FakeGroup = {
  id: string;
  locationType: 'grid' | 'edge';
  panels: FakePanel[];
  width?: number;
  height?: number;
  setSizeCalls: Array<{ width?: number; height?: number }>;
  setConstraintsCalls: Array<{ minimumWidth?: number; minimumHeight?: number }>;
  setSize: (value: { width?: number; height?: number }) => void;
  setConstraints: (value: { minimumWidth?: number; minimumHeight?: number }) => void;
};

interface FakeDock {
  api: DockviewApi;
  removePanelCalls: string[];
  addEdgeGroupCalls: Array<{
    position: string;
    id: string;
    initialSize?: number;
    minimumSize?: number;
  }>;
  removeEdgeGroupCalls: string[];
  groups: FakeGroup[];
}

function makeGroup(
  id: string,
  locationType: 'grid' | 'edge',
  size: { width?: number; height?: number } = {},
): FakeGroup {
  const group: FakeGroup = {
    id,
    locationType,
    panels: [],
    width: size.width,
    height: size.height,
    setSizeCalls: [],
    setConstraintsCalls: [],
    setSize(value) {
      group.setSizeCalls.push(value);
      if (value.width !== undefined) group.width = value.width;
      if (value.height !== undefined) group.height = value.height;
    },
    setConstraints(value) {
      group.setConstraintsCalls.push(value);
    },
  };
  return group;
}

function makeFake(
  initial: {
    groups?: Array<{
      id: string;
      locationType: 'grid' | 'edge';
      panelIds: Array<{ id: string; component: string }>;
    }>;
    edges?: Record<
      string,
      {
        id: string;
        width?: number;
        height?: number;
        panelIds: Array<{ id: string; component: string }>;
      }
    >;
  } = {},
): FakeDock {
  const groups: FakeGroup[] = [];
  const edges: Map<string, FakeGroup> = new Map();
  const removePanelCalls: string[] = [];
  const addEdgeGroupCalls: Array<{
    position: string;
    id: string;
    initialSize?: number;
    minimumSize?: number;
  }> = [];
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
        isActive: false,
        setActive() {},
      },
    };
  }

  function edgeApi(group: FakeGroup) {
    return {
      id: group.id,
      get width() {
        return group.width;
      },
      get height() {
        return group.height;
      },
      setSize: group.setSize,
      setConstraints: group.setConstraints,
      isCollapsed: () => false,
      collapse: () => {},
      expand: () => {},
      onDidCollapsedChange: () => ({ dispose: () => {} }),
    };
  }

  for (const g of initial.groups ?? []) {
    const group = makeGroup(g.id, g.locationType);
    for (const p of g.panelIds) group.panels.push(makePanel(p.id, p.component, group));
    groups.push(group);
  }
  for (const [pos, e] of Object.entries(initial.edges ?? {})) {
    const group = makeGroup(e.id, 'edge', { width: e.width, height: e.height });
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
      for (const g of groups) for (const p of g.panels) if (p.id === id) return p;
      return undefined;
    },
    addGroup() {
      const g = makeGroup(`g${nextId++}`, 'grid');
      groups.push(g);
      return { id: g.id };
    },
    addPanel(args: { id: string; component: string; position?: { referenceGroup?: string } }) {
      const refId = args.position?.referenceGroup;
      const target = refId ? groups.find((g) => g.id === refId) : groups[0];
      if (!target) {
        const g = makeGroup(`g${nextId++}`, 'grid');
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
      const group = edges.get(position);
      return group ? edgeApi(group) : undefined;
    },
    addEdgeGroup(
      position: string,
      opts: { id: string; initialSize?: number; minimumSize?: number },
    ) {
      addEdgeGroupCalls.push({
        position,
        id: opts.id,
        initialSize: opts.initialSize,
        minimumSize: opts.minimumSize,
      });
      const g = makeGroup(opts.id, 'edge', { width: opts.initialSize });
      groups.push(g);
      edges.set(position, g);
      return edgeApi(g);
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
    onDidAddPanel: () => ({ dispose: () => {} }),
    onDidRemovePanel: () => ({ dispose: () => {} }),
    onDidAddGroup: () => ({ dispose: () => {} }),
  } as unknown as DockviewApi;

  return { api, removePanelCalls, addEdgeGroupCalls, removeEdgeGroupCalls, groups };
}

describe('layoutStore.resetToDefault', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('closes every panel and re-seeds the activity-bar tabs on both edges', () => {
    const dock = makeFake({
      groups: [
        {
          id: 'body-1',
          locationType: 'grid',
          panelIds: [
            { id: 'session-a', component: 'chat' },
            { id: 'session-b', component: 'chat' },
          ],
        },
        {
          id: 'body-2',
          locationType: 'grid',
          panelIds: [{ id: 'playground', component: 'playground' }],
        },
      ],
    });
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.resetToDefault();

    // All pre-existing panels closed.
    expect(dock.removePanelCalls).toEqual(
      expect.arrayContaining(['session-a', 'session-b', 'playground']),
    );

    // Both edge groups created.
    const leftCreate = dock.addEdgeGroupCalls.find((c) => c.position === 'left');
    const rightCreate = dock.addEdgeGroupCalls.find((c) => c.position === 'right');
    expect(leftCreate).toBeDefined();
    expect(rightCreate).toBeDefined();

    // Left edge group seeded with the max-of-all-tab-mins floor
    // (Logs needs 420 — the highest on the left). Sessions's 260
    // initialSize is clamped UP to 420 so the strip can't open
    // smaller than its tightest tab.
    expect(leftCreate?.initialSize).toBe(420);
    expect(leftCreate?.minimumSize).toBe(420);

    // Right edge: max-of-all-mins is 380 (SessionDetails). Library
    // would tolerate 320, but the strip is constrained to 380.
    expect(rightCreate?.initialSize).toBe(380);
    expect(rightCreate?.minimumSize).toBe(380);
  });

  test('no panels open → still seeds activity-bar tabs (idempotent first-launch reset)', () => {
    const dock = makeFake({});
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.resetToDefault();

    expect(dock.removePanelCalls).toHaveLength(0);
    // Both edges created.
    expect(dock.addEdgeGroupCalls.map((c) => c.position).sort()).toEqual(['left', 'right']);
  });

  test('Sessions sidebar already open → tears it down and re-seeds cleanly', () => {
    const dock = makeFake({
      edges: {
        left: {
          id: 'edge-left',
          panelIds: [{ id: 'sessions-manager', component: 'sessionsManager' }],
        },
      },
    });
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.resetToDefault();

    expect(dock.removePanelCalls).toContain('sessions-manager');
    // After re-seed the sessions panel is back.
    expect(dock.api.getPanel('sessions-manager')).toBeDefined();
  });
});
