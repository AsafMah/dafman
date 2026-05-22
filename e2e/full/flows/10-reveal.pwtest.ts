/// F10 — revealPath opens files vs folders with the right handler.
///
/// History: this used to be `explorer /select,<file>` for files
/// (open parent + highlight) and `explorer <folder>` for folders.
/// User feedback (2026-05-22) made clear that the select-in-parent
/// semantics is never what's wanted — every caller (export reveal,
/// workspace chip, attachment open) means "actually open the
/// thing". Now: files open with the OS default app, folders open
/// in Explorer. The test-server's spy still records `{isDir, path}`
/// so the renderer's stat distinction is observable.

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

test("revealPath: stats file vs folder so production can open vs reveal accordingly", async ({ page }) => {
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
