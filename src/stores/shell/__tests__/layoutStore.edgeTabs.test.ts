// Tests for the v2 layout-store edge-tab behaviors:
//   - `seedDefaultLayout`: deterministic shape of left + right edge
//     groups with the activity-bar tab inventory.
//   - `activateEdgePanel`: toggle semantics (click active +
//     expanded → collapse; otherwise activate + expand).
//
// Fake DockviewApi here is bespoke (separate from the addPanel-
// placement fake) because we care about edge-group apis and their
// collapse / expand surface, not body-grid placement decisions.

import { beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import type { DockviewApi } from 'dockview-core';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { PANEL_IDS, LEFT_ACTIVITY_TABS, RIGHT_ACTIVITY_TABS } from '@/constants/panels';

interface FakeEdgeGroup {
  id: string;
  collapsed: boolean;
  panelIds: string[];
  // Which panel the group is currently *displaying*. Tracked separately from
  // each panel's global `isActive` so tests can reproduce "rail still shows this
  // panel but it lost dockview's global-active status" (#54).
  activePanelId?: string;
}

interface FakePanel {
  id: string;
  component: string;
  isActive: boolean;
  tabComponent?: string;
  params?: Record<string, unknown>;
  title?: string;
}

interface FakeDock {
  api: DockviewApi;
  edges: Map<'left' | 'right', FakeEdgeGroup>;
  panels: FakePanel[];
  addPanelCalls: Array<{ id: string; tabComponent?: string }>;
}

function makeDock(): FakeDock {
  const edges = new Map<'left' | 'right', FakeEdgeGroup>();
  const panels: FakePanel[] = [];
  const addPanelCalls: Array<{ id: string; tabComponent?: string }> = [];

  function edgeApi(group: FakeEdgeGroup) {
    return {
      id: group.id,
      isCollapsed: () => group.collapsed,
      collapse: () => {
        group.collapsed = true;
      },
      expand: () => {
        group.collapsed = false;
      },
      onDidCollapsedChange: () => ({ dispose: () => {} }),
      width: 280,
      height: 600,
    };
  }

  const api = {
    get groups() {
      return [];
    },
    get panels() {
      return panels.map((p) => p);
    },
    getPanel(id: string) {
      const p = panels.find((x) => x.id === id);

      if (!p) return undefined;

      const edge = [...edges.values()].find((g) => g.panelIds.includes(id));

      return {
        id: p.id,
        api: {
          get isActive() {
            return p.isActive;
          },
          setActive: () => {
            // Mimic dockview: activating a panel makes it the group's displayed
            // panel and deactivates its siblings in the same edge group.
            if (edge) {
              for (const other of panels) {
                if (edge.panelIds.includes(other.id)) other.isActive = false;
              }
              edge.activePanelId = p.id;
            }
            p.isActive = true;
          },
        },
        group: {
          get activePanel() {
            return edge?.activePanelId ? { id: edge.activePanelId } : undefined;
          },
        },
      };
    },
    getEdgeGroup(position: string) {
      const g = edges.get(position as 'left' | 'right');

      return g ? edgeApi(g) : undefined;
    },
    addEdgeGroup(position: string, opts: { id: string; collapsed?: boolean }) {
      const g: FakeEdgeGroup = {
        id: opts.id,
        collapsed: opts.collapsed ?? false,
        panelIds: [],
      };

      edges.set(position as 'left' | 'right', g);

      return edgeApi(g);
    },
    addPanel(args: {
      id: string;
      component: string;
      title?: string;
      tabComponent?: string;
      params?: Record<string, unknown>;
      position?: { referenceGroup?: string };
    }) {
      addPanelCalls.push({ id: args.id, tabComponent: args.tabComponent });
      panels.push({
        id: args.id,
        component: args.component,
        isActive: false,
        tabComponent: args.tabComponent,
        params: args.params,
        title: args.title,
      });

      const edge = [...edges.values()].find((g) => g.id === args.position?.referenceGroup);

      if (edge) edge.panelIds.push(args.id);
    },
    removePanel: () => {},
    removeEdgeGroup: () => {},
    onDidActiveGroupChange: () => ({ dispose: () => {} }),
    onDidActivePanelChange: () => ({ dispose: () => {} }),
    onDidAddPanel: () => ({ dispose: () => {} }),
    onDidRemovePanel: () => ({ dispose: () => {} }),
    onDidAddGroup: () => ({ dispose: () => {} }),
  } as unknown as DockviewApi;

  return { api, edges, panels, addPanelCalls };
}

describe('layoutStore.seedDefaultLayout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('creates left + right edge groups with the expected tabs', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.seedDefaultLayout();

    expect(dock.edges.get('left')?.panelIds).toEqual(LEFT_ACTIVITY_TABS.map((t) => t.id));
    expect(dock.edges.get('right')?.panelIds).toEqual(RIGHT_ACTIVITY_TABS.map((t) => t.id));
  });

  test('every seeded panel uses the activityTab renderer', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.seedDefaultLayout();

    const expectedIds = new Set([
      ...LEFT_ACTIVITY_TABS.map((t) => t.id),
      ...RIGHT_ACTIVITY_TABS.map((t) => t.id),
    ]);

    for (const call of dock.addPanelCalls) {
      if (!expectedIds.has(call.id as never)) continue;
      expect(call.tabComponent).toBe('activityTab');
    }
  });

  test('both edge groups start collapsed', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.seedDefaultLayout();

    expect(dock.edges.get('left')?.collapsed).toBe(true);
    expect(dock.edges.get('right')?.collapsed).toBe(true);
  });

  test('idempotent — calling twice does not duplicate panels', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.seedDefaultLayout();
    store.seedDefaultLayout();

    expect(dock.edges.get('left')?.panelIds).toEqual(LEFT_ACTIVITY_TABS.map((t) => t.id));
    expect(dock.edges.get('right')?.panelIds).toEqual(RIGHT_ACTIVITY_TABS.map((t) => t.id));
  });
});

