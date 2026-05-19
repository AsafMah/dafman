// Tracks the app's startup phase so `BootSplash.vue` can show the
// right status text and gate user actions until the client is alive.
//
// The boot is a finite state machine, advanced by `App.vue` as each
// phase resolves:
//
//   "settings"  → reading settings.json
//   "client"    → spawning the Copilot CLI subprocess + handshake
//   "sessions"  → resuming previously-open sessions (per-progress
//                 counter for the "Restoring 3 of 5…" affordance)
//   "ready"     → splash dismisses
//   "failed"    → terminal: splash stays, error shown
//
// The settings + client phases run in parallel (they don't depend on
// each other), but the splash advertises the slowest active phase so
// the user always sees a useful status. Session-restore can't start
// until both settings and client are ready (we need the persisted
// layout from settings + an alive client to call `resumeSession`).

import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type BootPhase =
  | "settings"
  | "client"
  | "sessions"
  | "ready"
  | "failed";

export const useBootStore = defineStore("boot", () => {
  const phase = ref<BootPhase>("settings");
  const error = ref<string | null>(null);
  const sessionsRestored = ref(0);
  const sessionsTotal = ref(0);
  const settingsLoaded = ref(false);
  const clientReady = ref(false);

  /// Status string for the splash. Reflects whichever phase is
  /// currently the slowest active path.
  const statusText = computed<string>(() => {
    if (phase.value === "ready") return "Ready";
    if (phase.value === "failed") return error.value ?? "Failed to start";
    if (phase.value === "sessions") {
      if (sessionsTotal.value === 0) return "Restoring sessions…";
      return `Restoring sessions… ${sessionsRestored.value} of ${sessionsTotal.value}`;
    }
    // Parallel phase: advertise whichever piece isn't done yet.
    if (!clientReady.value) return "Starting Copilot CLI…";
    if (!settingsLoaded.value) return "Loading settings…";
    return "Starting up…";
  });

  /// True while the boot splash should be visible. Becomes false on
  /// "ready" but stays true on "failed" (the user needs to see the
  /// error and reload).
  const isBooting = computed(
    () => phase.value !== "ready",
  );

  function markSettingsLoaded(): void {
    settingsLoaded.value = true;
  }

  function markClientReady(): void {
    clientReady.value = true;
  }

  function beginSessions(total: number): void {
    sessionsTotal.value = total;
    sessionsRestored.value = 0;
    phase.value = "sessions";
  }

  function markSessionRestored(): void {
    sessionsRestored.value += 1;
  }

  function markReady(): void {
    phase.value = "ready";
  }

  function markFailed(reason: string): void {
    phase.value = "failed";
    error.value = reason;
  }

  return {
    phase,
    error,
    sessionsRestored,
    sessionsTotal,
    settingsLoaded,
    clientReady,
    statusText,
    isBooting,
    markSettingsLoaded,
    markClientReady,
    beginSessions,
    markSessionRestored,
    markReady,
    markFailed,
  };
});
