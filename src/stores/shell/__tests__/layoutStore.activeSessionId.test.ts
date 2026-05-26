/// activeSessionId fallback when a non-chat panel becomes active.
///
/// Reproduces the regression that caused the right-rail panel to
/// blank out the moment its own tab became the active dockview
/// panel. Fix: `recomputeActiveSession` only nulls out the ref when
/// no chat panel exists in any body group; non-chat activations
/// (rail, settings, dev playground) preserve the previously-bound
/// session.

import { describe, test, expect, beforeEach } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import type { DockviewApi } from 'dockview-core';
import { useLayoutStore } from '@/stores/shell/layoutStore';

type FakePanel = {
  id: string;
  component: string;
  api: { id: string; component: string };
};
type FakeGroup = {
  id: string;
  activePanel: FakePanel | undefined;
  panels: FakePanel[];
  model: { location: { type: 'grid' | 'edge' } };
};

function panel(id: string, component: string): FakePanel {
  return { id, component, api: { id, component } };
}

function makeFakeDock(initial: {
  groups: Array<{ id: string; type: 'grid' | 'edge'; panels: FakePanel[]; activeIndex?: number }>;
  activeGroupId: string | null;
}) {
  const groups: FakeGroup[] = initial.groups.map((g) => ({
    id: g.id,
    panels: g.panels,
    activePanel: g.activeIndex !== undefined ? g.panels[g.activeIndex] : g.panels[0],
    model: { location: { type: g.type } },
  }));
  let active: FakeGroup | undefined = initial.activeGroupId
    ? groups.find((g) => g.id === initial.activeGroupId)
    : undefined;

  const listeners: Array<() => void> = [];

  const api = {
    get groups() {
      return groups;
    },
    get activeGroup() {
      return active;
    },
    getPanel(id: string): FakePanel | undefined {
      for (const g of groups) for (const p of g.panels) if (p.id === id) return p;
      return undefined;
    },
    getEdgeGroup() {
      return undefined;
    },
    addEdgeGroup(_pos: string, opts: { id?: string } = {}) {
      const id = opts.id ?? 'edge-right';
      const g: FakeGroup = {
        id,
        panels: [],
        activePanel: undefined,
        model: { location: { type: 'edge' } },
      };
      groups.push(g);
      return { id };
    },
    removeEdgeGroup() {},
    setEdgeGroupVisible() {},
    isEdgeGroupVisible() {
      return true;
    },
    addGroup() {
      const g: FakeGroup = {
        id: `g${groups.length + 1}`,
        panels: [],
        activePanel: undefined,
        model: { location: { type: 'grid' } },
      };
      groups.push(g);
      return { id: g.id };
    },
    addPanel(_args: unknown) {},
    onDidActiveGroupChange(cb: () => void) {
      listeners.push(cb);
      return { dispose: () => {} };
    },
    onDidActivePanelChange(cb: () => void) {
      listeners.push(cb);
      return { dispose: () => {} };
    },
    onDidAddPanel(cb: () => void) {
      listeners.push(cb);
      return { dispose: () => {} };
    },
    onDidRemovePanel(cb: () => void) {
      listeners.push(cb);
      return { dispose: () => {} };
    },
    onDidAddGroup(cb: () => void) {
      listeners.push(cb);
      return { dispose: () => {} };
    },
  } as unknown as DockviewApi;

  function activate(groupId: string): void {
    active = groups.find((g) => g.id === groupId);
    for (const cb of listeners) cb();
  }

  return { api, activate };
}

describe('layoutStore.activeSessionId — singleton rail preserves session on non-chat activation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('active panel is a chat → activeSessionId tracks it', () => {
    const dock = makeFakeDock({
      activeGroupId: 'body',
      groups: [{ id: 'body', type: 'grid', panels: [panel('session-1', 'chat')] }],
    });
    const store = useLayoutStore();
    store.setApi(dock.api);
    expect(store.activeSessionId).toBe('session-1');
  });

  test('active panel is the rail (singleton) → activeSessionId stays on the chat', () => {
    const dock = makeFakeDock({
      activeGroupId: 'edge-right',
      groups: [
        { id: 'body', type: 'grid', panels: [panel('session-1', 'chat')] },
        {
          id: 'edge-right',
          type: 'edge',
          panels: [panel('session-details', 'sessionDetails')],
        },
      ],
    });
    const store = useLayoutStore();
    store.setApi(dock.api);
    // Even though the rail's group is the active one, the rail bind
    // logic must find the chat panel in the body group.
    expect(store.activeSessionId).toBe('session-1');
  });

  test('active panel is settings (no chat anywhere) → activeSessionId is null', () => {
    const dock = makeFakeDock({
      activeGroupId: 'body',
      groups: [{ id: 'body', type: 'grid', panels: [panel('settings', 'settingsPanel')] }],
    });
    const store = useLayoutStore();
    store.setApi(dock.api);
    expect(store.activeSessionId).toBeNull();
  });

  test('two body groups with two chats → activeSessionId picks the one in the active group', () => {
    const dock = makeFakeDock({
      activeGroupId: 'body-2',
      groups: [
        { id: 'body-1', type: 'grid', panels: [panel('session-a', 'chat')] },
        { id: 'body-2', type: 'grid', panels: [panel('session-b', 'chat')] },
      ],
    });
    const store = useLayoutStore();
    store.setApi(dock.api);
    expect(store.activeSessionId).toBe('session-b');
  });

  test('switching active group from chat to rail preserves activeSessionId', () => {
    const dock = makeFakeDock({
      activeGroupId: 'body',
      groups: [
        { id: 'body', type: 'grid', panels: [panel('session-1', 'chat')] },
        {
          id: 'edge-right',
          type: 'edge',
          panels: [panel('session-details', 'sessionDetails')],
        },
      ],
    });
    const store = useLayoutStore();
    store.setApi(dock.api);
    expect(store.activeSessionId).toBe('session-1');
    dock.activate('edge-right');
    expect(store.activeSessionId).toBe('session-1');
  });
});
