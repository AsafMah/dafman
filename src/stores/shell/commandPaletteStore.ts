/**
 * Command palette open/close state store.
 *
 * Extracted from CommandPalette.vue so that `commandPalette.toggle`,
 * `commandPalette.open`, and `commandPalette.close` can be registered as
 * commandRegistry commands and fired via shortcut bindings.
 * Phase 4 cutover complete: CommandPalette.vue now drives visibility from
 * this store; the old hardcoded Ctrl/Cmd+K listener in that component has
 * been removed. Global dispatch goes through `useGlobalShortcuts` →
 * `shortcutRegistry.match` → `commandRegistry.runCommand`.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useCommandRegistry } from './commandRegistry';

export const useCommandPaletteStore = defineStore('commandPalette', () => {
  const isOpen = ref(false);

  function open(): void {
    if (document.querySelector('.p-confirmpopup, .p-dialog-mask')) return;
    isOpen.value = true;
  }

  function close(): void {
    isOpen.value = false;
  }

  function toggle(): void {
    if (isOpen.value) {
      close();
    } else {
      open(); // guard is inside open()
    }
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
