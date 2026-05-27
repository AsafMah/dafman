/// F23 — Creating a session in a new group lands in the NEW group.
///
/// User-reported bug from the Groups v3 sprint (2026-05-27, commits
/// `33f4d82` + `17b2123`): after creating a new group via the palette,
/// adding a session via `session.new` put the session in the OLD
/// group's inner dockview, not the active (new) one. Root cause was
/// `firstBodyGroupId()` walking outer api while `addPanel` ran on the
/// inner — picking the first body group instead of the active one.
///
/// This flow exercises the path end-to-end:
///   newGroup → assert 2 groups, active = new (second)
///   session.new → assert session lands in the second group's inner

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

test("new session created in a new group lands in the new group, not the old one", async ({ page }) => {
  // Start with autosession=1 to seed an initial session in the first
  // group, so we can tell whether the SECOND session lands in the
  // right place (vs being the only session in the only group).
  await page.goto(urlFor(harness, { autosession: "1" }));
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  await page.waitForFunction(
    () => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      return w.__DAFMAN_TEST__.getState().bodyApiPanelIds.length >= 1;
    },
    { timeout: 10_000 },
  );

  const first = await readState(page);
  expect(first.groups.length).toBe(1);
  const firstSession = first.bodyApiPanelIds[0];
  const firstGroupId = first.groups[0].id;

  // Create the second group via the palette command. This activates it.
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
  expect(afterGroup.groups.length).toBe(2);
  // Active group should be the newly-created one (the second).
  const secondGroupId = afterGroup.groups.find((g) => g.id !== firstGroupId)?.id;
  expect(secondGroupId).toBeTruthy();
  expect(afterGroup.activeGroupId).toBe(secondGroupId);

  // Now create a second session via the palette command. It should
  // land in the second group's inner dockview, not the first's.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __DAFMAN_TEST__: { runCommand: (id: string) => Promise<unknown> };
    };
    await w.__DAFMAN_TEST__.runCommand("session.new");
  });

  await page.waitForFunction(
    (prevSessionId) => {
      const w = window as unknown as { __DAFMAN_TEST__?: { getState: () => TestState } };
      if (!w.__DAFMAN_TEST__) return false;
      const s = w.__DAFMAN_TEST__.getState();
      // bodyApi is the ACTIVE group's inner; the new session must land here.
      return s.bodyApiPanelIds.length >= 1 && !s.bodyApiPanelIds.includes(prevSessionId);
    },
    firstSession,
    { timeout: 5_000 },
  );

  const after = await readState(page);
  expect(after.activeGroupId).toBe(secondGroupId);

  // Second group's inner contains the new session.
  const secondGroupInner = after.innerPanelIds[secondGroupId!] ?? [];
  expect(secondGroupInner.length).toBe(1);
  const newSession = secondGroupInner[0];
  expect(newSession).not.toBe(firstSession);

  // First group's inner still contains the seeded session, not the new one.
  const firstGroupInner = after.innerPanelIds[firstGroupId] ?? [];
  expect(firstGroupInner).toContain(firstSession);
  expect(firstGroupInner).not.toContain(newSession);
});