describe('layoutStore.activateEdgePanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('inactive panel → activates it and expands a collapsed edge', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);
    store.seedDefaultLayout();

    store.activateEdgePanel(PANEL_IDS.sessionsManager, 'left');

    expect(dock.edges.get('left')?.collapsed).toBe(false);

    const panel = dock.panels.find((p) => p.id === PANEL_IDS.sessionsManager);

    expect(panel?.isActive).toBe(true);
  });

  test('active panel + expanded edge → collapses the edge', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);
    store.seedDefaultLayout();

    // Open it first
    store.activateEdgePanel(PANEL_IDS.sessionsManager, 'left');
    expect(dock.edges.get('left')?.collapsed).toBe(false);

    // Click the active tab again
    store.activateEdgePanel(PANEL_IDS.sessionsManager, 'left');

    expect(dock.edges.get('left')?.collapsed).toBe(true);
  });

  test('no-op when panel / edge does not exist', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);
    // No seed — no panels, no edge group.

    expect(() => store.activateEdgePanel('not-there', 'left')).not.toThrow();
  });

  // Regression for #54: after the user interacts with a control inside the rail,
  // the rail panel is still the one displayed but is no longer dockview's
  // globally-active panel. A single cog click must still collapse it — the toggle
  // decision keys off "is this the displayed panel", not `panel.api.isActive`.
  test('displayed-but-not-globally-active panel still collapses on one click (#54)', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);
    store.seedDefaultLayout();

    // Open the details rail.
    store.activateEdgePanel(PANEL_IDS.sessionDetails, 'right');
    expect(dock.edges.get('right')?.collapsed).toBe(false);

    // Simulate clicking a control inside the rail: the panel loses global-active
    // status, but the group still displays it (activePanelId unchanged).
    const panel = dock.panels.find((p) => p.id === PANEL_IDS.sessionDetails);
    if (panel) panel.isActive = false;
    expect(dock.edges.get('right')?.activePanelId).toBe(PANEL_IDS.sessionDetails);

    // One cog click must collapse it.
    store.activateEdgePanel(PANEL_IDS.sessionDetails, 'right');

    expect(dock.edges.get('right')?.collapsed).toBe(true);
  });

  // Guard the multi-panel edge semantics the `activePanel` check must preserve:
  // when a *different* panel is displayed in the same edge group, clicking this
  // panel's tab switches to it rather than collapsing the group.
  test('clicking a tab whose panel is not displayed switches instead of collapsing', () => {
    const dock = makeDock();
    const store = useLayoutStore();
    store.setApi(dock.api);
    store.seedDefaultLayout();

    // Show sessionDetails on the right edge.
    store.activateEdgePanel(PANEL_IDS.sessionDetails, 'right');
    expect(dock.edges.get('right')?.activePanelId).toBe(PANEL_IDS.sessionDetails);

    // Click the sibling library tab (same right edge group).
    store.activateEdgePanel(PANEL_IDS.library, 'right');

    expect(dock.edges.get('right')?.collapsed).toBe(false);
    expect(dock.edges.get('right')?.activePanelId).toBe(PANEL_IDS.library);
  });
});
