/// F20 — Singleton details rail across multiple sessions.
///
/// Phase 18b post-fix: the rail is a singleton bound to
/// `layoutStore.activeSessionId`. Creating a second session does NOT
/// spawn a second rail tab; switching between chat tabs re-binds the
/// rail's content (name, etc.). Sections are collapsible and
/// localStorage-persisted; long descriptions truncate by default.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";
import { openActivityTab, openDetailsRail } from "../harness/pageHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("rail is a singleton — only one rail panel exists with multiple sessions", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  // First session: open the rail via the composer cog (no longer auto-opens).
  await openDetailsRail(page);
  await expect(page.locator(".session-details")).toHaveCount(1);

  // Create a second session via the Sessions activity panel's
  // "New session" button (SessionsManager.vue).
  await openActivityTab(page, "Sessions");
  await page.getByRole("button", { name: "New session", exact: true }).first().click();

  // Wait until a second chat composer exists.
  await expect(page.locator(".lex-composer-input")).toHaveCount(2, { timeout: 10_000 });

  // Still exactly one rail panel (not two).
  await expect(page.locator(".session-details")).toHaveCount(1);
});

test("collapsing tools section persists across reload (localStorage)", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  await openDetailsRail(page);
  const detailsPanel = page.locator(".session-details").first();
  await expect(detailsPanel).toBeVisible({ timeout: 5_000 });

  // Tools section starts collapsed by default — the tool-list should be hidden.
  await expect(detailsPanel.locator(".tool-list")).toHaveCount(0);

  // Expand it via the section toggle button.
  const toolsToggle = detailsPanel.getByRole("button", { name: /^Tools/i }).first();
  await toolsToggle.click();
  await expect(detailsPanel.locator(".tool-list").first()).toBeVisible({ timeout: 3_000 });

  // Verify localStorage was written.
  const stored = await page.evaluate(() =>
    localStorage.getItem("dafman.details.section.tools"),
  );
  expect(stored).toBe("1");
});

test("expanding a tool row reveals its description", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  await openDetailsRail(page);
  const detailsPanel = page.locator(".session-details").first();
  // Expand Tools (collapsed by default).
  await detailsPanel.getByRole("button", { name: /^Tools/i }).first().click();
  const firstRow = detailsPanel.locator(".tool-row").first();
  await firstRow.waitFor({ state: "visible", timeout: 5_000 });

  // Description hidden by default — clicking the name reveals it.
  // 22b: rows are now `.tool-row` (grouped layout) instead of bare
  // `.compact-row`, but `.compact-desc` still marks the description
  // panel since it's shared with other compact lists in the rail.
  await expect(detailsPanel.locator(".compact-desc")).toHaveCount(0);
  await firstRow.locator(".compact-name-button").click();
  await expect(detailsPanel.locator(".compact-desc").first()).toBeVisible({ timeout: 3_000 });
});
