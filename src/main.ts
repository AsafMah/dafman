import { createApp } from 'vue';
// Prism grammar registrations MUST happen before any module that
// imports @lexical/code. In HMR (Vite dev) mode esbuild's dep
// optimizer chunks the @lexical/code imports of `prism-objectivec`
// and `prism-swift` into separate files but orders them BEFORE
// the chunk that defines `Prism.languages.c`, so the transitive
// `Prism.languages.extend("c", ...)` blows up at @lexical/code
// load time. Importing prismExtraLanguages at the very top of
// main.ts guarantees the full grammar set is registered before
// any other module evaluates — including the dockview ChatPanel
// and MessageComposer paths that pull @lexical/code in eagerly.
// Re-imports from MessageContent.vue / src/lib/markdown.ts are
// module-cache no-ops.
import './lexical/prismExtraLanguages';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';
import 'primeicons/primeicons.css';
import 'dockview-vue/dist/styles/dockview.css';
import './style.css';
import './lexical/lexical.css';
// KaTeX styles for math rendering inside MessageContent.vue (the
// markdown-it-texmath plugin emits HTML that depends on these classes).
// ~80 KB minified; only paid once.
import 'katex/dist/katex.min.css';
import App from '@/App.vue';
import ChatPanel from '@/components/chat/ChatPanel.vue';
import ChatTab from '@/components/chat/ChatTab.vue';
import ChatTabActions from '@/components/chat/ChatTabActions.vue';
import GroupPanel from '@/components/shell/GroupPanel.vue';
import GroupTab from '@/components/shell/GroupTab.vue';
import GroupsHeaderActions from '@/components/shell/GroupsHeaderActions.vue';
import JobsPanel from '@/components/observability/JobsPanel.vue';
import LibraryPanel from '@/components/library/LibraryPanel.vue';
import LogViewer from '@/components/observability/LogViewer.vue';
import SessionDetailsPanel from '@/components/session/SessionDetailsPanel.vue';
import SessionsManager from '@/components/session/SessionsManager.vue';
import SettingsPanel from '@/components/settings/SettingsPanel.vue';
import SidebarTab from '@/components/shell/SidebarTab.vue';
import ActivityBarTab from '@/components/shell/ActivityBarTab.vue';
import TerminalPanel from '@/components/terminal/TerminalPanel.vue';
import TerminalsPanel from '@/components/terminal/TerminalsPanel.vue';
import Watermark from '@/components/shell/Watermark.vue';
import { setRpcBridge } from '@/ipc/invoke';
import { createElectrobunBridge } from '@/ipc/electrobunBridge';
import { createWebSocketBridge } from '@/ipc/wsBridge';
import { installRendererLogBridge } from '@/ipc/rendererLog';
import { toErrorMessage } from '@/lib/errorMessage';
import { useCommandRegistry } from '@/stores/shell/commandRegistry';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import { useGroupsActions } from '@/composables/useGroupsActions';

const GreenAura = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{emerald.50}',
      100: '{emerald.100}',
      200: '{emerald.200}',
      300: '{emerald.300}',
      400: '{emerald.400}',
      500: '{emerald.500}',
      600: '{emerald.600}',
      700: '{emerald.700}',
      800: '{emerald.800}',
      900: '{emerald.900}',
      950: '{emerald.950}',
    },
  },
});

// Wire the Electrobun RPC bridge before any store/component invokes an
// IPC. Tests inject their own bridge via `setRpcBridge` before mount,
// OR by pre-setting `window.__DAFMAN_TEST_RPC__` before the bundle
// evaluates (used by the Playwright smoke harness in `e2e/`), OR by
// loading with `?testBridge=ws://host:port` which switches to the
// WebSocket transport (used by the real-E2E harness in `e2e/full/`).
type TestBridgeWindow = Window & {
  __DAFMAN_TEST_RPC__?: import('@/ipc/invoke').RpcBridge;
};
const testBridge =
  typeof window !== 'undefined' ? (window as TestBridgeWindow).__DAFMAN_TEST_RPC__ : undefined;

function pickBridge(): import('@/ipc/invoke').RpcBridge {
  if (testBridge) return testBridge;

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const wsUrl = params.get('testBridge');

    if (wsUrl) return createWebSocketBridge(wsUrl);
  }

  return createElectrobunBridge().bridge;
}

setRpcBridge(pickBridge());

// Install the renderer→bun log bridge so console.error and uncaught
// exceptions surface in the bun JSON log, not just WebView2 devtools.
installRendererLogBridge();

