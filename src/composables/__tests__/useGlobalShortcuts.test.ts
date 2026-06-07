/**
 * Tests for the global keyboard dispatcher (useGlobalShortcuts).
 *
 * Key behaviors verified:
 *  - Ctrl+K (≡ $mod+K) opens the command palette via the shortcut registry.
 *  - Palette does NOT open when a PrimeVue confirm/dialog overlay is present.
 *  - A global pane shortcut runs the bound command.
 *  - Non-allowlisted shortcuts are suppressed while a contenteditable has focus.
 *  - Allowlisted commands (commandPalette.toggle, settings.open) fire even in
 *    editable surfaces.
 *
 * End-to-end flow: window keydown → useGlobalShortcuts → shortcutRegistry
 * (defaultKeymap) → commandRegistry.runCommand → command.run().
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, nextTick } from 'vue';
import { useGlobalShortcuts } from '@/composables/useGlobalShortcuts';
import { useCommandPaletteStore } from '@/stores/shell/commandPaletteStore';
import { useCommandRegistry } from '@/stores/shell/commandRegistry';

/** Minimal host component that installs the global shortcut listener. */
const ShortcutsHost = defineComponent({
  setup() {
    useGlobalShortcuts();
    return {};
  },
  template: '<div />',
});

async function mountDispatcher(): Promise<void> {
  render(ShortcutsHost);
  await nextTick(); // ensure onMounted has fired and listener is attached
}

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  // ---------------------------------------------------------------------------
  // Palette toggle via $mod+K
  // ---------------------------------------------------------------------------

  test('Ctrl+K opens the command palette via the shortcut registry', async () => {
    const paletteStore = useCommandPaletteStore();
    paletteStore.registerCommands(); // registers commandPalette.toggle

    await mountDispatcher();

    expect(paletteStore.isOpen).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await nextTick();
    await nextTick(); // runCommand is async

    expect(paletteStore.isOpen).toBe(true);
  });

  test('Ctrl+K does not open palette when a PrimeVue dialog overlay is present', async () => {
    const paletteStore = useCommandPaletteStore();
    paletteStore.registerCommands();

    await mountDispatcher();

    // Inject a PrimeVue modal overlay the same way PrimeVue does it.
    const mask = document.createElement('div');
    mask.className = 'p-dialog-mask';
    document.body.appendChild(mask);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await nextTick();
    await nextTick();

    expect(paletteStore.isOpen).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Generic global shortcut dispatch
  // ---------------------------------------------------------------------------

  test('global pane shortcut (Ctrl+Shift+]) runs view.nextGroup', async () => {
    const registry = useCommandRegistry();
    let ran = false;
    registry.register({
      id: 'view.nextGroup',
      label: 'Next Group',
      run: () => {
        ran = true;
      },
    });

    await mountDispatcher();

    // $mod+Shift+] → Ctrl+Shift+] on non-Mac. The defaultKeymap has this binding.
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ']', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await nextTick();
    await nextTick();

    expect(ran).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Scope guard: editable surfaces
  // ---------------------------------------------------------------------------

  test('non-allowlisted shortcut does NOT fire while a contenteditable (Lexical composer) has focus', async () => {
    const registry = useCommandRegistry();
    let ran = false;
    registry.register({
      id: 'view.nextGroup',
      label: 'Next Group',
      run: () => {
        ran = true;
      },
    });

    await mountDispatcher();

    // Focus a contenteditable element (simulates Lexical composer or message editor).
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.appendChild(editor);
    editor.focus();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ']', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await nextTick();
    await nextTick();

    expect(ran).toBe(false);
  });

  test('non-allowlisted shortcut does NOT fire while a text input has focus', async () => {
    const registry = useCommandRegistry();
    let ran = false;
    registry.register({
      id: 'view.nextGroup',
      label: 'Next Group',
      run: () => {
        ran = true;
      },
    });

    await mountDispatcher();

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ']', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await nextTick();
    await nextTick();

    expect(ran).toBe(false);
  });

  test('Ctrl+K (commandPalette.toggle) fires even while an input has focus', async () => {
    const paletteStore = useCommandPaletteStore();
    paletteStore.registerCommands();

    await mountDispatcher();

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await nextTick();
    await nextTick();

    expect(paletteStore.isOpen).toBe(true);
  });

  test('Ctrl+K (commandPalette.toggle) fires even while a contenteditable has focus', async () => {
    const paletteStore = useCommandPaletteStore();
    paletteStore.registerCommands();

    await mountDispatcher();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.appendChild(editor);
    editor.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await nextTick();
    await nextTick();

    expect(paletteStore.isOpen).toBe(true);
  });
});
