/// F28 — renaming a session propagates to tab + sidebar (#149/#131/#151).
///
/// The title lives on one owner (the SessionRecord); the dockview tab and
/// the Sessions sidebar both DERIVE it via the displayTitle selector. A
/// rename must update both surfaces with no hand fan-out — the exact
/// propagation-gap class (#131/#133/#134) the normalization closed.
///
/// We invoke the real `setSessionName` store action (the same one the
/// rename dialog's Save button calls — full RPC round-trip through the
/// backend), rather than the /rename dialog UI: that dialog lives on the
/// `area="all"` SessionHeaderControls hosted in dockview's header-actions
/// slot, which isn't mounted in this layout (tracked separately). This
/// flow guards the propagation seam #149 actually fixed.

import { test, expect, type Page } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";
import { openActivityTab } from "../harness/pageHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

const NEW_NAME = "Renamed E2E Session";

/// Reach the live sessions Pinia store and run the real rename action
/// (resolves once the backend setSessionName RPC returns).
async function renameViaStore(page: Page, sessionId: string, name: string): Promise<void> {
  await page.evaluate(
    async ({ sessionId, name }) => {
      const root = document.querySelector("#app") as (Element & { __vue_app__?: unknown }) | null;
      const app = root?.__vue_app__ as { _context: { provides: Record<symbol, unknown> } } | undefined;
      if (!app) throw new Error("vue app not found");
      const provides = app._context.provides;
      let pinia: { _s: Map<string, { setSessionName(id: string, n: string): Promise<void> }> } | null =
        null;
      for (const sym of Object.getOwnPropertySymbols(provides)) {
        const v = provides[sym] as { _s?: unknown };
        if (v && v._s instanceof Map) {
          pinia = v as NonNullable<typeof pinia>;
          break;
        }
      }
      if (!pinia) throw new Error("pinia not found");
      await pinia._s.get("sessions")!.setSessionName(sessionId, name);
    },
    { sessionId, name },
  );
}

test("renaming a session updates the tab and the sidebar from one owner", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  await renameViaStore(page, "fake-session-1", NEW_NAME);

  // Surface 1 — the dockview tab derives the new title.
  await expect(page.getByText(NEW_NAME).first()).toBeVisible({ timeout: 10_000 });

  // Surface 2 — the Sessions sidebar row derives the same title, with no
  // separate sync. (This is the #131/#133/#134 seam.)
  await openActivityTab(page, "Sessions");
  await expect(page.getByText(NEW_NAME).nth(1)).toBeVisible({ timeout: 10_000 });
});
