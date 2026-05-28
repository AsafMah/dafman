// Regression test for issue #15. Asserts the Jobs panel's running-job
// spinner is actually animating in the prod bundle.
//
// History: two previous attempts at #15 (commits 19412d1 and 04a8f89)
// shipped to main and both broke the spinner in the live app — one
// stopped it spinning, one looked stuck visually due to glyph
// rotational symmetry. The unit tests + `bun run check` didn't catch
// either because they don't render the prod bundle in a browser.
// This probe does, by stubbing the IPC bridge and asserting on
// computed-style animation properties of the spinner SVG.

import { test, expect } from '@playwright/test';

test('Jobs panel running-job spinner actually rotates', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`);
  });

  await page.addInitScript(() => {
    const job = {
      id: 'job-1',
      title: 'Running task',
      status: 'running',
      kind: 'task',
      sessionId: 'sess-smoke-1',
      startedAt: Date.now(),
    };

    const settings = {
      appearance: { theme: 'system', reasoningVisibility: 'compact', defaultModelId: 'auto', defaultReasoningEffort: null, streaming: false, enableMermaid: false },
      layout: { dockview: null, schemaVersion: 2 },
      workspaces: { recent: [], defaultWorkspace: '' },
      notifications: { turnEnd: false, waitingForInput: true },
      tools: { defaultExcluded: [], defaultAllowed: [] },
      permissions: { defaultApproveAll: false },
      terminal: { defaultProfileId: 'platform-default', fontFamily: 'monospace', fontSize: 13, scrollback: 10_000, theme: { background: '#111827', foreground: '#d1d5db' }, addons: { search: true, webLinks: true, clipboard: true, unicode11: true, webFonts: true, progress: true, ligatures: true, image: true, unicodeGraphemes: true, webgl: true, serialize: true } },
    };

    const stub: Record<string, (args: unknown) => unknown> = {
      getSettings: () => settings,
      updateSettings: ({ next }: { next: unknown }) => next,
      createClient: () => ({ status: 'ready' }),
      listModels: () => [],
      listSessions: () => [],
      rendererLog: () => null,
      openLogFolder: () => true,
      openUrl: () => true,
      pickFolder: () => null,
      browseDirectory: () => [],
      revealPath: () => null,
      respondToRequest: () => true,
      getAuditState: () => ({ recent: [], pendingCount: 0 }),
      getLogState: () => ({ recent: [], droppedCount: 0 }),
      listJobs: () => [job],
      createSession: () => ({ id: 'sess-smoke-1', title: 'Smoke', cwd: 'C:\\smoke', workingDirectory: 'C:\\smoke', accent: '#3b82f6' }),
      getSessionMetadata: () => ({ summary: 'Smoke', context: { workingDirectory: 'C:\\smoke' } }),
      listSessionEvents: () => [],
      listSessionHistory: () => [],
      getSession: () => ({ id: 'sess-smoke-1', title: 'Smoke', cwd: 'C:\\smoke', workingDirectory: 'C:\\smoke' }),
    };

    (window as unknown as { __DAFMAN_TEST_RPC__: unknown }).__DAFMAN_TEST_RPC__ = {
      request(name: string, _args: unknown): Promise<unknown> {
        const h = stub[name];
        if (!h) {
          if (name.startsWith('list')) return Promise.resolve([]);
          return Promise.resolve(null);
        }
        return Promise.resolve(h(_args));
      },
      on() { return () => {}; },
    };
  });

  await page.goto('/');
  await page.waitForSelector('.dv-tabs-container, .activity-rail', { timeout: 15_000 });

  // Open Jobs panel
  const jobsTab = page.locator('[aria-label*="Jobs" i], [title*="Jobs" i]').first();
  if (await jobsTab.count() > 0) {
    await jobsTab.click();
    await page.waitForTimeout(500);
  }

  // Find the spinner — now PrimeVue <ProgressSpinner> (SVG)
  const spinner = page.locator('.job-main .job-spinner svg').first();
  await spinner.waitFor({ state: 'visible', timeout: 5000 });

  // Inspect SVG structure (PrimeVue class names vary across versions)
  const svgInfo = await spinner.evaluate((el) => {
    const innerHTML = el.outerHTML;
    const animated: { tagName: string; class: string; animationName: string; animationDuration: string; animationPlayState: string }[] = [];
    el.querySelectorAll('*').forEach((child) => {
      const cs = getComputedStyle(child);
      if (cs.animationName !== 'none') {
        animated.push({
          tagName: child.tagName,
          class: child.getAttribute('class') || '',
          animationName: cs.animationName,
          animationDuration: cs.animationDuration,
          animationPlayState: cs.animationPlayState,
        });
      }
    });
    const selfStyle = getComputedStyle(el);
    return {
      outerHTML: innerHTML.slice(0, 600),
      animated,
      svgAnimationName: selfStyle.animationName,
      svgAnimationDuration: selfStyle.animationDuration,
      svgAnimationPlayState: selfStyle.animationPlayState,
    };
  });

  console.log('---svg+animated children---');
  console.log(JSON.stringify(svgInfo, null, 2));

  await page.screenshot({ path: 'C:/Users/mahle/AppData/Local/Temp/dafman-jobs-spinner.png', fullPage: true });

  // Pass if any animated element was found.
  expect(svgInfo.animated.length).toBeGreaterThan(0);
});
