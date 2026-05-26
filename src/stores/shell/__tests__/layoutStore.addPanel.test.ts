import { beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import type { DockviewApi } from 'dockview-core';
import { useLayoutStore } from '@/stores/shell/layoutStore';

// Minimal fake dockview API. Covers only the methods the layoutStore
// addPanel path actually touches; everything else throws so a future
// dependency change shows up in CI rather than silently regressing
// behaviour at runtime.
//
// The fake records every `addGroup` / `addPanel` invocation so tests
// can assert WHAT the layoutStore asked dockview to do — the goal
// here isn't to simulate dockview's internal layout engine, it's to
// pin the placement decision the store makes.

type FakeGroup = {
  id: string;
  locationType: 'grid' | 'edge';
  panels: Array<{ id: string; component: string }>;
};

type AddPanelArgs = {
  id: string;
  component: string;
  title?: string;
  params?: unknown;
  position?: { referenceGroup?: string; direction?: string };
};

interface FakeDock {
  api: DockviewApi;
  addPanelCalls: AddPanelArgs[];
  addGroupCalls: Array<{ id: string }>;
  groups: FakeGroup[];
}

function makeFakeDock(initialGroups: FakeGroup[] = []): FakeDock {
  const groups: FakeGroup[] = initialGroups.map((g) => ({ ...g }));
  const addPanelCalls: AddPanelArgs[] = [];
  const addGroupCalls: Array<{ id: string }> = [];
  let nextGroupId = groups.length + 1;
  let activeGroup: FakeGroup | null = groups[0] ?? null;

  // Cast through unknown — the layoutStore code path doesn't touch
  // the full DockviewApi surface area, only the subset modelled here.
  const api = {
    get activeGroup() {
      if (!activeGroup) return undefined;
      return {
        id: activeGroup.id,
        model: { location: { type: activeGroup.locationType } },
        activePanel: undefined,
      };
    },
    get groups() {
      return groups.map((g) => ({
        id: g.id,
        model: { location: { type: g.locationType } },
        panels: g.panels,
      }));
    },
    getPanel(id: string) {
      for (const g of groups) {
        for (const p of g.panels) if (p.id === id) return p;
      }
      return undefined;
    },
    addGroup() {
      const newGroup: FakeGroup = {
        id: `g${nextGroupId++}`,
        locationType: 'grid',
        panels: [],
      };
      groups.push(newGroup);
      addGroupCalls.push({ id: newGroup.id });
      activeGroup = newGroup;
      return { id: newGroup.id };
    },
    addPanel(args: AddPanelArgs) {
      addPanelCalls.push(args);
      // Mirror what dockview would do so subsequent calls see the new
      // panel in `groups`. Only the cases the store actually invokes
      // are supported — anything else means the test made a wrong
      // assumption and we throw to surface it.
      const direction = args.position?.direction;
      const refId = args.position?.referenceGroup;
      if (direction === 'within') {
        const target = groups.find((g) => g.id === refId);
        if (!target) {
          throw new Error(`fake dock: addPanel within ${refId} but no such group`);
        }
        target.panels.push({ id: args.id, component: args.component });
      } else if (direction === 'right') {
        const newGroup: FakeGroup = {
          id: `g${nextGroupId++}`,
          locationType: 'grid',
          panels: [{ id: args.id, component: args.component }],
        };
        groups.push(newGroup);
      } else if (!direction && refId) {
        // Dockview's "position to a specific group without direction"
        // → tab into that group. Used by openEdgePanel via
        // openSessionDetailsPanel.
        const target = groups.find((g) => g.id === refId);
        if (target) {
          target.panels.push({ id: args.id, component: args.component });
        }
      } else if (!args.position) {
        // Default placement — match dockview's "into the active group"
        // semantics so we'd catch the regression we just fixed.
        if (activeGroup) {
          activeGroup.panels.push({ id: args.id, component: args.component });
        } else {
          const newGroup: FakeGroup = {
            id: `g${nextGroupId++}`,
            locationType: 'grid',
            panels: [{ id: args.id, component: args.component }],
          };
          groups.push(newGroup);
        }
      } else {
        throw new Error(`fake dock: unsupported direction ${direction}`);
      }
    },
    getGroup(id: string) {
      const g = groups.find((x) => x.id === id);
      if (!g) return undefined;
      return { id: g.id, panels: g.panels };
    },
    // Edge-group surface used by openSessionDetailsPanel (added in
    // Phase 18a). For the addPanel tests we don't care about the
    // details panel — return undefined for getEdgeGroup so
    // openEdgePanel takes the addEdgeGroup path, and addEdgeGroup
    // creates a tracked group so subsequent addPanel({ position:
    // referenceGroup: edge.id }) resolves.
    getEdgeGroup(_position: string) {
      return undefined;
    },
    addEdgeGroup(position: string, opts: { id?: string } = {}) {
      const id = opts.id ?? `edge-${position}`;
      const newGroup: FakeGroup = {
        id,
        locationType: 'edge',
        panels: [],
      };
      groups.push(newGroup);
      addGroupCalls.push({ id });
      return { id };
    },
    removeEdgeGroup() {
      /* no-op */
    },
    setEdgeGroupVisible() {
      /* no-op */
    },
    isEdgeGroupVisible() {
      return true;
    },
    onDidActiveGroupChange: () => ({ dispose: () => {} }),
    onDidActivePanelChange: () => ({ dispose: () => {} }),
    onDidAddPanel: () => ({ dispose: () => {} }),
    onDidRemovePanel: () => ({ dispose: () => {} }),
    onDidAddGroup: () => ({ dispose: () => {} }),
  } as unknown as DockviewApi;

  return { api, addPanelCalls, addGroupCalls, groups };
}

describe('layoutStore.addPanel placement', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('no groups at all → creates a body group and drops panel WITHIN it (not as a sibling)', () => {
    const dock = makeFakeDock([]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.addPanel('session-1');

    // addPanel is responsible for the CHAT panel placement decision;
    // it also auto-opens the per-session details right-rail panel
    // (Phase 18a). The body-group add is the only `addGroup` that
    // matters for placement (edge groups are tracked separately via
    // addEdgeGroup), but the fake also routes addEdgeGroup through
    // addGroupCalls, so we filter on the body-grid id we expect.
    const chatCall = dock.addPanelCalls.find((c) => c.component === 'chat')!;
    expect(chatCall).toBeDefined();
    expect(chatCall.id).toBe('session-1');
    expect(chatCall.position?.direction).toBe('within');
    const bodyGroupId = chatCall.position?.referenceGroup;
    expect(bodyGroupId).toBeDefined();
    expect(dock.addGroupCalls.some((g) => g.id === bodyGroupId)).toBe(true);
    const bodyGroup = dock.groups.find((g) => g.id === bodyGroupId);
    expect(bodyGroup?.panels.map((p) => p.id)).toEqual(['session-1']);
  });

  test('only edge group exists (Sessions sidebar) → still creates a body group, panel does NOT land in the sidebar', () => {
    const dock = makeFakeDock([
      {
        id: 'sessions-sidebar',
        locationType: 'edge',
        panels: [{ id: 'sessions-manager', component: 'sessionsManager' }],
      },
    ]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.addPanel('session-1');

    const chatCall = dock.addPanelCalls.find((c) => c.component === 'chat')!;
    expect(chatCall.position?.direction).toBe('within');
    const newBodyId = chatCall.position?.referenceGroup;
    expect(newBodyId).toBeDefined();
    expect(dock.addGroupCalls.some((g) => g.id === newBodyId)).toBe(true);
    // Sidebar must remain untouched.
    const sidebar = dock.groups.find((g) => g.id === 'sessions-sidebar');
    expect(sidebar?.panels.map((p) => p.id)).toEqual(['sessions-manager']);
    // Chat panel landed in the new body group.
    const body = dock.groups.find((g) => g.id === newBodyId);
    expect(body?.panels.map((p) => p.id)).toEqual(['session-1']);
  });

  test('body group already exists → tile to the RIGHT (new group), not within', () => {
    const dock = makeFakeDock([
      { id: 'body-1', locationType: 'grid', panels: [{ id: 'existing', component: 'chat' }] },
    ]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.addPanel('session-2');

    // No new body group via addGroup() — dockview creates the sibling
    // group as part of `addPanel({ direction: "right" })`. The
    // details-rail panel will trigger an addEdgeGroup call though;
    // assert specifically on the chat-panel placement.
    const chatCall = dock.addPanelCalls.find((c) => c.component === 'chat')!;
    expect(chatCall.position?.direction).toBe('right');
    expect(chatCall.position?.referenceGroup).toBe('body-1');
    // Only the right-edge details group should be the addGroupCalls
    // entry (id like `edge-right`), NOT a body group.
    expect(dock.addGroupCalls.every((g) => g.id.startsWith('edge-'))).toBe(true);
  });

  test('targetGroupId supplied (orphan replacement) → WITHIN that group', () => {
    const dock = makeFakeDock([
      { id: 'body-1', locationType: 'grid', panels: [{ id: 'orphan', component: 'chat' }] },
    ]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.addPanel('replacement', { targetGroupId: 'body-1' });

    expect(dock.addPanelCalls[0]?.position?.direction).toBe('within');
    expect(dock.addPanelCalls[0]?.position?.referenceGroup).toBe('body-1');
  });

  test("duplicate sessionId → no-op (doesn't double-add or split)", () => {
    const dock = makeFakeDock([
      { id: 'body-1', locationType: 'grid', panels: [{ id: 'session-1', component: 'chat' }] },
    ]);
    const store = useLayoutStore();
    store.setApi(dock.api);

    store.addPanel('session-1');

    expect(dock.addPanelCalls).toHaveLength(0);
    expect(dock.addGroupCalls).toHaveLength(0);
  });
});
