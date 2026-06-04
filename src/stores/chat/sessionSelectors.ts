// Derived reads of a session's display title + status.
//
// A session's title/status historically lived in three hand-synced
// places (the open `SessionRecord`, the durable sidebar catalog
// `summary`, and the dockview panel title persisted in the layout
// JSON). Every "X didn't update when the session was renamed/deleted"
// bug (#129, #131, #133, #134) was a missed propagation between them.
//
// These selectors collapse the read to a single resolution order so
// every surface — tab, sidebar, details rail — can DERIVE the title
// instead of holding a copy that someone has to remember to sync. The
// open `SessionRecord` is the owner (AGENTS.md: "the runtime source of
// truth"); the catalog summary is the fallback for sessions that
// aren't currently open; the short GUID is the last resort before any
// title exists. See issue #149.

import { shortPanelTitle } from '@/stores/shell/layoutStore';
import { useSessionsStore } from './sessionsStore';
import { useSessionsListStore } from './sessionsListStore';

export interface SessionStatus {
  /// Agent is mid-turn (between turn_start/turn_end).
  isThinking: boolean;
  /// Completed turns the user hasn't seen on this panel.
  unseenTurns: number;
  /// CLI-side session was permanently deleted while still open.
  isDeleted: boolean;
}

export interface SessionSelectors {
  displayTitle: (sessionId: string) => string;
  sessionStatus: (sessionId: string) => SessionStatus;
}

/// Pinia stores are resolved once per call; both reads below touch
/// reactive state (the record map / the catalog list), so a selector
/// invoked inside a `computed` or template re-evaluates when the owner
/// changes — that reactive follow-through is the whole point.
export function useSessionSelectors(): SessionSelectors {
  const sessions = useSessionsStore();
  const catalog = useSessionsListStore();

  function displayTitle(sessionId: string): string {
    const recordTitle = sessions.getSession(sessionId)?.title?.trim();

    if (recordTitle) return recordTitle;

    const summary = catalog.sessions.find((s) => s.sessionId === sessionId)?.summary?.trim();

    if (summary) return summary;

    return shortPanelTitle(sessionId);
  }

  function sessionStatus(sessionId: string): SessionStatus {
    const record = sessions.getSession(sessionId);

    return {
      isThinking: record?.isThinking ?? false,
      unseenTurns: record?.unseenTurns ?? 0,
      isDeleted: record?.isDeleted ?? false,
    };
  }

  return { displayTitle, sessionStatus };
}
