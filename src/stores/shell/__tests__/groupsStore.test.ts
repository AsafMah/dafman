import { beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import type { DockviewApi, IDockviewPanel } from 'dockview-core';
import {
  useGroupsStore,
  removeSessionFromBody,
  extractPanelIdsFromBody,
  extractBodyFromLegacy,
  GROUP_COLORS,
  DEFAULT_GROUP_NAME,
} from '@/stores/shell/groupsStore';
import type { Layout } from '@/ipc/types';

// Minimal fake inner-DockviewApi for testing the registry + prune logic.
// Only covers `getPanel` + `removePanel` + `toJSON` — the rest throws.
interface FakeInner {
  api: DockviewApi;
  panelIds: string[];
  removed: string[];
  toJSONResult: unknown;
}

function makeFakeInner(initialPanelIds: string[] = [], toJSONResult?: unknown): FakeInner {
  const panelIds: string[] = [...initialPanelIds];
  const removed: string[] = [];
  const finalToJSON = toJSONResult ?? { grid: { root: {} }, panels: {} };

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
    toJSON(): unknown {
      // Snapshot reflects current state so deleteGroup + final-snapshot
      // logic see the most recent picture.
      return {
        ...(finalToJSON as Record<string, unknown>),
        panels: Object.fromEntries(panelIds.map((id) => [id, { id }])),
      };
    },
  } as unknown as DockviewApi;

  return { api, panelIds, removed, toJSONResult: finalToJSON };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('groupsStore — hydrate', () => {
  test('empty input → single Default group + empty cache', () => {
    const store = useGroupsStore();
    store.hydrate(undefined);
    expect(store.groups).toHaveLength(1);
    expect(store.groups[0].name).toBe(DEFAULT_GROUP_NAME);
    expect(store.groups[0].color).toBe(GROUP_COLORS[0]);
    expect(store.activeGroupId).toBe(store.groups[0].id);
    expect(store.innerBodiesCache).toEqual({});
  });

  test('v2 legacy {dockview: ...} → wraps body into Default group', () => {
    const v2: Layout = {
      schemaVersion: 2,
      dockview: {
        grid: { root: { type: 'branch', data: [] }, height: 1, width: 1, orientation: 'HORIZONTAL' },
        panels: { 'sess-1': { id: 'sess-1', contentComponent: 'chat' } },
        activeGroup: 'g-old',
        edgeGroups: { left: { size: 200, visible: true } },
      },
    };
    const store = useGroupsStore();
    store.hydrate(v2);
    expect(store.groups).toHaveLength(1);
    const defaultId = store.groups[0].id;
    expect(store.innerBodiesCache[defaultId]).toBeDefined();
    const body = store.innerBodiesCache[defaultId] as Record<string, unknown>;
    expect(body.grid).toBeDefined();
    expect(body.panels).toEqual({ 'sess-1': { id: 'sess-1', contentComponent: 'chat' } });
    expect(body.activeGroup).toBe('g-old');
    // edgeGroups dropped — outer-only in v3
    expect(body.edgeGroups).toBeUndefined();
  });

  test('v3 layout passes through (groups + innerBodies preserved)', () => {
    const v3: Layout = {
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g2',
      innerBodies: {
        g1: { grid: { root: {} }, panels: {} },
        g2: { grid: { root: {} }, panels: { 'sess-1': { id: 'sess-1' } } },
      },
    };
    const store = useGroupsStore();
    store.hydrate(v3);
    expect(store.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(store.activeGroupId).toBe('g2');
    expect(Object.keys(store.innerBodiesCache).sort()).toEqual(['g1', 'g2']);
  });

  test('activeGroupId pointing at unknown group → falls back to groups[0].id', () => {
    const v3: Layout = {
      schemaVersion: 3,
      groups: [{ id: 'g1', name: 'One', color: '#aaa' }],
      activeGroupId: 'g-missing',
      innerBodies: {},
    };
    const store = useGroupsStore();
    store.hydrate(v3);
    expect(store.activeGroupId).toBe('g1');
  });

  test('orphan innerBodies (key not in groups) → dropped', () => {
    const v3: Layout = {
      schemaVersion: 3,
      groups: [{ id: 'g1', name: 'One', color: '#aaa' }],
      activeGroupId: 'g1',
      innerBodies: {
        g1: { grid: {}, panels: {} },
        'g-ghost': { grid: {}, panels: { 'sess-zombie': {} } },
      },
    };
    const store = useGroupsStore();
    store.hydrate(v3);
    expect(Object.keys(store.innerBodiesCache)).toEqual(['g1']);
  });

  test('groups: [] (empty array) hydrates same as missing groups', () => {
    const store = useGroupsStore();
    store.hydrate({ schemaVersion: 3, groups: [], innerBodies: {} });
    expect(store.groups).toHaveLength(1);
    expect(store.groups[0].name).toBe(DEFAULT_GROUP_NAME);
  });
});

describe('groupsStore — CRUD', () => {
  test('createGroup appends with cycling color', () => {
    const store = useGroupsStore();
    store.hydrate(undefined); // seed Default
    const a = store.createGroup('Work');
    const b = store.createGroup('Play');
    expect(store.groups.map((g) => g.name)).toEqual([DEFAULT_GROUP_NAME, 'Work', 'Play']);
    expect(a.color).toBe(GROUP_COLORS[1]);
    expect(b.color).toBe(GROUP_COLORS[2]);
  });

  test('createGroup with no name → defaults to "Group N"', () => {
    const store = useGroupsStore();
    store.hydrate(undefined);
    const created = store.createGroup();
    expect(created.name).toBe('Group 2');
  });

  test('renameGroup trims input, no-ops on empty', () => {
    const store = useGroupsStore();
    store.hydrate(undefined);
    const id = store.groups[0].id;
    store.renameGroup(id, '  Updated  ');
    expect(store.groups[0].name).toBe('Updated');
    store.renameGroup(id, '   ');
    expect(store.groups[0].name).toBe('Updated'); // unchanged
  });

  test('setGroupColor updates color in place', () => {
    const store = useGroupsStore();
    store.hydrate(undefined);
    const id = store.groups[0].id;
    store.setGroupColor(id, '#ff0000');
    expect(store.groups[0].color).toBe('#ff0000');
  });

  test('deleteGroup of last group is no-op', () => {
    const store = useGroupsStore();
    store.hydrate(undefined);
    const id = store.groups[0].id;
    const closed = store.deleteGroup(id);
    expect(closed).toEqual([]);
    expect(store.groups).toHaveLength(1);
  });

  test('deleteGroup returns session ids from cached body of that group', () => {
    const store = useGroupsStore();
    store.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g1',
      innerBodies: {
        g2: {
          grid: { root: {} },
          panels: { 'sess-a': { id: 'sess-a' }, 'sess-b': { id: 'sess-b' } },
        },
      },
    });
    const closed = store.deleteGroup('g2');
    expect(closed.sort()).toEqual(['sess-a', 'sess-b']);
    expect(store.groups).toHaveLength(1);
    expect(store.innerBodiesCache.g2).toBeUndefined();
  });

  test('deleteGroup of active group moves activeGroupId to a sibling', () => {
    const store = useGroupsStore();
    store.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g2',
      innerBodies: {},
    });
    store.deleteGroup('g2');
    expect(store.activeGroupId).toBe('g1');
  });
});

