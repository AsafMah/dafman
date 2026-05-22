/// F9 — Directory pill renders with `pi-folder` icon + carries
/// `attachment.type = "directory"`.
///
/// Bug class: user reported the dir picker yielded a file-typed
/// attachment with a file icon. Fix: split `pickAttachment` so
/// caller passes the explicit `kind`; FilePicker emits the right
/// type; AttachmentNode picks the icon off the type.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("picking a directory via @-picker inserts a pill with the folder icon", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.click();
  // Type @ then "src" — directories are ranked first in our fuzzy
  // index, so "src" should be the first/only option.
  await page.keyboard.type("@src");
  const picker = page.locator(".file-picker").first();
  await picker.waitFor({ state: "visible", timeout: 5_000 });
  // The first option (by sort order: directories alphabetical) is
  // `src`. Match by the `.file-picker-item-kind` badge text "DIR"
  // and the visible name being exactly "src".
  const dirOption = picker
    .locator('[role="option"]')
    .filter({ has: page.locator('.file-picker-item-name', { hasText: /^src$/ }) })
    .first();
  await expect(dirOption).toBeVisible();
  await dirOption.click();

  const pill = page.locator(".composer-attachment-pill").first();
  await expect(pill).toBeVisible({ timeout: 3_000 });
  await expect(pill).toHaveAttribute("data-attachment-type", "directory");
  await expect(pill.locator(".pi-folder").first()).toBeVisible();
});
