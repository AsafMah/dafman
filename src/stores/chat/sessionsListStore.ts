// Cached list of CLI-side sessions (the durable session catalog, distinct
// from `sessionsStore` which tracks sessions currently open in panels).
// Drives the Sessions Manager edge panel: list by workspace, resume,
// delete. Refresh is explicit — the SDK doesn't yet emit a stream of
// session.created/deleted events we can subscribe to from the renderer,
// so we refetch on user actions and on app focus / panel mount.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import type { SessionMetadataSummary } from '@/ipc/types';
import { basename, shortPanelTitle } from '@/stores/shell/layoutUtils';
import { useToastStore } from '@/stores/app/toastStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useGroupsStore, extractPanelIdsFromBody } from '@/stores/shell/groupsStore';
import { toErrorMessage } from '@/lib/errorMessage';
import { usePersistedRef } from '@/composables/usePersistedRef';

// ─── View-state types ────────────────────────────────────────────────────────

export type GroupingMode = 'workspace' | 'dockview-group' | 'date-bucket' | 'flat';
export type SortField = 'modified' | 'created' | 'name' | 'activity';
export type SortDir = 'desc' | 'asc';

export interface SessionPaneViewState {
  grouping: GroupingMode;
  sortField: SortField;
  sortDir: SortDir;
  /// Ephemeral — `SessionsManager.vue` resets this to '' on mount.
  /// Included in the store so `grouped` can filter without the
  /// component post-processing the result (Option B1).
  searchQuery: string;
  colorByGroup: boolean;
}

const VIEW_STATE_DEFAULTS: SessionPaneViewState = {
  grouping: 'workspace',
  sortField: 'modified',
  sortDir: 'desc',
  searchQuery: '',
  colorByGroup: false,
};

const VALID_GROUPING: Record<string, true> = {
  workspace: true,
  'dockview-group': true,
  'date-bucket': true,
  flat: true,
};
const VALID_SORT_FIELD: Record<string, true> = {
  modified: true,
  created: true,
  name: true,
  activity: true,
};
const VALID_SORT_DIR: Record<string, true> = { desc: true, asc: true };

function validateViewState(parsed: unknown): SessionPaneViewState | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const v = parsed as Record<string, unknown>;

  return {
    grouping: VALID_GROUPING[v.grouping as string]
      ? (v.grouping as GroupingMode)
      : VIEW_STATE_DEFAULTS.grouping,
    sortField: VALID_SORT_FIELD[v.sortField as string]
      ? (v.sortField as SortField)
      : VIEW_STATE_DEFAULTS.sortField,
    sortDir: VALID_SORT_DIR[v.sortDir as string]
      ? (v.sortDir as SortDir)
      : VIEW_STATE_DEFAULTS.sortDir,
    searchQuery: '',
    colorByGroup:
      typeof v.colorByGroup === 'boolean' ? v.colorByGroup : VIEW_STATE_DEFAULTS.colorByGroup,
  };
}

// ─── Group shape ─────────────────────────────────────────────────────────────

