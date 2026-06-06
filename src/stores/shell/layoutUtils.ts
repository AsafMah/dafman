/// Pure panel-title utilities and shared option interfaces extracted from
/// layoutStore.ts. No Pinia / Vue reactivity — safe to import anywhere.

/// Short panel title from a session id. The CLI emits `session.title_changed`
/// when the model summarizes the conversation; until then the tab shows
/// the first 8 chars of the session id so each pane is identifiable.
export function shortPanelTitle(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId;
}

/// Returns the last path segment of a Unix or Windows absolute path.
/// Empty / whitespace input → "". Trailing slashes are tolerated so
/// "C:\\repo\\dafman\\" and "C:\\repo\\dafman" produce the same result.
export function basename(path: string | null | undefined): string {
  if (!path) return '';

  const trimmed = path.trim().replace(/[\\/]+$/, '');

  if (!trimmed) return '';

  const match = trimmed.match(/[\\/]([^\\/]+)$/);

  return match ? match[1] : trimmed;
}

/// Composes the dockview tab title. We deliberately keep tabs short
/// — workspace shows up in the per-session controls (chat tab strip
/// right actions), so duplicating it in the tab title makes the label
/// very long for no extra info. SDK-supplied title preferred; fall
/// back to a shortened session id.
///
/// (Used to also take a `workingDirectory` so an earlier design could
/// prefix the folder; that approach was dropped — the param is gone
/// now. If we re-introduce folder-prefixed titles, add an options bag
/// rather than a positional arg.)
export function composePanelTitle(sessionId: string, title: string | null): string {
  if (title) return title;

  return shortPanelTitle(sessionId);
}

export interface EdgePanelOptions {
  /// Unique panel id (used by `getPanel` for toggle behaviour).
  id: string;
  /// Registered component name (named template slot in App.vue).
  component: string;
  /// Optional dockview tab-component name. Sidebar / edge-group panels
  /// usually want the slimmer `sidebarTab` instead of the session-styled
  /// `chatTab` default.
  tabComponent?: string;
  /// Tab title (visible on the panel's tab).
  title?: string;
  /// Arbitrary panel params forwarded to the component slot.
  params?: Record<string, unknown>;
  /// Initial size of the edge group along its main axis (px). Only
  /// applied when the edge group is being created for the first time.
  initialSize?: number;
  /// Minimum size of the edge group along its main axis (px). Below
  /// this, the user-drag sash bottoms out. Defaults to dockview's
  /// own fallback (`collapsedSize + 50`) when omitted.
  minimumSize?: number;
  /// When true, closes sibling panels in the same edge group before
  /// opening this one. Used by the activity-bar left rail so only one
  /// sidebar button can be active at a time.
  exclusive?: boolean;
}
