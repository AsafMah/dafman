/// F21 — Layout restore across bun restart.
///
/// First boot: autosession=1 seeds one session in the default group;
/// the flow then creates a second group via the palette command.
/// Then bun is restarted on the SAME workspace + userData (no autosession
/// on the re-goto so a regression can't be masked by a fresh seed). The
/// flow asserts both groups + the seeded session id reappear via
/// `window.__DAFMAN_TEST__.getState()`.
///
/// This is the flow that would have caught:
/// - `coerceLayout` strip (commit `c97b0a5`) — bun-side validator was
///   dropping all v3 layout fields on every save, so restart resurfaced
///   `{ dockview: null }` and zero groups.
/// - `firstBodyGroupId` outer/inner mixup (commit `33f4d82`).
/// - Missing inner `onDidLayoutChange` subscription (commit `e0de0b8`).

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";
import { urlFor } from "../harness/pageHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

interface TestState {
  activeGroupId: string;
  groups: Array<{ id: string; name: string; color: string }>;
  innerApiCount: number;
  innerPanelIds: Record<string, string[]>;
  outerPanelIds: string[];
  bodyApiPanelIds: string[];
}

async function readState(page: import("@playwright/test").Page): Promise<TestState> {
  return await page.evaluate(
    () =>
      (window as unknown as { __DAFMAN_TEST__: { getState: () => TestState } }).__DAFMAN_TEST__.getState(),
  );
}

test("two groups + seeded session restored after bun restart", async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[page:err]", msg.text());
  });

  // === First boot ===
  await page.goto(urlFor(harness, { autosession: "1" }));
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  // autosession=1 fires on a 500ms timer; wait for the seeded session
  // to land in the active group's INNER dockview (bodyApiPanelIds in
  // v3). Also wait for the __DAFMAN_TEST__ hook to attach (it wires
  // AFTER app.mount() async; the composer can be visible before it's there).
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      const s = w.__DAFMAN_TEST__.getState();
      return s.bodyApiPanelIds.length >= 1;
    },
    { timeout: 10_000 },
  );

  // Capture the seeded session id BEFORE creating the second group.
  // After view.newGroup activates the new (empty) group, bodyApi flips
  // to point at the new inner dockview and the seeded session id is
  // no longer in bodyApiPanelIds.
  const seeded = await readState(page);
  expect(seeded.bodyApiPanelIds.length).toBeGreaterThanOrEqual(1);
  const seededSessionId = seeded.bodyApiPanelIds[0];
  expect(seededSessionId).toBeTruthy();

  // Create a second group via the palette command.
  await page.evaluate(async () => {
    await (window as unknown as {
      __DAFMAN_TEST__: { runCommand: (id: string) => Promise<unknown> };
    }).__DAFMAN_TEST__.runCommand("view.newGroup");
  });

  // Wait for the second group to be in store state.
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      return w.__DAFMAN_TEST__.getState().groups.length >= 2;
    },
    { timeout: 5_000 },
  );

  const before = await readState(page);
  expect(before.groups.length).toBe(2);

  // Let the 300ms debounced persistScheduler flush before we kill bun.
  // Verify via control RPC that settings.json actually contains 2 groups
  // — proves the persist landed; otherwise the restart-restore phase is
  // testing nothing useful.
  await page.waitForTimeout(800);
  const settingsBeforeRestart = await harness.invokeControl<{
    layout: {
      outer?: unknown;
      groups?: Array<unknown>;
      activeGroupId?: string | null;
      innerBodies?: unknown;
      schemaVersion?: number;
    };
  }>("getSettings", {});
  expect(settingsBeforeRestart.layout.groups?.length ?? 0).toBe(2);
  expect(settingsBeforeRestart.layout.schemaVersion).toBe(3);

  // === Restart ===
  await harness.restart();
  // Re-goto on the NEW port. NO autosession this time — we want the
  // restore path to be the only source of state. If restore is broken,
  // we should see 0 groups / 0 panels, not a freshly-seeded one.
  await page.goto(urlFor(harness));
  // Don't wait for .lex-composer-input — after restart the active group
  // may be the empty second group (no chat panel → no composer). Wait
  // for __DAFMAN_TEST__ to wire + groups to hydrate instead.

  // Wait for the hydration cycle to populate stores. Two layers to land:
  // 1. groups + outer panels (synchronous from layout JSON).
  // 2. inner DockviewVue mounts → registerInnerApi → fromJSON restores
  //    the inner panel (async, after Vue child-component mount + @ready).
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      const s = w.__DAFMAN_TEST__.getState();
      if (s.groups.length < 2) return false;
      const allInner = Object.values(s.innerPanelIds).flat();
      return allInner.length >= 1;
    },
    { timeout: 15_000 },
  );

  const after = await readState(page);
  expect(after.groups.length).toBe(2);

  // Session restored under one of the inner dockviews. Don't depend on
  // which group is active after restore — just flatten innerPanelIds
  // across all groups and assert presence. This is the assertion the
  // `coerceLayout` strip bug fails on (with the bug, settings.json had
  // `{dockview: null}` after every save → 0 sessions restored).
  const allInnerIds = Object.values(after.innerPanelIds).flat();
  expect(allInnerIds).toContain(seededSessionId);
});
