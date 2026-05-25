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
import { basename } from '@/stores/shell/layoutStore';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

export interface WorkspaceGroup {
  /// Stable key for the group — full workspace path, or "" for the
  /// "no workspace" bucket. Used as Vue keys.
  key: string;
  /// Display label — basename of the path, or "No workspace" for "".
  label: string;
  /// Full path tooltip (mirrors `key` for non-empty groups; empty for "").
  path: string;
  sessions: SessionMetadataSummary[];
}

export const useSessionsListStore = defineStore('sessionsList', () => {
  const sessions = ref<SessionMetadataSummary[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  /// Set to `true` the first time `refresh()` is invoked so the
  /// component can render a "not yet loaded" empty state distinct
  /// from "loaded but empty".
  const hasLoaded = ref(false);

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

  /// Permanently delete the CLI-side session and drop it from the
  /// local cache. Refresh isn't strictly necessary because we mutate
  /// the cache optimistically, but we run it after the RPC succeeds
  /// to stay consistent with any out-of-band changes.
  async function deleteSession(sessionId: string): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('deleteSession', { sessionId });
      sessions.value = sessions.value.filter((s) => s.sessionId !== sessionId);
      toasts.success('Session deleted', sessionId.slice(0, 8));
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to delete session', message);
      throw err;
    }
  }

  /// Groups the cached list by workspace path. Groups are ordered by
  /// their most-recently-modified session (descending) — so the
  /// workspace you touched last is at the top, matching how the
  /// sessions themselves are sorted within each group. The "no
  /// workspace" bucket interleaves naturally by recency rather than
  /// being pinned to the bottom.
  ///
  /// Search / explicit sort modes will land later; this is the simple
  /// MRU default.
  const grouped = computed<WorkspaceGroup[]>(() => {
    const map = new Map<string, SessionMetadataSummary[]>();

    for (const session of sessions.value) {
      const key = session.cwd ?? '';
      const list = map.get(key) ?? [];

      list.push(session);
      map.set(key, list);
    }

    const groups: WorkspaceGroup[] = [];

    for (const [key, list] of map.entries()) {
      groups.push({
        key,
        label: key === '' ? 'No workspace' : basename(key) || key,
        path: key,
        sessions: list,
      });
    }

    // Each group's `sessions[0]` is the newest (sessions are pre-sorted
    // DESC in `refresh`). String-compare ISO 8601 timestamps for the
    // group ordering — lexical order matches chronological order for
    // well-formed ISO strings.
    groups.sort((a, b) => {
      const aLatest = a.sessions[0]?.modifiedTime ?? '';
      const bLatest = b.sessions[0]?.modifiedTime ?? '';

      return bLatest.localeCompare(aLatest);
    });

    return groups;
  });

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
    grouped,
    refresh,
    deleteSession,
    findByName,
  };
});
