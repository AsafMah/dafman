/// F19 — Library Skills tab (Phase 19b).
///
/// Renders skills grouped by source from the fakeClient's
/// `skills.discover` stub (builtin / project / personal-copilot).
/// Per-row toggle pushes the full disabled-list to
/// `setGloballyDisabledSkills`. "Manage globally" link in the
/// right-rail Skills section jumps here.

import { test, expect } from "@playwright/test";
import { spawnBunHarness, type BunHarness } from "../harness/bunHarness";

let harness: BunHarness;

test.beforeEach(async () => {
  harness = await spawnBunHarness();
});

test.afterEach(async () => {
  await harness.teardown();
});

test("skills tab renders groups by source from the discover RPC", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  // Open Library → Skills.
  await page.getByRole("button", { name: /library/i }).first().click();
  await page.getByRole("tab", { name: "Skills" }).click();

  const library = page.locator(".library-panel");
  // Three source headings from the fake catalog: builtin / personal-
  // copilot / project (alphabetical).
  await expect(library.locator(".skill-group-title", { hasText: "builtin" })).toBeVisible({
    timeout: 5_000,
  });
  await expect(library.locator(".skill-group-title", { hasText: "personal-copilot" })).toBeVisible();
  await expect(library.locator(".skill-group-title", { hasText: "project" })).toBeVisible();

  // Each catalog skill should render.
  await expect(library.locator("text=summarize")).toBeVisible();
  await expect(library.locator("text=personal-snippet")).toBeVisible();
  await expect(library.locator("text=project-greet")).toBeVisible();
});

test("toggling a skill pushes the full disabled list via setGloballyDisabledSkills", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: /library/i }).first().click();
  await page.getByRole("tab", { name: "Skills" }).click();

  const library = page.locator(".library-panel");
  await library.locator(".skill-row").first().waitFor({ state: "visible", timeout: 5_000 });

  // Disable the first skill (summarize). Its toggle goes off; the
  // discover RPC will report `enabled: false` for that name next
  // load. We re-open the tab to trigger a refresh and assert the
  // toggle state persisted server-side.
  const summarizeRow = library.locator(".skill-row").filter({ hasText: "summarize" }).first();
  await summarizeRow.locator(".p-toggleswitch").click();
  await page.waitForTimeout(200);

  // Re-open the tab to force the next mount's discover call.
  await page.getByRole("tab", { name: "MCP" }).click();
  await page.getByRole("tab", { name: "Skills" }).click();
  await library.locator(".skill-row").filter({ hasText: "summarize" }).first().waitFor({ state: "visible" });

  // Toggle should now show off (aria-checked="false").
  const summarizeToggle = library
    .locator(".skill-row")
    .filter({ hasText: "summarize" })
    .first()
    .locator(".p-toggleswitch input");
  await expect(summarizeToggle).not.toBeChecked();
});

test("Manage globally link in right-rail opens Library Skills tab", async ({ page }) => {
  await page.goto(`/?testBridge=${encodeURIComponent(harness.wsUrl)}&autosession=1`);
  await page.locator(".lex-composer-input").first().waitFor({ state: "visible", timeout: 15_000 });

  const details = page.locator(".session-details").first();
  await expect(details).toBeVisible({ timeout: 5_000 });
  // Skills section is expanded by default; click the link directly.
  await details.getByRole("button", { name: /manage globally/i }).click();

  // Library panel is now open and Skills tab is selected.
  const library = page.locator(".library-panel");
  await expect(library).toBeVisible({ timeout: 3_000 });
  await expect(library.getByRole("tab", { name: "Skills", selected: true })).toBeVisible();
});
