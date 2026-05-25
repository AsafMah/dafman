// Seeds the command palette with the built-in command set. Called
// once from `main.ts` after Pinia is wired so the stores are
// available.
//
// Layout:
//
//   * **Static commands** (settings, log folder, new session, sessions
//     manager toggle, dark mode, playground) are registered once.
//
//   * **Dynamic commands** that depend on async stores re-register
//     themselves on every change. The registry uses replace-by-id so
//     re-running is idempotent — no manual diff/dedupe. The two
//     dynamic families today:
//       - "New Session in <workspace>" — one per MRU entry.
//       - "Switch Model: <model>" — one per available model.
//       - "Run Mode: <mode>" (3 entries, model.value gated by active session).
//
// Each command's `when()` reads live store state so the lazy filter
// in `commandRegistry.visibleCommands` updates reactively when the
// active session changes / models load / MRU changes.

import type { ConfirmationOptions } from 'primevue/confirmationoptions';
import { invokeCommand } from '@/ipc/invoke';
import { useCommandRegistry, type Command } from '@/stores/shell/commandRegistry';
import { watchDynamicCommands } from '@/lib/dynamicCommands';
import { useClientStore } from '@/stores/app/clientStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useModelsStore } from '@/stores/library/modelsStore';
import { useToastStore } from '@/stores/app/toastStore';
import { useTerminalStore } from '@/stores/terminal/terminalStore';
import { SESSION_COMMANDS } from '@/lib/sessionCommands';
import { MODE_OPTIONS } from '@/lib/sessionModeOptions';
import { toErrorMessage } from '@/lib/errorMessage';

const SESSIONS_PANEL_ID = 'sessions-manager';

/// Confirmation surface — usually `primevue/useconfirm`'s instance.
/// Typed minimally so tests can pass a stub without dragging PrimeVue
/// in. Caller (App.vue setup) is responsible for resolving it from
/// the component context where `useConfirm()` is valid.
export interface ConfirmHandle {
  require(options: ConfirmationOptions): void;
}

export interface RegisterOptions {
  confirm?: ConfirmHandle;
}

