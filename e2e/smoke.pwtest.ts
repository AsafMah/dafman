// dafman renderer smoke test.
//
// The single test in this file is the cheapest possible answer to
// "did we ship a blank screen?". It loads the production Vite bundle
// in chromium, installs a deterministic stub bridge before the bundle
// evaluates (so the bundle doesn't crash on the missing Electrobun
// host globals), then asserts:
//
//   1. The boot splash mounted (so the Vue tree at least started).
//   2. The boot reached "ready" (so all module-eval side-effects ran,
//      every imported plugin loaded, every RPC the boot path needs
//      returned data the stores were willing to accept).
//   3. The dockview body mounted (so the post-boot render didn't
//      crash either).
//   4. Nothing was logged to `console.error` during the run (so a
//      Vue render error or unhandled promise rejection would fail
//      the test even if the visible UI looked fine).
//
// Each of these would have caught at least one of: the prism
// load-order regression, the boot splash freeze, the dockview
// placement bugs, the command palette CSS regressions.

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

test.beforeAll(async ({}, _testInfo) => {
  // Sanity: this test relies on `dist/` being built, which the
  // Playwright `webServer` config already implicitly requires via
  // `vite preview` (it'll fail to start if dist/ is empty). No
  // explicit existsSync check needed.
});

/// Installs `window.__DAFMAN_TEST_RPC__` BEFORE the bundle evaluates.
/// `main.ts` checks for this global at the very top and uses it in
/// place of the Electrobun-bridged production bridge — that's the only
/// production-source change needed to make this smoke harness viable.
///
/// The stub returns sensible defaults for every RPC the boot path
/// reaches; unknown RPCs reject with an explanatory error (so a new
/// RPC added to the boot path without updating this stub surfaces as
/// a console.error and fails the smoke instead of silently hanging
/// the splash).
async function installRpcStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Match the shape `electroview.rpc.request` would return: the
    // boot stores expect a resolved Promise with the typed shape.
    const stub = {
      // Full settings shape — Settings is now eagerly mounted at boot
      // as a left-edge tab, so any subsection (terminal, workspaces,
      // tools, permissions, …) will dereference its part of the
      // settings tree on mount. Keep this fixture in sync with
      // `defaultSettings()` in src/stores/app/settingsStore.ts.
      getSettings: () => ({
        version: 14,
        appearance: {
          theme: "system",
          reasoningVisibility: "compact",
          defaultModelId: "auto",
          defaultReasoningEffort: null,
          streaming: false,
          enableMermaid: false,
        },
        layout: { dockview: null, schemaVersion: 2 },
        workspaces: { recent: [], defaultWorkspace: "" },
        notifications: { turnEnd: false, waitingForInput: true },
        tools: { defaultExcluded: [], defaultAllowed: [] },
        permissions: { defaultApproveAll: false },
        terminal: {
          defaultProfileId: "platform-default",
          fontFamily: "Cascadia Mono, Consolas, ui-monospace, monospace",
          fontSize: 13,
          scrollback: 10_000,
          theme: { background: "#111827", foreground: "#d1d5db" },
          addons: {
            search: true,
            webLinks: true,
            clipboard: true,
            unicode11: true,
            webFonts: true,
            progress: true,
            ligatures: true,
            image: true,
            unicodeGraphemes: true,
            webgl: true,
            serialize: true,
          },
        },
      }),
      updateSettings: ({ next }: { next: unknown }) => next,
      createClient: () => ({ status: "ready" }),
      listModels: () => [],
      listSessions: () => [],
      rendererLog: () => null,
      openLogFolder: () => true,
      openUrl: () => true,
      pickFolder: () => null,
      browseDirectory: () => [],
      revealPath: () => null,
      respondToRequest: () => true,
      // v2 layout seeds the LogViewer panel at boot, which calls
      // auditStore.ensureInitialised → getAuditState and
      // logStore.ensureInitialised → getLogState. Return empty so
      // the panel mounts cleanly.
      getAuditState: () => ({ recent: [], pendingCount: 0 }),
      getLogState: () => ({ recent: [], droppedCount: 0 }),
      listJobs: () => [],
      // Minimal createSession stub returning a session id; the renderer
      // then asks for metadata + history below.
      createSession: () => ({
        id: 'sess-smoke-1',
        title: 'Smoke session',
        cwd: 'C:\\smoke',
        workingDirectory: 'C:\\smoke',
        accent: '#3b82f6',
      }),
      getSessionMetadata: () => ({ summary: 'Smoke session', context: { workingDirectory: 'C:\\smoke' } }),
      listSessionEvents: () => [],
      listSessionHistory: () => [],
      getSession: () => ({
        id: 'sess-smoke-1',
        title: 'Smoke session',
        cwd: 'C:\\smoke',
        workingDirectory: 'C:\\smoke',
      }),
    } as Record<string, (args: unknown) => unknown>;

    (window as unknown as { __DAFMAN_TEST_RPC__: unknown }).__DAFMAN_TEST_RPC__ = {
      request(name: string, args: unknown): Promise<unknown> {
        const handler = stub[name];
        if (!handler) {
          return Promise.reject(
            new Error(
              `Playwright stub: unhandled RPC '${name}' — add it to ` +
                `e2e/smoke.spec.ts:installRpcStub if it's part of the boot path.`,
            ),
          );
        }
        try {
          return Promise.resolve(handler(args));
        } catch (err) {
          return Promise.reject(err);
        }
      },
      onSessionEvent(): () => void {
        // No SDK events fire in the smoke; return a no-op disposer.
        return () => undefined;
      },
      onPendingRequest(): () => void {
        // No pending requests in the smoke. The handler is still
        // required by the typed bridge contract.
        return () => undefined;
      },
      onLogEvent(): () => void {
        // No live log fan-out in the smoke; the renderer's log viewer
        // will simply receive no entries.
        return () => undefined;
      },
      onAuditEvent(): () => void {
        return () => undefined;
      },
    };
  });
}

