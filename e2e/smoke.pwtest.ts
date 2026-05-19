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
      getSettings: () => ({
        version: 7,
        appearance: { theme: "system", reasoningVisibility: "compact", streaming: false },
        layout: { dockview: null },
        workspaces: { recent: [], defaultWorkspace: "" },
        notifications: { turnEnd: false, waitingForInput: true },
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
