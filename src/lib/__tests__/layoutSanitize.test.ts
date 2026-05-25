/// Unit tests for `src/lib/layoutSanitize.ts`. Includes a fixture
/// captured from a real user's settings.json that triggered the
/// "stuck on Restoring sessions…" boot hang after the per-session
/// rail → singleton migration (commit 4b0297e). The right edge
/// group ended up with `views: []` AND `visible: true`, which is
/// the exact shape `collapseEmptyEdgeGroups` neutralizes.

import { describe, test, expect } from "bun:test";
import {
  collapseEmptyEdgeGroups,
  enforcePersistedEdgeMinimums,
  extractChatPanelIds,
  persistedLayoutHasPanel,
  stripLegacyDetailsPanels,
  stripPanelFromLayout,
} from "../layoutSanitize";

// Real-user fixture (redacted to use placeholder session ids).
const USER_LAYOUT_2026_05_22 = {
  grid: {
    root: {
      type: "branch",
      data: [
        {
          type: "branch",
          data: [
            {
              type: "leaf",
              data: { views: ["session-A"], activeView: "session-A", id: "1" },
              size: 210,
            },
            {
              type: "leaf",
              data: { views: ["session-B"], activeView: "session-B", id: "2" },
              size: 210,
            },
          ],
          size: 761,
        },
      ],
      size: 420,
    },
    width: 420,
    height: 761,
    orientation: "VERTICAL",
  },
  panels: {
    "session-A": {
      id: "session-A",
      contentComponent: "chat",
      tabComponent: "chatTab",
      params: { sessionId: "session-A" },
      title: "session-A…",
    },
    "session-B": {
      id: "session-B",
      contentComponent: "chat",
      tabComponent: "chatTab",
      params: { sessionId: "session-B" },
      title: "session-B…",
    },
    "sessions-manager": {
      id: "sessions-manager",
      contentComponent: "sessionsManager",
      tabComponent: "sidebarTab",
      title: "Sessions",
    },
  },
  activeGroup: "2",
  edgeGroups: {
    left: {
      size: 240,
      visible: true,
      group: {
        views: ["sessions-manager"],
        activeView: "sessions-manager",
        id: "edge-left",
        headerPosition: "left",
      },
    },
    right: {
      // The boot-hang trigger: visible=true with empty views.
      size: 480,
      visible: true,
      group: {
        views: [],
        id: "edge-right",
        headerPosition: "right",
      },
    },
  },
};

describe("collapseEmptyEdgeGroups", () => {
  test("flips visible to false for empty right edge group (the regression)", () => {
    const out = collapseEmptyEdgeGroups(USER_LAYOUT_2026_05_22) as typeof USER_LAYOUT_2026_05_22;
    expect(out.edgeGroups.right.visible).toBe(false);
    // left edge has a view → untouched.
    expect(out.edgeGroups.left.visible).toBe(true);
  });

  test("returns the input by reference when no changes are needed", () => {
    const clean = { edgeGroups: { left: { visible: true, group: { views: ["x"] } } } };
    expect(collapseEmptyEdgeGroups(clean)).toBe(clean);
  });

  test("non-object / null / no edgeGroups → passthrough", () => {
    expect(collapseEmptyEdgeGroups(null)).toBe(null);
    expect(collapseEmptyEdgeGroups("not an object")).toBe("not an object");
    expect(collapseEmptyEdgeGroups({ grid: {} })).toEqual({ grid: {} });
  });

  test("does not flip a group that's already hidden", () => {
    const input = {
      edgeGroups: { right: { visible: false, group: { views: [] } } },
    };
    expect(collapseEmptyEdgeGroups(input)).toBe(input);
  });
});

describe("stripPanelFromLayout", () => {
  test("removes the panel from panels + every views[] reference", () => {
    const out = stripPanelFromLayout(USER_LAYOUT_2026_05_22, "session-A") as typeof USER_LAYOUT_2026_05_22;
    expect(Object.keys(out.panels)).not.toContain("session-A");
    // Walk the structure and assert no `views` array still mentions
    // "session-A" anywhere.
    const allViews: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const n of node) walk(n);
        return;
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "views" && Array.isArray(v)) {
          for (const x of v) if (typeof x === "string") allViews.push(x);
        } else {
          walk(v);
        }
      }
    };
    walk(out);
    expect(allViews).not.toContain("session-A");
  });

  test("returns the input as-is when the id is not in panels", () => {
    expect(stripPanelFromLayout(USER_LAYOUT_2026_05_22, "ghost")).toBe(USER_LAYOUT_2026_05_22);
  });
});

