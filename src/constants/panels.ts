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
export interface ActivityTabSeed {
  id: PanelId;
  component: PanelComponentName;
  icon: string;
  title: string;
}

export const LEFT_ACTIVITY_TABS: readonly ActivityTabSeed[] = [
  {
    id: PANEL_IDS.sessionsManager,
    component: PANEL_COMPONENTS.sessionsManager,
    icon: 'pi-list',
    title: 'Sessions',
  },
  {
    id: PANEL_IDS.terminals,
    component: PANEL_COMPONENTS.terminalsPanel,
    icon: 'pi-chevron-right',
    title: 'Terminals',
  },
  {
    id: PANEL_IDS.jobs,
    component: PANEL_COMPONENTS.jobsPanel,
    icon: 'pi-clock',
    title: 'Jobs',
  },
  {
    id: PANEL_IDS.logs,
    component: PANEL_COMPONENTS.logViewer,
    icon: 'pi-bars',
    title: 'Logs',
  },
];

export const RIGHT_ACTIVITY_TABS: readonly ActivityTabSeed[] = [
  {
    id: PANEL_IDS.sessionDetails,
    component: PANEL_COMPONENTS.sessionDetails,
    icon: 'pi-info-circle',
    title: 'Session details',
  },
  {
    id: PANEL_IDS.library,
    component: PANEL_COMPONENTS.library,
    icon: 'pi-book',
    title: 'Library',
  },
];
