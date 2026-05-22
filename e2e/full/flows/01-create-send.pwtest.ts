/// F1 — Create session + send + assert reply event arrives.
///
/// Smoke flow proving the full harness works:
/// chromium → wsBridge → bun subprocess → fakeClient → event back → UI render.
///
/// If this test fails, every other E2E flow is doomed; fix this first.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("create session, send 'hello', assistant reply renders", async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[page:err]", msg.text());
  });

  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  const composer = page.locator(".lex-composer-input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  await composer.click();
  await page.keyboard.type("hello");
  // Default send chord is Ctrl+Enter (plain Enter inserts a newline
  // so markdown line breaks work; the SubmitOnEnter plugin in
  // src/lexical/plugins.ts only handles modifier chords).
  await page.keyboard.press("Control+Enter");

  // Default fakeClient script echoes `ok: hello` as an assistant
  // message. Wait for it to appear in the transcript.
  await expect(page.locator("text=ok: hello").first()).toBeVisible({ timeout: 10_000 });
});
