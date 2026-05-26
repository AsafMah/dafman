/// Centralised panel + component IDs used throughout the renderer.
///
/// Replaces ~50 inline string literals (`'sessionsManager'`, `'library'`,
/// `'sidebarTab'`, etc.) scattered across stores, App.vue, dockview
/// layouts, and command palette registrations. Per AGENTS.md rule 21
/// (and §6 architectural-debt #11), magic strings for panel IDs are a
/// chronic source of typos that only surface at runtime in the dockview
/// "Failed to find Vue Component 'foo'" path.
///
/// Each constant is `as const` so TypeScript narrows to the literal type
/// and we get the same compile-time checking we'd get from a string-union
/// type, without the boilerplate of writing the union by hand.

/// Vue components registered globally in src/main.ts and referenced by
/// dockview's `component:` panel option.
export const PANEL_COMPONENTS = {
  chat: 'chat',
  terminal: 'terminal',
  sessionsManager: 'sessionsManager',
  sessionDetails: 'sessionDetails',
  settingsPanel: 'settingsPanel',
  library: 'library',
  jobsPanel: 'jobsPanel',
  terminalsPanel: 'terminalsPanel',
  logViewer: 'logViewer',
} as const;

export type PanelComponentName = (typeof PANEL_COMPONENTS)[keyof typeof PANEL_COMPONENTS];

/// Tab header components passed to dockview's `tabComponent:` panel
/// option.
export const TAB_COMPONENTS = {
  sidebarTab: 'sidebarTab',
  chatTab: 'chatTab',
  activityTab: 'activityTab',
} as const;

export type TabComponentName = (typeof TAB_COMPONENTS)[keyof typeof TAB_COMPONENTS];

/// Stable panel IDs for the singleton edge panels (sidebar, settings,
/// library, etc.). Each is unique within a layout snapshot so dockview
/// can look them up by id for activate / focus / remove operations.
/// Chat session panels use the sessionId itself as their id, not one
/// of these — see layoutStore.addPanel().
export const PANEL_IDS = {
  sessionsManager: 'sessions-manager',
  sessionDetails: 'session-details',
  settings: 'settings-panel',
  library: 'library',
  jobs: 'jobs-panel',
  terminals: 'terminals-panel',
  logs: 'log-viewer',
} as const;

export type PanelId = (typeof PANEL_IDS)[keyof typeof PANEL_IDS];

/// Activity-bar tab inventory. The left + right edge groups are seeded
/// from these at boot. The order here determines tab order in the
/// strip on first launch; the user can drag-reorder thereafter
/// (persisted by dockview's layout JSON).
///
/// Each entry must reference a panel id from `PANEL_IDS` and a
/// component name from `PANEL_COMPONENTS`. Tabs render via the global
/// `activityTab` component with `params: { icon, title }`.
///
/// `minimumSize` / `initialSize` are PER-TAB constraints. The edge
/// group as a whole has one constraint at a time; layoutStore tracks
/// the active tab and applies that tab's `minimumSize` to the edge
/// group. So when the user clicks "Logs" (min 420), the edge auto-
/// grows; when they switch back to "Sessions" (min 180), they can
/// drag the strip narrower again.
///
/// Width catalog inherited from v1 `EDGE_PANEL_DEFINITIONS` —
/// preserve ergonomic widths the user had pre-refactor.
export interface ActivityTabSeed {
  id: PanelId;
  component: PanelComponentName;
  icon: string;
  title: string;
  /// Width the edge group expands to on the FIRST activation of this
  /// tab (before the user has dragged). Subsequent activations
  /// preserve the user's drag width.
  initialSize: number;
  /// Floor width when this tab is active. Edge group is constrained
  /// to >= this. Drag handle bottoms out here.
  minimumSize: number;
}

export const LEFT_ACTIVITY_TABS: readonly ActivityTabSeed[] = [
  {
    id: PANEL_IDS.sessionsManager,
    component: PANEL_COMPONENTS.sessionsManager,
    icon: 'pi-comments',
    title: 'Sessions',
    initialSize: 260,
    minimumSize: 180,
  },
  {
    id: PANEL_IDS.terminals,
    component: PANEL_COMPONENTS.terminalsPanel,
    icon: 'pi-chevron-right',
    title: 'Terminals',
    initialSize: 360,
    minimumSize: 320,
  },
  {
    id: PANEL_IDS.jobs,
    component: PANEL_COMPONENTS.jobsPanel,
    icon: 'pi-clock',
    title: 'Jobs',
    initialSize: 380,
    minimumSize: 380,
  },
  {
    id: PANEL_IDS.logs,
    component: PANEL_COMPONENTS.logViewer,
    icon: 'pi-bars',
    title: 'Logs',
    initialSize: 480,
    minimumSize: 420,
  },
  {
    id: PANEL_IDS.settings,
    component: PANEL_COMPONENTS.settingsPanel,
    icon: 'pi-cog',
    title: 'Settings',
    initialSize: 400,
    minimumSize: 380,
  },
];

export const RIGHT_ACTIVITY_TABS: readonly ActivityTabSeed[] = [
  {
    id: PANEL_IDS.sessionDetails,
    component: PANEL_COMPONENTS.sessionDetails,
    icon: 'pi-info-circle',
    title: 'Session details',
    initialSize: 380,
    minimumSize: 380,
  },
  {
    id: PANEL_IDS.library,
    component: PANEL_COMPONENTS.library,
    icon: 'pi-book',
    title: 'Library',
    initialSize: 360,
    minimumSize: 320,
  },
];

/// Returns the seed metadata for any activity-bar tab id, regardless
/// of edge. Used by layoutStore to look up per-tab constraints when
/// the active panel in an edge group changes.
export function findActivityTabSeed(id: string): ActivityTabSeed | undefined {
  for (const t of LEFT_ACTIVITY_TABS) if (t.id === id) return t;
  for (const t of RIGHT_ACTIVITY_TABS) if (t.id === id) return t;

  return undefined;
}

/// `true` if the given panel id is one of the seeded activity-bar
/// tabs. Used by the drop-target restriction in App.vue to prevent
/// dragging an activity-bar tab into the main grid / a floating
/// window / a popout — those tabs are only valid in an edge group.
export function isActivityBarPanel(id: string): boolean {
  return findActivityTabSeed(id) !== undefined;
}
