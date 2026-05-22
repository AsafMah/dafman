/// F13 — Each permission kind opens its dedicated rule editor body.
///
/// MANUAL_TESTS #74 reported shell/read/write didn't render right.
/// Shell + read + write were fixed in the prior commits. This test
/// just exercises every kind we support so a regression in the
/// editor template's v-if chain trips immediately.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

const cases = [
  {
    name: "shell",
    request: {
      kind: "shell",
      toolCallId: "c-shell",
      fullCommandText: "git status",
      commandIdentifiers: ["git:*"],
      canOfferSessionApproval: true,
    },
    // The editor template includes "This exact command".
    expectText: /this exact command/i,
  },
  {
    name: "read",
    request: { kind: "read", toolCallId: "c-read", path: "/abs/file.txt" },
    expectText: /all file reads/i,
  },
  {
    name: "write",
    request: { kind: "write", toolCallId: "c-write", fileName: "/abs/file.txt" },
    expectText: /all file writes/i,
  },
  {
    name: "memory",
    request: { kind: "memory", toolCallId: "c-memory" },
    expectText: /all memory operations/i,
  },
  {
    name: "mcp",
    request: {
      kind: "mcp",
      toolCallId: "c-mcp",
      serverName: "github",
      toolName: "list_repos",
    },
    expectText: /which mcp calls/i,
  },
  {
    name: "custom-tool",
    request: { kind: "custom-tool", toolCallId: "c-tool", toolName: "myTool" },
    expectText: /myTool/,
  },
  {
    name: "url",
    request: { kind: "url", toolCallId: "c-url", url: "https://example.com/foo" },
    expectText: /allow urls from which domain/i,
  },
];

for (const c of cases) {
  test(`${c.name}: Allow for session opens the dedicated editor body`, async ({ page }) => {
    await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
    const composer = page.locator(".lex-composer-input").first();
    await composer.waitFor({ state: "visible", timeout: 15_000 });

    // Fire & forget — the handler resolves only after the user picks
    // a decision. We never resolve here; afterEach kills the bun
    // process which cancels any pending handlers.
    void harness.invokeControl<unknown>("__test.triggerPermission", {
      sessionId: "fake-session-1",
      request: c.request,
    }).catch(() => { /* harness teardown cancels */ });

    const card = page.locator(".pending-card").first();
    await card.waitFor({ state: "visible", timeout: 5_000 });
    await card.getByRole("button", { name: /allow for session/i }).click();
    await expect(card.locator(".rule-editor").locator(`text=${c.expectText.source}`).first()).toBeVisible({ timeout: 3_000 });
  });
}
