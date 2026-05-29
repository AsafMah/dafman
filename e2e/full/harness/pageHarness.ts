/// Page-side helpers for the full E2E tier.
///
/// Tests that use `harness.restart()` need a fresh URL — the
/// `?testBridge=ws://...` param embeds the bun port, which changes on
/// every spawn. Call `urlFor(harness, { autosession: "1" })` after
/// restart and pass it to `page.goto()`.

import { expect, type Page } from "@playwright/test";
import type { BunHarness } from "./bunHarness";

export function urlFor(harness: BunHarness, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    testBridge: harness.wsUrl,
    ...extra,
  });
  return `/?${params.toString()}`;
}

/// Click a left/right activity-bar edge tab by its accessible name.
///
/// Since the ActivityBar was replaced with native dockview edge tabs
/// (commit e39bdc9) these render as `<div class="activity-bar-tab"
/// aria-label="...">` (role `generic`), NOT buttons — so `getByRole
/// ("button", …)` no longer matches. Valid labels: Sessions, Terminals,
/// Jobs, Logs, Settings (left); "Session details", Library (right).
export async function openActivityTab(page: Page, label: string): Promise<void> {
  await page.locator(`.activity-bar-tab[aria-label="${label}"]`).first().click();
}

/// Open the per-session details right rail via the composer cog.
///
/// The rail no longer auto-opens on session create (commit 6343902 —
/// "remove the thing that auto-opens session settings"), so flows that
/// assert rail contents must open it explicitly first.
export async function openDetailsRail(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open session details", exact: true }).first().click();
  await expect(page.locator(".session-details").first()).toBeVisible({ timeout: 5_000 });
}
