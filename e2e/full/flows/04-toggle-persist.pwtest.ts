/// F4 — File picker toggle persistence.
///
/// Catches the regression class where the Hidden / Ignored toggles
/// fail to persist across page reload. Wired via localStorage:
/// `dafman.filePicker.showHidden` + `dafman.filePicker.showIgnored`.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("Alt+H + Alt+I toggles persist via localStorage and survive reload", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.click();

  // Open the picker via @ trigger.
  await page.keyboard.type("@");
  await page.locator(".file-picker").first().waitFor({ state: "visible", timeout: 5_000 });

  // Flip both toggles.
  await page.keyboard.press("Alt+h");
  await page.keyboard.press("Alt+i");

  // Assert localStorage is written.
  const hiddenPref = await page.evaluate(() =>
    localStorage.getItem("dafman.filePicker.showHidden"),
  );
  const ignoredPref = await page.evaluate(() =>
    localStorage.getItem("dafman.filePicker.showIgnored"),
  );
  expect(hiddenPref).toBe("1");
  expect(ignoredPref).toBe("1");

  // Reload + reopen the picker; assert checkboxes start checked.
  await page.reload();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.click();
  await page.keyboard.type("@");
  await page.locator(".file-picker").first().waitFor({ state: "visible", timeout: 5_000 });

  const hiddenCheckbox = page.getByLabel("Show hidden (dotfiles)");
  const ignoredCheckbox = page.getByLabel("Show ignored (node_modules, dist, …)");
  await expect(hiddenCheckbox).toBeChecked();
  await expect(ignoredCheckbox).toBeChecked();
});
