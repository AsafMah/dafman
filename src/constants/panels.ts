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
/// option. Today there's only one shared `sidebarTab`, but a typed
/// constant keeps future additions discoverable.
export const TAB_COMPONENTS = {
  sidebarTab: 'sidebarTab',
  chatTab: 'chatTab',
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

/// Panels that share the left activity-bar's "single visible at a time"
/// slot. Runtime exclusion lives in `ActivityBar.activate()`, which
/// closes any other open member before opening the new one. The
/// startup `dockview.fromJSON()` path bypasses that pre-close, so
/// `layoutStore.restore()` calls `enforceActivityBarExclusivity()` to
/// keep the invariant after restore as well.
///
/// Note: `sessionDetails` lives on the RIGHT edge, not the activity
/// bar — kept out of this set.
export const ACTIVITY_BAR_PANEL_IDS: ReadonlySet<PanelId> = new Set([
  PANEL_IDS.sessionsManager,
  PANEL_IDS.terminals,
  PANEL_IDS.library,
  PANEL_IDS.jobs,
  PANEL_IDS.logs,
  PANEL_IDS.settings,
]);
