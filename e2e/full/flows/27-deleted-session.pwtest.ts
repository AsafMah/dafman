/// F27 — deleting an open session tombstones its panel (#129).
///
/// Permanently deleting a session that's open in a panel must flip that
/// panel to read-only: a "session was deleted" banner, a disabled
/// composer, and a "(deleted)" tab label — instead of silently leaving a
/// live composer pointed at a session the CLI no longer has. Dogfooded
/// live 2026-06-04; this pins it end-to-end through the real backend.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";
import { openActivityTab } from "../harness/pageHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("deleting the open session shows the read-only tombstone", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  // Open the Sessions activity panel (left edge sidebar — leaves the chat
  // panel mounted in the body) and delete the only session.
  await openActivityTab(page, "Sessions");
  await page.getByRole("button", { name: /^Delete / }).first().click();

  // Confirm in the ConfirmPopup (acceptLabel: "Delete").
  await page.locator(".p-confirmpopup").getByRole("button", { name: "Delete" }).click();

  // The chat panel flips to the tombstone state.
  await expect(page.locator(".deleted-banner")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".deleted-banner")).toContainText(/deleted/i);

  // Composer is read-only (contenteditable flipped off).
  await expect(composer).toHaveAttribute("contenteditable", "false");

  // Tab carries the "(deleted)" marker.
  await expect(page.getByText(/\(deleted\)/).first()).toBeVisible({ timeout: 5_000 });
});