describe('groupsStore — inner-api registry', () => {
  test('registerInnerApi + unregisterInnerApi maintain the map', () => {
    const store = useGroupsStore();
    store.hydrate(undefined);
    const id = store.groups[0].id;
    const inner = makeFakeInner();
    store.registerInnerApi(id, inner.api);
    // Pinia wraps the value in a reactive proxy; compare by presence.
    expect(store.innerApis[id]).toBeDefined();
    expect(typeof store.innerApis[id].getPanel).toBe('function');
    store.unregisterInnerApi(id);
    expect(store.innerApis[id]).toBeUndefined();
  });

  test('unregisterInnerApi captures a final snapshot into the cache', () => {
    const store = useGroupsStore();
    store.hydrate(undefined);
    const id = store.groups[0].id;
    const inner = makeFakeInner(['sess-x']);
    store.registerInnerApi(id, inner.api);
    store.unregisterInnerApi(id);
    const cached = store.innerBodiesCache[id] as Record<string, unknown>;
    expect(cached).toBeDefined();
    expect(cached.panels).toEqual({ 'sess-x': { id: 'sess-x' } });
  });
});

describe('groupsStore — pruneSessionFromAllGroups', () => {
  test('strips from every mounted inner except the kept group', () => {
    const store = useGroupsStore();
    store.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
        { id: 'g3', name: 'Three', color: '#ccc' },
      ],
      activeGroupId: 'g1',
      innerBodies: {},
    });
    const i1 = makeFakeInner(['sess-shared']);
    const i2 = makeFakeInner(['sess-shared', 'other']);
    const i3 = makeFakeInner(['sess-shared']);
    store.registerInnerApi('g1', i1.api);
    store.registerInnerApi('g2', i2.api);
    store.registerInnerApi('g3', i3.api);

    const touched = store.pruneSessionFromAllGroups('sess-shared', 'g1');
    expect(touched.sort()).toEqual(['g2', 'g3']);
    expect(i1.removed).toEqual([]); // kept
    expect(i2.removed).toEqual(['sess-shared']);
    expect(i3.removed).toEqual(['sess-shared']);
    expect(i2.panelIds).toEqual(['other']); // remaining
  });

  test('strips from cached bodies of unmounted groups', () => {
    const store = useGroupsStore();
    store.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g1',
      innerBodies: {
        g2: {
          grid: { root: { type: 'leaf', data: { views: ['sess-x'] } } },
          panels: { 'sess-x': { id: 'sess-x' } },
        },
      },
    });
    // g2 has no live api, just the cache
    const touched = store.pruneSessionFromAllGroups('sess-x', 'g1');
    expect(touched).toEqual(['g2']);
    const cached = store.innerBodiesCache.g2 as Record<string, unknown>;
    expect(cached.panels).toEqual({});
  });

  test('wraps remove in withMovingSession so isMovingSession is true mid-remove', () => {
    const store = useGroupsStore();
    store.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g1',
      innerBodies: {},
    });
    const i2 = makeFakeInner(['sess-mv']);
    // Intercept removePanel to observe the flag during the call.
    let flagDuringRemove = false;
    const wrapped = {
      ...i2.api,
      removePanel: (panel: IDockviewPanel) => {
        flagDuringRemove = store.isMovingSession(panel.id);
        i2.api.removePanel(panel);
      },
    } as unknown as DockviewApi;
    store.registerInnerApi('g2', wrapped);

    store.pruneSessionFromAllGroups('sess-mv', 'g1');
    expect(flagDuringRemove).toBe(true);
    expect(store.isMovingSession('sess-mv')).toBe(false); // cleared after
  });
});

