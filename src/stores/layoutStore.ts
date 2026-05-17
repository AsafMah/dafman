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

export interface EdgePanelOptions {
  /// Unique panel id (used by `getPanel` for toggle behaviour).
  id: string;
  /// Registered component name (named template slot in App.vue).
  component: string;
  /// Tab title (visible on the panel's tab).
  title?: string;
  /// Arbitrary panel params forwarded to the component slot.
  params?: Record<string, unknown>;
  /// Initial size of the edge group along its main axis (px). Only
  /// applied when the edge group is being created for the first time.
  initialSize?: number;
}

export const useLayoutStore = defineStore("layout", () => {
  const api = ref<DockviewApi | null>(null);

  function setApi(next: DockviewApi | null): void {
    api.value = next;
  }

  // ---------- Chat panels (one per session) ----------

  function addPanel(sessionId: string, title?: string): void {
    const dock = api.value;
    if (!dock) return;
    if (dock.getPanel(sessionId)) return;
    dock.addPanel({
      id: sessionId,
      component: "chat",
      title: title ?? shortPanelTitle(sessionId),
      params: { sessionId },
    });
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
    const edge =
      dock.getEdgeGroup(position) ??
      dock.addEdgeGroup(position, {
        id: `edge-${position}`,
        ...(options.initialSize !== undefined
          ? { initialSize: options.initialSize }
          : {}),
      });
    dock.addPanel({
      id: options.id,
      component: options.component,
      title: options.title ?? options.id,
      params: options.params ?? {},
      position: { referenceGroup: edge.id },
    });
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
    openEdgePanel,
    toggleEdgeGroup,
    snapshot,
    restore,
  };
});
