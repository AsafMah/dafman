/// F22 — Settings round-trip across bun restart.
///
/// Asserts the basic settings persistence path: mutate a settings field
/// in the renderer, restart bun on the same userData, verify the field
/// is loaded back from disk.
///
/// This is the regression flow for the v14 schema. Locks in the contract
/// that `update() → settings.json → loadOrDefault() → identical settings`
/// holds end-to-end through the WS bridge (the unit-level
/// `settings.test.ts` does the same at the bun layer).

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";
import { urlFor } from "../harness/pageHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

interface SettingsLite {
  appearance: { theme: "light" | "dark" | "auto" };
}

test("appearance.theme persists across bun restart", async ({ page }) => {
  await page.goto(urlFor(harness, { autosession: "1" }));
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  // Capture the initial theme.
  const before = await harness.invokeControl<SettingsLite>("getSettings", {});
  const initial = before.appearance.theme;
  const next = initial === "dark" ? "light" : "dark";

  // Toggle via the palette command (covers the runtime command → store
  // → updateSettings IPC chain). The runCommand return resolves AFTER
  // settingsStore.setTheme() completes (which awaits the IPC).
  await page.evaluate(async () => {
    const w = window as unknown as {
      __DAFMAN_TEST__: { runCommand: (id: string) => Promise<unknown> };
    };
    await w.__DAFMAN_TEST__.runCommand("appearance.darkMode.toggle");
  });

  // Sanity: the renderer should have updated locally too.
  await page.waitForTimeout(200);

  // Wait for the bun-side getSettings to reflect the flip — confirms
  // the IPC reached the bun layer before we kill it.
  await new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const poll = async () => {
      try {
        const s = await harness.invokeControl<SettingsLite>("getSettings", {});
        if (s.appearance.theme !== initial) return resolve();
      } catch {
        /* harness may be reconnecting */
      }
      if (Date.now() - start > 5_000) return reject(new Error("theme flip didn't reach bun in 5s"));
      setTimeout(poll, 50);
    };
    void poll();
  });

  // === Restart ===
  await harness.restart();
  await page.goto(urlFor(harness, { autosession: "1" }));

  // Read the post-restart bun-side state directly. Bypasses the
  // renderer hydration timing — what we care about here is "did
  // settings.json survive the restart and re-load identically?".
  const after = await harness.invokeControl<SettingsLite>("getSettings", {});
  expect(after.appearance.theme).not.toBe(initial);
  expect(after.appearance.theme).toBe(next);
});
