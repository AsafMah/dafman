// Composable that owns the per-message agent-mode override for a single
// ChatWindow instance.
//
// Semantics:
// - `nextMessageMode` is `null` by default (follow session mode).
// - `setNextMessageMode(mode)` arms the override for the next submit.
// - `resolveForSubmit()` returns the current value and resets to `null`
//   (one-shot). Call this inside `submitMessage` to inject the override
//   into `ComposerSubmitPayload.agentMode`.
//
// State is scoped per ChatWindow — it is ephemeral UI state, not session
// data, so it lives here rather than in sessionsStore.

import { ref, type Ref } from 'vue';
import type { SessionMode } from '@/ipc/types';

export interface UseComposerAgentModeReturn {
  /// The pending one-shot override. `null` = follow session default.
  nextMessageMode: Ref<SessionMode | null>;
  /// Set (or clear) the override. Does NOT mutate the session mode.
  setNextMessageMode(mode: SessionMode | null): void;
  /// Returns the current override value and immediately resets to `null`.
  /// Designed to be called exactly once per submit.
  resolveForSubmit(): SessionMode | undefined;
}

export function useComposerAgentMode(): UseComposerAgentModeReturn {
  const nextMessageMode = ref<SessionMode | null>(null);

  function setNextMessageMode(mode: SessionMode | null): void {
    nextMessageMode.value = mode;
  }

  function resolveForSubmit(): SessionMode | undefined {
    const value = nextMessageMode.value;

    nextMessageMode.value = null;
    return value ?? undefined;
  }

  return { nextMessageMode, setNextMessageMode, resolveForSubmit };
}
