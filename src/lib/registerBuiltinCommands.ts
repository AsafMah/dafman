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

import { watch } from 'vue';
import type { ConfirmationOptions } from 'primevue/confirmationoptions';
import { invokeCommand } from '@/ipc/invoke';
import { useCommandRegistry, type Command } from '@/stores/shell/commandRegistry';
import { useClientStore } from '@/stores/app/clientStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useModelsStore } from '@/stores/library/modelsStore';
import { useToastStore } from '@/stores/app/toastStore';
import { useTerminalStore } from '@/stores/terminal/terminalStore';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import { useGroupsActions } from '@/composables/useGroupsActions';
import { SESSION_COMMANDS } from '@/lib/sessionCommands';
import { MODE_OPTIONS } from '@/lib/sessionModeOptions';
import { toErrorMessage } from '@/lib/errorMessage';
import type { ReasoningVisibility } from '@/ipc/types';

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
  const groupsStore = useGroupsStore();
  const groupsActions = useGroupsActions();
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
        layoutStore.activateEdgePanel(SESSIONS_PANEL_ID, 'left');
      },
    },
    {
      id: 'jobs.open',
      label: 'Open Jobs',
      group: 'Navigation',
      icon: 'pi pi-clock',
      keywords: ['background', 'tasks', 'autopilot'],
      run: () => {
        layoutStore.activateEdgePanel('jobs-panel', 'left');
      },
    },
    {
      id: 'terminals.open',
      label: 'Open Terminals',
      group: 'Terminal',
      icon: 'pi pi-window-maximize',
      keywords: ['shell', 'terminal', 'pty', 'settings'],
      run: () => {
        layoutStore.activateEdgePanel('terminals-panel', 'left');
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
        // Settings is a left-edge activity-bar tab in v2. Toggle
        // semantics: open if closed, collapse if active+expanded.
        layoutStore.toggleSettings();
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
        const next = current === 'dark' ? 'light' : 'dark';

        await settingsStore.setTheme(next);
      },
    },
    {
      id: 'view.newGroup',
      label: 'New Group',
      group: 'Layout',
      icon: 'pi pi-plus-circle',
      keywords: ['workspace', 'tab', 'group', 'create'],
      run: () => {
        groupsActions.newGroup();
      },
    },
    {
      id: 'view.nextGroup',
      label: 'Next Group',
      group: 'Layout',
      icon: 'pi pi-angle-right',
      keywords: ['workspace', 'switch', 'cycle'],
      run: () => {
        const groups = groupsStore.groups;
        if (groups.length <= 1) return;
        const activeId = groupsStore.activeGroupId;
        const idx = groups.findIndex((g) => g.id === activeId);
        const next = groups[(idx + 1) % groups.length];
        if (next) groupsActions.activateGroup(next.id);
      },
    },
    {
      id: 'view.prevGroup',
      label: 'Previous Group',
      group: 'Layout',
      icon: 'pi pi-angle-left',
      keywords: ['workspace', 'switch', 'cycle'],
      run: () => {
        const groups = groupsStore.groups;
        if (groups.length <= 1) return;
        const activeId = groupsStore.activeGroupId;
        const idx = groups.findIndex((g) => g.id === activeId);
        const prev = groups[(idx - 1 + groups.length) % groups.length];
        if (prev) groupsActions.activateGroup(prev.id);
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

  // ---------- Static parents: global settings (Settings group) ----------
  registry.register({
    id: 'settings.streaming.toggle',
    label: 'Toggle Streaming',
    group: 'Settings',
    icon: 'pi pi-bolt',
    keywords: ['stream', 'live', 'realtime'],
    run: async () => {
      await settingsStore.setStreaming(!settingsStore.settings.appearance.streaming);
    },
  });
  registry.register({
    id: 'settings.mermaid.toggle',
    label: 'Toggle Mermaid Diagrams',
    group: 'Settings',
    icon: 'pi pi-share-alt',
    keywords: ['diagram', 'graph', 'flowchart'],
    run: async () => {
      await settingsStore.setEnableMermaid(!settingsStore.settings.appearance.enableMermaid);
    },
  });
  registry.register({
    id: 'settings.notifications.turnEnd.toggle',
    label: 'Toggle Notification: Turn End',
    group: 'Settings',
    icon: 'pi pi-bell',
    keywords: ['notify', 'beep', 'alert', 'finished'],
    run: async () => {
      await settingsStore.setNotifications({
        turnEnd: !settingsStore.settings.notifications.turnEnd,
      });
    },
  });
  registry.register({
    id: 'settings.notifications.waitingInput.toggle',
    label: 'Toggle Notification: Waiting for Input',
    group: 'Settings',
    icon: 'pi pi-bell',
    keywords: ['notify', 'prompt', 'pending'],
    run: async () => {
      await settingsStore.setNotifications({
        waitingForInput: !settingsStore.settings.notifications.waitingForInput,
      });
    },
  });
  registry.register({
    id: 'settings.defaultApproveAll.toggle',
    label: 'Toggle Default Autopilot (approve-all)',
    group: 'Settings',
    icon: 'pi pi-bolt',
    keywords: ['autopilot', 'approve', 'auto'],
    run: async () => {
      await settingsStore.setDefaultApproveAll(!settingsStore.settings.permissions.defaultApproveAll);
    },
  });

  // ---------- Static parents: multi-value global settings ----------
  const reasoningVisibilityValues: { v: ReasoningVisibility; label: string }[] = [
    { v: 'hidden', label: 'Hidden' },
    { v: 'compact', label: 'Compact' },
    { v: 'expanded', label: 'Expanded' },
  ];
  registry.register({
    id: 'settings.reasoningVisibility',
    label: 'Set Reasoning Visibility',
    group: 'Settings',
    icon: 'pi pi-eye',
    keywords: ['reasoning', 'thoughts', 'visibility'],
    children: reasoningVisibilityValues.map(({ v, label }) => ({
      id: `settings.reasoningVisibility.${v}`,
      label,
      icon: 'pi pi-circle',
      run: async () => {
        await settingsStore.setReasoningVisibility(v);
      },
    })),
    run: () => {
      /* parent */
    },
  });

  const reasoningEffortValues: { v: string | null; label: string }[] = [
    { v: null, label: 'Default (model picks)' },
    { v: 'low', label: 'Low' },
    { v: 'medium', label: 'Medium' },
    { v: 'high', label: 'High' },
  ];
  registry.register({
    id: 'settings.defaultReasoningEffort',
    label: 'Set Default Reasoning Effort',
    group: 'Settings',
    icon: 'pi pi-cog',
    keywords: ['reasoning', 'effort', 'depth'],
    children: reasoningEffortValues.map(({ v, label }) => ({
      id: `settings.defaultReasoningEffort.${v ?? 'default'}`,
      label,
      icon: 'pi pi-circle',
      run: async () => {
        await settingsStore.setDefaultModel(settingsStore.settings.appearance.defaultModelId, v);
      },
    })),
    run: () => {
      /* parent */
    },
  });

  // ---------- Dynamic parent: Default Model (Settings group) ----------
  watch(
    () => modelsStore.models,
    (models) => {
      const children: Command[] = models.map((m) => ({
        id: `settings.defaultModel.${m.id}`,
        label: m.name,
        hint: m.id,
        icon: 'pi pi-server',
        keywords: ['default', 'model', m.id, m.name],
        run: async () => {
          await settingsStore.setDefaultModel(
            m.id,
            settingsStore.settings.appearance.defaultReasoningEffort,
          );
        },
      }));
      registry.register({
        id: 'settings.defaultModel',
        label: 'Set Default Model',
        group: 'Settings',
        icon: 'pi pi-server',
        keywords: ['default', 'model'],
        when: () => clientStore.ready && children.length > 0,
        children,
        run: () => {
          /* parent */
        },
      });
    },
    { immediate: true, deep: true },
  );

  // ---------- Dynamic parent: Default Workspace (Settings group) ----------
  watch(
    () => settingsStore.settings.workspaces.recent,
    (recent) => {
      const children: Command[] = recent.map((path) => ({
        id: `settings.defaultWorkspace.${path}`,
        label: shortPath(path),
        hint: path,
        icon: 'pi pi-folder',
        keywords: ['workspace', 'default', path],
        run: async () => {
          await settingsStore.setDefaultWorkspace(path);
        },
      }));
      registry.register({
        id: 'settings.defaultWorkspace',
        label: 'Set Default Workspace',
        group: 'Settings',
        icon: 'pi pi-folder',
        keywords: ['workspace', 'default', 'folder'],
        when: () => children.length > 0,
        children,
        run: () => {
          /* parent */
        },
      });
    },
    { immediate: true, deep: true },
  );

  // ---------- Active-session controls (Active Session group) ----------
  // These complement the existing per-model dynamic parent + run-mode
  // parent registered further below. Gated via `when()` on activeSessionId.
  registry.register({
    id: 'session.approveAll.toggle',
    label: 'Toggle Session Autopilot (approve-all)',
    group: 'Active Session',
    icon: 'pi pi-bolt',
    keywords: ['autopilot', 'approve', 'auto', 'session'],
    when: () => layoutStore.activeSessionId !== null,
    run: async () => {
      const sid = layoutStore.activeSessionId;
      if (!sid) return;
      const record = sessionsStore.getSession(sid);
      await sessionsStore.setSessionApproveAll(sid, !record?.approveAll);
    },
  });
  registry.register({
    id: 'session.reasoningOverride',
    label: 'Session Reasoning Visibility',
    group: 'Active Session',
    icon: 'pi pi-eye',
    keywords: ['reasoning', 'thoughts', 'visibility', 'session'],
    when: () => layoutStore.activeSessionId !== null,
    children: [
      { v: 'default' as const, label: 'Use Global Default' },
      { v: 'hidden' as const, label: 'Hidden' },
      { v: 'compact' as const, label: 'Compact' },
      { v: 'expanded' as const, label: 'Expanded' },
    ].map(({ v, label }) => ({
      id: `session.reasoningOverride.${v}`,
      label,
      icon: 'pi pi-circle',
      run: () => {
        const sid = layoutStore.activeSessionId;
        if (sid) sessionsStore.setSessionReasoningOverride(sid, v);
      },
    })),
    run: () => {
      /* parent */
    },
  });
  registry.register({
    id: 'session.pinAsDefaults',
    label: 'Pin Session Settings as Defaults',
    group: 'Active Session',
    icon: 'pi pi-thumbtack',
    keywords: ['pin', 'default', 'save'],
    when: () => layoutStore.activeSessionId !== null,
    run: async () => {
      const sid = layoutStore.activeSessionId;
      if (!sid) return;
      const record = sessionsStore.getSession(sid);
      if (!record) return;
      const modelId = record.model ?? settingsStore.settings.appearance.defaultModelId;
      const effort = record.reasoningEffort ?? settingsStore.settings.appearance.defaultReasoningEffort;
      try {
        await settingsStore.setDefaultModel(modelId, effort);
        if (typeof record.approveAll === 'boolean') {
          await settingsStore.setDefaultApproveAll(record.approveAll);
        }
        toasts.info('Pinned as defaults', `${modelId}${effort ? ` (${effort})` : ''}`);
      } catch (err) {
        toasts.error("Couldn't pin as defaults", toErrorMessage(err));
      }
    },
  });

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

  // ---------- Dynamic parent: New Session in <workspace> ----------
  // Single parent row whose children are the MRU entries. Re-register
  // on every change so HMR + MRU updates stay idempotent (replace-by-id).
  watch(
    () => settingsStore.settings.workspaces.recent,
    (recent) => {
      const children: Command[] = recent.map((path) => ({
        id: `session.new.workspace.${path}`,
        label: shortPath(path),
        hint: path,
        icon: 'pi pi-folder',
        keywords: ['workspace', 'folder', path],
        run: async () => {
          const record = await sessionsStore.createSession({
            workingDirectory: path,
          });

          if (record) {
            void settingsStore.recordWorkspaceUse(path);
            layoutStore.addPanel(record.id);
          }
        },
      }));
      registry.register({
        id: 'session.new.workspace',
        label: 'New Session in Workspace…',
        group: 'Sessions',
        icon: 'pi pi-folder-plus',
        keywords: ['workspace', 'folder', 'mru', 'recent'],
        when: () => clientStore.ready && children.length > 0,
        children,
        run: () => {
          /* parent — palette toggles expansion instead */
        },
      });
    },
    { immediate: true, deep: true },
  );

  // ---------- Dynamic parent: Switch Model ----------
  watch(
    () => modelsStore.models,
    (models) => {
      const children: Command[] = models.map((m) => ({
        id: `model.switch.${m.id}`,
        label: m.name,
        hint: m.id,
        icon: 'pi pi-server',
        keywords: ['model', m.id, m.name],
        run: async () => {
          const sid = layoutStore.activeSessionId;
          if (!sid) return;
          const record = sessionsStore.getSession(sid);
          await sessionsStore.setSessionModel(sid, m.id, record?.reasoningEffort ?? null);
        },
      }));
      registry.register({
        id: 'session.model',
        label: 'Switch Model',
        group: 'Active Session',
        icon: 'pi pi-server',
        keywords: ['model', 'switch'],
        when: () => clientStore.ready && layoutStore.activeSessionId !== null && children.length > 0,
        children,
        run: () => {
          /* parent */
        },
      });
    },
    { immediate: true, deep: true },
  );

  // ---------- Dynamic parent: Switch to Session ----------
  watch(
    () => sessionsStore.sessions.map((s) => ({ id: s.id, title: s.title, accent: s.accent })),
    (sessions) => {
      const children: Command[] = sessions
        .filter((r) => Boolean(layoutStore.api?.getPanel(r.id)))
        .map((r) => {
          const label = r.title ?? `Session ${r.id.slice(0, 8)}…`;
          return {
            id: `session.switch.${r.id}`,
            label,
            hint: r.id.slice(0, 8),
            icon: 'pi pi-comments',
            accent: r.accent,
            keywords: [r.id, r.id.slice(0, 8), label],
            run: () => {
              const panel = layoutStore.api?.getPanel(r.id);
              panel?.api.setActive();
            },
          };
        });
      registry.register({
        id: 'session.switch',
        label: 'Switch to Session',
        group: 'Sessions',
        icon: 'pi pi-arrow-right-arrow-left',
        keywords: ['switch', 'jump', 'session'],
        when: () => children.length > 0,
        children,
        run: () => {
          /* parent */
        },
      });
    },
    { immediate: true, deep: true },
  );

  // ---------- Static parent: Run Mode (active session) ----------
  const runModeChildren: Command[] = MODE_OPTIONS.map(({ value: mode, label, icon }) => ({
    id: `runMode.set.${mode}`,
    label,
    icon,
    keywords: ['mode', mode],
    run: async () => {
      const sid = layoutStore.activeSessionId;
      if (!sid) return;
      await sessionsStore.setSessionMode(sid, mode);
    },
  }));
  registry.register({
    id: 'session.mode',
    label: 'Run Mode',
    group: 'Active Session',
    icon: 'pi pi-sliders-h',
    keywords: ['mode', 'ask', 'edit', 'agent', 'autopilot'],
    when: () => clientStore.ready && layoutStore.activeSessionId !== null,
    children: runModeChildren,
    run: () => {
      /* parent */
    },
  });

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
