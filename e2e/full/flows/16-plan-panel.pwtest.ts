/// F16 — Plan panel inside the right-rail details panel (Phase 18b).
///
/// `readSessionPlan` returns { exists: false } by default in the
/// fakeClient; clicking "Create plan" reveals the editor; saving
/// invokes `writeSessionPlan` and re-renders the markdown preview.

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

test("plan: empty state → edit → save round-trips", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  await openDetailsRail(page);
  const details = page.locator(".session-details").first();
  await expect(details).toBeVisible({ timeout: 5_000 });

  // The Plan section starts with "No plan yet." and a "Create plan" button.
  const planSection = details
    .locator("section.row-stack")
    .filter({ has: page.locator(".row-label", { hasText: "Plan" }) });
  await expect(planSection.locator("text=No plan yet.")).toBeVisible();

  const createBtn = planSection.getByRole("button", { name: /create plan/i });
  await createBtn.click();

  // Editor textarea appears.
  const editor = planSection.locator("textarea.plan-editor");
  await expect(editor).toBeVisible();
  await editor.fill("## My plan\n\n- step one");

  await planSection.getByRole("button", { name: /^save$/i }).click();
  await expect(page.locator(".p-toast-message").filter({ hasText: /plan saved/i })).toBeVisible({
    timeout: 3_000,
  });

  // Preview should now show the saved content (fake's writePlan just
  // returns true; our component updates planContent optimistically).
  await expect(planSection.locator(".plan-preview")).toContainText("My plan");
});
