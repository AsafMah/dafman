/// F15 — Tool toggle UI in the right-rail details panel (Phase 18b).
///
/// The Tools section lists built-in tools (from `rpc.tools.list`) and
/// MCP servers (from `rpc.mcp.list`). Toggling a tool edits the global
/// `settings.tools.defaultExcluded` list and surfaces a "Restart
/// session to apply" info toast — the SDK does not support runtime
/// tool mutation.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("tools section lists built-in tools and toggling surfaces a restart toast", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  const detailsPanel = page.locator(".session-details").first();
  await expect(detailsPanel).toBeVisible({ timeout: 5_000 });

  // Tools section is collapsed by default — expand it first.
  await detailsPanel.getByRole("button", { name: /^Tools/i }).first().click();

  // The fakeClient's tools.list returns bash + str_replace_editor + grep.
  await expect(detailsPanel.locator(".compact-row").first()).toBeVisible({ timeout: 5_000 });
  await expect(detailsPanel.locator("text=bash")).toBeVisible();

  // Toggle the bash tool off — it should fire a "Tool change recorded"
  // info toast referencing the restart hint.
  const bashRow = detailsPanel.locator(".compact-row").filter({ hasText: "bash" }).first();
  await bashRow.locator(".p-toggleswitch").click();
  await expect(page.locator(".p-toast-message").filter({ hasText: /tool change/i })).toBeVisible({
    timeout: 3_000,
  });
});
