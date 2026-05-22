/// F14 — Session details right-rail panel.
///
/// Phase 18a: the gear popover was replaced by a dockview right-edge
/// panel that auto-opens with each new session, persists via
/// dockview's toJSON/fromJSON, and is toggled by the cog button in
/// the tab strip.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("details rail opens by default on session create + cog toggles it", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  // The right-rail panel should be visible automatically — locate by
  // the unique heading text the component renders.
  const detailsPanel = page.locator(".session-details").first();
  await expect(detailsPanel).toBeVisible({ timeout: 5_000 });
  const settingsToggle = detailsPanel.getByRole("button", {
    name: /session settings/i,
  });
  await expect(settingsToggle).toBeVisible();
  await expect(detailsPanel.locator("text=Session name")).toHaveCount(0);
  await settingsToggle.click();
  await expect(detailsPanel.locator("text=Session name")).toBeVisible();
  await expect(detailsPanel.locator("text=Run mode")).toBeVisible();
  await expect(detailsPanel.locator("text=Workspace")).toBeVisible();
  await expect(detailsPanel.getByRole("button", { name: /fork/i })).toBeVisible();

  // Click the cog (rendered by SessionHeaderControls in the tab actions).
  // The cog has aria-label "Close session details" when open.
  const cog = page.getByRole("button", { name: /close session details/i }).first();
  await cog.click();
  await expect(page.locator(".session-details")).toHaveCount(0);

  // Re-open via the same cog (now labelled "Open session details").
  const cogOpen = page.getByRole("button", { name: /open session details/i }).first();
  await cogOpen.click();
  await expect(page.locator(".session-details").first()).toBeVisible({ timeout: 3_000 });
});
