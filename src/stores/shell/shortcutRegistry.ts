/**
 * Shortcut registry — merges the default keymap with user preferences and
 * exposes the effective binding list plus per-command / per-scope lookups.
 *
 * Phase 1–2 substrate. Global dispatch is NOT wired here yet — that is the
 * Phase 4 cutover. The `match()` helper is provided for future dispatch use.
 *
 * Reactive to settings: call `setPrefs(prefs)` when the settings store loads
 * or updates (Phase 3 wiring point).
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { matchKeybindingPress, parseKeybinding } from 'tinykeys';
import type {
  EffectiveBinding,
  KeyboardShortcutPrefs,
  KeySequence,
  ShortcutScope,
} from '@/lib/shortcuts/types';
import { defaultKeymap } from '@/lib/defaultKeymap';
import { normalizeKeySequence } from '@/lib/shortcuts/normalize';

export const useShortcutRegistry = defineStore('shortcutRegistry', () => {
  // ---------------------------------------------------------------------------
  // User preferences (Phase 3 wiring: call setPrefs from settingsStore watcher)
  // ---------------------------------------------------------------------------

  const prefs = ref<KeyboardShortcutPrefs>({
    customBindings: [],
    disabledDefaultBindingIds: [],
  });

  function setPrefs(next: KeyboardShortcutPrefs): void {
    prefs.value = next;
  }

  // ---------------------------------------------------------------------------
  // Effective bindings — default keymap minus disabled + user custom on top
  // ---------------------------------------------------------------------------

  const effectiveBindings = computed<EffectiveBinding[]>(() => {
    const disabled = new Set(prefs.value.disabledDefaultBindingIds);
    const result: EffectiveBinding[] = [];

    for (const b of defaultKeymap) {
      if (!disabled.has(b.id)) {
        result.push({
          id: b.id,
          commandId: b.commandId,
          scope: b.scope,
          keys: normalizeKeySequence(b.keys),
          source: 'default',
          reassignable: b.reassignable,
        });
      }
    }

    for (const custom of prefs.value.customBindings) {
      result.push({
        // Generate a stable deterministic id from commandId + scope + keys
        id: `user.${custom.commandId}.${custom.scope}`,
        commandId: custom.commandId,
        scope: custom.scope,
        keys: normalizeKeySequence(custom.keys),
        source: 'user',
        reassignable: true,
      });
    }

    return result;
  });

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------

  /** Returns all effective bindings for the given commandId (may be empty). */
  function effectiveBindingsForCommand(commandId: string): EffectiveBinding[] {
    return effectiveBindings.value.filter((b) => b.commandId === commandId);
  }

  /** Returns all effective bindings for the given scope. */
  function bindingsForScope(scope: ShortcutScope): EffectiveBinding[] {
    return effectiveBindings.value.filter((b) => b.scope === scope);
  }

  /** Returns the first effective binding for a command, or `undefined`. */
  function primaryBindingForCommand(commandId: string): EffectiveBinding | undefined {
    return effectiveBindings.value.find((b) => b.commandId === commandId);
  }

  // ---------------------------------------------------------------------------
  // Matching — for future dispatch layer
  // ---------------------------------------------------------------------------

  /**
   * Tests whether a `KeyboardEvent` matches any effective binding in the given
   * scope, and returns the first matching binding.
   *
   * For single-press bindings this is a direct `matchKeybindingPress` call.
   * Multi-press sequences require stateful sequence tracking in the dispatch
   * layer (Phase 4); this function only matches the FIRST chord of a sequence.
   *
   * Composite IME events (`event.isComposing` or `event.key === 'Process'`)
   * are never matched — this mirrors the existing Lexical guard.
   *
   * @param event  The native `KeyboardEvent` to test
   * @param scope  The active scope to filter bindings by
   */
  function match(event: KeyboardEvent, scope: ShortcutScope): EffectiveBinding | undefined {
    if (event.isComposing || event.key === 'Process') return undefined;

    const scopeBindings = bindingsForScope(scope);

    for (const binding of scopeBindings) {
      // Split into individual chord presses
      const presses = parseKeybinding(binding.keys);

      if (presses.length === 0) continue;

      // Match the first press only; sequence continuation is dispatch-layer concern
      const firstPress = presses[0];

      if (matchKeybindingPress(event, firstPress)) {
        return binding;
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Display helpers — for palette rows and Settings UI
  // ---------------------------------------------------------------------------

  /**
   * Returns the tinykeys-syntax key sequence strings for display alongside a
   * command in the palette or settings. May be empty if no binding is active.
   */
  function displayKeysForCommand(commandId: string): KeySequence[] {
    return effectiveBindingsForCommand(commandId).map((b) => b.keys);
  }

  return {
    prefs,
    setPrefs,
    effectiveBindings,
    effectiveBindingsForCommand,
    bindingsForScope,
    primaryBindingForCommand,
    match,
    displayKeysForCommand,
  };
});
