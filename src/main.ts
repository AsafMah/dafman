import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import Aura from "@primeuix/themes/aura";
import { definePreset } from "@primeuix/themes";
import "primeicons/primeicons.css";
import "./style.css";
import "./lexical/lexical.css";
import App from "./App.vue";
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
// IPC. Tests inject their own bridge via `setRpcBridge` before mount.
const { bridge } = createElectrobunBridge();
setRpcBridge(bridge);

// Install the renderer→bun log bridge so console.error and uncaught
// exceptions surface in the bun JSON log, not just WebView2 devtools.
installRendererLogBridge();

// Dev-only playground: open with `?dev` during `bun run dev:hmr`. The
// dynamic import + DEV guard keeps Playground.vue out of production
// bundles via tree-shaking.
function mountWith(Root: typeof App) {
  const app = createApp(Root);
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
  app.mount("#app");
}

if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has("dev")
) {
  void import("./dev/Playground.vue").then((mod) => mountWith(mod.default));
} else {
  mountWith(App);
}