describe("stripLegacyDetailsPanels", () => {
  test("strips session-details-{id} entries and collapses the now-empty right rail", () => {
    const withLegacy = {
      ...USER_LAYOUT_2026_05_22,
      panels: {
        ...USER_LAYOUT_2026_05_22.panels,
        "session-details-session-A": {
          id: "session-details-session-A",
          contentComponent: "sessionDetails",
          params: { sessionId: "session-A" },
          title: "Session",
        },
      },
      edgeGroups: {
        ...USER_LAYOUT_2026_05_22.edgeGroups,
        right: {
          size: 480,
          visible: true,
          group: {
            views: ["session-details-session-A"],
            activeView: "session-details-session-A",
            id: "edge-right",
            headerPosition: "right",
          },
        },
      },
    };
    const out = stripLegacyDetailsPanels(withLegacy) as {
      panels: Record<string, unknown>;
      edgeGroups: { right: { visible: boolean; group: { views: string[] } } };
    };
    expect(Object.keys(out.panels)).not.toContain("session-details-session-A");
    expect(out.edgeGroups.right.group.views).toEqual([]);
    // Collapsed because the strip emptied it.
    expect(out.edgeGroups.right.visible).toBe(false);
  });

  test("keeps the singleton 'session-details' panel untouched", () => {
    const layoutWithSingleton = {
      panels: {
        "session-details": {
          id: "session-details",
          contentComponent: "sessionDetails",
        },
      },
    };
    const out = stripLegacyDetailsPanels(layoutWithSingleton) as {
      panels: Record<string, unknown>;
    };
    expect(out.panels["session-details"]).toBeDefined();
  });

  test("user's real layout (no legacy panels) round-trips with right edge collapsed", () => {
    const out = stripLegacyDetailsPanels(USER_LAYOUT_2026_05_22) as {
      edgeGroups: { right: { visible: boolean } };
    };
    // No legacy panels to strip → just the edge-group collapse.
    expect(out.edgeGroups.right.visible).toBe(false);
  });
});

describe("extractChatPanelIds", () => {
  test("returns only contentComponent=chat ids", () => {
    expect(extractChatPanelIds(USER_LAYOUT_2026_05_22).sort()).toEqual([
      "session-A",
      "session-B",
    ]);
  });

  test("excludes sessionsManager / sessionDetails / settings panels", () => {
    const ids = extractChatPanelIds(USER_LAYOUT_2026_05_22);
    expect(ids).not.toContain("sessions-manager");
  });
});

describe("persistedLayoutHasPanel", () => {
  test("returns true for an id that exists", () => {
    expect(persistedLayoutHasPanel(USER_LAYOUT_2026_05_22, "sessions-manager")).toBe(true);
  });

  test("returns false for an absent id", () => {
    expect(persistedLayoutHasPanel(USER_LAYOUT_2026_05_22, "nope")).toBe(false);
  });

  test("safe on null / non-object", () => {
    expect(persistedLayoutHasPanel(null, "x")).toBe(false);
    expect(persistedLayoutHasPanel({}, "x")).toBe(false);
  });
});

describe("enforcePersistedEdgeMinimums", () => {
  test("clamps known left and right edge panels before dockview restore", () => {
    const layout = {
      panels: {
        library: { id: "library", contentComponent: "library" },
        "session-details": { id: "session-details", contentComponent: "sessionDetails" },
      },
      edgeGroups: {
        left: {
          size: 120,
          visible: true,
          group: { views: ["library"], activeView: "library", id: "edge-left" },
        },
        right: {
          size: 150,
          visible: true,
          group: {
            views: ["session-details"],
            activeView: "session-details",
            id: "edge-right",
          },
        },
      },
    };

    const out = enforcePersistedEdgeMinimums(layout) as {
      edgeGroups: { left: { size: number }; right: { size: number } };
    };

    expect(out.edgeGroups.left.size).toBe(320);
    expect(out.edgeGroups.right.size).toBe(380);
  });

  test("returns input by reference when edge sizes are already valid", () => {
    const layout = {
      edgeGroups: {
        left: { size: 360, group: { views: ["library"] } },
        right: { size: 380, group: { views: ["session-details"] } },
      },
    };
    expect(enforcePersistedEdgeMinimums(layout)).toBe(layout);
  });
});

// ────────────────────────────────────────────────────────────────
// Group layout helpers — stripEdges / extractEdges / mergeBodyWithEdges
// ────────────────────────────────────────────────────────────────

import {
  stripEdges,
  extractEdges,
  mergeBodyWithEdges,
  edgesOnlyLayout,
} from "../layoutSanitize";

