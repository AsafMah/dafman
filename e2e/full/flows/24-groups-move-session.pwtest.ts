/// F24 — Move session between groups + survive restart.
///
/// Exercises G4a (move-to-group menu logic) end-to-end:
///   create 2 groups + session in group 1
///   moveSessionToGroup(session, group2)
///   restart bun
///   assert session restored in group 2
///
/// Catches the regression class where `moveSessionToGroup`'s
/// prune-then-add isn't atomic, or where the moved session's group
/// assignment doesn't survive the persist/restore cycle.

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

test("session moved across groups survives bun restart in the target group", async ({ page }) => {
  await page.goto(urlFor(harness, { autosession: "1" }));
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  // Wait for seeded session in group 1.
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      return w.__DAFMAN_TEST__.getState().bodyApiPanelIds.length >= 1;
    },
    { timeout: 10_000 },
  );

  const initial = await readState(page);
  const sessionId = initial.bodyApiPanelIds[0];
  const sourceGroupId = initial.groups[0].id;
  expect(sessionId).toBeTruthy();

  // Create the target group.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __DAFMAN_TEST__: { runCommand: (id: string) => Promise<unknown> };
    };
    await w.__DAFMAN_TEST__.runCommand("view.newGroup");
  });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      return w.__DAFMAN_TEST__.getState().groups.length === 2;
    },
    { timeout: 5_000 },
  );

  const afterGroup = await readState(page);
  const targetGroupId = afterGroup.groups.find((g) => g.id !== sourceGroupId)!.id;
  // After newGroup the NEW group is active. moveSessionToGroup's
  // guard returns early when `targetGroupId === activeGroupId` (UI
  // can only right-click tabs in the active group, never tabs in
  // inactive groups). Switch the active group back to the source
  // before exercising the move.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __DAFMAN_TEST__: { runCommand: (id: string) => Promise<unknown> };
    };
    await w.__DAFMAN_TEST__.runCommand("view.prevGroup");
  });
  await page.waitForFunction(
    (id) => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      return w.__DAFMAN_TEST__?.getState().activeGroupId === id;
    },
    sourceGroupId,
    { timeout: 5_000 },
  );

  // Move the seeded session into the new group.
  await page.evaluate(
    async (args: { sessionId: string; targetGroupId: string }) => {
      const w = window as unknown as {
        __DAFMAN_TEST__: {
          moveSessionToGroup: (sessionId: string, targetGroupId: string) => Promise<void>;
        };
      };
      await w.__DAFMAN_TEST__.moveSessionToGroup(args.sessionId, args.targetGroupId);
    },
    { sessionId, targetGroupId },
  );

  // Confirm the move landed before restart.
  await page.waitForFunction(
    (args: { sessionId: string; targetGroupId: string }) => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      const s = w.__DAFMAN_TEST__.getState();
      const target = s.innerPanelIds[args.targetGroupId] ?? [];
      return target.includes(args.sessionId);
    },
    { sessionId, targetGroupId },
    { timeout: 5_000 },
  );

  // Flush debounced persist, then restart.
  await page.waitForTimeout(800);
  await harness.restart();
  await page.goto(urlFor(harness));

  // Wait for both groups to hydrate + inner panel restored to target.
  await page.waitForFunction(
    (args: { sessionId: string; targetGroupId: string }) => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      const s = w.__DAFMAN_TEST__.getState();
      if (s.groups.length < 2) return false;
      const target = s.innerPanelIds[args.targetGroupId] ?? [];
      return target.includes(args.sessionId);
    },
    { sessionId, targetGroupId },
    { timeout: 15_000 },
  );

  const after = await readState(page);
  expect(after.innerPanelIds[targetGroupId] ?? []).toContain(sessionId);
  expect(after.innerPanelIds[sourceGroupId] ?? []).not.toContain(sessionId);
});