export interface SessionGroup {
  kind: GroupingMode;
  /// Stable Vue key for the group.
  key: string;
  /// Human-readable label shown in the group header.
  label: string;
  /// Full workspace path (kind='workspace' only).
  path?: string;
  /// Dockview group hex color (kind='dockview-group' only).
  color?: string;
  sessions: SessionMetadataSummary[];
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSessionsListStore = defineStore('sessionsList', () => {
  const sessions = ref<SessionMetadataSummary[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  /// Set to `true` the first time `refresh()` is invoked so the
  /// component can render a "not yet loaded" empty state distinct
  /// from "loaded but empty".
  const hasLoaded = ref(false);

  const viewState = usePersistedRef('dafman.sessionPane.view', VIEW_STATE_DEFAULTS, {
    validate: validateViewState,
  });

  // Peer stores — called at the define-store level so reactive reads in
  // `grouped` establish proper dependencies without calling `use*()` inside
  // a watcher/computed (which can silently lose context in tests).
  const sessionsStore = useSessionsStore();
  const groupsStore = useGroupsStore();

  // ─── Internal helpers ──────────────────────────────────────────────

  function liveSessionMetadata(
    existing: SessionMetadataSummary | undefined,
    summary: string | undefined,
    cwd: string | undefined,
  ): Pick<Partial<SessionMetadataSummary>, 'summary' | 'cwd' | 'repository' | 'branch'> {
    const out: Pick<
      Partial<SessionMetadataSummary>,
      'summary' | 'cwd' | 'repository' | 'branch'
    > = {};

    if (summary) out.summary = summary;

    if (cwd) out.cwd = cwd;

    if (existing?.repository) out.repository = existing.repository;

    if (existing?.branch) out.branch = existing.branch;

    return out;
  }

  /// Resolve the best available display title for a session.
  /// Resolution order: live record title → catalog summary → short GUID.
  /// Mirrors `useSessionSelectors().displayTitle` but directly usable
  /// inside a store without creating a composable context.
  function resolveTitle(sessionId: string): string {
    const recordTitle = sessionsStore.getSession(sessionId)?.title?.trim();

    if (recordTitle) return recordTitle;

    const summary = sessions.value.find((s) => s.sessionId === sessionId)?.summary?.trim();

    if (summary) return summary;

    return shortPanelTitle(sessionId);
  }

  /// Map sessionId → dockview group id by walking the live inner-body
  /// caches. O(total panels) per call; computed reactively from `grouped`.
  function buildSessionGroupMap(): Map<string, string> {
    const map = new Map<string, string>();

    for (const g of groupsStore.groups) {
      const body = groupsStore.innerBodiesCache[g.id] ?? groupsStore.innerApis[g.id]?.toJSON();

      for (const sid of extractPanelIdsFromBody(body)) {
        map.set(sid, g.id);
      }
    }

    return map;
  }

  /// Map an ISO timestamp to a date-bucket label.
  function dateBucketLabel(iso: string): string {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) return 'Older';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    // Week start = Monday (ISO week). (getDay()+6)%7 gives 0=Mon … 6=Sun.
    const dayOfWeek = (today.getDay() + 6) % 7;
    const weekStart = new Date(today.getTime() - dayOfWeek * 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayTime = today.getTime();
    const dateTime = dateDay.getTime();

    if (dateTime === todayTime) return 'Today';

    if (dateTime === yesterday.getTime()) return 'Yesterday';

    if (dateTime >= weekStart.getTime()) return 'This week';

    if (dateTime >= monthStart.getTime()) return 'This month';

    return 'Older';
  }

  /// Compare two sessions for sorting within a group. Returns a value
  /// < 0 when `a` should come before `b`.
  function compareByField(
    a: SessionMetadataSummary,
    b: SessionMetadataSummary,
    field: SortField,
    dir: SortDir,
  ): number {
    const flip = dir === 'asc' ? -1 : 1;

    switch (field) {
      case 'modified':
        return b.modifiedTime.localeCompare(a.modifiedTime) * flip;

      case 'created':
        return b.startTime.localeCompare(a.startTime) * flip;

      case 'name': {
        const aTitle = resolveTitle(a.sessionId).toLowerCase();
        const bTitle = resolveTitle(b.sessionId).toLowerCase();

        // Baseline Z→A so flip=1(desc)→Z→A, flip=-1(asc)→A→Z —
        // consistent with the modified/created DESC baseline.
        return bTitle.localeCompare(aTitle) * flip;
      }

      case 'activity': {
        const aRec = sessionsStore.getSession(a.sessionId);
        const bRec = sessionsStore.getSession(b.sessionId);

        // 1. Thinking sessions always first (dir-independent).
        if (aRec?.isThinking && !bRec?.isThinking) return -1;

        if (!aRec?.isThinking && bRec?.isThinking) return 1;

        // 2. Open before closed (dir-independent).
        if (aRec && !bRec) return -1;

        if (!aRec && bRec) return 1;

        // 3. unseenTurns DESC; dir flips this sub-sort.
        const aUnseen = aRec?.unseenTurns ?? 0;
        const bUnseen = bRec?.unseenTurns ?? 0;
        const unseenCmp = (bUnseen - aUnseen) * flip;

        if (unseenCmp !== 0) return unseenCmp;

        // 4. Fallback to modifiedTime.
        return b.modifiedTime.localeCompare(a.modifiedTime) * flip;
      }
    }
  }

  /// Filter sessions by a trimmed, lowercased search query.
  /// OR-match: title, cwd, sessionId prefix, summary.
  function filterSessions(list: SessionMetadataSummary[], query: string): SessionMetadataSummary[] {
    const q = query.trim().toLowerCase();

    if (!q) return list;

    return list.filter((s) => {
      if (resolveTitle(s.sessionId).toLowerCase().includes(q)) return true;

      if (s.cwd?.toLowerCase().includes(q)) return true;

      if (s.sessionId.toLowerCase().startsWith(q)) return true;

      if (s.summary?.toLowerCase().includes(q)) return true;

      return false;
    });
  }

  // ─── Main grouped computed ─────────────────────────────────────────

  /// Ordered, filtered, grouped session list derived from `viewState`.
  /// Single source of truth — the component renders this directly.
  const grouped = computed<SessionGroup[]>(() => {
    const vs = viewState.value;
    const filtered = filterSessions(sessions.value, vs.searchQuery);

    // ── Build groups ──────────────────────────────────────────────────

    let groups: SessionGroup[];

    switch (vs.grouping) {
      case 'workspace': {
        const map = new Map<string, SessionMetadataSummary[]>();

        for (const session of filtered) {
          const key = session.cwd ?? '';
          const list = map.get(key) ?? [];

          list.push(session);
          map.set(key, list);
        }

        groups = [];

        for (const [key, list] of map.entries()) {
          groups.push({
            kind: 'workspace',
            key,
            label: key === '' ? 'No workspace' : basename(key) || key,
            path: key,
            sessions: list,
          });
        }

        break;
      }

      case 'dockview-group': {
        const sessionGroupMap = buildSessionGroupMap();
        const map = new Map<
          string,
          { label: string; color: string; sessions: SessionMetadataSummary[] }
        >();

        // Seed known groups so they appear even when empty (hidden by
        // the zero-sessions filter applied at render time).
        for (const g of groupsStore.groups) {
          map.set(g.id, { label: g.name, color: g.color, sessions: [] });
        }

        // Unassigned bucket for sessions with no known group.
        const UNASSIGNED = '__unassigned__';

        map.set(UNASSIGNED, { label: 'Unassigned', color: '', sessions: [] });

        for (const session of filtered) {
          const groupId = sessionGroupMap.get(session.sessionId) ?? UNASSIGNED;
          const bucket = map.get(groupId);

          if (bucket) {
            bucket.sessions.push(session);
          } else {
            // groupId was in sessionGroupMap but the group was deleted; fall back.
            map.get(UNASSIGNED)!.sessions.push(session);
          }
        }

        groups = [];

        for (const [key, bucket] of map.entries()) {
          if (bucket.sessions.length === 0) continue;

          groups.push({
            kind: 'dockview-group',
            key,
            label: bucket.label,
            color: bucket.color || undefined,
            sessions: bucket.sessions,
          });
        }

        break;
      }

      case 'date-bucket': {
        const BUCKET_ORDER = ['Today', 'Yesterday', 'This week', 'This month', 'Older'] as const;
        const map = new Map<string, SessionMetadataSummary[]>();

        for (const session of filtered) {
          const label = dateBucketLabel(
            vs.sortField === 'created' ? session.startTime : session.modifiedTime,
          );
          const list = map.get(label) ?? [];

          list.push(session);
          map.set(label, list);
        }

        groups = [];

        // Emit buckets in chronological order (Today first); skip empty.
        for (const label of BUCKET_ORDER) {
          const list = map.get(label);

          if (list && list.length > 0) {
            groups.push({ kind: 'date-bucket', key: label, label, sessions: list });
          }
        }

        // For asc direction, reverse the bucket order (Older → Today).
        if (vs.sortDir === 'asc') groups.reverse();

        break;
      }

      case 'flat': {
        groups = [
          {
            kind: 'flat',
            key: 'flat',
            label: '',
            sessions: [...filtered],
          },
        ];

        break;
      }
    }

    // ── Sort sessions within each group ───────────────────────────────

    for (const g of groups) {
      g.sessions.sort((a, b) => compareByField(a, b, vs.sortField, vs.sortDir));
    }

    // ── Sort groups (workspace + dockview-group only) ─────────────────
    // date-bucket order is already canonical; flat has one group.

    if (vs.grouping === 'workspace' || vs.grouping === 'dockview-group') {
      groups.sort((a, b) => {
        // Use the "best" session's sort timestamp to rank groups.
        const aTop = a.sessions[0];
        const bTop = b.sessions[0];

        if (!aTop) return 1;

        if (!bTop) return -1;

        return compareByField(aTop, bTop, vs.sortField, vs.sortDir);
      });
    }

    return groups;
  });

  // ─── Actions ──────────────────────────────────────────────────────────

  async function refresh(): Promise<void> {
    const toasts = useToastStore();

    isLoading.value = true;
    error.value = null;

    try {
      const list = await invokeCommand('listSessions', {});

      // Most-recently-modified first.
      sessions.value = [...list].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      hasLoaded.value = true;
    } catch (err) {
      const message = toErrorMessage(err);

      error.value = message;
      toasts.error('Failed to list sessions', message);
    } finally {
      isLoading.value = false;
    }
  }

  /// Keep the durable catalog visibly in sync with currently-open
  /// sessions. The SDK catalog refresh is still authoritative, but it
  /// is pull-based; create/rename/title events need an immediate local
  /// patch so the sidebar doesn't wait for a manual refresh.
  function upsertLiveSession(record: {
    id: string;
    title: string | null;
    workingDirectory: string | null;
  }): void {
    const existing = sessions.value.find((s) => s.sessionId === record.id);
    const now = new Date().toISOString();
    const summary = record.title?.trim() || existing?.summary;
    const cwd = record.workingDirectory ?? existing?.cwd;
    const next: SessionMetadataSummary = {
      sessionId: record.id,
      startTime: existing?.startTime ?? now,
      modifiedTime: now,
      isRemote: existing?.isRemote ?? false,
      ...liveSessionMetadata(existing, summary, cwd),
    };

    sessions.value = [next, ...sessions.value.filter((s) => s.sessionId !== record.id)].sort(
      (a, b) => b.modifiedTime.localeCompare(a.modifiedTime),
    );
  }

  /// Permanently delete the CLI-side session and drop it from the
  /// local cache. Refresh isn't strictly necessary because we mutate
  /// the cache optimistically, but we run it after the RPC succeeds
  /// to stay consistent with any out-of-band changes.
  async function deleteSession(sessionId: string): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('deleteSession', { sessionId });
      sessionsStore.markSessionDeleted(sessionId);
      sessions.value = sessions.value.filter((s) => s.sessionId !== sessionId);
      toasts.success('Session deleted', sessionId.slice(0, 8));
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to delete session', message);
      throw err;
    }
  }

  /// Best-effort lookup over the catalog (closed sessions included).
  /// Used by the fork-notice chip when the referenced session isn't
  /// loaded yet — we resolve from the listSessions catalog and tell
  /// the caller to restore it. Matches: summary exact / startsWith /
  /// 4+ hex prefix on sessionId (covers default "Session <id8>" fork
  /// names).
  function findByName(name: string): SessionMetadataSummary | undefined {
    if (!name) return undefined;

    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    const all = sessions.value;
    const exact = all.find((s) => (s.summary ?? '').toLowerCase() === lower);

    if (exact) return exact;

    const starts = all.find((s) => (s.summary ?? '').toLowerCase().startsWith(lower));

    if (starts) return starts;

    const m = trimmed.match(/([0-9a-f]{4,})/i);

    if (m && m[1]) {
      const prefix = m[1].toLowerCase();
      const byId = all.find((s) => s.sessionId.toLowerCase().startsWith(prefix));

      if (byId) return byId;
    }

    return undefined;
  }

  return {
    sessions,
    isLoading,
    error,
    hasLoaded,
    viewState,
    grouped,
    refresh,
    upsertLiveSession,
    deleteSession,
    findByName,
  };
});
