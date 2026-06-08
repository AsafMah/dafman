/// F29 — global keyboard-shortcut dispatch + scope resolution (#183/#195).
///
/// The registry-driven dispatcher (`useGlobalShortcuts`) is the seam unit
/// tests can't reach: a real capture-phase `keydown` on `window`, resolved
/// against the effective bindings, with the editable-scope guard deciding
/// which chords fire while a text surface is focused. This flow drives real
/// key events through the live renderer and asserts the resulting store /
/// panel state.
///
/// Each chord gets its own fresh session so the assertions never depend on a
/// prior chord's side effect (Library and Session details share the right
/// edge, so opening one before toggling the other is order-sensitive).
///
/// `$mod` resolves to Control on the Linux CI runner (and Windows), so the
/// chords below press Control explicitly. tinykeys maps `$mod` → Meta only
/// on macOS, which the full-E2E job does not run.

import { test, expect, type Page } from '@playwright/test';
import { spawnBunHarness, type BunHarness } from '../harness/bunHarness';

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

/// Press Control(+Shift/+Alt)+<key> as a single chord.
async function chord(
  page: Page,
  key: string,
  mods: { shift?: boolean; alt?: boolean } = {},
): Promise<void> {
  await page.keyboard.down('Control');
  if (mods.shift) await page.keyboard.down('Shift');
  if (mods.alt) await page.keyboard.down('Alt');
  await page.keyboard.press(key);
  if (mods.alt) await page.keyboard.up('Alt');
  if (mods.shift) await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
}

/// Move focus off any text surface so global-scope chords are eligible.
async function blurToBody(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.focus();
  });
}

async function paletteOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector('#app') as
      | (Element & {
          __vue_app__?: {
            config: { globalProperties: { $pinia?: { _s: Map<string, { isOpen?: boolean }> } } };
          };
        })
      | null;
    const pinia = root?.__vue_app__?.config.globalProperties.$pinia;
    if (!pinia) throw new Error('pinia not found');
    return Boolean(pinia._s.get('commandPalette')?.isOpen);
  });
}

async function detailsOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector('#app') as
      | (Element & {
          __vue_app__?: {
            config: {
              globalProperties: { $pinia?: { _s: Map<string, { detailsOpen?: boolean }> } };
            };
          };
        })
      | null;
    const pinia = root?.__vue_app__?.config.globalProperties.$pinia;
    if (!pinia) throw new Error('pinia not found');
    return Boolean(pinia._s.get('layout')?.detailsOpen);
  });
}

async function libraryTabActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const tab = document.querySelector('.activity-bar-tab[aria-label="Library"]');
    return Boolean(tab && tab.className.includes('active'));
  });
}

async function boot(page: Page): Promise<void> {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator('.lex-composer-input').first().waitFor({ state: 'visible', timeout: 15_000 });
}

test('Mod+K opens the command palette', async ({ page }) => {
  await boot(page);
  await blurToBody(page);

  expect(await paletteOpen(page)).toBe(false);
  await chord(page, 'KeyK');
  await expect.poll(() => paletteOpen(page), { timeout: 5_000 }).toBe(true);

  await page.keyboard.press('Escape');
  await expect.poll(() => paletteOpen(page), { timeout: 5_000 }).toBe(false);
});

test('Mod+Shift+L opens the Library panel', async ({ page }) => {
  await boot(page);
  await blurToBody(page);

  expect(await libraryTabActive(page)).toBe(false);
  await chord(page, 'KeyL', { shift: true });
  await expect.poll(() => libraryTabActive(page), { timeout: 5_000 }).toBe(true);
});

test('Mod+I toggles the session-details panel', async ({ page }) => {
  await boot(page);
  await blurToBody(page);

  expect(await detailsOpen(page)).toBe(false);
  await chord(page, 'KeyI');
  await expect.poll(() => detailsOpen(page), { timeout: 5_000 }).toBe(true);
});

test('scope guard blocks non-allowlisted chords while a text surface is focused', async ({
  page,
}) => {
  await boot(page);

  // Focus the composer (an editable surface).
  await page.locator('.lex-composer-input').first().click();
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true'),
    )
    .toBe(true);

  // Non-allowlisted pane chord must NOT fire while editing.
  await chord(page, 'KeyL', { shift: true });
  await page.waitForTimeout(400);
  expect(await libraryTabActive(page)).toBe(false);

  // Allowlisted chord (command palette) MUST still fire while editing.
  await page.locator('.lex-composer-input').first().click();
  await chord(page, 'KeyK');
  await expect.poll(() => paletteOpen(page), { timeout: 5_000 }).toBe(true);
});

/// `Mod+Shift+K` opens the keyboard-shortcuts editor (Settings panel scrolled
/// to the section). Rebound off the original `Mod+K Mod+S` in #202 — that
/// sequence was unreachable because `Mod+K` (palette) fires on the first
/// press, shadowing any sequence sharing the prefix.
test('Mod+Shift+K opens the keyboard-shortcuts editor', async ({ page }) => {
  await boot(page);
  await blurToBody(page);

  await chord(page, 'KeyK', { shift: true });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const section = document.getElementById('keyboard-shortcuts-section');
        return Boolean(section && section.offsetParent !== null);
      }),
    )
    .toBe(true);
});
