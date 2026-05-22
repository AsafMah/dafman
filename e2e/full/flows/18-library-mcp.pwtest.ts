/// F18 — Library panel (Phase 19a, MCP tab).
///
/// Opens via ActivityBar pi-book button. The fake client returns
/// `playwright` + `github` in the Discovered list and an empty
/// Configured list. Adding a server via the form moves it into
/// Configured.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("library opens from activity bar and lists discovered MCP servers", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  // Activity bar button: aria-label "Library — MCP servers + Skills".
  const libBtn = page.getByRole("button", { name: /library/i }).first();
  await libBtn.click();

  const library = page.locator(".library-panel");
  await expect(library).toBeVisible({ timeout: 5_000 });

  // MCP tab is selected by default.
  await expect(library.getByRole("tab", { name: "MCP", selected: true })).toBeVisible();

  // Configured section is empty initially; Discovered shows the two
  // fake servers.
  await expect(library.locator("text=No MCP servers configured.")).toBeVisible();
  await expect(library.locator("text=playwright")).toBeVisible();
  await expect(library.locator("text=github")).toBeVisible();
});

test("add MCP server via structured form → moves to configured list", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: /library/i }).first().click();

  const library = page.locator(".library-panel");
  await expect(library).toBeVisible({ timeout: 5_000 });

  // Click Add to open the dialog.
  await library.getByRole("button", { name: /^Add$/i }).click();
  const dialog = page.locator(".p-dialog");
  await expect(dialog).toBeVisible();

  await dialog.locator("#mcp-form-name").fill("my-local-server");
  await dialog.locator("#mcp-form-cmd").fill("/usr/bin/my-server");

  // Submit — type=submit button. The form has another "Add" button
  // for env rows, so target the type=submit one explicitly.
  await dialog.locator("button[type='submit']").click();

  await expect(dialog).toBeHidden({ timeout: 3_000 });
  // Configured list now has the entry.
  await expect(
    library.locator(".mcp-row").filter({ hasText: "my-local-server" }),
  ).toBeVisible({ timeout: 3_000 });
});

test("JSON mode of the form round-trips with structured", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: /library/i }).first().click();
  await page.locator(".library-panel").getByRole("button", { name: /^Add$/i }).click();

  const dialog = page.locator(".p-dialog");
  await expect(dialog).toBeVisible();

  await dialog.locator("#mcp-form-name").fill("rt-test");
  await dialog.locator("#mcp-form-cmd").fill("/bin/test");

  // Switch to JSON mode — textarea must contain the serialized payload.
  await dialog.getByRole("button", { name: /^JSON$/i }).click();
  const textarea = dialog.locator("#mcp-form-json");
  await expect(textarea).toBeVisible();
  const json = await textarea.inputValue();
  expect(json).toContain("/bin/test");
  expect(json).toContain('"type"');
});
