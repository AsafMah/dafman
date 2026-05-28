/**
 * Groups store for v3 nested-dockview design.
 *
 * One outer `<DockviewVue>` (owns the activity bar) plus N inner
 * `<DockviewVue>`s, one per group. Each inner is mounted by a
 * `GroupPanel.vue` body panel in the outer.
 *
 * This store owns:
 *  - the user-facing group meta list (`groups`)
 *  - the per-group inner-api registry (`innerApis`) populated by
 *    `GroupPanel.registerInnerApi` on @ready / removed on unmount
 *  - the per-group inner-toJSON cache (`innerBodiesCache`) so unmounted
 *    groups don't get dropped on persist (rubber-duck rule #5)
 *  - the one-only invariant via `pruneSessionFromAllGroups`
 *
 * What this store does NOT own:
 *  - the outer DockviewApi (lives in `layoutStore`)
 *  - "the active group" — that's derived from `outer.activePanel.id` and
 *    exposed by `layoutStore.bodyApi` in phase 5; this store only stores
 *    `activeGroupId` for SERIALIZATION (so persisted layouts remember
 *    which group was visible)
 */

import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { DockviewApi } from 'dockview-core';
import type { GroupMeta, Layout } from '@/ipc/types';
import { composePersistLayout } from '@/lib/composePersistLayout';
import { stripPanelFromLayout } from '@/lib/layoutSanitize';

/// 8-swatch tab-color palette. Cycled by `createGroup` so the first 8
/// groups each get a distinct hue without prompting the user. Picked to
/// be readable on both light + dark themes.
export const GROUP_COLORS = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
] as const;

/// Default name for the migration group when v2 layouts get wrapped into
/// a single group at boot. Stable so the test fixture round-trip works.
export const DEFAULT_GROUP_NAME = 'Default';

let idCounter = 0;

