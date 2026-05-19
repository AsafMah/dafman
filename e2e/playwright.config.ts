// Playwright config for dafman's renderer smoke tests.
//
// What this is: the lowest-cost "the bundle actually runs" guard.
// Loads the Vite-built `dist/index.html` in chromium, stubs the
// Electrobun RPC bridge with deterministic responses, waits for the
// boot splash to advance to ready, and asserts no console errors.
//
// What it ISN'T: a full WebView2 / Electrobun E2E. Real Electrobun
// flows + IPC against the bun side need a Tier-2 harness (see
// plans/plan-testingStrategy.prompt.md). This catches the
// blank-screen / boot-fails-to-resolve class of regression that has
// repeatedly slipped past `bun run check` because vite-build proves
// resolution but not eval.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.pwtest\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  // Serve the prod-built `dist/` over HTTP. `file://` doesn't work
  // because chromium enforces CORS on file-origin script/CSS loads,
  // which blocks the Vite bundle's relative asset URLs. `vite preview`
  // is the closest thing to "the real production server" — just an
  // sirv-style static server pointing at `dist/`.
  webServer: {
    command: "bun run vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    cwd: "..",
  },

  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
