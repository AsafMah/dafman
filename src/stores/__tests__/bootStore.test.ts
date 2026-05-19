import { beforeEach, describe, expect, test } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import { useBootStore } from "../bootStore";

describe("bootStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("starts in 'settings' phase with isBooting=true", () => {
    const b = useBootStore();
    expect(b.phase).toBe("settings");
    expect(b.isBooting).toBe(true);
  });

  test("statusText flips to 'Starting Copilot CLI…' while client isn't ready (even after settings load)", () => {
    const b = useBootStore();
    b.markSettingsLoaded();
    expect(b.statusText).toContain("Copilot CLI");
  });

  test("statusText flips to 'Loading settings…' when client is ready first but settings not yet loaded", () => {
    const b = useBootStore();
    b.markClientReady();
    expect(b.statusText).toContain("settings");
  });

  test("beginSessions transitions phase + status shows N of M", () => {
    const b = useBootStore();
    b.markSettingsLoaded();
    b.markClientReady();
    b.beginSessions(5);
    expect(b.phase).toBe("sessions");
    expect(b.statusText).toContain("0 of 5");
    b.markSessionRestored();
    expect(b.statusText).toContain("1 of 5");
    b.markSessionRestored();
    b.markSessionRestored();
    expect(b.statusText).toContain("3 of 5");
  });

  test("markReady flips isBooting to false", () => {
    const b = useBootStore();
    b.markSettingsLoaded();
    b.markClientReady();
    b.markReady();
    expect(b.isBooting).toBe(false);
    expect(b.phase).toBe("ready");
  });

  test("markFailed keeps isBooting=true (so the splash stays + shows error)", () => {
    const b = useBootStore();
    b.markFailed("boom");
    expect(b.phase).toBe("failed");
    expect(b.error).toBe("boom");
    expect(b.isBooting).toBe(true);
    expect(b.statusText).toBe("boom");
  });

  test("beginSessions with 0 total still shows 'Restoring sessions…' (no n/m)", () => {
    const b = useBootStore();
    b.beginSessions(0);
    expect(b.statusText).toBe("Restoring sessions…");
  });

  test("beginApplying transitions to applying phase + status flips", () => {
    // Regression for: 'splash stuck at 1/4, spinner frozen, pops up
    // all at once'. After Promise.all of session restores resolves,
    // we yield a frame and call beginApplying so the splash flips
    // from a stuck N/M counter to a moving 'Applying layout…'
    // state (with indeterminate shimmer) before the heavy
    // dockview.fromJSON burst blocks the main thread.
    const b = useBootStore();
    b.beginSessions(4);
    b.markSessionRestored();
    b.markSessionRestored();
    b.beginApplying();
    expect(b.phase).toBe("applying");
    expect(b.statusText).toBe("Applying layout…");
    expect(b.isBooting).toBe(true);
  });
});
