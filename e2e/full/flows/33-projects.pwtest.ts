/// F33 — projects: per-workspace config overlay (#264 phase 1).
///
/// Exercises the two UI seams the backend unit tests can't reach: the
/// "Save as project" capture action (details panel → captureProjectFromSession
/// → ProjectService → projects.json) and the create-time auto-apply hook
/// (a new session whose cwd matches a saved project fires
/// getProjectForPath → applyProjectToSession and toasts the result).

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

async function boot(page: Page): Promise<void> {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator('.lex-composer-input').first().waitFor({ state: 'visible', timeout: 15_000 });
  await openDetailsRail(page);
}

/// Capture the active session's config as a project for its cwd.
async function saveAsProject(page: Page): Promise<void> {
  // The capture button enables once the session's cwd is backfilled
  // (async, via getSessionMetadata after create).
  const trigger = page.getByRole('button', { name: 'Save as project' });
  await expect(trigger).toBeEnabled({ timeout: 10_000 });
  await trigger.click();

  const form = page.locator('.capture-project-form');
  await expect(form).toBeVisible({ timeout: 5_000 });
  await form.getByRole('button', { name: 'Save', exact: true }).click();

  // On success the capture form collapses (capturingProject → false).
  await expect(form).toHaveCount(0, { timeout: 5_000 });
}

test('saving a session as a project captures it for the workspace', async ({ page }) => {
  await boot(page);
  await saveAsProject(page);
  // Form closed = captureProjectFromSession round-tripped through the real
  // backend (build + persist to projects.json) without error.
});

test('a new session in a project workspace auto-applies the project defaults', async ({ page }) => {
  await boot(page);
  await saveAsProject(page);

  // Create a fresh session via the renderer (session.new goes through
  // sessionsStore.createSession, which carries the auto-apply hook). The new
  // session shares the autosession's workspace cwd, so getProjectForPath
  // matches the project just saved and applyProjectToSession runs.
  await page.evaluate(() => {
    const t = (window as unknown as { __DAFMAN_TEST__?: { runCommand(id: string): void } })
      .__DAFMAN_TEST__;
    t?.runCommand('session.new');
  });

  await expect(
    page.locator('.p-toast-message').filter({ hasText: /project defaults applied/i }),
  ).toBeVisible({ timeout: 8_000 });
});
