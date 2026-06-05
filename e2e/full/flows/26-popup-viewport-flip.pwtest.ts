/// F26 — composer typeahead popups stay within the viewport (#126).
///
/// Regression guard for the top-edge clip bug: with a SHORT window the
/// `@` file-picker (and `/` command menu) opens above the bottom composer
/// and must NOT clip off the top — floating-ui flip/shift keeps it on
/// screen. Dogfooded live 2026-06-04; this pins it.

import { test, expect, type Page } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

function menuRect(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[class*="mention"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      vh: window.innerHeight,
      vw: window.innerWidth,
    };
  });
}

test("@ file-picker stays within a short viewport (no top-edge clip)", async ({ page }) => {
  // A short window forces the upward menu to overflow the top unless the
  // floating-ui flip/shift keeps it bounded — the exact #126 condition.
  await page.setViewportSize({ width: 1280, height: 430 });
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);

  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.click();
  await page.keyboard.type("@m");

  const menu = page.locator('[class*="mention"]').first();
  await expect(menu).toBeVisible({ timeout: 10_000 });

  const rect = await menuRect(page);
  expect(rect).not.toBeNull();
  // Fully on-screen: not clipped at the top, not overflowing the bottom.
  expect(rect!.top).toBeGreaterThanOrEqual(0);
  expect(rect!.bottom).toBeLessThanOrEqual(rect!.vh);
  expect(rect!.left).toBeGreaterThanOrEqual(0);
  expect(rect!.right).toBeLessThanOrEqual(rect!.vw);
});
