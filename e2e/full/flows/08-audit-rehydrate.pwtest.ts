/// F8 — Audit JSONL re-hydrates into the in-memory ring on bun restart.
///
/// Bug class: user reported the Activity tab was empty after restart
/// even though the `<userData>/audit/*.jsonl` files still existed.
/// Fix: `initAudit` now reads the tail of each JSONL into the
/// `recent` ring at startup so the panel shows history immediately.

import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let first: BunHarness | null = null;
let second: BunHarness | null = null;
let workspace: string | null = null;

test.afterEach(async () => {
  if (first) await first.teardown().catch(() => {});
  if (second) await second.teardown().catch(() => {});
  if (workspace) {
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  first = second = null;
  workspace = null;
});

test("audit entries from a prior bun session re-load into the recent ring on restart", async () => {
  workspace = mkdtempSync(join(tmpdir(), "dafman-e2e-audit-"));
  const sharedUserData = mkdtempSync(join(tmpdir(), "dafman-e2e-audit-ud-"));

  // bun#1: create a session and write a representative audit entry.
  first = await spawnBunHarness({ workspace, userData: sharedUserData });
  const sessionId = await first.invokeControl<string>("createSession", {
    workingDirectory: workspace,
  });
  await first.invokeControl<string>("__test.recordAudit", {
    entry: {
      kind: "permission",
      sessionId,
      requestId: "manual-1",
      permissionKind: "shell",
      decision: "approveOnce",
      summary: "Run `git status`",
    },
  });

  // Verify it's in the ring + on disk.
  const stateBefore = await first.invokeControl<{ recent: Array<{ kind: string }> }>(
    "getAuditState",
    { recentLimit: 10 },
  );
  expect(stateBefore.recent.some((e) => e.kind === "permission")).toBe(true);

  await first.teardown();
  first = null;

  // bun#2 with same userData. Should re-hydrate the JSONL file
  // into the in-memory ring.
  second = await spawnBunHarness({ workspace, userData: sharedUserData });
  const stateAfter = await second.invokeControl<{ recent: Array<{ kind: string; permissionKind?: string; summary?: string }> }>(
    "getAuditState",
    { recentLimit: 50 },
  );
  const perm = stateAfter.recent.find(
    (e) => e.kind === "permission" && e.permissionKind === "shell",
  );
  expect(perm).toBeDefined();
  expect(perm?.summary).toBe("Run `git status`");

  rmSync(sharedUserData, { recursive: true, force: true });
});
