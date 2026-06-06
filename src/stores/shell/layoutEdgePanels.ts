/// Edge-group panel orchestration helpers extracted from layoutStore.ts.
/// Receives reactive refs and a groups-store slice as arguments;
/// never calls useLayoutStore / useGroupsStore at module level.

import type { ShallowRef } from 'vue';
import type { DockviewApi, EdgeGroupPosition } from 'dockview-core';
import { findActivityTabSeed } from '@/constants/panels';
import { groupId, groupPanels } from '@/stores/shell/dockviewTypes';
import type { EdgePanelOptions } from './layoutUtils';

/// Minimal slice of groupsStore that these helpers actually access.
interface GroupsDep {
  innerApis: Record<string, DockviewApi>;
}

export interface EdgePanelCtx {
  api: ShallowRef<DockviewApi | null>;
  groupsStore: GroupsDep;
  applyEdgeMinimum: (position: EdgeGroupPosition, minimumSize: number | undefined) => void;
}

export function buildEdgePanels(ctx: EdgePanelCtx) {
  const { api, groupsStore, applyEdgeMinimum } = ctx;

  function removePanel(sessionId: string): void {
    const dock = api.value;

    if (!dock) return;

    const panel = dock.getPanel(sessionId);

    if (panel) dock.removePanel(panel);
    // The session-details rail is a singleton bound to the active
    // session — closing one chat panel doesn't close the rail.
  }

  /// Brings a panel forward in its group + activates it. Used by the
  /// global PendingRequestModal to surface the owning session when a
  /// pending request fires for a non-active panel.
  function activatePanel(sessionId: string): void {
    const dock = api.value;

    if (!dock) return;

    const panel = dock.getPanel(sessionId);

    if (panel) panel.api.setActive();
  }

  /// Toggle/activate a panel that lives in an edge group.
  ///
  /// Semantics:
  ///   - panel inactive  → activate it + expand the strip if collapsed
  ///   - panel active + expanded → collapse the strip
  ///   - panel active + collapsed → expand the strip
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
  /// Use for programmatic navigation where the intent is always "show
  /// this panel" (slash commands, etc.), not activity-bar click toggles.
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
  /// pass `EdgePanelOptions`. In v2 every activity-bar panel is seeded
  /// at boot via `seedDefaultLayout`, so this just delegates to
  /// `activateEdgePanel` for the known activity-tab ids. The
  /// `initialSize` / `minimumSize` fields are IGNORED here — per-tab
  /// constraints come from the seed metadata via
  /// `applyActiveTabConstraints` instead.
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
  /// dockview's own X still tears down the parent shell so the next
  /// open gets a fresh `initialSize`.
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
  /// dockview tree. Used by toggle-style toolbar buttons to decide
  /// between open/close.
  function isPanelOpen(id: string): boolean {
    const dock = api.value;

    if (!dock) return false;

    return !!dock.getPanel(id);
  }

  /// Closes (removes) a panel by id, and also tears down the parent
  /// edge group if removing this panel leaves it empty.
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
      // dockview to clean up on its own.
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
    // in v3). innerApis is a shallowRef so values keep their
    // DockviewApi identity.
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

  /// Toggles edge-group visibility (collapse/expand a sidebar without
  /// destroying its contents).
  function toggleEdgeGroup(position: EdgeGroupPosition): void {
    const dock = api.value;

    if (!dock) return;

    if (!dock.getEdgeGroup(position)) return;

    dock.setEdgeGroupVisible(position, !dock.isEdgeGroupVisible(position));
  }

  return {
    removePanel,
    activatePanel,
    activateEdgePanel,
    revealEdgePanel,
    openEdgePanel,
    pruneEmptyEdgeGroup,
    isPanelOpen,
    closePanel,
    toggleEdgeGroup,
  };
}
