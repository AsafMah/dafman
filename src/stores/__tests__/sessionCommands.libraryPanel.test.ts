import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import type { DockviewApi } from 'dockview-core';
import { PANEL_IDS } from '@/constants/panels';
import { runLocalSlashCommand } from '@/lib/sessionCommands';
import { useLayoutStore } from '@/stores/shell/layoutStore';

interface FakeEdgeGroup {
  id: string;
  collapsed: boolean;
  activePanelId?: string;
}

interface FakePanel {
  id: string;
  isActive: boolean;
}

function makeLibraryDock(collapsed = false): { api: DockviewApi; edge: FakeEdgeGroup; panel: FakePanel } {
  const edge: FakeEdgeGroup = {
    id: 'edge-right',
    collapsed,
    activePanelId: PANEL_IDS.library,
  };
  const panel: FakePanel = {
    id: PANEL_IDS.library,
    isActive: false,
  };

  const api = {
    get groups() {
      return [];
    },
    get panels() {
      return [];
    },
    getPanel(id: string) {
      if (id !== PANEL_IDS.library) return undefined;

      return {
        id: panel.id,
        api: {
          get isActive() {
            return panel.isActive;
          },
          setActive: () => {
            panel.isActive = true;
            edge.activePanelId = panel.id;
          },
        },
        group: {
          get activePanel() {
            return edge.activePanelId ? { id: edge.activePanelId } : undefined;
          },
        },
      };
    },
    getEdgeGroup(position: string) {
      if (position !== 'right') return undefined;

      return {
        id: edge.id,
        isCollapsed: () => edge.collapsed,
        collapse: () => {
          edge.collapsed = true;
        },
        expand: () => {
          edge.collapsed = false;
        },
        onDidCollapsedChange: () => ({ dispose: () => {} }),
        width: 280,
        height: 600,
      };
    },
    onDidActiveGroupChange: () => ({ dispose: () => {} }),
    onDidActivePanelChange: () => ({ dispose: () => {} }),
    onDidAddPanel: () => ({ dispose: () => {} }),
    onDidRemovePanel: () => ({ dispose: () => {} }),
    onDidAddGroup: () => ({ dispose: () => {} }),
  } as unknown as DockviewApi;

  return { api, edge, panel };
}

describe('sessionCommands library panel focus', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test.each(['/agent', '/skill', '/skills', '/mcp', '/library'])(
    '%s keeps an already-open Library panel open and focuses it',
    async (slash) => {
      const dock = makeLibraryDock();
      useLayoutStore().setApi(dock.api);

      expect(await runLocalSlashCommand('s1', slash)).toBe(true);

      expect(dock.edge.collapsed).toBe(false);
      expect(dock.edge.activePanelId).toBe(PANEL_IDS.library);
      expect(dock.panel.isActive).toBe(true);
    },
  );

  test.each(['/agent', '/skill', '/skills', '/mcp', '/library'])(
    '%s expands a collapsed Library panel and focuses it',
    async (slash) => {
      const dock = makeLibraryDock(true);
      dock.panel.isActive = true;
      useLayoutStore().setApi(dock.api);

      expect(await runLocalSlashCommand('s1', slash)).toBe(true);

      expect(dock.edge.collapsed).toBe(false);
      expect(dock.edge.activePanelId).toBe(PANEL_IDS.library);
      expect(dock.panel.isActive).toBe(true);
    },
  );
});