describe('removeSessionFromBody (pure helper)', () => {
  test('returns same reference when panel not present', () => {
    const body = { grid: { root: {} }, panels: { 'sess-a': { id: 'sess-a' } } };
    const out = removeSessionFromBody(body, 'sess-missing');
    expect(out).toBe(body);
  });

  test('removes from panels AND recursive views', () => {
    const body = {
      grid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: { views: ['sess-a', 'sess-b'], activeView: 'sess-a' },
            },
          ],
        },
      },
      panels: { 'sess-a': { id: 'sess-a' }, 'sess-b': { id: 'sess-b' } },
    };
    const out = removeSessionFromBody(body, 'sess-a') as Record<string, unknown>;
    expect(out).not.toBe(body);
    expect(out.panels).toEqual({ 'sess-b': { id: 'sess-b' } });
    const grid = out.grid as Record<string, unknown>;
    const root = grid.root as Record<string, unknown>;
    const branchData = (root.data as Record<string, unknown>[])[0];
    const leafData = branchData.data as Record<string, unknown>;
    expect(leafData.views).toEqual(['sess-b']);
  });

  test('non-object body passes through', () => {
    expect(removeSessionFromBody(null, 'x')).toBe(null);
    expect(removeSessionFromBody(undefined, 'x')).toBe(undefined);
  });
});

