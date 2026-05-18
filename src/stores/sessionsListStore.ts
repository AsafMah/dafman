// Cached list of CLI-side sessions (the durable session catalog, distinct
// from `sessionsStore` which tracks sessions currently open in panels).
// Drives the Sessions Manager edge panel: list by workspace, resume,
// delete. Refresh is explicit — the SDK doesn't yet emit a stream of
// session.created/deleted events we can subscribe to from the renderer,
// so we refetch on user actions and on app focus / panel mount.

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invokeCommand } from "../ipc/invoke";
import type { SessionMetadataSummary } from "../ipc/types";
import { useToastStore } from "./toastStore";

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

function basename(path: string | undefined | null): string {
  if (!path) return "";
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  const match = trimmed.match(/[\\/]([^\\/]+)$/);
  return match ? match[1] : trimmed;
}

export const useSessionsListStore = defineStore("sessionsList", () => {
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
      const list = await invokeCommand("listSessions", {});
      // Most-recently-modified first.
      sessions.value = [...list].sort((a, b) =>
        b.modifiedTime.localeCompare(a.modifiedTime),
      );
      hasLoaded.value = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      error.value = message;
      toasts.error("Failed to list sessions", message);
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
      await invokeCommand("deleteSession", { sessionId });
      sessions.value = sessions.value.filter(
        (s) => s.sessionId !== sessionId,
      );
      toasts.success("Session deleted", sessionId.slice(0, 8));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to delete session", message);
      throw err;
    }
  }

  /// Groups the cached list by workspace path. The "no workspace"
  /// bucket comes last; named workspaces are sorted alphabetically by
  /// basename (case-insensitive). Sessions within a group keep the
  /// modifiedTime DESC ordering established in `refresh`.
  const grouped = computed<WorkspaceGroup[]>(() => {
    const map = new Map<string, SessionMetadataSummary[]>();
    for (const session of sessions.value) {
      const key = session.cwd ?? "";
      const list = map.get(key) ?? [];
      list.push(session);
      map.set(key, list);
    }
    const named: WorkspaceGroup[] = [];
    let noWorkspace: WorkspaceGroup | null = null;
    for (const [key, list] of map.entries()) {
      if (key === "") {
        noWorkspace = {
          key: "",
          label: "No workspace",
          path: "",
          sessions: list,
        };
      } else {
        named.push({
          key,
          label: basename(key) || key,
          path: key,
          sessions: list,
        });
      }
    }
    named.sort((a, b) =>
      a.label.toLowerCase().localeCompare(b.label.toLowerCase()),
    );
    return noWorkspace ? [...named, noWorkspace] : named;
  });

  return {
    sessions,
    isLoading,
    error,
    hasLoaded,
    grouped,
    refresh,
    deleteSession,
  };
});
