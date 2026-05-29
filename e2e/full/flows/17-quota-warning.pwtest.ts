/// F17 — Account quota dashboard + threshold warning toast (Phase 18b).
///
/// The fakeClient returns two quota snapshots: `chat` (86% remaining)
/// and `premium_interactions` (6% remaining = 94% used). The 90%
/// threshold should fire a single warn toast at load.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";
import { openDetailsRail } from "../harness/pageHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("quota dashboard renders snapshots and fires a 90% warn toast", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  await openDetailsRail(page);
  const details = page.locator(".session-details").first();
  await expect(details).toBeVisible({ timeout: 5_000 });

  // Quota list shows both types from the fake client.
  await expect(details.locator(".quota-row").filter({ hasText: "chat" })).toBeVisible({
    timeout: 5_000,
  });
  await expect(details.locator(".quota-row").filter({ hasText: "premium_interactions" })).toBeVisible();

  // A 90%+ usage threshold should produce a warn toast referencing the type.
  await expect(
    page.locator(".p-toast-message").filter({ hasText: /quota at \d+%/i }),
  ).toBeVisible({ timeout: 3_000 });
});
