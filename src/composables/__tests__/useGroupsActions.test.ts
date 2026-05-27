import { beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import type { DockviewApi, IDockviewPanel } from 'dockview-core';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useGroupsActions } from '@/composables/useGroupsActions';

interface FakeInner {
  api: DockviewApi;
  panelIds: string[];
  removed: string[];
  added: Array<{ id: string; component: string }>;
}

function makeFakeInner(initial: string[] = []): FakeInner {
  const panelIds: string[] = [...initial];
  const removed: string[] = [];
  const added: Array<{ id: string; component: string }> = [];
  const api = {
    getPanel(id: string): IDockviewPanel | undefined {
      if (!panelIds.includes(id)) return undefined;
      return { id, api: { close: () => {} } } as unknown as IDockviewPanel;
    },
    removePanel(panel: IDockviewPanel): void {
      const idx = panelIds.indexOf(panel.id);
      if (idx >= 0) panelIds.splice(idx, 1);
      removed.push(panel.id);
    },
    addPanel(opts: { id: string; component: string }): void {
      added.push(opts);
      panelIds.push(opts.id);
    },
    toJSON(): unknown {
      return { panels: Object.fromEntries(panelIds.map((id) => [id, { id }])) };
    },
  } as unknown as DockviewApi;
  return { api, panelIds, removed, added };
}

function makeFakeOuter(): DockviewApi & { _addStub: (id: string) => void } {
  // Outer api stub. Must satisfy layoutStore.setApi which calls
  // recomputeActiveSession (reads dock.groups + dock.activeGroup),
  // rescanOpenDetails, applyActiveTabConstraints (reads
  // dock.getEdgeGroup). Pin the minimum surface so any future store
  // call that needs more shows up as a clear test failure.
  const panels = new Map<string, { id: string; api: { setActive: () => void; group: { id: string } } }>();
  const fakeGroup = {
    id: 'outer-body-group',
    model: { location: { type: 'grid' as const } },
    panels: [] as Array<{ id: string }>,
    activePanel: undefined as unknown,
  };
  const api = {
    get activeGroup() {
      return fakeGroup;
    },
    get groups() {
      return [fakeGroup];
    },
    get activePanel() {
      return undefined;
    },
    getPanel(id: string) {
      return panels.get(id);
    },
    removePanel(panel: { id: string }) {
      panels.delete(panel.id);
    },
    getEdgeGroup() {
      return undefined;
    },
    isEdgeGroupVisible() {
      return false;
    },
    setEdgeGroupVisible() {
      /* no-op */
    },
    onDidActiveGroupChange: () => ({ dispose: () => {} }),
    onDidActivePanelChange: () => ({ dispose: () => {} }),
    onDidAddPanel: () => ({ dispose: () => {} }),
    onDidRemovePanel: () => ({ dispose: () => {} }),
    onDidAddGroup: () => ({ dispose: () => {} }),
    onDidLayoutChange: () => ({ dispose: () => {} }),
    onWillShowOverlay: () => ({ dispose: () => {} }),
    _addStub(id: string) {
      panels.set(id, {
        id,
        api: { setActive: () => {}, group: fakeGroup },
      });
      fakeGroup.panels.push({ id });
    },
  } as unknown as DockviewApi & { _addStub: (id: string) => void };
  return api;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useGroupsActions.moveSessionToGroup — inner-api timing', () => {
  test('awaits target inner api registration before adding', async () => {
    const groups = useGroupsStore();
    const layout = useLayoutStore();
    const outer = makeFakeOuter() as DockviewApi & { _addStub: (id: string) => void };
    layout.setApi(outer);

    groups.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g1',
      innerBodies: {},
    });
    outer._addStub('g1');
    outer._addStub('g2');

    const i1 = makeFakeInner(['sess-1']);
    groups.registerInnerApi('g1', i1.api);

    const actions = useGroupsActions();

    // Start the move BEFORE g2's inner api is registered. The action
    // should hang in awaitInnerApi until we register it.
    const movePromise = actions.moveSessionToGroup('sess-1', 'g2');

    // Yield several ticks — without awaitInnerApi the old impl would
    // have errored out by now.
    await new Promise<void>((r) => setTimeout(r, 50));

    // Register g2's inner; the awaiter should resolve.
    const i2 = makeFakeInner();
    groups.registerInnerApi('g2', i2.api);

    await movePromise;

    // sess-1 was pruned from g1 (via withMovingSession) AND added to g2.
    expect(i1.panelIds).toEqual([]);
    expect(i2.added).toEqual([
      { id: 'sess-1', component: 'chat', params: { sessionId: 'sess-1' } } as unknown as { id: string; component: string },
    ]);
  });

  test('rejects after timeout if target inner never registers', async () => {
    const groups = useGroupsStore();
    const layout = useLayoutStore();
    const outer = makeFakeOuter() as DockviewApi & { _addStub: (id: string) => void };
    layout.setApi(outer);

    groups.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g1',
      innerBodies: {},
    });
    outer._addStub('g1');
    outer._addStub('g2');

    const i1 = makeFakeInner(['sess-1']);
    groups.registerInnerApi('g1', i1.api);

    // No g2 inner ever registered. awaitInnerApi will time out (we
    // use a short timeout here by calling awaitInnerApi directly).
    await expect(groups.awaitInnerApi('g2', 50)).rejects.toThrow(/timed out/);
    // Critical invariant: the session must NOT have been pruned. The
    // action surfaces the timeout via console.warn and returns — but
    // moveSessionToGroup's prune happens AFTER the await, so a timeout
    // means the source group is untouched.
    expect(i1.panelIds).toEqual(['sess-1']);
  });

  test('immediately resolves if target inner already registered', async () => {
    const groups = useGroupsStore();
    const layout = useLayoutStore();
    const outer = makeFakeOuter() as DockviewApi & { _addStub: (id: string) => void };
    layout.setApi(outer);

    groups.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g1',
      innerBodies: {},
    });
    outer._addStub('g1');
    outer._addStub('g2');

    const i1 = makeFakeInner(['sess-1']);
    const i2 = makeFakeInner();
    groups.registerInnerApi('g1', i1.api);
    groups.registerInnerApi('g2', i2.api);

    const actions = useGroupsActions();
    await actions.moveSessionToGroup('sess-1', 'g2');

    expect(i1.panelIds).toEqual([]);
    expect(i2.panelIds).toEqual(['sess-1']);
  });
});

