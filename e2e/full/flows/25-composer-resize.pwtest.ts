/// F25 — Composer toolbar reflows on resize without overlap (#66).
///
/// Regression guard for the recurring composer bottom-bar layout bug:
/// at certain widths the toolbar's controls (mode picker, attach,
/// format buttons, session controls) painted ON TOP of each other
/// instead of shrinking / collapsing / wrapping. The mechanism was a
/// flex child with `min-width: 0` whose fixed-width content overflowed
/// its allocated box and, thanks to `justify-content: center` +
/// `z-index`, spilled over its siblings.
///
/// This test drives the real composer (autosession) across a ladder of
/// viewport widths and asserts that no two visible toolbar controls
/// overlap horizontally at any width. Per AGENTS.md rule 13, this is a
/// behavioural assertion (actual geometry), not an existence check.

import { test, expect } from '@playwright/test';
import { spawnBunHarness, type BunHarness } from '../harness/bunHarness';

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

/// Widths chosen to straddle every composer container-query breakpoint
/// (760 / 620 / 500 / 390) plus a couple of in-between values where the
/// JS overflow-collapse and the CSS breakpoints disagree.
const WIDTHS = [
  1280, 1100, 1000, 920, 880, 860, 840, 820, 800, 790, 780, 770, 760, 750, 740, 720, 700, 680, 660,
  640, 620, 600, 580, 560, 540, 520, 500, 480, 460, 440, 420, 400, 380, 360, 340, 320,
];

test('composer toolbar controls never overlap across the resize ladder', async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[page:err]', msg.text());
  });

  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const toolbar = page.locator('.lex-composer-toolbar').first();
  await toolbar.waitFor({ state: 'visible', timeout: 15_000 });

  const failures: string[] = [];

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 820 });
    // Let ResizeObserver + container queries settle.
    await page.waitForTimeout(120);

    const report = await page.evaluate(() => {
      const bar = document.querySelector('.lex-composer-toolbar') as HTMLElement | null;
      if (!bar) return { ok: false, reason: 'no toolbar', overlaps: [] as string[], barRect: null };

      // Collect leaf, visible, interactive controls inside the toolbar.
      // Leaf = has no descendant that is itself one of our control
      // selectors, so we measure the actual painted control box, not a
      // wrapper.
      const SELECTOR = [
        '.lex-toolbar-btn',
        '.mode-button-group',
        '.mode-select-compact',
        '.workspace-chip',
        '.approve-all-button',
        '.session-terminal-button',
        '.compact-select',
      ].join(',');

      const all = Array.from(bar.querySelectorAll<HTMLElement>(SELECTOR));
      const visible = all.filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        );
      });
      // Drop controls nested inside another collected control (e.g. a
      // button inside the selectbutton group) so we compare siblings,
      // not parent/child.
      const leaves = visible.filter(
        (el) => !visible.some((other) => other !== el && other.contains(el)),
      );

      const rects = leaves.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label:
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.className.split(/\s+/)[0],
          left: Math.round(r.left),
          right: Math.round(r.right),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
        };
      });

      // Two controls overlap if their rectangles intersect on BOTH axes
      // by more than a 1px anti-aliasing tolerance.
      const TOL = 1;
      const overlaps: string[] = [];
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (xOverlap > TOL && yOverlap > TOL) {
            overlaps.push(
              `"${a.label}" [${a.left}-${a.right}] ∩ "${b.label}" [${b.left}-${b.right}] (x=${xOverlap}px)`,
            );
          }
        }
      }

      const barRect = bar.getBoundingClientRect();
      return {
        ok: true,
        reason: '',
        overlaps,
        barRect: { left: Math.round(barRect.left), right: Math.round(barRect.right) },
        controlCount: leaves.length,
      };
    });

    expect(report.ok, `toolbar missing at width ${width}`).toBe(true);
    if (report.overlaps.length > 0) {
      failures.push(`  [${width}px] ${report.overlaps.join(' ; ')}`);
    }
  }

  expect(failures, `Composer controls overlap at these widths:\n${failures.join('\n')}`).toEqual(
    [],
  );
});