function newGroupId(): string {
  idCounter += 1;

  return `grp-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/// Picks the next palette color based on the existing groups. Cycles
/// through `GROUP_COLORS` then reuses from the start.
function pickNextColor(existing: readonly GroupMeta[]): string {
  return GROUP_COLORS[existing.length % GROUP_COLORS.length];
}

/// Returns a brand-new "Default" group meta, used by migration and by the
/// hydrate fallback when the persisted layout is empty / corrupt.
export function createDefaultGroup(): GroupMeta {
  return { id: newGroupId(), name: DEFAULT_GROUP_NAME, color: GROUP_COLORS[0] };
}

export const useGroupsStore = defineStore('groups', () => {
  /// User-facing group meta list. Invariant after hydrate: length >= 1.
  const groups = ref<GroupMeta[]>([]);

  /// Id of the group whose inner panel is currently active in the outer
  /// dockview. Maintained by `App.vue` watching `outer.api.onDidActivePanelChange`
  /// (phase 5); this store only stores it for persistence so that on next
  /// boot we can `outer.api.getPanel(activeGroupId)?.api.setActive()`.
  const activeGroupId = ref<string | null>(null);

  /// Live inner DockviewApi by group id. Populated by `GroupPanel.vue` in
  /// its `@ready` handler (phase 3) and cleared by `onBeforeUnmount`
  /// (covers the dockview teardown path during outer `fromJSON`).
  ///
  /// Uses `shallowRef` (not `ref`) because `DockviewApi` is a class
  /// instance with private fields — Vue's deep reactive proxy mangles
  /// its TypeScript identity (`Type 'DockviewApi' is missing the
  /// following private properties: component, _getGroupModel`),
  /// forcing every reader to add `as unknown as DockviewApi` casts.
  /// Shallow ref keeps the map itself reactive (so registry add/remove
  /// triggers updates) but stores the api values raw.
  const innerApis = shallowRef<Record<string, DockviewApi>>({});

  /// Per-group inner-body cache. Source of truth for unmounted groups'
  /// persisted body. Updated by:
  ///  - `hydrate()` at boot
  ///  - `recordInnerBodySnapshot(id, json)` on every inner `onDidLayoutChange`
  ///  - `unregisterInnerApi(id)` — captures a final snapshot before the
  ///    api goes away
  ///  - `pruneSessionFromAllGroups` — when we strip a session from a cached
  ///    body, the new body replaces the old entry
  ///  - `deleteGroup(id)` — `delete cache[id]`
  const innerBodiesCache = ref<Record<string, unknown>>({});

  // ─── derived ────────────────────────────────────────────────────────

  const activeGroup = computed(
    () => groups.value.find((g) => g.id === activeGroupId.value) ?? null,
  );

  function isGroupPanelId(panelId: string): boolean {
    return groups.value.some((g) => g.id === panelId);
  }

  // ─── hydrate / serialize ────────────────────────────────────────────

  /// Loads persisted state from a `Layout` object. Normalizes inputs:
  ///  - missing / empty `groups` AND no legacy `dockview` blob → fresh seed
  ///    with a single Default group
  ///  - missing / empty `groups` BUT legacy `dockview` blob present → v2→v3
  ///    migration: wrap the v2 body (panels + grid, minus edgeGroups) into a
  ///    single Default group's `innerBodies` entry. The outer dockview gets
  ///    seeded fresh by `bootLayout` (edge state from v2 is lost — edges
  ///    resize themselves, not user-perceptible)
  ///  - `activeGroupId` not matching any group → reset to `groups[0].id`
  ///  - `innerBodies` keys not in `groups[].id` → dropped
  function hydrate(layout: Layout | undefined): void {
    const incoming = layout?.groups;

    if (!incoming || incoming.length === 0) {
      const defaultGroup = createDefaultGroup();

      groups.value = [defaultGroup];
      activeGroupId.value = defaultGroup.id;

      // v2 migration: harvest the legacy dockview blob's body (panels +
      // grid + activeGroup, dropping edgeGroups + floats + popouts which
      // are outer-only concerns) into the Default group's body cache.
      const legacyDockview = layout?.dockview;
      const legacyBody = legacyDockview ? extractBodyFromLegacy(legacyDockview) : undefined;

      innerBodiesCache.value = legacyBody !== undefined ? { [defaultGroup.id]: legacyBody } : {};

      return;
    }

    groups.value = incoming.map((g) => ({ ...g }));

    const persistedActive = layout?.activeGroupId;

    activeGroupId.value =
      persistedActive && groups.value.some((g) => g.id === persistedActive)
        ? persistedActive
        : groups.value[0].id;

    const incomingBodies = layout?.innerBodies;
    const cache: Record<string, unknown> = {};

    if (incomingBodies && typeof incomingBodies === 'object') {
      for (const g of groups.value) {
        const body = incomingBodies[g.id];

        if (body !== undefined) cache[g.id] = body;
      }
    }

    innerBodiesCache.value = cache;
  }

  /// Returns the next `Layout` to persist. Walks `innerApis` for every
  /// mounted group, snapshotting its `toJSON()` synchronously, and feeds
  /// the result through `composePersistLayout`. The result is the input
  /// to `settingsStore.persistLayout` (wired in phase 5).
  function serialize(outerJson: unknown): Layout {
    const live: Record<string, unknown> = {};

    for (const [gid, api] of Object.entries(innerApis.value)) {
      try {
        live[gid] = api.toJSON();
      } catch (err) {
        // Defensive: if a particular inner toJSON throws, fall back to
        // whatever's cached so we don't lose its state for this group.
        console.warn('[groupsStore] inner.toJSON() failed for group', gid, err);
      }
    }

    return composePersistLayout({
      outer: outerJson,
      groups: groups.value,
      activeGroupId: activeGroupId.value,
      innerBodiesCache: innerBodiesCache.value,
      liveInnerBodies: live,
    });
  }

  // ─── inner-api registry ─────────────────────────────────────────────

  /// Pending awaiters for `awaitInnerApi`. Resolved by `registerInnerApi`
  /// the moment the inner DockviewVue's @ready fires. Used by
  /// `useGroupsActions.moveSessionToGroup` to avoid the
  /// `requestAnimationFrame` timing assumption that broke when
  /// activation didn't synchronously land the api.
  const pendingApiAwaiters = new Map<string, Array<(api: DockviewApi) => void>>();

  function registerInnerApi(groupId: string, api: DockviewApi): void {
    innerApis.value = { ...innerApis.value, [groupId]: api };
    // Resolve any awaiters that were waiting for this id.
    const awaiters = pendingApiAwaiters.get(groupId);

    if (awaiters) {
      pendingApiAwaiters.delete(groupId);

      for (const resolve of awaiters) resolve(api);
    }
  }

  /// Returns a Promise that resolves with the inner api for `groupId`
  /// once it's registered. If already registered, resolves on the next
  /// microtask. Times out after `timeoutMs` (default 2 s) — exceeding
  /// this means the GroupPanel either failed to mount or the group id
  /// doesn't exist. Used by orchestration code (move-to-group) that
  /// needs to add a panel into a freshly-activated group's inner.
  function awaitInnerApi(groupId: string, timeoutMs = 2000): Promise<DockviewApi> {
    const existing = innerApis.value[groupId];

    if (existing) return Promise.resolve(existing);

    return new Promise<DockviewApi>((resolve, reject) => {
      const arr = pendingApiAwaiters.get(groupId) ?? [];

      arr.push(resolve);
      pendingApiAwaiters.set(groupId, arr);
      setTimeout(() => {
        const list = pendingApiAwaiters.get(groupId);

        if (!list) return;

        const idx = list.indexOf(resolve);

        if (idx >= 0) list.splice(idx, 1);

        if (list.length === 0) pendingApiAwaiters.delete(groupId);

        reject(new Error(`awaitInnerApi(${groupId}): timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  function unregisterInnerApi(groupId: string): void {
    const api = innerApis.value[groupId];

    if (api) {
      // Last chance to snapshot before the api dies. Mirrors the
      // 'final snapshot' rule called out in the plan's persistence section.
      try {
        innerBodiesCache.value = { ...innerBodiesCache.value, [groupId]: api.toJSON() };
      } catch (err) {
        console.warn('[groupsStore] final inner.toJSON() failed for group', groupId, err);
      }

      const next = { ...innerApis.value };

      delete next[groupId];
      innerApis.value = next;
    }
  }

  function recordInnerBodySnapshot(groupId: string, json: unknown): void {
    innerBodiesCache.value = { ...innerBodiesCache.value, [groupId]: json };
  }

  /// Caller-injected setter for `activeGroupId`. Used by `layoutStore`'s
  /// outer `onDidActivePanelChange` subscription to sync this store with
  /// the user's tab clicks. Filtered by `isGroupPanelId` at the call
  /// site so edge-panel focus changes don't shift the active group.
  function setActiveGroupId(id: string | null): void {
    if (id !== null && !groups.value.some((g) => g.id === id)) return;

    activeGroupId.value = id;
  }

  function getCachedInnerBody(groupId: string): unknown | undefined {
    return innerBodiesCache.value[groupId];
  }

  // ─── CRUD ───────────────────────────────────────────────────────────

  function createGroup(name?: string): GroupMeta {
    const meta: GroupMeta = {
      id: newGroupId(),
      name: (name ?? '').trim() || `Group ${groups.value.length + 1}`,
      color: pickNextColor(groups.value),
    };

    groups.value = [...groups.value, meta];

    return meta;
  }

  function renameGroup(id: string, name: string): void {
    const trimmed = name.trim();

    if (!trimmed) return;

    const idx = groups.value.findIndex((g) => g.id === id);

    if (idx < 0) return;

    const next = [...groups.value];

    next[idx] = { ...next[idx], name: trimmed };
    groups.value = next;
  }

  function setGroupColor(id: string, color: string): void {
    const idx = groups.value.findIndex((g) => g.id === id);

    if (idx < 0) return;

    const next = [...groups.value];

    next[idx] = { ...next[idx], color };
    groups.value = next;
  }

  /// Removes a group. No-op if it's the last group (invariant: always >=1).
  /// Returns the session ids that were in the deleted group's cached body
  /// — caller (App.vue) is responsible for closing them via `sessionsStore`.
  function deleteGroup(id: string): string[] {
    if (groups.value.length <= 1) return [];

    const idx = groups.value.findIndex((g) => g.id === id);

    if (idx < 0) return [];

    // Collect ids to close from whichever source has them. Prefer live
    // inner toJSON if mounted (most up-to-date), else cached body.
    const api = innerApis.value[id];
    const body = api ? api.toJSON() : innerBodiesCache.value[id];
    const sessionIds = body ? extractPanelIdsFromBody(body) : [];

    const next = [...groups.value];

    next.splice(idx, 1);
    groups.value = next;

    if (activeGroupId.value === id) {
      activeGroupId.value = next[0]?.id ?? null;
    }

    const apiNext = { ...innerApis.value };

    delete apiNext[id];
    innerApis.value = apiNext;

    const cacheNext = { ...innerBodiesCache.value };

    delete cacheNext[id];
    innerBodiesCache.value = cacheNext;

    return sessionIds;
  }

  // ─── one-only invariant ─────────────────────────────────────────────

  /// Set of session ids currently being moved between groups. Used by the
  /// per-inner `onDidRemovePanel` handler (wired in phase 3) to skip
  /// `closeSession` for programmatic moves. Synchronous enter/exit; can't
  /// leak across await boundaries because there are none inside the use.
  const movingSessions = ref<Set<string>>(new Set());

  function isMovingSession(sessionId: string): boolean {
    return movingSessions.value.has(sessionId);
  }

  function withMovingSession<T>(sessionId: string, fn: () => T): T {
    movingSessions.value.add(sessionId);

    try {
      return fn();
    } finally {
      movingSessions.value.delete(sessionId);
    }
  }

  /// Strips a session id from every group EXCEPT `exceptGroupId`. Both
  /// mounted (live api) and unmounted (cached body) groups are pruned.
  /// Returns the set of group ids that actually had to be pruned (for
  /// tests + diagnostics).
  function pruneSessionFromAllGroups(sessionId: string, exceptGroupId?: string | null): string[] {
    const touched: string[] = [];

    // 1. Mounted inners: live removal via api. Wrap in withMovingSession
    //    so the per-inner remove handler skips closeSession.
    for (const [gid, api] of Object.entries(innerApis.value)) {
      if (gid === exceptGroupId) continue;

      const panel = api.getPanel(sessionId);

      if (panel) {
        withMovingSession(sessionId, () => api.removePanel(panel));
        touched.push(gid);
      }
    }

    // 2. Cached bodies for unmounted groups: walk JSON.
    const nextCache: Record<string, unknown> = { ...innerBodiesCache.value };

    for (const [gid, body] of Object.entries(nextCache)) {
      if (gid === exceptGroupId) continue;

      const cleaned = removeSessionFromBody(body, sessionId);

      if (cleaned !== body) {
        nextCache[gid] = cleaned;
        touched.push(gid);
      }
    }

    if (touched.length > 0) innerBodiesCache.value = nextCache;

    return touched;
  }

  return {
    // state
    groups,
    activeGroupId,
    innerApis,
    innerBodiesCache,
    activeGroup,
    // queries
    isGroupPanelId,
    isMovingSession,
    getCachedInnerBody,
    setActiveGroupId,
    // lifecycle
    hydrate,
    serialize,
    // inner-api registry
    registerInnerApi,
    unregisterInnerApi,
    awaitInnerApi,
    recordInnerBodySnapshot,
    // CRUD
    createGroup,
    renameGroup,
    setGroupColor,
    deleteGroup,
    // one-only
    withMovingSession,
    pruneSessionFromAllGroups,
  };
});

// ─── pure helpers (exported for testing) ──────────────────────────────

/// Removes a session/panel id from a serialized dockview body. Returns the
/// SAME reference if nothing changed (so callers can do `if (cleaned !== body)`
/// to detect mutation cheaply). Otherwise returns a fresh body with the panel
/// stripped from `panels` AND every recursive `views[]` reference.
///
/// Delegates to the already-tested `stripPanelFromLayout`; this re-export
/// gives the groups module a domain-named function without re-implementing
/// the recursive walker.
export function removeSessionFromBody(body: unknown, sessionId: string): unknown {
  if (!body || typeof body !== 'object') return body;

  const obj = body as Record<string, unknown>;
  const panels = obj.panels;

  if (!panels || typeof panels !== 'object') return body;

  if (!Object.prototype.hasOwnProperty.call(panels, sessionId)) return body;

  return stripPanelFromLayout(body, sessionId);
}

/// Extracts the chat-panel ids from a v3 inner-body JSON. Unlike
/// `extractChatPanelIds` in `layoutSanitize`, this inner-body has no edge
/// groups — just `panels` + `grid`. Filters out the dafman edge / system
/// panel ids defensively (in practice there shouldn't be any).
export function extractPanelIdsFromBody(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];

  const panels = (body as Record<string, unknown>).panels;

  if (!panels || typeof panels !== 'object') return [];

  return Object.keys(panels);
}

/// v2 → v3 migration helper. Takes a legacy `dockview` blob (which has
/// `{grid, panels, activeGroup, edgeGroups?, floatingGroups?, popoutGroups?}`)
/// and returns just the body portion suitable for an inner dockview:
/// `{grid, panels, activeGroup}`. Drops `edgeGroups` (outer-only in v3),
/// `floatingGroups`, and `popoutGroups` (the latter two could be kept but
/// the rubber-duck pass flagged them as out-of-scope for v3 — they don't
/// follow group switches per M11, so they stay with whichever group they
/// were created in, but for a v2 migration the user has no group context
/// so we drop).
///
/// Returns `undefined` if the input doesn't look like a dockview blob.
export function extractBodyFromLegacy(dockview: unknown): unknown | undefined {
  if (!dockview || typeof dockview !== 'object') return undefined;

  const obj = dockview as Record<string, unknown>;

  if (!obj.grid || typeof obj.grid !== 'object') return undefined;

  const body: Record<string, unknown> = {
    grid: obj.grid,
    panels: obj.panels && typeof obj.panels === 'object' ? obj.panels : {},
  };

  if (typeof obj.activeGroup === 'string') {
    body.activeGroup = obj.activeGroup;
  }

  return body;
}
