/// F30 — cross-session transcript search (#241 phase 1).
///
/// The search panel + `searchSessionTranscripts` RPC are the seam unit
/// tests can't reach: a real query typed into the live panel, scanned
/// against an actual session's persisted transcript by the backend
/// registry, rendered as grouped result rows, and click-navigated back
/// to the owning message. This flow drives the whole path through the
/// real harness (chromium → wsBridge → bun → fakeClient → getEvents).
///
/// `$mod` resolves to Control on the Linux CI runner (and Windows); the
/// full-E2E job does not run macOS, so the search chord presses Control
/// explicitly.

import { test, expect, type Page } from '@playwright/test';
import { spawnBunHarness, type BunHarness } from '../harness/bunHarness';

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

/// A token unlikely to collide with any boilerplate transcript text, so a
/// match unambiguously came from the message this flow sent.
const MARKER = 'zebrafish';

async function boot(page: Page): Promise<void> {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator('.lex-composer-input').first().waitFor({ state: 'visible', timeout: 15_000 });
}

/// Send a message containing the marker and wait for the fakeClient echo
/// so the turn has settled and both the user + assistant events are
/// persisted (and thus reachable by getEvents()).
async function seedTranscript(page: Page): Promise<void> {
  const composer = page.locator('.lex-composer-input').first();
  await composer.click();
  await page.keyboard.type(`${MARKER} hello`);
  await page.keyboard.press('Enter');
  await expect(page.locator(`text=ok: ${MARKER} hello`).first()).toBeVisible({ timeout: 10_000 });
}

/// Open the search panel via the global `Mod+Shift+F` chord and wait for
/// it to render with the input focused.
async function openSearch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.focus();
  });
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyF');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await expect(page.locator('.search-panel .search-input')).toBeVisible({ timeout: 5_000 });
}

test('Mod+Shift+F opens the search panel with the input focused', async ({ page }) => {
  await boot(page);
  await openSearch(page);

  const focused = await page.evaluate(() =>
    document.activeElement?.classList.contains('search-input'),
  );
  expect(focused).toBe(true);
});

test('a matching query renders grouped result rows with a highlighted snippet', async ({
  page,
}) => {
  await boot(page);
  await seedTranscript(page);
  await openSearch(page);

  await page.locator('.search-panel .search-input').fill(MARKER);

  // Debounced (200ms) → RPC scan → grouped rows. Both the user message
  // and the `ok: …` echo contain the marker, so expect ≥ 1 row.
  await expect
    .poll(() => page.locator('.search-panel .result-row').count(), {
      timeout: 6_000,
    })
    .toBeGreaterThan(0);

  await expect(page.locator('.search-panel .result-group')).toHaveCount(1);
  await expect(page.locator('.search-panel .search-summary')).toContainText('match');

  // The marker is wrapped in a <mark> by snippetHtml.
  await expect(page.locator('.search-panel .snippet mark').first()).toContainText(MARKER);
});

test('a non-matching query shows the empty state', async ({ page }) => {
  await boot(page);
  await seedTranscript(page);
  await openSearch(page);

  await page.locator('.search-panel .search-input').fill('qwzxnope-no-such-token');

  await expect(page.locator('.search-panel .search-empty')).toBeVisible({ timeout: 6_000 });
});

test('clicking a result reveals the matching message in the owning session', async ({ page }) => {
  await boot(page);
  await seedTranscript(page);
  await openSearch(page);

  await page.locator('.search-panel .search-input').fill(MARKER);
  const firstRow = page.locator('.search-panel .result-row').first();
  await firstRow.waitFor({ state: 'visible', timeout: 6_000 });

  await firstRow.click();

  // Navigation wires openOwningSession + requestReveal(eventIndex). The
  // owning session stays the active one (single-session boot) and the
  // marker message remains rendered + visible in the transcript — proving
  // the search eventIndex maps onto a real rendered message.
  await expect(page.locator('.chat-messages').getByText(`${MARKER} hello`).first()).toBeVisible({
    timeout: 5_000,
  });
});
