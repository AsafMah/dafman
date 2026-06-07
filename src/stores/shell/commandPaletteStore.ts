/**
 * Command palette open/close state store.
 *
 * Extracted from CommandPalette.vue so that `commandPalette.toggle`,
 * `commandPalette.open`, and `commandPalette.close` can be registered as
 * commandRegistry commands and fired via shortcut bindings.
 *
 * Migration note: CommandPalette.vue still owns its own hardcoded Ctrl/Cmd+K
 * listener for now. The Phase 4 cutover will remove that listener and wire
 * the shortcutRegistry global dispatch to call `toggle()` instead. Until
 * then, both paths co-exist without conflict because toggling is idempotent.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useCommandRegistry } from './commandRegistry';

export const useCommandPaletteStore = defineStore('commandPalette', () => {
  const isOpen = ref(false);

  function open(): void {
    isOpen.value = true;
  }

  function close(): void {
    isOpen.value = false;
  }

  function toggle(): void {
    isOpen.value = !isOpen.value;
  }

  /**
   * Registers `commandPalette.toggle`, `commandPalette.open`, and
   * `commandPalette.close` commands in the commandRegistry.
   *
   * Call once during app boot (e.g. alongside `registerBuiltinCommands`).
   * Safe to call multiple times — register is idempotent (replace-by-id).
   */
  function registerCommands(): void {
    const registry = useCommandRegistry();

    registry.register({
      id: 'commandPalette.toggle',
      label: 'Toggle Command Palette',
      group: 'View',
      keywords: ['palette', 'commands', 'search', 'open palette'],
      run: toggle,
    });

    registry.register({
      id: 'commandPalette.open',
      label: 'Open Command Palette',
      group: 'View',
      keywords: ['palette', 'commands', 'search'],
      palette: { visible: false },
      run: open,
    });

    registry.register({
      id: 'commandPalette.close',
      label: 'Close Command Palette',
      group: 'View',
      palette: { visible: false },
      when: () => isOpen.value,
      run: close,
    });
  }

  return { isOpen, open, close, toggle, registerCommands };
});
