/// F12 — approve-for-session with a prefix rule prevents the SDK
/// from re-prompting on a follow-up command of the same family.
///
/// This is the bug class from MANUAL_TESTS #87:
/// "command with same prefix required re-approval". Root cause:
/// the rule editor was sending bare first-token identifiers (e.g.
/// `git`) which the CLI's matcher treats as strict equality. The
/// CLI offers `git:*`-style identifiers in the request, and only
/// those broaden across commands. Fix: the editor now uses the
/// SDK-offered identifier (preferring the one ending in `:*`).
///
/// We can't fully test the SDK matcher with a mock — the matcher
/// lives inside the real CLI. What we CAN assert is that the
/// payload our editor produces uses the SDK-broadened identifier
/// rather than fabricating its own first-token. That guarantees
/// the CLI's matcher will accept follow-ups.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("Allow for session uses the SDK-offered :* identifier (covers follow-up commands)", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  // Trigger a permission request. The CLI-offered identifiers in
  // the real flow include `git:*` for the git command family; we
  // mirror that shape here.
  const decisionPromise = harness.invokeControl<{ kind: string; approval?: { kind: string; commandIdentifiers?: string[] } }>(
    "__test.triggerPermission",
    {
      sessionId: "fake-session-1",
      request: {
        kind: "shell",
        toolCallId: "call-1",
        fullCommandText: "git status",
        intention: "check repo state",
        commandIdentifiers: ["git:*"],
        canOfferSessionApproval: true,
      },
    },
  );

  const card = page.locator(".pending-card").first();
  await card.waitFor({ state: "visible", timeout: 5_000 });

  // Click "Allow for session" to open the rule editor.
  await card.getByRole("button", { name: /allow for session/i }).click();

  // The editor pre-selects the broad option (the `:*` one). Click
  // "Allow for session" again to submit.
  await card.getByRole("button", { name: /^allow for session$/i }).click();

  const decision = await decisionPromise;
  expect(decision.kind).toBe("approve-for-session");
  // CRITICAL: the rule must carry `git:*` (the SDK's prefix-glob
  // identifier), NOT bare `git`. The latter only matches literal
  // `git` and re-prompts on `git diff` / `git status` /
  // `git add` — the original bug.
  expect(decision.approval?.kind).toBe("commands");
  expect(decision.approval?.commandIdentifiers).toEqual(["git:*"]);
});

test("custom prefix in rule editor auto-appends :* so it broadens correctly", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  const decisionPromise = harness.invokeControl<{ kind: string; approval?: { kind: string; commandIdentifiers?: string[] } }>(
    "__test.triggerPermission",
    {
      sessionId: "fake-session-1",
      request: {
        kind: "shell",
        toolCallId: "call-2",
        fullCommandText: "bun run test",
        commandIdentifiers: ["bun:*"],
        canOfferSessionApproval: true,
      },
    },
  );

  const card = page.locator(".pending-card").first();
  await card.waitFor({ state: "visible", timeout: 5_000 });
  await card.getByRole("button", { name: /allow for session/i }).click();

  // Switch to custom + type a prefix without `:*`.
  await card.getByLabel("Custom prefix").click();
  const input = card.getByPlaceholder("e.g. bun test");
  await input.fill("npm run");

  await card.getByRole("button", { name: /^allow for session$/i }).click();

  const decision = await decisionPromise;
  expect(decision.approval?.commandIdentifiers).toEqual(["npm run:*"]);
});