/// Top-level entry point. Idempotent — safe to call from HMR boundaries.
export function registerBuiltinCommands(opts: RegisterOptions = {}): void {
  const registry = useCommandRegistry();
  const clientStore = useClientStore();
  const layoutStore = useLayoutStore();
  const sessionsStore = useSessionsStore();
  const settingsStore = useSettingsStore();
  const modelsStore = useModelsStore();
  const toasts = useToastStore();
  const confirm = opts.confirm;

  // ---------- Static: navigation / app actions ----------
  const statics: Command[] = [
    {
      id: 'sessions-manager.toggle',
      label: 'Toggle Sessions Manager',
      group: 'Navigation',
      icon: 'pi pi-list',
      keywords: ['sidebar', 'panel'],
      run: () => {
        if (layoutStore.isPanelOpen(SESSIONS_PANEL_ID)) {
          layoutStore.closePanel(SESSIONS_PANEL_ID);
        } else {
          layoutStore.openEdgePanel('left', {
            id: SESSIONS_PANEL_ID,
            component: 'sessionsManager',
            tabComponent: 'sidebarTab',
            title: 'Sessions',
            initialSize: 260,
            minimumSize: 180,
            exclusive: true,
          });
        }
      },
    },
    {
      id: 'jobs.open',
      label: 'Open Jobs',
      group: 'Navigation',
      icon: 'pi pi-clock',
      keywords: ['background', 'tasks', 'autopilot'],
      run: () => {
        const id = 'jobs-panel';

        if (layoutStore.isPanelOpen(id)) return;

        layoutStore.openEdgePanel('left', {
          id,
          component: 'jobsPanel',
          tabComponent: 'sidebarTab',
          title: 'Jobs',
          initialSize: 380,
          minimumSize: 380,
          exclusive: true,
        });
      },
    },
    {
      id: 'terminals.open',
      label: 'Open Terminals',
      group: 'Terminal',
      icon: 'pi pi-window-maximize',
      keywords: ['shell', 'terminal', 'pty', 'settings'],
      run: () => {
        const id = 'terminals-panel';

        if (layoutStore.isPanelOpen(id)) return;

        layoutStore.openEdgePanel('left', {
          id,
          component: 'terminalsPanel',
          tabComponent: 'sidebarTab',
          title: 'Terminals — running shells',
          initialSize: 360,
          minimumSize: 320,
          exclusive: true,
        });
      },
    },
    {
      id: 'terminal.new',
      label: 'New Terminal',
      group: 'Terminal',
      icon: 'pi pi-window-maximize',
      keywords: ['shell', 'pty', 'command'],
      run: async () => {
        const terminalStore = useTerminalStore();
        const summary = await terminalStore.createTerminal({
          cols: 80,
          rows: 24,
        });

        layoutStore.addTerminalPanel(summary.id, summary.title);
      },
    },
    {
      id: 'terminal.newSession',
      label: 'New Terminal in Session Workspace',
      group: 'Terminal',
      icon: 'pi pi-folder-open',
      keywords: ['shell', 'pty', 'cwd'],
      when: () => layoutStore.activeSessionId !== null,
      run: async () => {
        const sid = layoutStore.activeSessionId;
        const record = sessionsStore.getSession(sid);
        const terminalStore = useTerminalStore();
        const cwd = record?.workingDirectory ?? undefined;
        const summary = await terminalStore.createTerminal({
          cols: 80,
          rows: 24,
          ...(cwd ? { cwd } : {}),
          ...(record ? { sessionId: record.id } : {}),
          title: cwd ? `Terminal · ${cwd.split(/[\\/]/).pop()}` : 'Session Terminal',
        });

        layoutStore.addTerminalPanel(summary.id, summary.title);
      },
    },
    {
      id: 'settings.open',
      label: 'Open Settings',
      group: 'Navigation',
      icon: 'pi pi-cog',
      keywords: ['preferences', 'config'],
      run: () => {
        const id = 'settings-panel';

        if (layoutStore.isPanelOpen(id)) return;

        layoutStore.openEdgePanel('left', {
          id,
          component: 'settingsPanel',
          tabComponent: 'sidebarTab',
          title: 'Settings',
          // Keep in sync with App.vue's ActivityBar settings item —
          // both paths must use the same size or the panel jumps
          // width when opened via different surfaces.
          initialSize: 400,
          minimumSize: 380,
          exclusive: true,
        });
      },
    },
    {
      id: 'logs.openFolder',
      label: 'Open Log Folder',
      group: 'Diagnostics',
      icon: 'pi pi-folder-open',
      keywords: ['logging', 'debug', 'diagnostics'],
      run: async () => {
        try {
          const ok = await invokeCommand('openLogFolder', {});

          if (!ok) toasts.warn("Couldn't open log folder", 'Path was returned as falsy.');
        } catch (err) {
          toasts.error("Couldn't open log folder", toErrorMessage(err));
        }
      },
    },
    {
      id: 'session.new',
      label: 'New Session',
      group: 'Sessions',
      icon: 'pi pi-plus',
      keywords: ['create', 'start', 'chat'],
      when: () => clientStore.ready,
      run: async () => {
        const record = await sessionsStore.createSession();

        if (record) layoutStore.addPanel(record.id);
      },
    },
    {
      id: 'appearance.darkMode.toggle',
      label: 'Toggle Dark Mode',
      group: 'Appearance',
      icon: 'pi pi-moon',
      keywords: ['theme', 'light', 'dark'],
      run: async () => {
        const current = settingsStore.settings.appearance.theme;
        // "system" → pick the opposite of the resolved value; "light" →
        // "dark"; "dark" → "light". Simpler than threading the resolved
        // ref through.
        const next = current === 'dark' ? 'light' : 'dark';

        await settingsStore.setTheme(next);
      },
    },
  ];

  if (import.meta.env.DEV) {
    statics.push({
      id: 'dev.openPlayground',
      label: 'Open Dev Playground',
      group: 'Diagnostics',
      icon: 'pi pi-wrench',
      keywords: ['dev', 'test', 'tools'],
      run: () => {
        // The dock api is the source of truth; reach in via layoutStore.
        const dock = layoutStore.api;

        if (!dock) return;

        const existing = dock.getPanel('playground');

        if (existing) {
          existing.api.setActive();

          return;
        }

        const bodyId = layoutStore.firstBodyGroupId();

        if (bodyId) {
          dock.addPanel({
            id: 'playground',
            component: 'playground',
            title: 'Dev Playground',
            position: { referenceGroup: bodyId, direction: 'within' },
          });
        } else {
          dock.addPanel({
            id: 'playground',
            component: 'playground',
            title: 'Dev Playground',
          });
        }
      },
    });
  }

  for (const cmd of statics) registry.register(cmd);

  // ---------- Session-scoped commands (shared with slash menu) ----------
  // Each SESSION_COMMANDS entry is registered as a palette command
  // gated on an active session. The slash typeahead uses the same
  // list so Ctrl+K and "/" stay in sync.
  for (const sc of SESSION_COMMANDS) {
    registry.register({
      id: `session.cmd.${sc.slash.replace(/^\//, '')}`,
      label: sc.label,
      hint: sc.slash,
      group: sc.group,
      icon: sc.icon ? `pi ${sc.icon}` : undefined,
      keywords: [sc.slash, ...(sc.keywords ?? [])],
      when: () => layoutStore.activeSessionId !== null,
      run: async () => {
        const id = layoutStore.activeSessionId;

        if (!id) return;

        await sc.run(id);
      },
    });
  }

  // ---------- Dynamic: New Session in <workspace> (MRU) ----------
  watchDynamicCommands({
    source: () => settingsStore.settings.workspaces.recent,
    toCommand: (path) => ({
      id: `session.new.workspace.${path}`,
      label: `New Session in ${shortPath(path)}`,
      hint: path,
      group: 'Sessions',
      icon: 'pi pi-folder-plus',
      keywords: ['workspace', 'folder', path],
      when: () => clientStore.ready,
      run: async () => {
        const record = await sessionsStore.createSession({
          workingDirectory: path,
        });

        if (record) {
          void settingsStore.recordWorkspaceUse(path);
          layoutStore.addPanel(record.id);
        }
      },
    }),
    register: (cmd) => registry.register(cmd),
    unregister: (id) => registry.unregister(id),
  });

  // ---------- Dynamic: Switch Model: <model> ----------
  watchDynamicCommands({
    source: () => modelsStore.models,
    toCommand: (m) => ({
      id: `model.switch.${m.id}`,
      label: `Switch Model: ${m.name}`,
      hint: m.id,
      group: 'Active Session',
      icon: 'pi pi-server',
      keywords: ['model', m.id, m.name],
      when: () => clientStore.ready && layoutStore.activeSessionId !== null,
      run: async () => {
        const sid = layoutStore.activeSessionId;

        if (!sid) return;

        const record = sessionsStore.getSession(sid);

        await sessionsStore.setSessionModel(sid, m.id, record?.reasoningEffort ?? null);
      },
    }),
    register: (cmd) => registry.register(cmd),
    unregister: (id) => registry.unregister(id),
  });

  // ---------- Dynamic: Switch to Session: <title> ----------
  watchDynamicCommands({
    source: () =>
      sessionsStore.sessions.map((s) => ({ id: s.id, title: s.title, accent: s.accent })),
    toCommand: (r) => {
      const label = r.title ?? `Session ${r.id.slice(0, 8)}…`;

      return {
        id: `session.switch.${r.id}`,
        label: `Switch to: ${label}`,
        hint: r.id.slice(0, 8),
        group: 'Sessions',
        icon: 'pi pi-comments',
        accent: r.accent,
        keywords: [r.id, r.id.slice(0, 8), label],
        when: () => Boolean(layoutStore.api?.getPanel(r.id)),
        run: () => {
          const panel = layoutStore.api?.getPanel(r.id);

          panel?.api.setActive();
        },
      };
    },
    register: (cmd) => registry.register(cmd),
    unregister: (id) => registry.unregister(id),
  });

  // ---------- Static, but session-gated: Run Mode ----------
  for (const { value: mode, label, icon } of MODE_OPTIONS) {
    registry.register({
      id: `runMode.set.${mode}`,
      label: `Run Mode: ${label}`,
      group: 'Active Session',
      icon,
      keywords: ['mode', mode],
      when: () => clientStore.ready && layoutStore.activeSessionId !== null,
      run: async () => {
        const sid = layoutStore.activeSessionId;

        if (!sid) return;

        await sessionsStore.setSessionMode(sid, mode);
      },
    });
  }

  // ---------- Static: Reset Layout ----------
  registry.register({
    id: 'layout.reset',
    label: 'Reset Layout',
    group: 'Diagnostics',
    icon: 'pi pi-refresh',
    keywords: ['close all', 'default', 'restore', 'factory'],
    run: () => {
      const openSessionCount = sessionsStore.sessions.length;
      const doReset = () => {
        layoutStore.resetToDefault();

        if (openSessionCount > 0) {
          toasts.info(
            'Layout reset',
            `Closed ${openSessionCount} open session${openSessionCount === 1 ? '' : 's'}. Resume any of them from the Sessions sidebar.`,
          );
        } else {
          toasts.info('Layout reset', 'Sessions sidebar re-opened.');
        }
      };

      // Confirm when 2+ sessions are open. The action is reversible
      // (sessions stay resumable from the Sessions Manager) but
      // mass-closing tabs by accident is annoying enough that an
      // explicit "yes" feels right. Single-session closes go through
      // without confirm — that's the same friction the dockview X
      // already requires anyway.
      if (openSessionCount >= 2 && confirm) {
        confirm.require({
          message: `Reset layout? This will close ${openSessionCount} open sessions. They'll still be available in the Sessions Manager and can be resumed from there.`,
          header: 'Reset Layout',
          icon: 'pi pi-refresh',
          acceptLabel: 'Reset',
          rejectLabel: 'Cancel',
          accept: doReset,
        });
      } else {
        doReset();
      }
    },
  });
}

/// Compact a workspace path for the command label. `C:\Users\…\dafman`
/// reads better than the full absolute path; the full path is kept in
/// the `hint` (right column) and fuzzy-search corpus.
function shortPath(path: string): string {
  if (!path) return '';

  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(sep).filter(Boolean);

  if (parts.length <= 2) return path;

  return `${parts[0]}${sep}…${sep}${parts[parts.length - 1]}`;
}
