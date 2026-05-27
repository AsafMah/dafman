/// Page-side helpers for the full E2E tier.
///
/// Tests that use `harness.restart()` need a fresh URL — the
/// `?testBridge=ws://...` param embeds the bun port, which changes on
/// every spawn. Call `urlFor(harness, { autosession: "1" })` after
/// restart and pass it to `page.goto()`.

import type { BunHarness } from "./bunHarness";

export function urlFor(harness: BunHarness, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    testBridge: harness.wsUrl,
    ...extra,
  });
  return `/?${params.toString()}`;
}
