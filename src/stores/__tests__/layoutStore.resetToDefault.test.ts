import { beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import type { DockviewApi } from 'dockview-core';
import { useLayoutStore } from '../layoutStore';

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
      for (const g of groups) for (const p of g.panels) if (p.id === id) return p.api;
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
  } as unknown as DockviewApi;

  return { api, removePanelCalls, addEdgeGroupCalls, removeEdgeGroupCalls, groups };
}

describe('layoutStore.resetToDefault', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('closes every panel and re-opens the Sessions sidebar at default size', () => {
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

    expect(dock.removePanelCalls).toEqual(
      expect.arrayContaining(['session-a', 'session-b', 'playground']),
    );
    expect(dock.removePanelCalls).toHaveLength(3);

    expect(dock.addEdgeGroupCalls).toHaveLength(1);
    expect(dock.addEdgeGroupCalls[0]?.position).toBe('left');
    expect(dock.addEdgeGroupCalls[0]?.initialSize).toBe(260);
  });

  test('no panels open → still opens the Sessions sidebar (idempotent first-launch reset)', () => {
    const dock = makeFake({});
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.resetToDefault();

    expect(dock.removePanelCalls).toHaveLength(0);
    expect(dock.addEdgeGroupCalls).toHaveLength(1);
  });

  test('Sessions sidebar already open → still resets cleanly', () => {
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

    // The sidebar panel is closed along with everything else; reset
    // then re-creates it in the existing (now-empty) edge group.
    // What matters is the panel is BACK after the reset — not
    // whether a new edge group was created (it isn't, because the
    // existing one is reused).
    expect(dock.removePanelCalls).toContain('sessions-manager');
    expect(dock.api.getPanel('sessions-manager')).toBeDefined();
  });

  test('enforceKnownEdgeMinimums recreates stale narrow library and details rails with real edge minimums', () => {
    const dock = makeFake({
      edges: {
        left: {
          id: 'edge-left',
          width: 120,
          panelIds: [{ id: 'library', component: 'library' }],
        },
        right: {
          id: 'edge-right',
          width: 140,
          panelIds: [{ id: 'session-details', component: 'sessionDetails' }],
        },
      },
    });
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.enforceKnownEdgeMinimums();

    const left = dock.groups.find((g) => g.id === 'edge-left');
    const right = dock.groups.find((g) => g.id === 'edge-right');
    expect(dock.removeEdgeGroupCalls).toEqual(expect.arrayContaining(['left', 'right']));
    expect(left?.width).toBe(320);
    expect(
      dock.addEdgeGroupCalls.some(
        (call) => call.position === 'left' && call.initialSize === 320 && call.minimumSize === 320,
      ),
    ).toBe(true);
    expect(right?.width).toBe(380);
    expect(
      dock.addEdgeGroupCalls.some(
        (call) => call.position === 'right' && call.initialSize === 380 && call.minimumSize === 380,
      ),
    ).toBe(true);
  });

  test('openEdgePanel recreates an already-open stale narrow edge group', () => {
    const dock = makeFake({
      edges: {
        left: {
          id: 'edge-left',
          width: 160,
          panelIds: [{ id: 'library', component: 'library' }],
        },
      },
    });
    const store = useLayoutStore();
    store.setApi(dock.api);
    const staleEdge = dock.groups.find((g) => g.id === 'edge-left');
    if (staleEdge) staleEdge.width = 160;

    store.openEdgePanel('left', {
      id: 'library',
      component: 'library',
      tabComponent: 'sidebarTab',
      title: 'Library',
      initialSize: 360,
      minimumSize: 320,
      exclusive: true,
    });

    expect(dock.removeEdgeGroupCalls).toContain('left');
    expect(dock.addEdgeGroupCalls[dock.addEdgeGroupCalls.length - 1]).toMatchObject({
      position: 'left',
      id: 'edge-left',
      initialSize: 360,
      minimumSize: 320,
    });
    const edge = dock.groups.find((g) => g.id === 'edge-left');
    expect(edge?.width).toBe(360);
    expect(edge?.panels.map((p) => p.id)).toContain('library');
  });
});
