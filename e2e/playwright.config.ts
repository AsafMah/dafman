// Playwright config for dafman's renderer smoke tests.
//
// Two projects, two failure modes:
//
//   - `prod`     — boots dist/ via `vite preview` (rollup IIFE bundle,
//                  exactly what ships in Electrobun production).
//   - `hmr`      — boots the source tree via `vite dev` (esbuild dep
//                  optimization + per-module ESM serving, exactly
//                  what `bun run dev:hmr` uses). Catches chunk-order
//                  bugs in the dep optimizer that the prod-bundle
//                  rollup pass papers over (e.g. the @lexical/code
//                  transitive prism-objectivec → undefined prism-c
//                  blank-screen regression).
//
// What this still ISN'T: a full WebView2 / Electrobun E2E. WebView2
// is Edge Chromium ~120; Playwright bundles ~141. They agree 99% of
// the time but a Tier-2 harness via CDP-attach to real electrobun
// is the eventual upgrade (see plans/plan-testingStrategy.prompt.md).

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.pwtest\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  // Two web servers — prod (vite preview) on 4173, dev (vite dev) on 5174.
  // Both reuse-existing in local dev to avoid repeated startup costs;
  // CI always starts fresh.
  webServer: [
    {
      command: "bun run vite preview --port 4173 --strictPort",
      url: "http://localhost:4173/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      cwd: "..",
    },
    {
      // 5174 instead of 5173 so this doesn't fight with a developer's
      // `bun run dev:hmr` running on the default port.
      command: "bun run vite --port 5174 --strictPort",
      url: "http://localhost:5174/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      cwd: "..",
    },
  ],

  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "prod",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:4173",
      },
    },
    {
      name: "hmr",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5174",
      },
    },
  ],
});