// Dev-only playground: registered as a dockview panel component
// `"playground"` when in dev builds. Activity-bar's wrench item opens
// it as a body panel. The dynamic import keeps Playground.vue out of
// production bundles via Vite's chunk-splitting.
async function mountWith(Root: typeof App) {
  const app = createApp(Root);

  // Forward Vue lifecycle errors (render, watch, async setup, …) to
  // the bun log. We deliberately rethrow into `console.error` so the
  // global console interceptor installed by `installRendererLogBridge`
  // covers devtools too — without double-logging through `rendererLog`
  // here.
  app.config.errorHandler = (err, instance, info) => {
    const componentName = instance?.$options?.name ?? instance?.$options?.__name ?? '<unknown>';
    const message = toErrorMessage(err);
    const stack = err instanceof Error ? err.stack : undefined;

    // Single log path via the console interceptor (one bun log entry,
    // visible in devtools).
    console.error(`[vue] ${message}`, { component: componentName, info, stack });
  };
  app.use(createPinia());
  app.use(PrimeVue, {
    theme: {
      preset: GreenAura,
      options: {
        darkModeSelector: '.app-dark',
      },
    },
  });
  app.use(ToastService);
  app.use(ConfirmationService);
  // dockview-vue resolves panel/watermark/header-action component names
  // via Vue's `instance.components[name]` lookup (not slots — slots
  // inside `<DockviewVue>` are dropped). Register them globally so
  // every consumer (App.vue, Playground if it ever uses dockview, …)
  // can refer to them by name in `addPanel({ component })` and the
  // `watermark-component` prop.
  // dockview-vue's findComponent() does an exact case-sensitive lookup
  // in Vue's appContext.components. Names here MUST match the strings
  // used in addPanel({ component: '...' }) and the watermark/tab props.
  /* eslint-disable vue/component-definition-name-casing -- dockview requires camelCase */
  app.component('chat', ChatPanel);
  app.component('jobsPanel', JobsPanel);
  app.component('library', LibraryPanel);
  app.component('sessionDetails', SessionDetailsPanel);
  app.component('sessionsManager', SessionsManager);
  app.component('settingsPanel', SettingsPanel);
  app.component('logViewer', LogViewer);
  app.component('terminal', TerminalPanel);
  app.component('terminalsPanel', TerminalsPanel);
  app.component('watermark', Watermark);
  app.component('chatTabActions', ChatTabActions);
  app.component('chatTab', ChatTab);
  app.component('group', GroupPanel);
  app.component('groupTab', GroupTab);
  app.component('groupsHeaderActions', GroupsHeaderActions);
  app.component('sidebarTab', SidebarTab);
  app.component('activityTab', ActivityBarTab);
  /* eslint-enable vue/component-definition-name-casing */

  if (import.meta.env.DEV) {
    const mod = await import('@/dev/Playground.vue');

    // eslint-disable-next-line vue/component-definition-name-casing
    app.component('playground', mod.default);
  }

  app.mount('#app');

  // Optional test hook — exposed both when the smoke RPC stub is
  // installed via `window.__DAFMAN_TEST_RPC__` (smoke harness in `e2e/`)
  // and when the full-tier WebSocket bridge URL param is present
  // (real-E2E harness in `e2e/full/`). Gives playwright a way to
  // invoke command palette entries by id without simulating keyboard
  // input, and to reach into the layout/groups stores for debugging.
  const wsBridgeActive =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('testBridge');

  if (testBridge || wsBridgeActive) {
    // The test surface uses the same stores/composables the app eager-loads
    // (statically imported above), so there's nothing to defer here. Earlier
    // we lazy-loaded on first method call, but that made `getState()` return a
    // Promise and broke the sync predicate contract Playwright callers rely on.
    const registry = useCommandRegistry();
    const layout = useLayoutStore();
    const groups = useGroupsStore();
    const groupsActions = useGroupsActions();

    (
      window as unknown as {
        __DAFMAN_TEST__: {
          runCommand: (id: string) => Promise<unknown>;
          addPanel: (sessionId: string) => void;
          getState: () => unknown;
          moveSessionToGroup: (sessionId: string, targetGroupId: string) => Promise<void>;
          renameGroup: (id: string, name: string) => void;
          setGroupColor: (id: string, color: string) => void;
        };
      }
    ).__DAFMAN_TEST__ = {
      async runCommand(id: string) {
        const cmd = registry.commands.get(id);

        if (!cmd) throw new Error(`Unknown command: ${id}`);

        return await cmd.run();
      },
      addPanel(sessionId: string): void {
        layout.addPanel(sessionId);
      },
      getState(): unknown {
        const innerPanelIds: Record<string, string[]> = {};

        for (const [gid, api] of Object.entries(groups.innerApis)) {
          innerPanelIds[gid] = api.panels.map((p) => p.id);
        }

        return {
          activeGroupId: groups.activeGroupId,
          groups: groups.groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
          innerApiCount: Object.keys(groups.innerApis).length,
          innerPanelIds,
          outerPanelIds: layout.api?.panels.map((p) => p.id) ?? [],
          bodyApiPanelIds: layout.bodyApi?.panels.map((p) => p.id) ?? [],
        };
      },
      async moveSessionToGroup(sessionId: string, targetGroupId: string): Promise<void> {
        await groupsActions.moveSessionToGroup(sessionId, targetGroupId);
      },
      renameGroup(id: string, name: string): void {
        groups.renameGroup(id, name);
      },
      setGroupColor(id: string, color: string): void {
        groups.setGroupColor(id, color);
      },
    };
  }
}

void mountWith(App);
