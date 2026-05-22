/// F2 — @-picker happy path + path-nav.
///
/// This is the test that would have caught the v1 file-picker
/// regressions (cwdFor returning undefined → "No matches"; `@.`
/// exiting the trigger). If it ever red-flags those classes again,
/// we'll know in 30 seconds instead of after a user complaint.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("@README opens the picker, ranks README.md first, Enter inserts a file pill", async ({
  page,
}) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.click();

  await page.keyboard.type("@READ");

  // Picker results render with role=option. The first one should be
  // README.md given our seeded workspace.
  const picker = page.locator(".file-picker").first();
  await picker.waitFor({ state: "visible", timeout: 5_000 });
  const firstOption = picker.locator('[role="option"]').first();
  await expect(firstOption).toBeVisible();
  await expect(firstOption).toContainText("README.md");

  await page.keyboard.press("Enter");

  // Pill in the editor carries the filename.
  const pill = page.locator(".composer-attachment-pill").first();
  await expect(pill).toBeVisible({ timeout: 3_000 });
  await expect(pill).toContainText("README.md");
});

test("@. does NOT exit the popup (path-nav trigger)", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.click();

  await page.keyboard.type("@.");

  // Picker stays visible. Before the v2 fix `useBasicTypeaheadTriggerMatch`
  // would have ended the trigger on `.` (PUNCTUATION includes it),
  // closing the popup. The fix passes `punctuation: ""`.
  const picker = page.locator(".file-picker").first();
  await expect(picker).toBeVisible({ timeout: 3_000 });
});

test("@./src/ lists children of src/ (path-nav mode)", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.click();

  await page.keyboard.type("@./src/");

  const picker = page.locator(".file-picker").first();
  await picker.waitFor({ state: "visible", timeout: 5_000 });
  // src/ has main.ts + app.ts from the workspace seed. Both should
  // appear; ordering: files alphabetical.
  await expect(picker.locator('[role="option"]').filter({ hasText: "app.ts" })).toBeVisible();
  await expect(picker.locator('[role="option"]').filter({ hasText: "main.ts" })).toBeVisible();
});
