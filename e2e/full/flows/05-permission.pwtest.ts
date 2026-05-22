/// F5 — Permission flow.
///
/// Drive a shell permission request through the registered handler,
/// assert the PendingRequestCard renders, click "Approve once", and
/// verify the bun-side audit log records the decision.
///
/// Uses the `__test.triggerPermission` control RPC to fire the
/// session's captured `onPermissionRequest` from outside the
/// renderer — the renderer sees the same `pendingRequest` webview
/// message it would in production.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("shell permission request → approve → audit log records decision", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  // Trigger the permission. The control RPC awaits the handler's
  // resolution, which only happens after the renderer responds, so
  // we kick it off without awaiting and resolve via the UI click.
  const decisionPromise = harness.invokeControl<{ kind: string }>(
    "__test.triggerPermission",
    {
      sessionId: "fake-session-1",
      request: {
        kind: "shell",
        toolCallId: "call-1",
        command: "git status",
        fullCommandText: "git status",
      },
    },
  );

  // PendingRequestCard renders with an Approve button.
  const card = page.locator(".pending-card").first();
  await card.waitFor({ state: "visible", timeout: 5_000 });
  await card.getByRole("button", { name: /^allow once$/i }).click();

  const decision = await decisionPromise;
  expect(decision.kind).toBe("approve-once");

  // Audit log should record the approveOnce decision. Poll the
  // bun-side state via the public RPC (same surface the renderer's
  // Activity tab uses).
  const audit = await harness.invokeControl<{ recent: Array<{ kind: string; decision?: string; permissionKind?: string }> }>(
    "getAuditState",
    { recentLimit: 10 },
  );
  const permEntry = audit.recent.find(
    (e) => e.kind === "permission" && e.permissionKind === "shell",
  );
  expect(permEntry).toBeDefined();
  expect(permEntry?.decision).toBe("approveOnce");
});
