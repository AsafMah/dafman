import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Vite builds the Vue app into ./dist; Electrobun's `copy` directives in
// `electrobun.config.ts` then place dist/index.html + dist/assets under
// `views/mainview/` inside the bundle. Dev HMR is served from port 5173,
// which `src-bun/index.ts` probes on startup.
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

