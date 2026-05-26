import { describe, expect, test } from 'bun:test';
import { composePersistLayout, type ComposeSource } from '@/lib/composePersistLayout';
import type { GroupMeta } from '@/ipc/types';

const G1: GroupMeta = { id: 'g1', name: 'One', color: '#3b82f6' };
const G2: GroupMeta = { id: 'g2', name: 'Two', color: '#f59e0b' };
const G3: GroupMeta = { id: 'g3', name: 'Three', color: '#10b981' };

function compose(partial: Partial<ComposeSource> = {}): ReturnType<typeof composePersistLayout> {
  return composePersistLayout({
    outer: { grid: { root: {} } },
    groups: [],
    innerBodiesCache: {},
    liveInnerBodies: {},
    ...partial,
  });
}

describe('composePersistLayout', () => {
  test('writes the v3 schema version', () => {
    const out = compose();
    expect(out.schemaVersion).toBe(3);
  });

  test('copies outer through unchanged (opaque blob)', () => {
    const outer = { grid: { root: { type: 'branch', data: [] }, width: 1, height: 1 } };
    const out = compose({ outer });
    expect(out.outer).toBe(outer);
  });

  test('groups are cloned, not aliased (defensive copy at compose time)', () => {
    const out = compose({ groups: [G1, G2] });
    expect(out.groups).toEqual([G1, G2]);
    // Each entry is a fresh object so callers can mutate the source without
    // corrupting the persisted layout.
    expect(out.groups?.[0]).not.toBe(G1);
    expect(out.groups?.[1]).not.toBe(G2);
  });

  test('cache-first: unmounted groups keep their cached body', () => {
    const cachedG2 = { kind: 'cached-g2-body' };
    const cachedG3 = { kind: 'cached-g3-body' };
    const out = compose({
      groups: [G1, G2, G3],
      innerBodiesCache: { g2: cachedG2, g3: cachedG3 },
      liveInnerBodies: { g1: { kind: 'live-g1-body' } },
    });
    expect(out.innerBodies).toEqual({
      g1: { kind: 'live-g1-body' },
      g2: cachedG2,
      g3: cachedG3,
    });
  });

  test('live overrides cache when both are present (rubber-duck rule #5)', () => {
    const cached = { kind: 'stale-cache' };
    const live = { kind: 'fresh-live' };
    const out = compose({
      groups: [G1],
      innerBodiesCache: { g1: cached },
      liveInnerBodies: { g1: live },
    });
    expect(out.innerBodies?.g1).toBe(live);
  });

  test('group with neither cache nor live entry is absent from innerBodies', () => {
    const out = compose({ groups: [G1, G2], innerBodiesCache: {}, liveInnerBodies: {} });
    expect(out.innerBodies).toEqual({});
  });

  test('cache entries for groups not in the meta list are dropped', () => {
    const out = compose({
      groups: [G1],
      innerBodiesCache: { g1: { live: 1 }, 'g-orphan': { ghost: 1 } },
      liveInnerBodies: {},
    });
    expect(out.innerBodies).toEqual({ g1: { live: 1 } });
    expect(Object.keys(out.innerBodies ?? {})).not.toContain('g-orphan');
  });

  test('output is a fresh object — no aliasing of source records', () => {
    const cache = { g1: { v: 1 } };
    const live = { g1: { v: 2 } };
    const out = compose({ groups: [G1], innerBodiesCache: cache, liveInnerBodies: live });
    expect(out.innerBodies).not.toBe(cache);
    expect(out.innerBodies).not.toBe(live);
    // Group entries pass through by reference (opaque blobs), which is fine
    // because callers serialize via api.toJSON immediately before compose.
    expect(out.innerBodies?.g1).toBe(live.g1);
  });
});
