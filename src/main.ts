import { createApp } from "vue";
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
import "./lexical/prismExtraLanguages";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import Aura from "@primeuix/themes/aura";
import { definePreset } from "@primeuix/themes";
import "primeicons/primeicons.css";
import "dockview-vue/dist/styles/dockview.css";
import "./style.css";
import "./lexical/lexical.css";
// KaTeX styles for math rendering inside MessageContent.vue (the
// markdown-it-texmath plugin emits HTML that depends on these classes).
// ~80 KB minified; only paid once.
import "katex/dist/katex.min.css";
import App from "./App.vue";
import ChatPanel from "./components/ChatPanel.vue";
import ChatTab from "./components/ChatTab.vue";
import ChatTabActions from "./components/ChatTabActions.vue";
import SessionsManager from "./components/SessionsManager.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import SidebarTab from "./components/SidebarTab.vue";
import Watermark from "./components/Watermark.vue";
import { setRpcBridge } from "./ipc/invoke";
import { createElectrobunBridge } from "./ipc/electrobunBridge";
import { installRendererLogBridge } from "./ipc/rendererLog";

const GreenAura = definePreset(Aura, {
  semantic: {
    primary: {
      50: "{emerald.50}",
      100: "{emerald.100}",
      200: "{emerald.200}",
      300: "{emerald.300}",
      400: "{emerald.400}",
      500: "{emerald.500}",
      600: "{emerald.600}",
      700: "{emerald.700}",
      800: "{emerald.800}",
      900: "{emerald.900}",
      950: "{emerald.950}",
    },
  },
});

// Wire the Electrobun RPC bridge before any store/component invokes an
// IPC. Tests inject their own bridge via `setRpcBridge` before mount,
// OR by pre-setting `window.__DAFMAN_TEST_RPC__` before the bundle
// evaluates (used by the Playwright smoke harness in `e2e/`). The
// global-hook path is necessary because the bundle constructs the
// Electrobun bridge eagerly at module load, and constructing it
// outside of an Electrobun host throws on the missing
// `window.__electrobun` global.
type TestBridgeWindow = Window & {
  __DAFMAN_TEST_RPC__?: import("./ipc/invoke").RpcBridge;
};
const testBridge =
  typeof window !== "undefined"
    ? (window as TestBridgeWindow).__DAFMAN_TEST_RPC__
    : undefined;
const { bridge } = testBridge
  ? { bridge: testBridge }
  : createElectrobunBridge();
setRpcBridge(bridge);

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
    const componentName =
      (instance?.$options?.name as string | undefined) ??
      (instance?.$options?.__name as string | undefined) ??
      "<unknown>";
    const message = err instanceof Error ? err.message : String(err);
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
        darkModeSelector: ".app-dark",
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
  app.component("chat", ChatPanel);
  app.component("sessionsManager", SessionsManager);
  app.component("settingsPanel", SettingsPanel);
  app.component("watermark", Watermark);
  app.component("chatTabActions", ChatTabActions);
  app.component("chatTab", ChatTab);
  app.component("sidebarTab", SidebarTab);
  if (import.meta.env.DEV) {
    const mod = await import("./dev/Playground.vue");
    app.component("playground", mod.default);
  }
  app.mount("#app");
}

void mountWith(App);
