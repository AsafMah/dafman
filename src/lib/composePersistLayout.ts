/**
 * Single composition point for the persisted `Layout` shape.
 *
 * Cache-first composition rule (from groups v3 rubber-duck): start with the
 * cached `innerBodies` for ALL groups (so unmounted groups aren't dropped),
 * then OVERWRITE entries for whichever groups have a live inner api. Any
 * snapshot path that doesn't go through this function risks losing an
 * unmounted group's saved body — that was v1's "groups config never
 * persisting" bug class in a new form.
 *
 * The actual layout-save call (`settingsStore.persistLayout`) is debounced
 * upstream; this function is intentionally pure / synchronous so it can be
 * called from inside that debounce without further plumbing.
 *
 * Phase 1 status: this module is added but NOT yet wired. It's exercised by
 * tier-1 unit tests so the contract is locked in before Phase 3 mounts the
 * GroupPanel + GroupTab components and starts writing real innerBodies. The
 * Phase 5 layoutStore split flips `persistLayout` to consume the return of
 * `composePersistLayout()`.
 */

import type { GroupMeta, Layout } from '@/ipc/types';

/// Target schema version that `composePersistLayout` produces. Bumped to 3
/// in this module ahead of `LAYOUT_SCHEMA_VERSION` because compose is not
/// yet wired to the settings save path; phase 2 flips the canonical const
/// to 3 atomically with the migration code.
const COMPOSED_SCHEMA_VERSION = 3;

/// Source state for composition. Each field comes from a different place in
/// the runtime; bundling them here lets the unit tests cover composition in
/// isolation from the Pinia stores.
export interface ComposeSource {
  /// `outer.api.toJSON()` if the outer dockview is ready, else `undefined`.
  outer: unknown | undefined;
  /// Ordered group meta. Caller (groupsStore) is responsible for the
  /// `length >= 1` invariant; this function passes it through.
  groups: GroupMeta[];
  /// Id of the active group (persisted so next boot can re-activate the
  /// same outer body panel). MAY be null if there are no groups yet —
  /// composePersistLayout still emits the field as undefined in that case.
  activeGroupId?: string | null;
  /// Inner dockview JSON cached at the most recent layout-change for every
  /// group (mounted or not). Keys MAY be missing for never-yet-mounted
  /// groups; `composePersistLayout` does not synthesize empty bodies for
  /// them (so first-mount restore can detect "no saved body" cleanly).
  innerBodiesCache: Readonly<Record<string, unknown>>;
  /// Live inner api `toJSON()` results, keyed by group id. Overrides the
  /// cache for every mounted group at compose time. The caller is expected
  /// to walk `groupsStore.innerApis` and call `api.toJSON()` synchronously
  /// before invoking compose, so the override here is already a serialized
  /// snapshot.
  liveInnerBodies: Readonly<Record<string, unknown>>;
}

export function composePersistLayout(src: ComposeSource): Layout {
  const innerBodies: Record<string, unknown> = {};

  for (const g of src.groups) {
    const cached = src.innerBodiesCache[g.id];

    if (cached !== undefined) innerBodies[g.id] = cached;

    const live = src.liveInnerBodies[g.id];

    if (live !== undefined) innerBodies[g.id] = live;
  }

  const out: Layout = {
    schemaVersion: COMPOSED_SCHEMA_VERSION,
    outer: src.outer,
    groups: src.groups.map((g) => ({ ...g })),
    innerBodies,
  };

  if (src.activeGroupId) out.activeGroupId = src.activeGroupId;

  return out;
}
