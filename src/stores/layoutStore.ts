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

/// Singleton id for the right-edge session details rail. One rail at
/// a time, bound to `activeSessionId` so switching chat tabs swaps the
/// rail's content rather than spawning a new panel per session.
const SESSION_DETAILS_PANEL_ID = "session-details";
const SESSIONS_PANEL_ID = "sessions-manager";
const SETTINGS_PANEL_ID = "settings-panel";
const LIBRARY_PANEL_ID = "library";
const JOBS_PANEL_ID = "jobs-panel";
const TERMINALS_PANEL_ID = "terminals-panel";
const LOG_VIEWER_PANEL_ID = "log-viewer";
const SESSION_DETAILS_MIN_WIDTH = 380;
const LEFT_EDGE_MIN_BY_PANEL_ID: Record<string, number> = {
  [SESSIONS_PANEL_ID]: 180,
  [SETTINGS_PANEL_ID]: 380,
  [LIBRARY_PANEL_ID]: 320,
  [JOBS_PANEL_ID]: 380,
  [TERMINALS_PANEL_ID]: 320,
  [LOG_VIEWER_PANEL_ID]: 420,
};
const EDGE_PANEL_DEFINITIONS: Record<
  string,
  Omit<EdgePanelOptions, "exclusive">
> = {
  [SESSIONS_PANEL_ID]: {
    id: SESSIONS_PANEL_ID,
    component: "sessionsManager",
    tabComponent: "sidebarTab",
    title: "Sessions",
    initialSize: 260,
    minimumSize: 180,
  },
  [SETTINGS_PANEL_ID]: {
    id: SETTINGS_PANEL_ID,
    component: "settingsPanel",
    tabComponent: "sidebarTab",
    title: "Settings",
    initialSize: 400,
    minimumSize: 380,
  },
  [LIBRARY_PANEL_ID]: {
    id: LIBRARY_PANEL_ID,
    component: "library",
    tabComponent: "sidebarTab",
    title: "Library — MCP servers + Tools + Skills + Agents + Instructions",
    initialSize: 360,
    minimumSize: 320,
  },
  [JOBS_PANEL_ID]: {
    id: JOBS_PANEL_ID,
    component: "jobsPanel",
    tabComponent: "sidebarTab",
    title: "Jobs",
    initialSize: 380,
    minimumSize: 380,
  },
  [TERMINALS_PANEL_ID]: {
    id: TERMINALS_PANEL_ID,
    component: "terminalsPanel",
    tabComponent: "sidebarTab",
    title: "Terminals — running shells",
    initialSize: 360,
    minimumSize: 320,
  },
  [LOG_VIEWER_PANEL_ID]: {
    id: LOG_VIEWER_PANEL_ID,
    component: "logViewer",
    tabComponent: "sidebarTab",
    title: "Diagnostics — live log + bundle export",
    initialSize: 480,
    minimumSize: 420,
  },
  [SESSION_DETAILS_PANEL_ID]: {
    id: SESSION_DETAILS_PANEL_ID,
    component: "sessionDetails",
    tabComponent: "sidebarTab",
    title: "Session",
    initialSize: SESSION_DETAILS_MIN_WIDTH,
    minimumSize: SESSION_DETAILS_MIN_WIDTH,
  },
};

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
  /// When true, closes sibling panels in the same edge group before
  /// opening this one. Used by the activity-bar left rail so only one
  /// sidebar button can be active at a time.
  exclusive?: boolean;
}

