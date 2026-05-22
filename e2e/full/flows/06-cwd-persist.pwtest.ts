/// F6 — Session cwd persists across bun restart.
///
/// This is the bug class the user flagged as "MASSIVE":
/// resumed sessions defaulted to `process.cwd()` (the Electrobun
/// exe folder). Fix: cache `workingDirectory` on Entry at
/// create/resume, fetch persisted cwd from `getSessionMetadata`
/// before resume, drop the `process.cwd()` fallback in `cwdFor`.
///
/// Flow: spawn bun#1 with workspace A, create session, kill bun#1.
/// Spawn bun#2 with SAME userData but workspace B (so a regressed
/// `process.cwd()` would surface B instead of A). Resume. Assert
/// reported cwd is still A.

import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let firstHarness: BunHarness | null = null;
let secondHarness: BunHarness | null = null;
let workspaceA: string | null = null;
let workspaceB: string | null = null;

test.afterEach(async () => {
  if (firstHarness) await firstHarness.teardown().catch(() => {});
  if (secondHarness) await secondHarness.teardown().catch(() => {});
  for (const ws of [workspaceA, workspaceB]) {
    if (ws) {
      try {
        rmSync(ws, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
  firstHarness = secondHarness = null;
  workspaceA = workspaceB = null;
});

test("resumed session reports the same workingDirectory as before restart", async ({ page }) => {
  // Two separate workspaces. Shared userData (catalog persists
  // there in fake-sessions.json) so bun#2 finds the session bun#1
  // created.
  workspaceA = mkdtempSync(join(tmpdir(), "dafman-e2e-A-"));
  workspaceB = mkdtempSync(join(tmpdir(), "dafman-e2e-B-"));
  writeFileSync(join(workspaceA, "README-A.md"), "A");
  writeFileSync(join(workspaceB, "README-B.md"), "B");
  const sharedUserData = mkdtempSync(join(tmpdir(), "dafman-e2e-ud-"));

  // bun#1: workspace A
  firstHarness = await spawnBunHarness({ workspace: workspaceA, userData: sharedUserData });
  const sessionId = await firstHarness.invokeControl<string>("createSession", {
    workingDirectory: workspaceA,
  });
  expect(sessionId).toBeTruthy();
  // Kill bun#1.
  await firstHarness.teardown();
  firstHarness = null;

  // bun#2: workspace B — same userData. If cwd doesn't persist
  // properly, resume below would report workspaceB (the bun cwd
  // fallback) instead of workspaceA.
  secondHarness = await spawnBunHarness({ workspace: workspaceB, userData: sharedUserData });

  const resumeResult = await secondHarness.invokeControl<{ sessionId: string; cwd: string | null }>(
    "resumeSession",
    { sessionId, model: null, reasoningEffort: null },
  );
  expect(resumeResult.cwd).toBe(workspaceA);

  // Also: the workspace fileSearch should walk workspaceA, not B.
  const results = await secondHarness.invokeControl<Array<{ name: string }>>(
    "searchWorkspaceFiles",
    { sessionId: resumeResult.sessionId, query: "README", limit: 10 },
  );
  expect(results.map((r) => r.name)).toContain("README-A.md");
  expect(results.map((r) => r.name)).not.toContain("README-B.md");

  // Cleanup
  try {
    rmSync(sharedUserData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  void page;
});
