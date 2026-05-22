// Pure helpers for sanitizing a persisted dockview layout JSON before
// handing it to `dock.fromJSON()`. Extracted from `App.vue` so they
// have unit-test coverage — every regression here strands the boot
// splash on "Restoring sessions…" / "Applying layout…" with no
// recovery surface for the user.

/// Returns a shallow copy of a dockview layout JSON with the given
/// panel id removed from `panels`, and pruned from any group's
/// `data.views` so dockview doesn't error on a dangling reference.
/// Other fields are left untouched. Pure: never mutates the input.
export function stripPanelFromLayout(layout: unknown, panelId: string): unknown {
  if (!layout || typeof layout !== "object") return layout;
  const obj = layout as Record<string, unknown>;
  const panels = obj.panels;
  if (!panels || typeof panels !== "object") return layout;
  if (!Object.prototype.hasOwnProperty.call(panels, panelId)) return layout;
  const nextPanels: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(panels as Record<string, unknown>)) {
    if (k !== panelId) nextPanels[k] = v;
  }
  const stripViews = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(stripViews);
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "views" && Array.isArray(v)) {
        next[k] = (v as unknown[]).filter((x) => x !== panelId);
      } else {
        next[k] = stripViews(v);
      }
    }
    return next;
  };
  return stripViews({ ...obj, panels: nextPanels });
}

/// Walks `edgeGroups.{left,right,top,bottom}` and sets `visible: false`
/// for any group whose `group.views` array is empty. dockview-vue's
/// fromJSON throws on a visible edge group with no views — exactly
/// the shape produced when a previously-rich rail loses every panel
/// (e.g. after a per-session → singleton migration that strips them
/// all). Returns the input as-is when no changes are needed.
export function collapseEmptyEdgeGroups(layout: unknown): unknown {
  if (!layout || typeof layout !== "object") return layout;
  const obj = layout as Record<string, unknown>;
  const edgeGroups = obj.edgeGroups;
  if (!edgeGroups || typeof edgeGroups !== "object") return layout;
  const nextEdge: Record<string, unknown> = {};
  let changed = false;
  for (const [pos, entry] of Object.entries(edgeGroups as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") {
      nextEdge[pos] = entry;
      continue;
    }
    const e = entry as Record<string, unknown>;
    const group = e.group as { views?: unknown[] } | undefined;
    const views = Array.isArray(group?.views) ? (group?.views as unknown[]) : null;
    if (views && views.length === 0 && e.visible === true) {
      nextEdge[pos] = { ...e, visible: false };
      changed = true;
    } else {
      nextEdge[pos] = entry;
    }
  }
  if (!changed) return layout;
  return { ...obj, edgeGroups: nextEdge };
}

/// Strips every panel whose id matches the legacy per-session
/// `session-details-${sessionId}` pattern from a dockview layout
/// blob, then collapses any edge groups left empty by the strip.
/// Phase 18b shipped per-session rails; the singleton refactor
/// uses a fixed id `session-details`. Any persisted layout from
/// before this commit carries N legacy panels that need to be
/// dropped before fromJSON to avoid orphan tabs in the right rail.
export function stripLegacyDetailsPanels(layout: unknown): unknown {
  if (!layout || typeof layout !== "object") return layout;
  const panels = (layout as { panels?: unknown }).panels;
  if (!panels || typeof panels !== "object") return layout;
  const legacyIds: string[] = [];
  for (const id of Object.keys(panels as Record<string, unknown>)) {
    if (id === "session-details") continue;
    if (id.startsWith("session-details-")) legacyIds.push(id);
  }
  let next: unknown = layout;
  for (const id of legacyIds) {
    next = stripPanelFromLayout(next, id);
  }
  return collapseEmptyEdgeGroups(next);
}

/// Extract panel ids from a dockview `toJSON()` blob whose
/// `contentComponent` is `"chat"`. The layout shape is roughly
/// `{ panels: Record<panelId, { contentComponent, params, ... }>, ... }`.
/// We deliberately exclude sidebar / activity-bar panels (sessions-
/// manager, settings-panel) — those don't correspond to CLI sessions
/// and asking the SDK to resume them just produces error toasts.
export function extractChatPanelIds(layout: unknown): string[] {
  if (!layout || typeof layout !== "object") return [];
  const panels = (layout as { panels?: unknown }).panels;
  if (!panels || typeof panels !== "object") return [];
  const out: string[] = [];
  for (const [id, entry] of Object.entries(
    panels as Record<string, unknown>,
  )) {
    if (!entry || typeof entry !== "object") continue;
    const component = (entry as { contentComponent?: unknown })
      .contentComponent;
    if (typeof component !== "string") continue;
    if (component !== "chat") continue;
    out.push(id);
  }
  return out;
}

/// Returns true if the persisted dockview layout JSON contains a
/// panel with the given id. Used to decide whether to add a default
/// panel on startup (e.g. Sessions sidebar).
export function persistedLayoutHasPanel(layout: unknown, panelId: string): boolean {
  if (!layout || typeof layout !== "object") return false;
  const panels = (layout as { panels?: unknown }).panels;
  if (!panels || typeof panels !== "object") return false;
  return Object.prototype.hasOwnProperty.call(panels, panelId);
}
