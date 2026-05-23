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

test("composer toolbar icons and edge panel minimum widths stay visible", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  await expect(page.locator(".lex-format-glyph-bold").first()).toHaveText("B");
  await expect(page.locator(".lex-format-glyph-italic").first()).toHaveText("I");
  await expect(page.locator(".lex-terminal-glyph").first()).toHaveText(">_");

  const detailsWidth = await page.locator(".session-details").first().evaluate((el) =>
    el.getBoundingClientRect().width,
  );
  expect(detailsWidth).toBeGreaterThanOrEqual(380);

  await page.getByRole("button", { name: /Library — MCP servers/i }).click();
  const libraryPanel = page.locator(".library-panel").first();
  await expect(libraryPanel).toBeVisible({ timeout: 3_000 });
  const libraryWidth = await libraryPanel.evaluate((el) =>
    el.getBoundingClientRect().width,
  );
  expect(libraryWidth).toBeGreaterThanOrEqual(320);
});

test("composer toolbar switches to compact controls on narrow panes", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  await expect(page.locator(".mode-select-shell").first()).toBeVisible();
  await expect(page.locator(".mode-button-group").first()).toBeHidden();
  await expect(page.locator(".lex-markdown-tools").first()).toBeHidden();
  const formatOverflow = page.locator(".lex-format-overflow").first();
  await expect(formatOverflow).toBeVisible();
  await formatOverflow.click();
  await expect(page.getByRole("button", { name: "Heading 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Code block" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Numbered list" })).toBeVisible();
  await expect(
    page.locator(".session-header-controls.area-composer-left .approve-all-button .p-button-label").first(),
  ).toBeHidden();

  const toolbarSections = await page.locator(".lex-composer-toolbar > div").evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }),
  );
  for (let i = 0; i < toolbarSections.length; i++) {
    for (let j = i + 1; j < toolbarSections.length; j++) {
      const a = toolbarSections[i]!;
      const b = toolbarSections[j]!;
      const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      expect(overlapX * overlapY).toBeLessThan(1);
    }
  }
});