/// Full layout fixture with both body and edge panels.
const FULL_LAYOUT = {
  grid: {
    root: {
      type: "branch",
      data: [
        {
          type: "leaf",
          data: { views: ["chat-1", "chat-2"], activeView: "chat-1", id: "1" },
          size: 400,
        },
      ],
      size: 600,
    },
    width: 400,
    height: 600,
    orientation: "VERTICAL",
  },
  panels: {
    "chat-1": {
      id: "chat-1",
      contentComponent: "chat",
      params: { sessionId: "chat-1" },
    },
    "chat-2": {
      id: "chat-2",
      contentComponent: "chat",
      params: { sessionId: "chat-2" },
    },
    "sessions-manager": {
      id: "sessions-manager",
      contentComponent: "sessionsManager",
      tabComponent: "sidebarTab",
    },
    "session-details": {
      id: "session-details",
      contentComponent: "sessionDetails",
      tabComponent: "sidebarTab",
    },
  },
  activeGroup: "1",
  edgeGroups: {
    left: {
      size: 240,
      visible: true,
      group: {
        views: ["sessions-manager"],
        activeView: "sessions-manager",
        id: "edge-left",
      },
    },
    right: {
      size: 380,
      visible: true,
      group: {
        views: ["session-details"],
        activeView: "session-details",
        id: "edge-right",
      },
    },
  },
};

describe("stripEdges", () => {
  test("removes edgeGroups and edge panel definitions", () => {
    const body = stripEdges(FULL_LAYOUT) as Record<string, unknown>;
    expect(body).not.toHaveProperty("edgeGroups");
    const panels = body.panels as Record<string, unknown>;
    expect(Object.keys(panels)).toEqual(["chat-1", "chat-2"]);
    expect(panels).not.toHaveProperty("sessions-manager");
    expect(panels).not.toHaveProperty("session-details");
  });

  test("preserves grid and activeGroup", () => {
    const body = stripEdges(FULL_LAYOUT) as Record<string, unknown>;
    expect(body.grid).toEqual(FULL_LAYOUT.grid);
    expect(body.activeGroup).toBe("1");
  });

  test("safe on null / non-object", () => {
    expect(stripEdges(null)).toBe(null);
    expect(stripEdges("string")).toBe("string");
  });

  test("no-op on layout without edge groups", () => {
    const noEdge = { grid: {}, panels: { a: {} } };
    const result = stripEdges(noEdge) as Record<string, unknown>;
    expect(Object.keys(result.panels as Record<string, unknown>)).toEqual(["a"]);
  });
});

describe("extractEdges", () => {
  test("returns edge groups and their panel definitions", () => {
    const { edgeGroups, edgePanels } = extractEdges(FULL_LAYOUT);
    expect(edgeGroups).toEqual(FULL_LAYOUT.edgeGroups);
    expect(Object.keys(edgePanels)).toEqual(["sessions-manager", "session-details"]);
  });

  test("returns empty on null / non-object", () => {
    const { edgeGroups, edgePanels } = extractEdges(null);
    expect(edgeGroups).toBeUndefined();
    expect(edgePanels).toEqual({});
  });
});

describe("mergeBodyWithEdges", () => {
  test("merges body panels with current edge groups", () => {
    const body = stripEdges(FULL_LAYOUT);
    const merged = mergeBodyWithEdges(body, FULL_LAYOUT) as typeof FULL_LAYOUT;
    expect(Object.keys(merged.panels).sort()).toEqual([
      "chat-1", "chat-2", "session-details", "sessions-manager",
    ]);
    expect(merged.edgeGroups).toEqual(FULL_LAYOUT.edgeGroups);
    expect(merged.grid).toEqual(FULL_LAYOUT.grid);
  });

  test("body panels override edge panels on id collision", () => {
    const body = { panels: { "sessions-manager": { custom: true } } };
    const merged = mergeBodyWithEdges(body, FULL_LAYOUT) as Record<string, unknown>;
    const panels = merged.panels as Record<string, unknown>;
    // Edge panel spread comes second, so it overrides body
    expect(panels["sessions-manager"]).toEqual(
      FULL_LAYOUT.panels["sessions-manager"],
    );
  });

  test("safe on null body → returns current full", () => {
    expect(mergeBodyWithEdges(null, FULL_LAYOUT)).toBe(FULL_LAYOUT);
  });

  test("safe on null full → returns body", () => {
    const body = { panels: { a: {} } };
    expect(mergeBodyWithEdges(body, null)).toBe(body);
  });
});

describe("edgesOnlyLayout", () => {
  test("produces layout with only edge panels and minimal empty grid", () => {
    const eo = edgesOnlyLayout(FULL_LAYOUT) as Record<string, unknown>;
    const panels = eo.panels as Record<string, unknown>;
    expect(Object.keys(panels).sort()).toEqual(["session-details", "sessions-manager"]);
    expect(eo.edgeGroups).toEqual(FULL_LAYOUT.edgeGroups);
    // Grid should be a minimal empty leaf, not the original (which has dangling refs)
    const grid = eo.grid as { root: { type: string; data: { views: unknown[] } } };
    expect(grid.root.type).toBe("leaf");
    expect(grid.root.data.views).toEqual([]);
  });

  test("safe on null", () => {
    expect(edgesOnlyLayout(null)).toBe(null);
  });
});
