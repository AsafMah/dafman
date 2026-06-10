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
import { asRemovePanelArg, dockApiHeight, dockApiWidth } from '@/stores/shell/dockviewTypes';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import { LEFT_ACTIVITY_TABS, PANEL_IDS, RIGHT_ACTIVITY_TABS } from '@/constants/panels';
import { buildPanelCrud } from './layoutPanelCrud';
import { buildEdgePanels } from './layoutEdgePanels';
import { buildLayoutSeeds } from './layoutSeeds';

// Re-export pure utilities so existing callers keep their import paths.
export { basename, composePanelTitle, shortPanelTitle } from './layoutUtils';
export type { EdgePanelOptions } from './layoutUtils';

/// Singleton id for the right-edge session details rail. One rail at
/// a time, bound to `activeSessionId` so switching chat tabs swaps the
/// rail's content rather than spawning a new panel per session.
const SESSION_DETAILS_PANEL_ID = PANEL_IDS.sessionDetails;
const SETTINGS_PANEL_ID = PANEL_IDS.settings;

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
  /// Last chat panel that actually held focus. Edge panels such as the
  /// Library can legitimately make `activeSessionId` null/stale, but
  /// workspace-scoped surfaces still need the chat session the user was
  /// viewing before opening the edge panel.
  const lastFocusedSessionId = ref<string | null>(null);
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
  const pendingReveal = ref<Record<string, { toolCallId?: string; eventIndex?: number }>>({});

  function requestReveal(
    sessionId: string,
    target: { toolCallId?: string; eventIndex?: number },
  ): void {
    // Replace (never merge) so a reveal can't leave a stale id behind a
    // later "scroll to bottom" request.
    pendingReveal.value = { ...pendingReveal.value, [sessionId]: { ...target } };
  }

  function consumeReveal(sessionId: string): { toolCallId?: string; eventIndex?: number } | null {
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

    if (sessionId) lastFocusedSessionId.value = sessionId;
  }

  function bindActiveSession(sessionId: string): void {
    activeSessionId.value = sessionId;
    lastFocusedSessionId.value = sessionId;
  }

  /// Reactive flag for the singleton session-details right-rail
  /// panel. Kept in sync via `onDidAddPanel` / `onDidRemovePanel`.
  /// Unlike the old per-session set, only one rail exists at a time
  /// — it reads its current session from `activeSessionId` and
  /// re-binds when the user switches chat tabs.
  const detailsOpen = ref<boolean>(false);
  let activeUnsubs: Array<() => void> = [];

  // ---------- Constraints & edge minimums ----------

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

  // ---------- Active session tracking ----------

  function recomputeActiveSession(dock: DockviewApi): void {
    const panel = dock.activeGroup?.activePanel;

    if (panel && panel.api.component === 'chat') {
      bindActiveSession(panel.api.id);

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
        bindActiveSession(innerActive.api.id);

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
          bindActiveSession(id);

          return;
        }
      }

      for (const p of group.panels) {
        if (panelComponent(p) === 'chat') {
          const id = panelId(p);

          if (id) {
            bindActiveSession(id);

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

  // ---------- Sub-module builders ----------

  const edges = buildEdgePanels({ api, groupsStore, applyEdgeMinimum });
  const crud = buildPanelCrud({ api, bodyApi, sessionTitleResolver, groupsStore });
  const seeds = buildLayoutSeeds({ api, enforceKnownEdgeMinimums });

  // ---------- Outer API lifecycle ----------

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

  // ---------- Thin delegates ----------

  /// Opens or toggles the Settings panel in the left-edge activity bar.
  function toggleSettings(): void {
    edges.activateEdgePanel(SETTINGS_PANEL_ID, 'left');
  }

  /// Toggles the details rail. Goes through `activateEdgePanel` which
  /// already implements the toggle (click active → collapse; otherwise
  /// activate + expand). Per-tab `minimumSize` is enforced by
  /// `applyActiveTabConstraints` reacting to the active-panel change.
  function toggleSessionDetailsPanel(): void {
    edges.activateEdgePanel(SESSION_DETAILS_PANEL_ID, 'right');
  }

  /// Returns true if the rail singleton is currently open. Reactive
  /// — backed by `detailsOpen` ref maintained via dockview add/remove
  /// events. Consumers can read directly without computed-wrapping.
  function isSessionDetailsOpen(): boolean {
    return detailsOpen.value;
  }

  // ---------- Reset ----------

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
      seeds.seedDefaultLayout();
    } catch (err) {
      console.error('[layoutStore.resetToDefault] seedDefaultLayout threw', err);
    }
  }

  return {
    api,
    bodyApi,
    activeSessionId,
    lastFocusedSessionId,
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
    // panel CRUD (addPanel, addTerminalPanel, removePanel, activatePanel,
    // replaceMissingPanel, firstBodyGroupId, rescueChatPanelsFromEdgeGroups)
    ...crud,
    // edge panels (activateEdgePanel, revealEdgePanel, openEdgePanel,
    // pruneEmptyEdgeGroup, isPanelOpen, closePanel, toggleEdgeGroup,
    // removePanel, activatePanel)
    ...edges,
    // serialization (snapshot, restore, seedDefaultLayout)
    ...seeds,
    toggleSettings,
    toggleSessionDetailsPanel,
    isSessionDetailsOpen,
    resetToDefault,
  };
});