export const useLayoutStore = defineStore("layout", () => {
  const api = ref<DockviewApi | null>(null);
  /// Reactive id of the currently-focused chat panel, or `null` when no
  /// chat panel is active (focus on Sessions sidebar, Settings, dev
  /// playground, or nothing at all). Subscribers on dockview's
  /// `onDidActiveGroupChange` / `onDidActivePanelChange` keep this in
  /// sync; consumers (command palette `when()` predicates, future
  /// status-bar bindings, …) just read the ref.
  const activeSessionId = ref<string | null>(null);
  /// Reactive flag for the singleton session-details right-rail
  /// panel. Kept in sync via `onDidAddPanel` / `onDidRemovePanel`.
  /// Unlike the old per-session set, only one rail exists at a time
  /// — it reads its current session from `activeSessionId` and
  /// re-binds when the user switches chat tabs.
  const detailsOpen = ref<boolean>(false);
  const lastSessionDetailsWidth = ref<number>(SESSION_DETAILS_MIN_WIDTH);
  let activeUnsubs: Array<() => void> = [];

  function panelId(panel: unknown): string | null {
    const api = (panel as { api?: { id?: unknown } }).api;
    if (typeof api?.id === "string") return api.id;
    const flat = (panel as { id?: unknown }).id;
    return typeof flat === "string" ? flat : null;
  }

  function edgePanels(edge: unknown): unknown[] {
    const panels = (edge as { panels?: unknown[] }).panels;
    return Array.isArray(panels) ? panels : [];
  }

  function edgeId(edge: unknown): string | null {
    const id = (edge as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }

  function edgePanelsFromDock(edge: unknown): unknown[] {
    const direct = edgePanels(edge);
    if (direct.length > 0) return direct;
    const id = edgeId(edge);
    const dock = api.value;
    if (!id || !dock) return [];
    const group = dock.groups.find((g) => g.id === id);
    if (!group) return [];
    const panels = (group as unknown as { panels?: unknown[] }).panels;
    return Array.isArray(panels) ? panels : [];
  }

  function minimumForEdgeGroup(
    position: EdgeGroupPosition,
    edge: unknown,
  ): number | undefined {
    if (position === "right") {
      return edgePanelsFromDock(edge).some((panel) => panelId(panel) === SESSION_DETAILS_PANEL_ID)
        ? SESSION_DETAILS_MIN_WIDTH
        : undefined;
    }
    if (position !== "left") return undefined;
    let min: number | undefined;
    for (const panel of edgePanelsFromDock(edge)) {
      const id = panelId(panel);
      if (!id) continue;
      const candidate = LEFT_EDGE_MIN_BY_PANEL_ID[id];
      if (candidate === undefined) continue;
      min = Math.max(min ?? 0, candidate);
    }
    return min;
  }

  function applyEdgeMinimum(
    position: EdgeGroupPosition,
    minimumSize: number | undefined,
  ): void {
    const edge = api.value?.getEdgeGroup(position);
    if (!edge || minimumSize === undefined) return;
    const effectiveMinimum = effectiveEdgeMinimum(position, minimumSize);
    const edgeApi = edge as unknown as {
      width?: number;
      height?: number;
      setSize?: (value: { width?: number; height?: number }) => void;
      setConstraints?: (value: { minimumWidth?: number; minimumHeight?: number }) => void;
    };
    if (typeof edgeApi.setConstraints === "function") {
      if (position === "left" || position === "right") {
        edgeApi.setConstraints.call(edge, { minimumWidth: effectiveMinimum });
      } else {
        edgeApi.setConstraints.call(edge, { minimumHeight: effectiveMinimum });
      }
    }
    const current =
      position === "left" || position === "right" ? edgeApi.width : edgeApi.height;
    if (
      typeof current === "number" &&
      current < effectiveMinimum &&
      typeof edgeApi.setSize === "function"
    ) {
      if (position === "left" || position === "right") {
        edgeApi.setSize.call(edge, { width: effectiveMinimum });
      } else {
        edgeApi.setSize.call(edge, { height: effectiveMinimum });
      }
    }
  }

  function effectiveEdgeMinimum(
    position: EdgeGroupPosition,
    desired: number,
  ): number {
    const dock = api.value;
    const viewportWidth = typeof window === "undefined" ? undefined : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? undefined : window.innerHeight;
    const available =
      position === "left" || position === "right"
        ? (dock as unknown as { width?: number } | null)?.width ?? viewportWidth
        : (dock as unknown as { height?: number } | null)?.height ?? viewportHeight;
    if (available === undefined || !Number.isFinite(available) || available <= 0) {
      return desired;
    }
    const floor = position === "left" || position === "right" ? 160 : 120;
    const maxEdge = Math.max(floor, Math.floor(available * 0.46));
    return Math.min(desired, maxEdge);
  }

  function edgeSize(
    position: EdgeGroupPosition,
    edge: unknown,
  ): number | undefined {
    const edgeApi = edge as { width?: number; height?: number };
    return position === "left" || position === "right"
      ? edgeApi.width
      : edgeApi.height;
  }

  function isEdgeBelowMinimum(
    position: EdgeGroupPosition,
    edge: unknown,
    minimumSize: number | undefined,
  ): boolean {
    if (minimumSize === undefined) return false;
    const current = edgeSize(position, edge);
    return typeof current === "number" && current < effectiveEdgeMinimum(position, minimumSize);
  }

  function recreateKnownEdgeGroup(
    position: EdgeGroupPosition,
    edge: unknown,
    minimumSize: number,
  ): boolean {
    const dock = api.value;
    if (!dock) return false;
    const panels = edgePanelsFromDock(edge);
    const knownPanels = panels
      .map((panel) => {
        const id = panelId(panel);
        return id ? EDGE_PANEL_DEFINITIONS[id] : undefined;
      })
      .filter((panel): panel is Omit<EdgePanelOptions, "exclusive"> => !!panel);
    if (knownPanels.length === 0) return false;
    const effectiveMinimum = effectiveEdgeMinimum(position, minimumSize);
    dock.removeEdgeGroup(position);
    const initialSize = Math.max(
      effectiveMinimum,
      ...knownPanels.map((panel) =>
        Math.min(panel.initialSize ?? effectiveMinimum, effectiveMinimum),
      ),
    );
    const recreatedEdge = dock.addEdgeGroup(position, {
      id: `edge-${position}`,
      initialSize,
      minimumSize: effectiveMinimum,
    });
    for (const panel of knownPanels) {
      dock.addPanel({
        id: panel.id,
        component: panel.component,
        title: panel.title ?? panel.id,
        params: panel.params ?? {},
        ...(panel.tabComponent ? { tabComponent: panel.tabComponent } : {}),
        position: { referenceGroup: recreatedEdge.id },
      });
    }
    if (knownPanels.some((panel) => panel.id === SESSION_DETAILS_PANEL_ID)) {
      detailsOpen.value = true;
    }
    return true;
  }

  function enforceKnownEdgeMinimums(): void {
    const dock = api.value;
    if (!dock) return;
    for (const position of ["left", "right"] as const) {
      const edge = dock.getEdgeGroup(position);
      if (!edge) continue;
      const minimumSize = minimumForEdgeGroup(position, edge);
      if (
        minimumSize !== undefined &&
        isEdgeBelowMinimum(position, edge, minimumSize) &&
        recreateKnownEdgeGroup(position, edge, minimumSize)
      ) {
        continue;
      }
      applyEdgeMinimum(position, minimumSize);
    }
  }

  function recomputeActiveSession(dock: DockviewApi): void {
    const panel = dock.activeGroup?.activePanel;
    if (panel && panel.api.component === "chat") {
      activeSessionId.value = panel.api.id;
      return;
    }
    // The active panel may be a non-chat surface (the rail itself,
    // Settings, Dev playground). Don't clobber `activeSessionId`
    // unless the previously-bound session is gone — otherwise the
    // rail (which keys off this ref) blanks out the moment its own
    // tab steals focus. Walk the body groups for the currently-
    // active chat panel; only null out when none exists.
    const current = activeSessionId.value;
    if (current && dock.getPanel(current)) return;
    const panelComponent = (p: unknown): string | null => {
      const api = (p as { api?: { component?: unknown } }).api;
      if (typeof api?.component === "string") return api.component;
      const flat = (p as { component?: unknown }).component;
      return typeof flat === "string" ? flat : null;
    };
    const panelId = (p: unknown): string | null => {
      const api = (p as { api?: { id?: unknown } }).api;
      if (typeof api?.id === "string") return api.id;
      const flat = (p as { id?: unknown }).id;
      return typeof flat === "string" ? flat : null;
    };
    for (const group of dock.groups) {
      if (group.model.location.type !== "grid") continue;
      const activeChat = group.activePanel;
      if (activeChat && panelComponent(activeChat) === "chat") {
        const id = panelId(activeChat);
        if (id) {
          activeSessionId.value = id;
          return;
        }
      }
      for (const p of group.panels) {
        if (panelComponent(p) === "chat") {
          const id = panelId(p);
          if (id) {
            activeSessionId.value = id;
            return;
          }
        }
      }
    }
    activeSessionId.value = null;
  }

  function rescanOpenDetails(dock: DockviewApi): void {
    let found = false;
    for (const group of dock.groups) {
      for (const panel of group.panels) {
        const rawApi = (panel as { api?: { id?: unknown } }).api;
        const id =
          typeof rawApi?.id === "string"
            ? rawApi.id
            : typeof (panel as { id?: unknown }).id === "string"
              ? ((panel as { id: string }).id)
              : null;
        if (id === SESSION_DETAILS_PANEL_ID) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (detailsOpen.value !== found) detailsOpen.value = found;
  }

  function setApi(next: DockviewApi | null): void {
    for (const unsub of activeUnsubs) unsub();
    activeUnsubs = [];
    api.value = next;
    if (!next) {
      activeSessionId.value = null;
      detailsOpen.value = false;
      return;
    }
    recomputeActiveSession(next);
    rescanOpenDetails(next);
    enforceKnownEdgeMinimums();
    const groupSub = next.onDidActiveGroupChange(() => recomputeActiveSession(next));
    const panelSub = next.onDidActivePanelChange(() => recomputeActiveSession(next));
    const removeSub = next.onDidRemovePanel(() => {
      recomputeActiveSession(next);
      rescanOpenDetails(next);
    });
    const addSub = next.onDidAddPanel(() => rescanOpenDetails(next));
    activeUnsubs = [
      () => groupSub.dispose(),
      () => panelSub.dispose(),
      () => removeSub.dispose(),
      () => addSub.dispose(),
    ];
  }

  // ---------- Chat panels (one per session) ----------

  function addPanel(
    sessionId: string,
    opts: { title?: string; targetGroupId?: string } = {},
  ): void {
    const dock = api.value;
    if (!dock) return;
    if (dock.getPanel(sessionId)) return;

    // Resolve the best available title: explicit `opts.title` first,
    // then fall back to the session's SDK-supplied title from the store,
    // then the short GUID prefix. The lazy import avoids a circular
    // dependency between layoutStore and sessionsStore.
    let resolvedTitle = opts.title;
    if (!resolvedTitle) {
      try {
        const { useSessionsStore } = require("../stores/sessionsStore");
        const sessionsStore = useSessionsStore();
        const record = sessionsStore.getSession(sessionId);
        if (record?.title) {
          resolvedTitle = composePanelTitle(sessionId, record.title);
        }
      } catch {
        // sessionsStore not available yet — fall through
      }
    }
    resolvedTitle ??= shortPanelTitle(sessionId);
    // Three placement cases:
    //
    // 1. `targetGroupId` supplied (orphan replacement) → drop the panel
    //    as a tab inside that specific group (`direction: "within"`).
    // 2. A body (grid-located) group already exists → tile a new group
    //    to the right of it so two sessions read as side-by-side panes
    //    (the documented "new sessions tile by default" behaviour).
    // 3. No body group exists yet (very first session, or every session
    //    closed and only edge sidebars remain) → create a body group
    //    ourselves and drop the panel `direction: "within"` it.
    //
    // Earlier "fix" tried calling `dock.addPanel` with no `position`
    // when no body group existed, on the theory that dockview's default
    // placement would land it in the body. It does NOT — when the only
    // groups are edges, dockview's default places the panel inside the
    // active group (the Sessions sidebar). The result was chat panels
    // tabbed into the 240 px sidebar with the tab strip hidden by the
    // `.dv-edge-group .dv-tabs-and-actions-container` rule in
    // style.css — exactly the "sessions open at tiny percentage / no
    // tab bar / lands in sidebar" cluster. Covered by tests now.
    let referenceGroup = opts.targetGroupId ?? firstBodyGroupId();
    let createdBodyGroup = false;
    if (!referenceGroup) {
      const body = dock.addGroup();
      referenceGroup = body.id;
      createdBodyGroup = true;
    }
    const direction = opts.targetGroupId || createdBodyGroup ? "within" : "right";
    dock.addPanel({
      id: sessionId,
      component: "chat",
      title: resolvedTitle,
      params: { sessionId },
      position: { referenceGroup, direction },
    });
    // Auto-open the session-details right-rail singleton alongside
    // the first chat panel (subsequent panels reuse the same rail
    // — it re-binds to whichever chat tab is active). Skips if the
    // rail is already in the persisted layout (dockview restore
    // re-creates it then) or if the user explicitly closed it.
    if (!detailsOpen.value) {
      openSessionDetailsPanel();
    }
  }

  function addTerminalPanel(terminalId: string, title = "Terminal"): void {
    const dock = api.value;
    if (!dock) return;
    const panelId = `terminal-${terminalId}`;
    const existing = dock.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
      return;
    }
    let referenceGroup = firstBodyGroupId();
    let createdBodyGroup = false;
    if (!referenceGroup) {
      const body = dock.addGroup();
      referenceGroup = body.id;
      createdBodyGroup = true;
    }
    dock.addPanel({
      id: panelId,
      component: "terminal",
      title,
      params: { terminalId },
      position: {
        referenceGroup,
        direction: createdBodyGroup ? "within" : "right",
      },
    });
  }

  // ---------- Session details right-rail (singleton) ----------
  //
  // Single rail panel mounted in a right-edge dockview group. Its
  // content reads from `activeSessionId` so switching chat tabs
  // re-renders the rail for the new session rather than spawning
  // a per-session panel.

  /// Opens (or focuses) the singleton details rail. Idempotent —
  /// reopening when the panel already exists just brings it forward.
  function openSessionDetailsPanel(): void {
    openEdgePanel("right", {
      id: SESSION_DETAILS_PANEL_ID,
      component: "sessionDetails",
      tabComponent: "sidebarTab",
      title: "Session",
      initialSize: Math.max(lastSessionDetailsWidth.value, SESSION_DETAILS_MIN_WIDTH),
      minimumSize: SESSION_DETAILS_MIN_WIDTH,
    });
    restoreSessionDetailsWidth();
  }

  /// Toggles the details rail. If open, closes; if closed, opens.
  function toggleSessionDetailsPanel(): void {
    const dock = api.value;
    if (!dock) return;
    const panel = dock.getPanel(SESSION_DETAILS_PANEL_ID);
    if (panel) {
      dock.removePanel(panel);
    } else {
      openSessionDetailsPanel();
    }
  }

  function rememberSessionDetailsWidth(): void {
    const edge = api.value?.getEdgeGroup("right");
    if (!edge) return;
    const width = edge.width;
    if (Number.isFinite(width) && width >= SESSION_DETAILS_MIN_WIDTH) {
      lastSessionDetailsWidth.value = width;
    }
  }

  function restoreSessionDetailsWidth(): void {
    applyEdgeMinimum(
      "right",
      Math.max(lastSessionDetailsWidth.value, SESSION_DETAILS_MIN_WIDTH),
    );
  }

  /// Returns true if the rail singleton is currently open. Reactive
  /// — backed by `detailsOpen` ref maintained via dockview add/remove
  /// events. Consumers can read directly without computed-wrapping.
  function isSessionDetailsOpen(): boolean {
    return detailsOpen.value;
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

  /// Resets the layout to "factory default": closes every panel
  /// (chat tabs, settings, dev playground, sidebars), then re-opens
  /// the Sessions sidebar at its configured initial size. Used by
  /// the "Reset Layout" command in the palette + the (future)
  /// Settings → Diagnostics surface.
  ///
  /// Closing chat panels routes through dockview's
  /// `onDidRemovePanel` handler in `App.vue`, which calls
  /// `sessionsStore.closeSession(id)` for each — disconnecting the
  /// SDK session. Sessions remain available in the CLI catalog (so
  /// the Sessions Manager can resume them later); we just shed the
  /// open-pane state.
  ///
  /// Snapshots are pushed to settings.layout via the existing
  /// `onDidLayoutChange` debounced writer, so we don't need to
  /// touch persistence directly here.
  function resetToDefault(): void {
    const dock = api.value;
    if (!dock) return;
    // Copy the list — dockview mutates it during removePanel. The
    // typed `panels: readonly IDockviewPanel[]` is structurally
    // compatible with `removePanel(panel: DockviewGroupPanel)` at
    // runtime; the cast matches the same pattern used elsewhere in
    // this store for moveTo / removePanel calls.
    //
    // Each removePanel is wrapped in try/catch because this is also
    // called as a fallback when fromJSON failed and the dock is in a
    // partial / unknown state — one panel's removal throwing must
    // not strand the user with a half-cleared layout.
    const panels = dock.panels.slice();
    for (const panel of panels) {
      try {
        dock.removePanel(panel as unknown as Parameters<typeof dock.removePanel>[0]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[layoutStore.resetToDefault] removePanel threw", err);
      }
    }
    // Re-open the Sessions sidebar at default size. Wrapped because
    // a broken dock may also throw on openEdgePanel; we'd rather log
    // and let the user create a session from the (empty) topbar than
    // crash the boot.
    try {
      openEdgePanel("left", {
        id: "sessions-manager",
        component: "sessionsManager",
        tabComponent: "sidebarTab",
        title: "Sessions",
        initialSize: 260,
        minimumSize: 180,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[layoutStore.resetToDefault] openEdgePanel threw", err);
    }
  }

  function removePanel(sessionId: string): void {
    const dock = api.value;
    if (!dock) return;
    const panel = dock.getPanel(sessionId);
    if (panel) dock.removePanel(panel);
    // The session-details rail is a singleton bound to the active
    // session — closing one chat panel doesn't close the rail. It
    // re-binds to whatever chat becomes active next.
  }

  /// Brings a panel forward in its group + activates it. Used by
  /// the global PendingRequestModal to surface the owning session
  /// when a pending request fires for a non-active panel.
  function activatePanel(sessionId: string): void {
    const dock = api.value;
    if (!dock) return;
    const panel = dock.getPanel(sessionId);
    if (panel) panel.api.setActive();
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
    let existingGroup = dock.getEdgeGroup(position);
    let existing = dock.getPanel(options.id);
    if (existingGroup && isEdgeBelowMinimum(position, existingGroup, options.minimumSize)) {
      dock.removeEdgeGroup(position);
      existingGroup = undefined;
      existing = undefined;
    }
    if (existing) {
      existing.api.setActive();
      applyEdgeMinimum(
        position,
        options.minimumSize ?? minimumForEdgeGroup(position, existingGroup),
      );
      return;
    }
    applyEdgeMinimum(position, options.minimumSize);
    if (options.exclusive && existingGroup) {
      const panels = (existingGroup as unknown as { panels?: unknown[] }).panels ?? [];
      for (const panel of [...panels]) {
        const panelId =
          typeof (panel as { id?: unknown }).id === "string"
            ? (panel as { id: string }).id
            : typeof (panel as { api?: { id?: unknown } }).api?.id === "string"
              ? ((panel as { api: { id: string } }).api.id)
              : "";
        if (panelId && panelId !== options.id) {
          dock.removePanel(panel as Parameters<typeof dock.removePanel>[0]);
        }
      }
    }
    if (existingGroup && options.initialSize !== undefined) {
      // dockview-vue's EdgeGroupApi exposes `width` / `height` via the
      // underlying group element. Read defensively — if the property
      // shape changes we just skip the resize check and use the
      // existing group as-is.
      const w =
        position === "left" || position === "right"
          ? (existingGroup as unknown as { width?: number }).width
          : (existingGroup as unknown as { height?: number }).height;
      // Threshold: if the caller declared a `minimumSize`, that's the
      // floor — anything below it (e.g. a stale persisted layout from
      // before a min-size bump) gets torn down + recreated at
      // `initialSize`. Without a `minimumSize`, fall back to the older
      // half-of-initialSize heuristic that just rescues "sliver"
      // panels.
      const recreateBelow =
        options.minimumSize ?? Math.max(40, options.initialSize / 2);
      if (typeof w === "number" && w < recreateBelow) {
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
    applyEdgeMinimum(position, options.minimumSize ?? minimumForEdgeGroup(position, edge));
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
  ///
  /// Wrapped in try/catch because a malformed persisted JSON
  /// (legacy panel ids, dangling group refs, schema drift across
  /// dockview versions) makes `fromJSON` throw — and an unhandled
  /// throw here propagates up through `App.vue`'s async `onMounted`,
  /// preventing `bootStore.markReady()` from ever firing and leaving
  /// the splash stuck on "Applying layout…" / "Restoring sessions…".
  /// Returns true on success, false on a swallowed failure (caller
  /// can fall back to opening the Sessions sidebar at default size).
  function restore(layout: unknown): boolean {
    const dock = api.value;
    if (!dock || !layout || typeof layout !== "object") return false;
    try {
      dock.fromJSON(layout as Parameters<DockviewApi["fromJSON"]>[0]);
      enforceKnownEdgeMinimums();
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[layoutStore.restore] dockview.fromJSON threw — clearing layout", err);
      return false;
    }
  }

  return {
    api,
    activeSessionId,
    detailsOpen,
    enforceKnownEdgeMinimums,
    rememberSessionDetailsWidth,
    restoreSessionDetailsWidth,
    setApi,
    addPanel,
    addTerminalPanel,
    removePanel,
    activatePanel,
    renamePanel,
    replaceMissingPanel,
    openEdgePanel,
    openSessionDetailsPanel,
    toggleSessionDetailsPanel,
    isSessionDetailsOpen,
    isPanelOpen,
    closePanel,
    pruneEmptyEdgeGroup,
    rescueChatPanelsFromEdgeGroups,
    toggleEdgeGroup,
    resetToDefault,
    firstBodyGroupId,
    snapshot,
    restore,
  };
});
