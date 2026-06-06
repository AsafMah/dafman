/// Body/grid panel CRUD helpers extracted from layoutStore.ts.
/// Receives reactive refs and a groups-store slice as arguments;
/// never calls useLayoutStore / useGroupsStore at module level.

import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { DockviewApi } from 'dockview-core';
import { composePanelTitle, shortPanelTitle } from './layoutUtils';

/// Minimal slice of groupsStore that these helpers actually access.
interface GroupsDep {
  activeGroupId: string | null;
  pruneSessionFromAllGroups(sessionId: string, exceptGroupId?: string | null): string[];
}

export interface PanelCrudCtx {
  api: ShallowRef<DockviewApi | null>;
  bodyApi: ComputedRef<DockviewApi | null>;
  sessionTitleResolver: Ref<((sessionId: string) => string | null | undefined) | null>;
  groupsStore: GroupsDep;
}

export function buildPanelCrud(ctx: PanelCrudCtx) {
  const { api, bodyApi, sessionTitleResolver, groupsStore } = ctx;

  /// Variant that operates on an arbitrary DockviewApi (used by addPanel
  /// when routing through bodyApi — the active group's INNER dockview).
  /// Inner dockviews have no edge groups so all their groups are body
  /// groups, but the filter is still semantically correct.
  function firstBodyGroupIdOf(dock: DockviewApi): string | undefined {
    const active = dock.activeGroup;

    if (active && active.model.location.type === 'grid') return active.id;

    for (const group of dock.groups) {
      if (group.model.location.type === 'grid') return group.id;
    }

    return undefined;
  }

  /// Returns the id of the active group when it lives inside the grid
  /// body, or — if the active group is an edge / floating / popout —
  /// the first body group we find. Returns undefined when no body
  /// group exists yet.
  function firstBodyGroupId(): string | undefined {
    const dock = api.value;

    if (!dock) return undefined;

    return firstBodyGroupIdOf(dock);
  }

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
    // then fall back to the title resolver, then the short GUID prefix.
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
    //    to the right of it so two sessions read as side-by-side panes.
    // 3. No body group exists yet → create a body group ourselves and
    //    drop the panel `direction: "within"` it.
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

  /// One-shot cleanup: scans every panel and moves any chat panels
  /// (component === "chat") that are stuck inside an edge group out
  /// to the body. Runs once after layout restore to recover from
  /// older bugs that let chat panels land in the Sessions sidebar.
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

  /// Swaps an orphan panel (a session that failed to resume on restore)
  /// for a freshly-created session, in-place: the new panel lands in the
  /// same group and the orphan is removed. Returns true if the swap happened.
  function replaceMissingPanel(orphanId: string, newSessionId: string): boolean {
    const dock = api.value;

    if (!dock) return false;

    const orphan = dock.getPanel(orphanId);

    if (!orphan) return false;

    const targetGroupId = orphan.api.group.id;

    addPanel(newSessionId, { targetGroupId });
    dock.removePanel(orphan);

    return true;
  }

  return {
    firstBodyGroupId,
    addPanel,
    addTerminalPanel,
    rescueChatPanelsFromEdgeGroups,
    replaceMissingPanel,
  };
}
