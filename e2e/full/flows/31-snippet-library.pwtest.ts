/// F31 — prompt snippet library (#242 phase 1).
///
/// Exercises the full snippet path through the real harness: create a
/// snippet via the Library Snippets tab (→ saveSnippet RPC →
/// SnippetService → snippets.json), see it listed, insert it into the
/// active session's composer (→ palette/row → bus → Lexical editor), and
/// confirm it survives a tab remount (→ listSnippets round-trip).

import { test, expect, type Page } from '@playwright/test';
import { spawnBunHarness, type BunHarness } from '../harness/bunHarness';
import { openActivityTab } from '../harness/pageHarness';

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

const TITLE = 'Code Review Checklist';
const BODY = 'Review for zebrafish edge cases and error handling.';

async function boot(page: Page): Promise<void> {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator('.lex-composer-input').first().waitFor({ state: 'visible', timeout: 15_000 });
}

/// Open Library → Snippets and create one snippet with the marker body.
async function createSnippet(page: Page): Promise<void> {
  await openActivityTab(page, 'Library');
  await page.getByRole('tab', { name: 'Snippets' }).click();

  const tab = page.locator('.snippets-tab');
  await tab.getByRole('button', { name: 'New snippet' }).click();

  await tab.locator('.snippets-form__input').first().fill(TITLE);
  await tab.locator('.snippets-form__textarea').fill(BODY);
  await tab.getByRole('button', { name: 'Create' }).click();

  // Row is rendered once saveSnippet resolves + store updates.
  await expect(tab.locator('.snippets-list__title', { hasText: TITLE })).toBeVisible({
    timeout: 5_000,
  });
}

test('creating a snippet lists it and reports the count', async ({ page }) => {
  await boot(page);
  await createSnippet(page);

  const tab = page.locator('.snippets-tab');
  await expect(tab.locator('.snippets-list__row')).toHaveCount(1);
  await expect(tab).toContainText('1 snippet');
});

test('a created snippet survives a tab remount (listSnippets round-trip)', async ({ page }) => {
  await boot(page);
  await createSnippet(page);

  // Switch away + back; the tab re-mounts and re-fetches via listSnippets.
  await page.getByRole('tab', { name: 'Skills' }).click();
  await page.getByRole('tab', { name: 'Snippets' }).click();

  await expect(page.locator('.snippets-tab .snippets-list__title', { hasText: TITLE })).toBeVisible(
    { timeout: 5_000 },
  );
});

test('inserting a snippet drops its body into the active composer', async ({ page }) => {
  await boot(page);
  await createSnippet(page);

  await page
    .locator('.snippets-tab .snippets-list__row')
    .first()
    .getByRole('button', {
      name: 'Insert snippet',
    })
    .click();

  // The body lands at the composer cursor via the insert-composer-text bus
  // event consumed by MessageComposer for the active session.
  await expect(page.locator('.lex-composer-input').first()).toContainText('zebrafish edge cases', {
    timeout: 5_000,
  });
});
