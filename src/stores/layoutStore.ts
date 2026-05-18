// Owns the dockview-vue API instance and bridges session lifecycle into
// panel lifecycle. The api is captured on `<DockviewVue @ready>`; the
// rest of the app calls `addPanel(sessionId)` / `removePanel(sessionId)`
// rather than reaching into dockview directly.
//
// **Convention:** any new persistent UI surface (recent-sessions picker,
// permission queue, MCP server status, log viewer, BYOK editor, …)
// should be a dockview panel — never new chrome around dockview. Use
// `openEdgePanel(position, options)` for sidebars/statusbars and
// `addPanel(...)` for tab-bar items. Edge group sizes + visibility are
// serialized into the layout JSON for free.

import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  DockviewApi,
  EdgeGroupPosition,
} from "dockview-core";

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
  if (!path) return "";
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
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
export function composePanelTitle(
  sessionId: string,
  title: string | null,
): string {
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
}

export const useLayoutStore = defineStore("layout", () => {
  const api = ref<DockviewApi | null>(null);

  function setApi(next: DockviewApi | null): void {
    api.value = next;
  }

  // ---------- Chat panels (one per session) ----------

  function addPanel(
    sessionId: string,
    opts: { title?: string; targetGroupId?: string } = {},
  ): void {
    const dock = api.value;
    if (!dock) return;
    if (dock.getPanel(sessionId)) return;
    // When `targetGroupId` is provided (e.g. replacing an orphan panel
    // inline) we drop the new panel as a tab inside that group.
    // Otherwise we tile: a new group to the right of the active *body*
    // group. If no body group exists at all (the only thing on screen
    // is the Sessions sidebar), we explicitly create one so the panel
    // doesn't end up tabbed inside the edge group.
    let referenceGroup = opts.targetGroupId ?? firstBodyGroupId();
    if (!referenceGroup) {
      const body = dock.addGroup();
      referenceGroup = body.id;
    }
    dock.addPanel({
      id: sessionId,
      component: "chat",
      title: opts.title ?? shortPanelTitle(sessionId),
      params: { sessionId },
      position: {
        referenceGroup,
        direction: opts.targetGroupId ? "within" : "right",
      },
    });
  }

  /// Returns the id of the active group when it lives inside the grid
  /// body, or — if the active group is an edge / floating / popout —
  /// the first body group we find. Returns undefined when no body
  /// group exists yet (first panel ever; dockview will use default
  /// placement).
  function firstBodyGroupId(): string | undefined {
    const dock = api.value;
    if (!dock) return undefined;
    const active = dock.activeGroup;
    if (active && active.model.location.type === "grid") return active.id;
    for (const group of dock.groups) {
      if (group.model.location.type === "grid") return group.id;
    }
    return undefined;
  }

  /// One-shot cleanup: scans every panel and moves any chat panels
  /// (component === "chat") that are stuck inside an edge group out
  /// to the body. Runs once after layout restore to recover from
  /// older bugs that let chat panels land in the Sessions sidebar.
  ///
  /// Uses `panel.api.moveTo({ group })` so the panel keeps its state;
  /// creates a fresh body group when none exists.
  function rescueChatPanelsFromEdgeGroups(): void {
    const dock = api.value;
    if (!dock) return;
    const stuck: Array<{ panelId: string }> = [];
    for (const group of dock.groups) {
      if (group.model.location.type === "grid") continue;
      for (const panel of group.panels) {
        if (panel.api.component === "chat") {
          stuck.push({ panelId: panel.api.id });
        }
      }
    }
    if (stuck.length === 0) return;
    let bodyGroupId = firstBodyGroupId();
    if (!bodyGroupId) {
      const body = dock.addGroup();
      bodyGroupId = body.id;
    }
    const target = dock.getGroup(bodyGroupId);
    if (!target) return;
    for (const { panelId } of stuck) {
      const panel = dock.getPanel(panelId);
      // `moveTo` takes the concrete DockviewGroupPanel class but
      // `dock.getGroup()` is typed as IDockviewGroupPanel here. The
      // runtime value is the same instance; cast through unknown.
      if (panel) {
        panel.api.moveTo({
          group: target as unknown as Parameters<typeof panel.api.moveTo>[0]["group"],
        });
      }
    }
  }

  /// Swaps an orphan panel (a session that failed to resume on
  /// restore) for a freshly-created session, in-place: the new panel
  /// lands in the same group as the orphan and the orphan is removed.
  /// Returns `true` if the swap happened (orphan was found).
  function replaceMissingPanel(orphanId: string, newSessionId: string): boolean {
    const dock = api.value;
    if (!dock) return false;
    const orphan = dock.getPanel(orphanId);
    if (!orphan) return false;
    const groupId = orphan.api.group.id;
    addPanel(newSessionId, { targetGroupId: groupId });
    dock.removePanel(orphan);
    return true;
  }

  function removePanel(sessionId: string): void {
    const dock = api.value;
    if (!dock) return;
    const panel = dock.getPanel(sessionId);
    if (panel) dock.removePanel(panel);
  }

  function renamePanel(sessionId: string, title: string): void {
    const dock = api.value;
    if (!dock) return;
    const panel = dock.getPanel(sessionId);
    if (panel) panel.api.setTitle(title);
  }

  // ---------- Edge-group panels (sidebars / status bars) ----------
  //
  // Future side surfaces (Recent Sessions, Permission queue, Log viewer,
  // MCP status, …) plug in here. Each registered component (template
  // slot on `<DockviewVue>`) becomes openable at left/right/top/bottom.

  /// Opens (or focuses) a panel inside an edge group at the given
  /// position. The edge group is created lazily on first call.
  ///
  /// If an existing edge group at this position is below `initialSize`
  /// (e.g. the user dragged it to a sliver, or a previous close left
  /// it collapsed), we tear it down and recreate at the requested size.
  /// Without this, "close → reopen" produces a tiny strip.
  function openEdgePanel(
    position: EdgeGroupPosition,
    options: EdgePanelOptions,
  ): void {
    const dock = api.value;
    if (!dock) return;
    const existing = dock.getPanel(options.id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const existingGroup = dock.getEdgeGroup(position);
    if (existingGroup && options.initialSize !== undefined) {
      // dockview-vue's EdgeGroupApi exposes `width` / `height` via the
      // underlying group element. Read defensively — if the property
      // shape changes we just skip the resize check and use the
      // existing group as-is.
      const w =
        position === "left" || position === "right"
          ? (existingGroup as unknown as { width?: number }).width
          : (existingGroup as unknown as { height?: number }).height;
      if (typeof w === "number" && w < Math.max(40, options.initialSize / 2)) {
        dock.removeEdgeGroup(position);
      }
    }
    const edge =
      dock.getEdgeGroup(position) ??
      dock.addEdgeGroup(position, {
        id: `edge-${position}`,
        ...(options.initialSize !== undefined
          ? { initialSize: options.initialSize }
          : {}),
        ...(options.minimumSize !== undefined
          ? { minimumSize: options.minimumSize }
          : {}),
      });
    dock.addPanel({
      id: options.id,
      component: options.component,
      title: options.title ?? options.id,
      params: options.params ?? {},
      ...(options.tabComponent ? { tabComponent: options.tabComponent } : {}),
      position: { referenceGroup: edge.id },
    });
  }

  /// Removes the edge group at `position` if the given group id matches
  /// and the group is now empty. Returns true if we cleaned up. Used by
  /// `onDidRemovePanel` handlers so closing a sidebar panel via
  /// dockview's own X (which doesn't go through `closePanel`) still
  /// tears down the parent shell so the next open gets a fresh
  /// `initialSize`.
  function pruneEmptyEdgeGroup(groupId: string): boolean {
    const dock = api.value;
    if (!dock) return false;
    for (const pos of ["left", "right", "top", "bottom"] as const) {
      const edge = dock.getEdgeGroup(pos);
      if (!edge) continue;
      if ((edge as unknown as { id?: string }).id !== groupId) continue;
      const panels = (edge as unknown as { panels?: unknown[] }).panels;
      if (Array.isArray(panels) && panels.length === 0) {
        dock.removeEdgeGroup(pos);
        return true;
      }
      return false;
    }
    return false;
  }

  /// Returns `true` if a panel with the given id is currently in the
  /// dockview tree. Used by toggle-style toolbar buttons (Sessions
  /// Manager, Library, …) to decide between open/close.
  function isPanelOpen(id: string): boolean {
    const dock = api.value;
    if (!dock) return false;
    return !!dock.getPanel(id);
  }

  /// Closes (removes) a panel by id, and also tears down the parent
  /// edge group if removing this panel leaves it empty. Removing the
  /// empty group means the *next* `openEdgePanel` call recreates at
  /// the configured `initialSize` instead of inheriting a residual
  /// collapsed size. Idempotent for unknown ids.
  function closePanel(id: string): void {
    const dock = api.value;
    if (!dock) return;
    const panel = dock.getPanel(id);
    if (!panel) return;
    const group = panel.api.group;
    const wasLastInGroup = group.panels.length <= 1;
    dock.removePanel(panel);
    // If the group it lived in is now empty *and* it's an edge group,
    // remove it so size persistence resets. Body groups are left for
    // dockview to clean up on its own — body layout is the user's
    // grid and we don't want to collapse adjacent panels.
    if (wasLastInGroup) {
      for (const pos of ["left", "right", "top", "bottom"] as const) {
        const edge = dock.getEdgeGroup(pos);
        if (edge && (edge as unknown as { id?: string }).id === group.id) {
          dock.removeEdgeGroup(pos);
          break;
        }
      }
    }
  }

  /// Toggles edge-group visibility (e.g. collapse/expand a sidebar
  /// without destroying its contents).
  function toggleEdgeGroup(position: EdgeGroupPosition): void {
    const dock = api.value;
    if (!dock) return;
    if (!dock.getEdgeGroup(position)) return;
    dock.setEdgeGroupVisible(position, !dock.isEdgeGroupVisible(position));
  }

  // ---------- Layout serialization (persistence) ----------

  /// Returns dockview's full serialized layout, or null when the api
  /// isn't ready yet. Callers (settingsStore writers) treat this as an
  /// opaque blob — only dockview interprets it.
  function snapshot(): unknown | null {
    return api.value?.toJSON() ?? null;
  }

  /// Restores a previously-snapshotted layout. Caller is responsible
  /// for ensuring any session-backed panels referenced by the layout
  /// have been resumed first (so the slot can find their record).
  function restore(layout: unknown): void {
    const dock = api.value;
    if (!dock || !layout || typeof layout !== "object") return;
    dock.fromJSON(layout as Parameters<DockviewApi["fromJSON"]>[0]);
  }

  return {
    api,
    setApi,
    addPanel,
    removePanel,
    renamePanel,
    replaceMissingPanel,
    openEdgePanel,
    isPanelOpen,
    closePanel,
    pruneEmptyEdgeGroup,
    rescueChatPanelsFromEdgeGroups,
    toggleEdgeGroup,
    firstBodyGroupId,
    snapshot,
    restore,
  };
});
