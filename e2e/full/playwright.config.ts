/// Playwright config for the FULL E2E tier.
///
/// Different shape from the smoke tier (`../playwright.config.ts`):
/// - No `webServer`. We rely on a pre-built `vite preview` running
///   on 4173 (started by the test script). Each test spawns its own
///   bun subprocess via `harness/bunHarness.ts` and loads chromium
///   at `?testBridge=ws://localhost:<port>` to wire the renderer
///   to that subprocess.
/// - One project (chromium-prod-bundle). Adding -hmr later is cheap.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./flows",
  testMatch: /.*\.pwtest\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  webServer: {
    // Same `vite preview` as the smoke tier — port 4173. The full
    // tier's bun subprocess is independent and ephemeral per test.
    command: "bun run vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    cwd: "../..",
  },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    baseURL: "http://localhost:4173",
  },
  projects: [
    {
      name: "full",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  timeout: 30_000,
});
