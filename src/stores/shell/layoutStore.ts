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

import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { DockviewApi, EdgeGroupPosition } from 'dockview-core';
import {
  asRemovePanelArg,
  dockApiHeight,
  dockApiWidth,
  groupId,
  groupPanels,
} from '@/stores/shell/dockviewTypes';
import { useGroupsStore } from '@/stores/shell/groupsStore';

/// Singleton id for the right-edge session details rail. One rail at
/// a time, bound to `activeSessionId` so switching chat tabs swaps the
/// rail's content rather than spawning a new panel per session.
import {
  findActivityTabSeed,
  LEFT_ACTIVITY_TABS,
  PANEL_IDS,
  RIGHT_ACTIVITY_TABS,
  TAB_COMPONENTS,
} from '@/constants/panels';

const SESSION_DETAILS_PANEL_ID = PANEL_IDS.sessionDetails;
const SETTINGS_PANEL_ID = PANEL_IDS.settings;

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

export const useLayoutStore = defineStore('layout', () => {
  /// Outer DockviewApi. `shallowRef` (not `ref`) because DockviewApi is
  /// a class with private fields; Vue's deep reactive proxy strips them
  /// from the TS surface and forces `as unknown as DockviewApi` casts
  /// everywhere it flows. Shallow ref keeps the reference reactive (so
  /// computed bodyApi re-runs on setApi) but stores the api raw.
  const api = shallowRef<DockviewApi | null>(null);

  /// The "body" api — where chat / terminal / playground panels live. In
  /// v3 this is the active group's INNER dockview (`groupsStore.innerApis[
  /// groupsStore.activeGroupId]`); during the v2→v3 transition (before any
  /// group inner has mounted) it falls back to the outer api so existing
  /// add/close paths keep working. Read-only computed; write the inner-api
  /// registry via `groupsStore.registerInnerApi`.
  const groupsStore = useGroupsStore();
  const bodyApi = computed<DockviewApi | null>(() => {
    const activeId = groupsStore.activeGroupId;

    if (activeId) {
      const inner = groupsStore.innerApis[activeId];

      if (inner) return inner;
    }

    return api.value;
  });

  /// Caller-injected title resolver. Set once at boot by App.vue so
  /// `addPanel(sessionId)` (and any other layout call that needs a
  /// session title) can look up the canonical title from the
  /// sessions store WITHOUT layoutStore importing it directly.
  /// Returns `null`/`undefined` when no session record is available;
  /// addPanel falls back to the short GUID prefix in that case.
  const sessionTitleResolver = ref<((sessionId: string) => string | null | undefined) | null>(null);

  function setSessionTitleResolver(
    resolver: ((sessionId: string) => string | null | undefined) | null,
  ): void {
    sessionTitleResolver.value = resolver;
  }

  /// Reactive id of the currently-focused chat panel, or `null` when no
  /// chat panel is active (focus on Sessions sidebar, Settings, dev
  /// playground, or nothing at all). Subscribers on dockview's
  /// `onDidActiveGroupChange` / `onDidActivePanelChange` keep this in
  /// sync; consumers (command palette `when()` predicates, future
  /// status-bar bindings, …) just read the ref.
  const activeSessionId = ref<string | null>(null);
  /// Reactive counter bumped on every layout change (outer + each
  /// inner dockview's `onDidLayoutChange`, wired by App.vue and
  /// GroupPanel.vue). Consumers that depend on the panel-set —
  /// command-palette `session.switch` parent re-registration is the
  /// motivating case — `watch` this to re-run when panels open/close
  /// without sessionsStore.sessions mutating. Avoids walking the
  /// per-group inner apis directly (their `panels` arrays aren't
  /// deeply reactive via Vue).
  const layoutRev = ref<number>(0);

  function bumpLayoutRev(): void {
    layoutRev.value++;
  }

  /// Pending "scroll the transcript to this spot" intents, keyed by
  /// session id. Durable navigation intent (issue #16): "Go to session"
  /// in the Jobs panel needs to reveal the tool-call card that spawned
  /// the job, but the target ChatWindow may not be mounted yet when the
  /// request is made (a freshly-opened panel mounts async). A plain bus
  /// emit would be dropped (mitt has no replay). So we park the intent
  /// here and let each ChatWindow consume it on mount AND via a watch,
  /// which is race-free for both the freshly-opened and already-open
  /// cases. `toolCallId` undefined ⇒ "scroll to bottom" (e.g. autopilot
  /// jobs that have no spawning tool call).
  const pendingReveal = ref<Record<string, { toolCallId?: string }>>({});

  function requestReveal(sessionId: string, target: { toolCallId?: string }): void {
    // Replace (never merge) so a tool-call reveal can't leave a stale
    // toolCallId behind a later "scroll to bottom" request.
    pendingReveal.value = { ...pendingReveal.value, [sessionId]: { ...target } };
  }

  function consumeReveal(sessionId: string): { toolCallId?: string } | null {
    const target = pendingReveal.value[sessionId];

    if (!target) return null;

    const next = { ...pendingReveal.value };

    delete next[sessionId];
    pendingReveal.value = next;

    return target;
  }

  /// Programmatic setter for `activeSessionId`. Used by GroupPanel.vue's
  /// per-inner `onDidActivePanelChange` subscription so chat-tab
  /// switches inside the active group update the active-session ref
  /// without us having to roll through `recomputeActiveSession` (which
  /// only sees outer-level events).
  function setActiveSessionId(sessionId: string | null): void {
    activeSessionId.value = sessionId;
  }

  /// Reactive flag for the singleton session-details right-rail
  /// panel. Kept in sync via `onDidAddPanel` / `onDidRemovePanel`.
  /// Unlike the old per-session set, only one rail exists at a time
  /// — it reads its current session from `activeSessionId` and
  /// re-binds when the user switches chat tabs.
  const detailsOpen = ref<boolean>(false);
  let activeUnsubs: Array<() => void> = [];

  /// Apply the active-tab's `minimumSize` (from the seed metadata)
  /// to the edge group's splitview constraints. v2 semantics: dockview
  /// doesn't expose a clean public API for mutating an edge group's
  /// `_expandedMinimumSize` after creation. So we set the edge
  /// group's constraint to `max(all-tab-mins)` at seed time (see
  /// `seedDefaultLayout`) and this function is now a thin wrapper
  /// kept for back-compat with the `enforceKnownEdgeMinimums` hook
  /// — it re-applies via the api's `setConstraints` which DOES
  /// propagate when applied on each layout-change tick.
  function applyActiveTabConstraints(position: EdgeGroupPosition): void {
    const dock = api.value;

    if (!dock) return;

    const edge = dock.getEdgeGroup(position);

    if (!edge) return;

    if (edge.isCollapsed()) return;

    const seeds = position === 'left' ? LEFT_ACTIVITY_TABS : RIGHT_ACTIVITY_TABS;
    const staticMin = seeds.reduce((acc, s) => Math.max(acc, s.minimumSize), 0);

    if (staticMin > 0) applyEdgeMinimum(position, staticMin);
  }

  function applyEdgeMinimum(position: EdgeGroupPosition, minimumSize: number | undefined): void {
    const edge = api.value?.getEdgeGroup(position);

    if (!edge || minimumSize === undefined) return;

    const effectiveMinimum = effectiveEdgeMinimum(position, minimumSize);
    const edgeApi = edge as unknown as {
      width?: number;
      height?: number;
      setSize?: (value: { width?: number; height?: number }) => void;
      setConstraints?: (value: { minimumWidth?: number; minimumHeight?: number }) => void;
    };

    if (typeof edgeApi.setConstraints === 'function') {
      if (position === 'left' || position === 'right') {
        edgeApi.setConstraints.call(edge, { minimumWidth: effectiveMinimum });
      } else {
        edgeApi.setConstraints.call(edge, { minimumHeight: effectiveMinimum });
      }
    }

    const current = position === 'left' || position === 'right' ? edgeApi.width : edgeApi.height;

    if (
      typeof current === 'number' &&
      current < effectiveMinimum &&
      typeof edgeApi.setSize === 'function'
    ) {
      if (position === 'left' || position === 'right') {
        edgeApi.setSize.call(edge, { width: effectiveMinimum });
      } else {
        edgeApi.setSize.call(edge, { height: effectiveMinimum });
      }
    }
  }

  function effectiveEdgeMinimum(position: EdgeGroupPosition, desired: number): number {
    const dock = api.value;
    const viewportWidth = typeof window === 'undefined' ? undefined : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? undefined : window.innerHeight;
    const available =
      position === 'left' || position === 'right'
        ? (dockApiWidth(dock) ?? viewportWidth)
        : (dockApiHeight(dock) ?? viewportHeight);

    if (available === undefined || !Number.isFinite(available) || available <= 0) {
      return desired;
    }

    const floor = position === 'left' || position === 'right' ? 160 : 120;
    const maxEdge = Math.max(floor, Math.floor(available * 0.46));

    return Math.min(desired, maxEdge);
  }

  /// Re-apply per-edge active-tab constraints. Called on every layout
  /// change (via App.vue's onDidLayoutChange) so that drag-resize
  /// down to the constraint floor is enforced and so that any
  /// runtime-added panels with their own ergonomic minimum get
  /// picked up.
  function enforceKnownEdgeMinimums(): void {
    applyActiveTabConstraints('left');
    applyActiveTabConstraints('right');
  }

  function recomputeActiveSession(dock: DockviewApi): void {
    const panel = dock.activeGroup?.activePanel;

    if (panel && panel.api.component === 'chat') {
      activeSessionId.value = panel.api.id;

      return;
    }

    // v3: the outer dock's active panel is a `group` component, not
    // `chat`. The actual chat panel lives inside the inner dockview
    // owned by groupsStore.innerApis[activeGroupId]. Resolve through
    // that path first. Without this, the user just switching the
    // active outer group (or any boot path that doesn't pass the
    // chat-active branch above) leaves activeSessionId null even
    // though a chat panel IS active — surfaces "No active session"
    // in SessionDetailsPanel and hides every session.* palette
    // command. Caught 2026-05-27 by user feedback.
    const activeGid = groupsStore.activeGroupId;

    if (activeGid) {
      const inner = groupsStore.innerApis[activeGid];
      const innerActive = inner?.activeGroup?.activePanel;

      if (innerActive && innerActive.api.component === 'chat') {
        activeSessionId.value = innerActive.api.id;

        return;
      }
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

      if (typeof api?.component === 'string') return api.component;

      const flat = (p as { component?: unknown }).component;

      return typeof flat === 'string' ? flat : null;
    };
    const panelId = (p: unknown): string | null => {
      const api = (p as { api?: { id?: unknown } }).api;

      if (typeof api?.id === 'string') return api.id;

      const flat = (p as { id?: unknown }).id;

      return typeof flat === 'string' ? flat : null;
    };

    for (const group of dock.groups) {
      if (group.model.location.type !== 'grid') continue;

      const activeChat = group.activePanel;

      if (activeChat && panelComponent(activeChat) === 'chat') {
        const id = panelId(activeChat);

        if (id) {
          activeSessionId.value = id;

          return;
        }
      }

      for (const p of group.panels) {
        if (panelComponent(p) === 'chat') {
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

  /// Recomputes `detailsOpen` from the live dockview state. The
  /// definition (v2): right edge group exists AND is expanded AND its
  /// session-details panel is the active tab.
  ///
  /// (v1 used existence-based semantics — `detailsOpen = panel exists
  /// anywhere in the layout`. That stopped working once we seed
  /// `session-details` as a persistent tab in the right edge: the
  /// panel always exists, the strip just collapses to hide it.)
  function rescanOpenDetails(dock: DockviewApi): void {
    const right = dock.getEdgeGroup('right');
    const panel = dock.getPanel(SESSION_DETAILS_PANEL_ID);
    const found = right !== undefined && !right.isCollapsed() && panel?.api.isActive === true;

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

    // Per-tab edge-group constraint tracking. Each edge group's
    // active tab supplies its own `minimumSize` (from the seed
    // metadata); the constraint applied to the edge group as a
    // whole must follow the active tab. We re-attach the collapse
    // listener for each edge group once it actually exists (the
    // group may not be present at setApi time — seedDefaultLayout
    // creates it later via fromJSON or fresh-seed).
    let leftCollapseUnsub: (() => void) | null = null;
    let rightCollapseUnsub: (() => void) | null = null;

    const tryAttachEdgeListeners = (position: 'left' | 'right') => {
      const cur = position === 'left' ? leftCollapseUnsub : rightCollapseUnsub;

      if (cur) return;

      const edge = next.getEdgeGroup(position);

      if (!edge) return;

      const sub = edge.onDidCollapsedChange(() => {
        applyActiveTabConstraints(position);

        if (position === 'right') rescanOpenDetails(next);
      });

      if (position === 'left') {
        leftCollapseUnsub = () => sub.dispose();
      } else {
        rightCollapseUnsub = () => sub.dispose();
      }
    };

    tryAttachEdgeListeners('left');
    tryAttachEdgeListeners('right');

    // Initial constraint pass — covers the fresh-seed / restore-from-
    // JSON case where the edge groups already exist with an active
    // tab when setApi is called.
    applyActiveTabConstraints('left');
    applyActiveTabConstraints('right');

    const groupSub = next.onDidActiveGroupChange(() => recomputeActiveSession(next));
    const panelSub = next.onDidActivePanelChange(() => {
      // v3 groups: sync groupsStore.activeGroupId from outer.activePanel
      // FIRST so the recomputeActiveSession call below resolves through
      // the NEW group's inner dockview, not the previous group's stale
      // one. Without this ordering, switching between outer group tabs
      // leaves activeSessionId pointing at the previous group's active
      // chat panel, and downstream watchers (Library tabs auto-refresh,
      // session.* command palette `when()`, etc.) miss the switch.
      // Filter: only update when the active panel is a group panel —
      // clicking an activity-bar tab (Sessions / Settings / etc.)
      // changes outer.activePanel but should NOT change which group
      // is "active" for body routing.
      const activeId = next.activePanel?.id;

      if (activeId && groupsStore.isGroupPanelId(activeId)) {
        groupsStore.setActiveGroupId(activeId);
      }

      recomputeActiveSession(next);
      rescanOpenDetails(next);
      applyActiveTabConstraints('left');
      applyActiveTabConstraints('right');
    });
    const removeSub = next.onDidRemovePanel(() => {
      recomputeActiveSession(next);
      rescanOpenDetails(next);
    });
    const addSub = next.onDidAddPanel(() => rescanOpenDetails(next));
    const addGroupSub = next.onDidAddGroup(() => {
      tryAttachEdgeListeners('left');
      tryAttachEdgeListeners('right');
      rescanOpenDetails(next);
      applyActiveTabConstraints('left');
      applyActiveTabConstraints('right');
    });

    activeUnsubs = [
      () => groupSub.dispose(),
      () => panelSub.dispose(),
      () => removeSub.dispose(),
      () => addSub.dispose(),
      () => addGroupSub.dispose(),
      () => leftCollapseUnsub?.(),
      () => rightCollapseUnsub?.(),
    ];
  }

  // ---------- Chat panels (one per session) ----------

  function addPanel(
    sessionId: string,
    opts: { title?: string; targetGroupId?: string } = {},
  ): void {
    const dock = bodyApi.value;

    if (!dock) return;

    // One-only invariant: if this session lives in a different group
    // (mounted or cached), strip it from there first. No-op when it's
    // already in the active group.
    groupsStore.pruneSessionFromAllGroups(sessionId, groupsStore.activeGroupId ?? undefined);

    if (dock.getPanel(sessionId)) return;

    // Resolve the best available title: explicit `opts.title` first,
    // then fall back to the title resolver (typically registered at
    // boot to look up session titles from `sessionsStore`), then the
    // short GUID prefix. Using a callback rather than importing the
    // sessions store avoids the circular-import problem that the
    // require()-hack previously worked around.
    let resolvedTitle = opts.title;

    if (!resolvedTitle && sessionTitleResolver.value) {
      const title = sessionTitleResolver.value(sessionId);

      if (title) resolvedTitle = composePanelTitle(sessionId, title);
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
    // v3 nested-dockview: `dock === bodyApi` is the active group's INNER
    // dockview which has no edge groups. Use the location-aware helper
    // so both v3 inner AND the legacy outer code path produce a
    // grid-located reference (never an edge group). Using the outer's
    // firstBodyGroupId() here would return an id that doesn't exist on
    // the inner and dockview throws `referenceGroup '<id>' does not
    // exist`. (Caught when the user reported "sessions go nowhere
    // after creating".)
    let referenceGroup = opts.targetGroupId ?? firstBodyGroupIdOf(dock);
    let createdBodyGroup = false;

    if (!referenceGroup) {
      const body = dock.addGroup();

      referenceGroup = body.id;
      createdBodyGroup = true;
    }

    const direction = opts.targetGroupId || createdBodyGroup ? 'within' : 'right';

    dock.addPanel({
      id: sessionId,
      component: 'chat',
      title: resolvedTitle,
      params: { sessionId },
      position: { referenceGroup, direction },
    });

    // Note: do NOT auto-open the session-details right-rail here.
    // The previous behavior popped the rail open every time a session
    // was created, which surprised users — they had to close it
    // themselves on every new session. The rail is still openable on
    // demand via the activity-bar toggle / `toggleSessionDetailsPanel`.
    // (Issue: problems.md "Remove the thing that a session
    // automatically opens its settings".)
  }

  function addTerminalPanel(terminalId: string, title = 'Terminal'): void {
    const dock = bodyApi.value;

    if (!dock) return;

    const panelId = `terminal-${terminalId}`;
    const existing = dock.getPanel(panelId);

    if (existing) {
      existing.api.setActive();

      return;
    }

    // See addPanel above for why we use firstBodyGroupIdOf(dock)
    // instead of the outer-only firstBodyGroupId().
    let referenceGroup = firstBodyGroupIdOf(dock);
    let createdBodyGroup = false;

    if (!referenceGroup) {
      const body = dock.addGroup();

      referenceGroup = body.id;
      createdBodyGroup = true;
    }

    dock.addPanel({
      id: panelId,
      component: 'terminal',
      title,
      params: { terminalId },
      position: {
        referenceGroup,
        direction: createdBodyGroup ? 'within' : 'right',
      },
    });
  }

  // ---------- Session details right-rail (singleton) ----------
  //
  // Single rail panel mounted in a right-edge dockview group. Its
  // content reads from `activeSessionId` so switching chat tabs
  // re-renders the rail for the new session rather than spawning
  // a per-session panel.

  /// Toggles the details rail. Goes through `activateEdgePanel` which
  /// already implements the toggle (click active → collapse; otherwise
  /// activate + expand). Per-tab `minimumSize` is enforced by
  /// `applyActiveTabConstraints` reacting to the active-panel change.
  function toggleSessionDetailsPanel(): void {
    activateEdgePanel(SESSION_DETAILS_PANEL_ID, 'right');
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

    return firstBodyGroupIdOf(dock);
  }

  /// Variant of `firstBodyGroupId` that operates on an arbitrary
  /// DockviewApi (used by addPanel when it's routing through bodyApi
  /// — the active group's INNER dockview). Inner dockviews have no
  /// edge groups so all their groups are body groups, but the filter
  /// is still semantically correct (and protects the legacy path).
  function firstBodyGroupIdOf(dock: DockviewApi): string | undefined {
    const active = dock.activeGroup;

    if (active && active.model.location.type === 'grid') return active.id;

    for (const group of dock.groups) {
      if (group.model.location.type === 'grid') return group.id;
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
      if (group.model.location.type === 'grid') continue;

      for (const panel of group.panels) {
        if (panel.api.component === 'chat') {
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
          group: target as unknown as Parameters<typeof panel.api.moveTo>[0]['group'],
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

    // Copy the list — dockview mutates it during removePanel.
    const panels = dock.panels.slice();

    for (const panel of panels) {
      try {
        dock.removePanel(asRemovePanelArg(panel));
      } catch (err) {
        console.error('[layoutStore.resetToDefault] removePanel threw', err);
      }
    }

    // Tear down edge groups too so seedDefaultLayout rebuilds them fresh.
    for (const pos of ['left', 'right'] as const) {
      if (dock.getEdgeGroup(pos)) {
        try {
          dock.removeEdgeGroup(pos);
        } catch (err) {
          console.error(`[layoutStore.resetToDefault] removeEdgeGroup ${pos} threw`, err);
        }
      }
    }

    // Re-seed the activity-bar tabs.
    try {
      seedDefaultLayout();
    } catch (err) {
      console.error('[layoutStore.resetToDefault] seedDefaultLayout threw', err);
    }
  }

  /// Opens the Settings panel in the main body grid (it stopped being
  /// an activity-bar tab in v2; the status-bar cog and the command
  /// palette both go through here so the panel lands in the same
  /// place from every surface).
  /// Opens or toggles the Settings panel. In v2 Settings lives as a
  /// left-edge activity-bar tab (per `LEFT_ACTIVITY_TABS`). This is
  /// just a typed shortcut to `activateEdgePanel(SETTINGS_PANEL_ID,
  /// 'left')` — clicking when closed expands the strip + activates
  /// Settings; clicking when already active+expanded collapses.
  function toggleSettings(): void {
    activateEdgePanel(SETTINGS_PANEL_ID, 'left');
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
  /// Toggle/activate a panel that lives in an edge group. Intended
  /// for command palette, keyboard shortcuts, and programmatic
  /// callers — UI clicks on dockview tabs already go through
  /// dockview's native handler which does the same thing.
  ///
  /// Semantics:
  ///   - panel inactive  → activate it + expand the strip if collapsed
  ///   - panel active + expanded → collapse the strip
  ///   - panel active + collapsed → expand the strip (rare; happens
  ///     if external code activated the panel programmatically while
  ///     the strip is collapsed)
  ///
  /// No-ops if the panel or its edge group is not seeded yet.
  function activateEdgePanel(id: string, edge: 'left' | 'right'): void {
    const dock = api.value;

    if (!dock) return;

    const group = dock.getEdgeGroup(edge);
    const panel = dock.getPanel(id);

    if (!group || !panel) return;

    const isCollapsed = group.isCollapsed();
    // "Shown" = the edge is expanded AND this panel is the one currently
    // displayed in it. Deliberately NOT `panel.api.isActive`: that is also false
    // whenever the panel's group isn't dockview's globally-active group, which it
    // stops being the moment the user clicks any control inside the rail — making
    // the cog need two clicks to collapse (#54). `group.activePanel` tracks the
    // displayed panel regardless of global focus.
    const isShown = !isCollapsed && panel.group.activePanel?.id === id;

    if (isShown) {
      group.collapse();

      return;
    }

    if (!panel.api.isActive) panel.api.setActive();

    if (isCollapsed) group.expand();
  }

  /// Reveals and focuses an edge panel without toggling it closed.
  /// Use for programmatic navigation where the intent is always "show this
  /// panel" (for example slash commands), not activity-bar click toggles.
  function revealEdgePanel(id: string, edge: 'left' | 'right'): void {
    const dock = api.value;

    if (!dock) return;

    const group = dock.getEdgeGroup(edge);
    const panel = dock.getPanel(id);

    if (!group || !panel) return;

    if (!panel.api.isActive || panel.group.activePanel?.id !== id) panel.api.setActive();

    if (group.isCollapsed()) group.expand();
  }

  /// v1 entry point retained for back-compat with callers that still
  /// pass `EdgePanelOptions`. In v2 every activity-bar panel is
  /// seeded at boot via `seedDefaultLayout`, so this just delegates
  /// to `activateEdgePanel` for the known activity-tab ids. The
  /// `initialSize` / `minimumSize` fields in the options are IGNORED
  /// here — per-tab constraints come from the seed metadata via
  /// `applyActiveTabConstraints` instead. Kept as a function so we
  /// don't have to migrate every caller in one commit.
  ///
  /// New callers should use `activateEdgePanel(id, position)` directly.
  function openEdgePanel(position: EdgeGroupPosition, options: EdgePanelOptions): void {
    const dock = api.value;

    if (!dock) return;

    // If the panel is one of our seeded activity-bar tabs, the seed
    // already created it. Just activate + expand.
    if (findActivityTabSeed(options.id)) {
      if (position === 'left' || position === 'right') {
        activateEdgePanel(options.id, position);
      }

      return;
    }

    // Unknown panel id — fall back to the v1 path (add the panel
    // into the existing edge group, or create the group if absent).
    // No callers exercise this today; if a new caller appears,
    // consider whether the panel should be added to the seed table
    // instead.
    const edge =
      dock.getEdgeGroup(position) ??
      dock.addEdgeGroup(position, {
        id: `edge-${position}`,
        ...(options.initialSize !== undefined ? { initialSize: options.initialSize } : {}),
        ...(options.minimumSize !== undefined ? { minimumSize: options.minimumSize } : {}),
      });

    if (!dock.getPanel(options.id)) {
      dock.addPanel({
        id: options.id,
        component: options.component,
        title: options.title ?? options.id,
        params: options.params ?? {},
        ...(options.tabComponent ? { tabComponent: options.tabComponent } : {}),
        position: { referenceGroup: edge.id },
      });
    } else {
      dock.getPanel(options.id)?.api.setActive();
    }

    if (edge.isCollapsed()) edge.expand();

    applyEdgeMinimum(position, options.minimumSize);
  }

  /// Removes the edge group at `position` if the given group id matches
  /// and the group is now empty. Returns true if we cleaned up. Used by
  /// `onDidRemovePanel` handlers so closing a sidebar panel via
  /// dockview's own X (which doesn't go through `closePanel`) still
  /// tears down the parent shell so the next open gets a fresh
  /// `initialSize`.
  function pruneEmptyEdgeGroup(targetGroupId: string): boolean {
    const dock = api.value;

    if (!dock) return false;

    for (const pos of ['left', 'right', 'top', 'bottom'] as const) {
      const edge = dock.getEdgeGroup(pos);

      if (!edge) continue;

      if (groupId(edge) !== targetGroupId) continue;

      const panels = groupPanels(edge);

      if (panels.length === 0) {
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
  ///
  /// v3: chat / terminal panels live in inner dockviews. We try the
  /// outer api first (covers edge tabs, settings, playground, group
  /// panels themselves). If the panel isn't there, walk the registered
  /// inner apis and remove from whichever inner owns it.
  function closePanel(id: string): void {
    const dock = api.value;

    if (!dock) return;

    const panel = dock.getPanel(id);

    if (panel) {
      const group = panel.api.group;
      const wasLastInGroup = group.panels.length <= 1;

      dock.removePanel(panel);

      // If the group it lived in is now empty *and* it's an edge group,
      // remove it so size persistence resets. Body groups are left for
      // dockview to clean up on its own — body layout is the user's
      // grid and we don't want to collapse adjacent panels.
      if (wasLastInGroup) {
        for (const pos of ['left', 'right', 'top', 'bottom'] as const) {
          const edge = dock.getEdgeGroup(pos);

          if (edge && groupId(edge) === group.id) {
            dock.removeEdgeGroup(pos);
            break;
          }
        }
      }

      return;
    }

    // Not on outer — walk inner apis (chat / terminal panels live there
    // in v3). innerApis is now a shallowRef so values keep their
    // DockviewApi identity (no `as unknown as DockviewApi` needed).
    for (const innerApi of Object.values(groupsStore.innerApis)) {
      const innerPanel = innerApi.getPanel(id);

      if (innerPanel) {
        innerApi.removePanel(innerPanel);

        // No edge-group cleanup inside inner dockviews (they don't have edges).
        // The group-meta cache will pick up the new toJSON on next layout-change.
        return;
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
  function snapshot(): unknown {
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

    if (!dock || !layout || typeof layout !== 'object') return false;

    try {
      dock.fromJSON(layout as Parameters<DockviewApi['fromJSON']>[0]);
      enforceKnownEdgeMinimums();

      return true;
    } catch (err) {
      console.error('[layoutStore.restore] dockview.fromJSON threw — clearing layout', err);

      return false;
    }
  }

  /// Seeds the canonical v2 edge-group layout: a left edge group with
  /// the activity-bar tabs and a right edge group with the right-side
  /// tabs (session details + library). Both groups start collapsed —
  /// the user opens one by clicking its tab in the strip.
  ///
  /// Idempotent: skips work that's already in place. Safe to call
  /// during boot before any chat panel resumes happen.
  ///
  /// Logs total wall time so we can keep the boot-cost gate honest
  /// per plan §4 (>50 ms regression triggers a lazy-mount detour).
  function seedDefaultLayout(): void {
    const dock = api.value;

    if (!dock) return;

    const startedAt = performance.now();

    for (const [position, seeds] of [
      ['left', LEFT_ACTIVITY_TABS],
      ['right', RIGHT_ACTIVITY_TABS],
    ] as const) {
      // Edge group min = max(all tabs' minimums) because dockview's
      // splitview enforces ONE static minimumSize per edge group
      // and there's no clean public API to mutate it after creation
      // (the splitview's view.minimumSize getter reads from a
      // private `_expandedMinimumSize` field set only at addEdgeGroup
      // time). Setting it to the max keeps the most-demanding tab
      // (Logs needs 420 on the left; SessionDetails needs 380 on
      // the right) from ever being clipped. Sessions/Library can
      // technically tolerate a narrower strip, but pay a small
      // strip-width cost in exchange for never breaking.
      //
      // Initial size = the FIRST seeded tab's preferred initial
      // (Sessions's 260 on left, SessionDetails's 380 on right),
      // clamped up to the max-min floor if necessary.
      const firstSeed = seeds[0];
      const maxMin = seeds.reduce((acc, s) => Math.max(acc, s.minimumSize), 0);
      const initialSize = Math.max(firstSeed?.initialSize ?? 280, maxMin);
      const minimumSize = maxMin;

      const edge =
        dock.getEdgeGroup(position) ??
        dock.addEdgeGroup(position, {
          id: `edge-${position}`,
          initialSize,
          minimumSize,
          // Explicit collapsedSize: dockview's default is 35px which
          // crowds our 28x28 icons. 44px matches most dockview themes
          // and leaves comfortable padding.
          collapsedSize: 44,
          collapsed: true,
        });

      for (const seed of seeds) {
        if (dock.getPanel(seed.id)) continue;

        dock.addPanel({
          id: seed.id,
          component: seed.component,
          tabComponent: TAB_COMPONENTS.activityTab,
          title: seed.title,
          params: { icon: seed.icon, title: seed.title },
          position: { referenceGroup: edge.id },
        });
      }

      if (!edge.isCollapsed()) edge.collapse();
    }

    const elapsedMs = Math.round(performance.now() - startedAt);

    console.info(`[layoutStore.seedDefaultLayout] seeded edge tabs in ${elapsedMs}ms`);
  }

  return {
    api,
    bodyApi,
    activeSessionId,
    layoutRev,
    bumpLayoutRev,
    pendingReveal,
    requestReveal,
    consumeReveal,
    setActiveSessionId,
    detailsOpen,
    enforceKnownEdgeMinimums,
    setApi,
    setSessionTitleResolver,
    addPanel,
    addTerminalPanel,
    removePanel,
    activatePanel,
    renamePanel,
    replaceMissingPanel,
    openEdgePanel,
    activateEdgePanel,
    revealEdgePanel,
    toggleSettings,
    toggleSessionDetailsPanel,
    isSessionDetailsOpen,
    isPanelOpen,
    closePanel,
    pruneEmptyEdgeGroup,
    rescueChatPanelsFromEdgeGroups,
    toggleEdgeGroup,
    resetToDefault,
    seedDefaultLayout,
    firstBodyGroupId,
    snapshot,
    restore,
  };
});