test("renderer bundle boots to ready without console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  // Capture every error-level console call + uncaught page exceptions.
  // The boot path logs at info/warn freely; only `console.error` and
  // truly uncaught exceptions are smoke-failures.
  page.on("console", (msg: ConsoleMessage) => {
    // Echo to test stdout for live diagnostics. Playwright's reporter
    // captures these alongside the failure context.
    // eslint-disable-next-line no-console
    console.log(`[page:${msg.type()}]`, msg.text());
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err: Error) => {
    // eslint-disable-next-line no-console
    console.log("[page:exception]", err.message);
    pageErrors.push(err.stack ?? err.message);
  });

  await installRpcStub(page);
  await page.goto("/");

  // BootSplash mounts on first paint; if the bundle eval'd cleanly
  // and Vue mounted, we see it within a fraction of a second.
  const splash = page.locator(".boot-splash");
  await expect(splash, "BootSplash never mounted — bundle likely failed to evaluate")
    .toBeVisible({ timeout: 10_000 });

  // The dockview body is mounted exactly once, when bootStore.phase
  // flips to "ready". So waiting for the dockview root is equivalent
  // to waiting for boot completion.
  const dockview = page.locator(".dv-dockview").first();
  await expect(dockview, "Dockview body never mounted — boot did not reach ready")
    .toBeVisible({ timeout: 15_000 });

  // v3 nested-dockview check: the outer body should have a `group` panel
  // for the Default group, rendering inside a `.group-panel-root`. The
  // inner DockviewVue should also mount, producing a second `.dv-dockview`
  // node. Asserting BOTH catches the v1 nesting failure mode where the
  // inner instance crashed silently at mount.
  //
  // Use `toBeAttached` rather than `toBeVisible` for the GroupPanel root
  // because dockview lays out body panels asynchronously after first
  // add, and the 0×0 transient lasts long enough to fail toBeVisible
  // in headless chromium. Inner dockview mounting (= 2 total
  // .dv-dockview nodes) is the real proof of nesting.
  const groupRoot = page.locator(".group-panel-root").first();
  await expect(groupRoot, "GroupPanel never mounted — outer body has no group panel")
    .toBeAttached({ timeout: 5_000 });
  const allDockviews = page.locator(".dv-dockview");
  await expect(allDockviews, "Inner DockviewVue never mounted")
    .toHaveCount(2, { timeout: 5_000 });

  // Wait for boot to fully settle then capture a screenshot for
  // human-eye verification (rule 4a). The structural assertions only
  // prove DOM presence; visual bugs (0x0 group panel, watermark
  // showing instead of group tab strip, etc.) hide from them.
  await page.waitForTimeout(500);

  // Regression guard for the "group panel landed in an edge group"
  // bug: dockview's default placement (no `position`) drops new panels
  // into the active group, which after edge-seeding is an EDGE group.
  // The visible symptom is a vertical 35-px-wide tab strip and a 0×0
  // group-panel-root. Assert the inner dockview has the body's full
  // width so this can't regress silently.
  const sizes = await page.evaluate(() => {
    const dockviews = Array.from(document.querySelectorAll('.dv-dockview'));
    return dockviews.map((d) => {
      const r = (d as HTMLElement).getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  // The inner dockview must be wider than ~200 px (i.e. not stuffed
  // into a 35 px edge strip). 200 is a deliberate floor — the actual
  // value is ~1192 in the smoke viewport.
  const innerWidth = sizes[1]?.w ?? 0;
  expect(
    innerWidth,
    `Inner dockview width is ${innerWidth}px — group panel likely landed in an edge group (regression of bootLayout.seedOuterGroupPanels). Sizes: ${JSON.stringify(sizes)}`,
  ).toBeGreaterThan(200);

  await page.screenshot({
    path: `test-results/groups-v3-${process.env.SMOKE_VARIANT ?? 'prod'}.png`,
    fullPage: true,
  });

  // Exercise: create a new group via the command palette entry. This
  // is the highest-leverage path through the v3 surface and the one
  // the user explicitly asked to verify on 2026-05-27.
  await page.evaluate(async () => {
    type DafmanTest = { runCommand: (id: string) => Promise<unknown> };
    const w = window as unknown as { __DAFMAN_TEST__?: DafmanTest };
    if (!w.__DAFMAN_TEST__) throw new Error('__DAFMAN_TEST__ not available');
    await w.__DAFMAN_TEST__.runCommand('view.newGroup');
  });
  await page.waitForTimeout(500);

  const sizes2 = await page.evaluate(() => {
    const dockviews = Array.from(document.querySelectorAll('.dv-dockview'));
    return {
      dockviewCount: dockviews.length,
      groupTabCount: document.querySelectorAll('.group-tab').length,
      activeTabName: document.querySelector('.group-tab.group-tab-active .group-tab-title')?.textContent ?? null,
      innerWidth: Math.round(
        (dockviews[1] as HTMLElement | undefined)?.getBoundingClientRect().width ?? 0,
      ),
    };
  });
  // eslint-disable-next-line no-console
  console.log('[smoke:after-newGroup]', JSON.stringify(sizes2));

  // Two outer tabs, the new one is active, inner width still full.
  expect(sizes2.groupTabCount, 'newGroup did not add a 2nd group tab').toBe(2);
  expect(sizes2.activeTabName, 'newGroup did not activate the new group').toBe('Group 2');
  expect(sizes2.innerWidth, 'inner dockview width collapsed after newGroup').toBeGreaterThan(200);

  await page.screenshot({
    path: `test-results/groups-v3-${process.env.SMOKE_VARIANT ?? 'prod'}-2groups.png`,
    fullPage: true,
  });
  // Note: not asserting `boundingBox()` dimensions here. dockview's
  // gridview lays out body panels via a ResizeObserver in a deferred
  // task that headless chromium under playwright's run loop can delay
  // unpredictably — a separate dev-boot manual check (rule 4a) covers
  // visual sizing of the group panel.

  // The splash should auto-dismiss once boot is ready.
  await expect(splash, "BootSplash did not dismiss after boot")
    .toBeHidden({ timeout: 5_000 });

  // No errors anywhere in the boot trace.
  expect(
    consoleErrors,
    `Unexpected console.error during boot:\n${consoleErrors.join("\n")}`,
  ).toEqual([]);
  expect(
    pageErrors,
    `Unhandled page exception during boot:\n${pageErrors.join("\n")}`,
  ).toEqual([]);
});
