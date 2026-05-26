// Regression test for the "multiple sidebars open at startup" bug.
//
// Runtime exclusion of activity-bar panels lives in `ActivityBar.activate()`
// — it closes any other open ActivityBar member before opening the new
// one. But the startup `dockview.fromJSON(layout)` path restores the
// raw persisted JSON without re-checking that invariant. If a prior
// session's snapshot stacked 2+ activity-bar panels on the left edge
// (e.g. user dragged one in, layout migration left both in, version
// change), all of them would come back at boot.
//
// `layoutStore.restore()` now calls `enforceActivityBarExclusivity()`
// after every `fromJSON` to keep at most one of the activity-bar
// panel set visible. This file pins that behavior.

import { beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import type { DockviewApi } from 'dockview-core';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { PANEL_IDS } from '@/constants/panels';

interface FakePanel {
  id: string;
  component: string;
  isActive: boolean;
}

interface FakeDock {
  api: DockviewApi;
  panels: FakePanel[];
  removedPanelIds: string[];
}

function makeDock(panels: FakePanel[]): FakeDock {
  const live = [...panels];
  const removedPanelIds: string[] = [];

  const noopSub = { dispose: () => {} };

  const api = {
    get activeGroup() {
      return undefined;
    },
    get groups() {
      return live.map((p) => ({
        id: p.id,
        model: { location: { type: 'grid' as const } },
        activePanel: undefined,
        panels: [{ id: p.id, component: p.component }],
      }));
    },
    getPanel(id: string) {
      const p = live.find((x) => x.id === id);

      if (!p) return undefined;

      return {
        id: p.id,
        api: { isActive: p.isActive },
      };
    },
    removePanel(panel: { id: string }) {
      const idx = live.findIndex((x) => x.id === panel.id);

      if (idx >= 0) {
        live.splice(idx, 1);
        removedPanelIds.push(panel.id);
      }
    },
    fromJSON: () => {},
    getEdgeGroup() {
      return undefined;
    },
    onDidActiveGroupChange: () => noopSub,
    onDidActivePanelChange: () => noopSub,
    onDidRemovePanel: () => noopSub,
    onDidAddPanel: () => noopSub,
  } as unknown as DockviewApi;

  return { api, panels: live, removedPanelIds };
}

describe('layoutStore.restore — activity-bar exclusivity', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('single activity-bar panel restored → no-op', () => {
    const dock = makeDock([
      { id: PANEL_IDS.sessionsManager, component: 'sessionsManager', isActive: true },
    ]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    const ok = store.restore({});

    expect(ok).toBe(true);
    expect(dock.removedPanelIds).toEqual([]);
    expect(dock.panels.map((p) => p.id)).toEqual([PANEL_IDS.sessionsManager]);
  });

  test('two activity-bar panels restored → keeps the active one, closes the rest', () => {
    const dock = makeDock([
      { id: PANEL_IDS.sessionsManager, component: 'sessionsManager', isActive: false },
      { id: PANEL_IDS.library, component: 'library', isActive: true },
    ]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.restore({});

    expect(dock.panels.map((p) => p.id)).toEqual([PANEL_IDS.library]);
    expect(dock.removedPanelIds).toEqual([PANEL_IDS.sessionsManager]);
  });

  test('three activity-bar panels restored with none active → keeps the first in canonical order', () => {
    const dock = makeDock([
      { id: PANEL_IDS.terminals, component: 'terminalsPanel', isActive: false },
      { id: PANEL_IDS.library, component: 'library', isActive: false },
      { id: PANEL_IDS.jobs, component: 'jobsPanel', isActive: false },
    ]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.restore({});

    // The ACTIVITY_BAR_PANEL_IDS Set iteration order is:
    // sessionsManager, terminals, library, jobs, logs, settings.
    // Of the panels actually present, `terminals` comes first, so it
    // wins when no one is active.
    expect(dock.panels.map((p) => p.id)).toEqual([PANEL_IDS.terminals]);
    expect(dock.removedPanelIds.sort()).toEqual([PANEL_IDS.jobs, PANEL_IDS.library].sort());
  });

  test('non-activity-bar panels (chat, sessionDetails) are NEVER touched', () => {
    const dock = makeDock([
      { id: 'chat-session-abc', component: 'chat', isActive: false },
      { id: 'chat-session-def', component: 'chat', isActive: true },
      { id: PANEL_IDS.sessionDetails, component: 'sessionDetails', isActive: false },
      { id: PANEL_IDS.library, component: 'library', isActive: true },
      { id: PANEL_IDS.jobs, component: 'jobsPanel', isActive: false },
    ]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.restore({});

    // Two chat panels survive (independent placements), session details
    // survives (right-edge rail, not part of the activity bar), library
    // wins the activity-bar fight, jobs gets closed.
    expect(new Set(dock.panels.map((p) => p.id))).toEqual(
      new Set([
        'chat-session-abc',
        'chat-session-def',
        PANEL_IDS.sessionDetails,
        PANEL_IDS.library,
      ]),
    );
    expect(dock.removedPanelIds).toEqual([PANEL_IDS.jobs]);
  });
});
