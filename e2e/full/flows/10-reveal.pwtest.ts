/// F10 — revealPath uses file-vs-folder strategy correctly.
///
/// Bug class: explorer was opening the parent folder for diagnostics
/// (which passes a folder path) AND for export reveals (which pass a
/// file path). Fix: on Windows, use `explorer /select,<file>` for
/// files and `explorer <dir>` for directories. The test-server
/// records each call via a spyReveal control.

import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;
let scratch: string | null = null;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
  if (scratch) {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  scratch = null;
});

test("revealPath: file path → file reveal; folder path → folder reveal", async ({ page }) => {
  // Create a real file + folder so the bun-side stat distinguishes.
  scratch = mkdtempSync(join(tmpdir(), "dafman-reveal-"));
  const file = join(scratch, "thing.txt");
  writeFileSync(file, "hi");
  const folder = join(scratch, "subdir");
  mkdirSync(folder);

  // Page just to keep the bridge alive via main.ts mount; we drive
  // RPC through the control client.
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}`);
  await harness.invokeControl<string>("__test.resetRevealSpy", {});

  await harness.invokeControl<boolean>("revealPath", { path: file });
  await harness.invokeControl<boolean>("revealPath", { path: folder });

  const calls = await harness.invokeControl<Array<{ isDir: boolean; path: string }>>(
    "__test.getRevealSpy",
    {},
  );
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual({ isDir: false, path: file });
  expect(calls[1]).toEqual({ isDir: true, path: folder });
});
