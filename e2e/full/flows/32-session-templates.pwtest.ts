/// F32 — session config templates (#243 phase 1).
///
/// Drives the capture→persist→apply path through the real harness:
/// "Save as template" reads the live session config (captureTemplate RPC →
/// TemplateService → session-templates.json), the saved template then shows
/// up in the "Apply template" picker (listTemplates round-trip via the
/// store), and applying it runs the per-session ops (applyTemplate RPC).
///
/// The warning paths (missing MCP/skill on apply) are covered by the
/// backend unit tests — the fake client's MCP/skill ops succeed silently on
/// unknown names, so they can't be driven from here.

import { test, expect, type Page } from '@playwright/test';
import { spawnBunHarness, type BunHarness } from '../harness/bunHarness';
import { openDetailsRail } from '../harness/pageHarness';

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

const TEMPLATE_NAME = 'E2E Prod Debug';

async function boot(page: Page): Promise<void> {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator('.lex-composer-input').first().waitFor({ state: 'visible', timeout: 15_000 });
  await openDetailsRail(page);
}

/// Capture the current session as a named template via the details panel.
async function saveTemplate(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save as template…' }).click();

  const form = page.locator('form.template-inline-form');
  await form.locator('.template-name-input').fill(TEMPLATE_NAME);
  await form.getByRole('button', { name: 'Save', exact: true }).click();

  // On success the capture form closes.
  await expect(page.locator('form.template-inline-form')).toHaveCount(0, { timeout: 5_000 });
}

test('saving captures the session config as a template', async ({ page }) => {
  await boot(page);
  await saveTemplate(page);

  // Reopen the Apply picker — the captured template round-trips through the
  // store/listTemplates and is selectable, proving it persisted.
  await page.getByRole('button', { name: 'Apply template…' }).click();
  await page.locator('form.template-inline-form .template-name-input').click();
  await expect(page.locator('.p-select-option', { hasText: TEMPLATE_NAME })).toBeVisible({
    timeout: 5_000,
  });
});

test('applying a saved template runs without error and closes the form', async ({ page }) => {
  await boot(page);
  await saveTemplate(page);

  await page.getByRole('button', { name: 'Apply template…' }).click();

  const form = page.locator('form.template-inline-form');
  await form.locator('.template-name-input').click();
  await page.locator('.p-select-option', { hasText: TEMPLATE_NAME }).click();
  await form.getByRole('button', { name: 'Apply', exact: true }).click();

  // applyTemplate resolved (no thrown error) → the apply form closes.
  await expect(page.locator('form.template-inline-form')).toHaveCount(0, { timeout: 5_000 });
});