describe('extractBodyFromLegacy (v2 migration helper)', () => {
  test('keeps grid + panels + activeGroup, drops edgeGroups + floatingGroups + popoutGroups', () => {
    const legacy = {
      grid: { root: { type: 'branch', data: [] } },
      panels: { 'sess-1': { id: 'sess-1' } },
      activeGroup: 'g-old',
      edgeGroups: { left: { size: 200, visible: true, group: { panels: ['sidebar'] } } },
      floatingGroups: [{ data: {} }],
      popoutGroups: [{ data: {} }],
    };
    const body = extractBodyFromLegacy(legacy) as Record<string, unknown>;
    expect(body.grid).toBe(legacy.grid);
    expect(body.panels).toBe(legacy.panels);
    expect(body.activeGroup).toBe('g-old');
    expect(body.edgeGroups).toBeUndefined();
    expect(body.floatingGroups).toBeUndefined();
    expect(body.popoutGroups).toBeUndefined();
  });

  test('returns undefined for non-object input', () => {
    expect(extractBodyFromLegacy(null)).toBeUndefined();
    expect(extractBodyFromLegacy('string')).toBeUndefined();
    expect(extractBodyFromLegacy({})).toBeUndefined(); // no grid
  });

  test('omits activeGroup when legacy blob has none', () => {
    const body = extractBodyFromLegacy({ grid: {}, panels: {} }) as Record<string, unknown>;
    expect(body.activeGroup).toBeUndefined();
  });
});

describe('extractPanelIdsFromBody', () => {
  test('returns ids from body.panels', () => {
    expect(extractPanelIdsFromBody({ panels: { a: {}, b: {} } })).toEqual(['a', 'b']);
  });

  test('returns [] for empty / invalid input', () => {
    expect(extractPanelIdsFromBody(undefined)).toEqual([]);
    expect(extractPanelIdsFromBody({})).toEqual([]);
    expect(extractPanelIdsFromBody({ panels: null })).toEqual([]);
  });
});

describe('groupsStore — serialize', () => {
  test('emits v3 shape with activeGroupId + all groups in innerBodies (cache-first)', () => {
    const store = useGroupsStore();
    store.hydrate({
      schemaVersion: 3,
      groups: [
        { id: 'g1', name: 'One', color: '#aaa' },
        { id: 'g2', name: 'Two', color: '#bbb' },
      ],
      activeGroupId: 'g2',
      innerBodies: {
        g1: { grid: 'cached-g1', panels: {} },
        g2: { grid: 'cached-g2', panels: {} },
      },
    });
    const i2 = makeFakeInner([], { grid: 'live-g2', panels: {} });
    store.registerInnerApi('g2', i2.api);
    const out = store.serialize({ grid: 'outer-stub' });
    expect(out.schemaVersion).toBe(3);
    expect(out.outer).toEqual({ grid: 'outer-stub' });
    expect(out.activeGroupId).toBe('g2');
    expect(out.groups).toHaveLength(2);
    // g1 from cache, g2 from live api
    expect((out.innerBodies?.g1 as Record<string, unknown>).grid).toBe('cached-g1');
    expect((out.innerBodies?.g2 as Record<string, unknown>).grid).toBe('live-g2');
  });
});
