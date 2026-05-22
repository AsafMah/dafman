/// F15 — Tool tri-state UI in the right-rail details panel (Phase 22b).
///
/// The Tools section lists built-in tools (from `rpc.tools.list`) and
/// MCP servers (from `rpc.mcp.list`), grouped by namespacedName prefix.
/// Per-tool tri-state control: Default / Only allow / Forbid. Setting
/// any non-default state surfaces a "Tool change recorded" info toast
/// — the SDK does not support runtime tool mutation, so changes only
/// take effect on next session create.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("tools section lists built-in tools and changing state surfaces a restart toast", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  const detailsPanel = page.locator(".session-details").first();
  await expect(detailsPanel).toBeVisible({ timeout: 5_000 });

  // Tools section is collapsed by default — expand it first.
  await detailsPanel.getByRole("button", { name: /^Tools/i }).first().click();

  // The fakeClient's tools.list returns bash + str_replace_editor + grep.
  await expect(detailsPanel.locator(".tool-row").first()).toBeVisible({ timeout: 5_000 });
  await expect(detailsPanel.locator("text=bash")).toBeVisible();

  // Click the "Forbid" segment in bash's tri-state SelectButton — it
  // should fire a "Tool change recorded" info toast referencing the
  // restart hint.
  const bashRow = detailsPanel.locator(".tool-row").filter({ hasText: "bash" }).first();
  await bashRow.locator(".tool-state-button").getByText("Forbid").click();
  await expect(page.locator(".p-toast-message").filter({ hasText: /tool change/i })).toBeVisible({
    timeout: 3_000,
  });
});