describe('useGroupsActions.deleteGroup', () => {
  test('closes sessions in the deleted group and activates a sibling', async () => {
    const groups = useGroupsStore();
    const layout = useLayoutStore();
    const sessions = useSessionsStore();
    const outer = makeFakeOuter() as DockviewApi & { _addStub: (id: string) => void };
    layout.setApi(outer);

    groups.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g2',
      innerBodies: {
        g2: { grid: { root: {} }, panels: { 'sess-a': { id: 'sess-a' } } },
      },
    });
    outer._addStub('g1');
    outer._addStub('g2');

    const closeCalls: string[] = [];
    // sessionsStore is real; stub only the closeSession call by
    // intercepting via a spy. Simpler: replace the method.
    (sessions as unknown as { closeSession: (id: string) => Promise<void> }).closeSession = async (id) => {
      closeCalls.push(id);
    };

    const actions = useGroupsActions();
    actions.deleteGroup('g2');

    expect(closeCalls).toEqual(['sess-a']);
    expect(groups.groups.map((g) => g.id)).toEqual(['g1']);
    expect(groups.activeGroupId).toBe('g1');
  });

  test('no-op when only one group remains', () => {
    const groups = useGroupsStore();
    const layout = useLayoutStore();
    const outer = makeFakeOuter() as DockviewApi & { _addStub: (id: string) => void };
    layout.setApi(outer);

    groups.hydrate({
      schemaVersion: 3,
      groups: [{ id: 'g1', name: 'Only', color: '#aaa' }],
      activeGroupId: 'g1',
      innerBodies: {},
    });
    outer._addStub('g1');

    const actions = useGroupsActions();
    actions.deleteGroup('g1');

    expect(groups.groups.map((g) => g.id)).toEqual(['g1']);
    expect(groups.activeGroupId).toBe('g1');
  });
});
