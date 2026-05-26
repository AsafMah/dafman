/// Typed views over the dockview-vue runtime shapes we touch but
/// that dockview-vue's TS surface doesn't expose directly.
///
/// dockview-vue ships type defs for its public API (`DockviewApi`,
/// `DockviewGroupPanel`, etc.) but several internal-ish properties
/// the layout store reads — `group.panels`, `edge.id`, `edge.api.{move,
/// remove}Panel`, `dock.{width,height}` — aren't in the public types.
/// Rather than scattering `as unknown as { panels?: unknown[] }`
/// shape probes across `layoutStore.ts`, this module narrows them
/// once with named interfaces + accessor functions.
///
/// **Failure mode:** if dockview-vue restructures one of these
/// fields, the cast will silently return `undefined`. Every accessor
/// returns a typed-as-`undefined` fallback so callers can `??` to a
/// sensible default. We don't throw because dockview-vue's runtime
/// shape has historically been forgiving (e.g. `width`/`height` are
/// missing during the initial mount tick).

import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from 'dockview-vue';

/// Properties on a DockviewGroupPanel that are observable at runtime
/// but not in the published types.
export interface DockviewGroupRuntime {
  id?: string;
  panels?: unknown[];
  width?: number;
  height?: number;
  /// Edge groups expose `api.moveGroup` / `api.removeGroup` for the
  /// shell to drag panels around. Mirrors EdgeGroupApi in dockview's
  /// internals.
  api?: {
    moveGroup?: (opts: unknown) => void;
    removeGroup?: () => void;
  };
}

/// Properties on the top-level DockviewApi observable at runtime but
/// not in the published types (the layout-debugger code paths use
/// width/height for orientation calcs).
export interface DockviewApiRuntime {
  width?: number;
  height?: number;
}

/// Cast a group panel to its runtime shape. Use sparingly — prefer
/// the typed accessors below when possible.
export function asGroupRuntime(group: DockviewGroupPanel | object): DockviewGroupRuntime {
  return group as DockviewGroupRuntime;
}

/// Cast the dockview API root to its runtime shape.
export function asDockviewApiRuntime(api: object | null | undefined): DockviewApiRuntime {
  return api ?? {};
}

/// Read `group.panels` (array of panels in a group). Returns `[]` when
/// dockview hasn't materialised the field yet.
export function groupPanels(group: DockviewGroupPanel | object): unknown[] {
  return asGroupRuntime(group).panels ?? [];
}

/// Read `group.id` (group's stable id within the layout). Returns
/// `undefined` when missing.
export function groupId(group: DockviewGroupPanel | object): string | undefined {
  return asGroupRuntime(group).id;
}

/// Read `group.width` (group's pixel width). Returns `undefined`
/// during initial mount; callers should `??` to a viewport fallback.
export function groupWidth(group: DockviewGroupPanel | object): number | undefined {
  return asGroupRuntime(group).width;
}

/// Read `group.height` (group's pixel height). Returns `undefined`
/// during initial mount; callers should `??` to a viewport fallback.
export function groupHeight(group: DockviewGroupPanel | object): number | undefined {
  return asGroupRuntime(group).height;
}

/// Read the dockview API's overall width. Returns `undefined` when
/// the api hasn't sized itself yet.
export function dockApiWidth(api: object | null | undefined): number | undefined {
  return asDockviewApiRuntime(api).width;
}

/// Read the dockview API's overall height. Returns `undefined` when
/// the api hasn't sized itself yet.
export function dockApiHeight(api: object | null | undefined): number | undefined {
  return asDockviewApiRuntime(api).height;
}

/// Cast for `panel.api.moveTo({ group: ... })` — dockview's published
/// types accept a specific `DockviewGroupPanel` opaque token; the
/// runtime tolerates anything with a matching id, but we still need
/// the structural cast to satisfy TS.
export function asMoveToGroup<P extends IDockviewPanel>(
  group: object,
): Parameters<P['api']['moveTo']>[0]['group'] {
  return group as Parameters<P['api']['moveTo']>[0]['group'];
}

/// Cast for `dock.removePanel(panel)`. Same rationale as above.
export function asRemovePanelArg(panel: unknown): Parameters<DockviewApi['removePanel']>[0] {
  return panel as Parameters<DockviewApi['removePanel']>[0];
}
