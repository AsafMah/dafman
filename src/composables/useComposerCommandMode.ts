// Composer command-mode logic — `!` armed-entry from the editor +
// Esc-Esc / Ctrl+Backspace exit from the terminal pane + the
// `enterCommandMode` orchestration that clears the editor and asks
// the parent to spin up a session terminal.
//
// Extracted from MessageComposer.vue (Phase D.4.6).

import { nextTick, type Ref } from 'vue';

export interface UseComposerCommandModeOptions {
  /// Reactive flag the composer toggles to swap the editor surface
  /// for the embedded terminal. Owned by the composer because the
  /// template branches on it.
  commandMode: Ref<boolean>;
  /// Reads the current editor text. Used to detect a single `!`
  /// keystroke as the armed entry trigger.
  getEditorText: () => string;
  /// Editor state mutations the orchestrator drives.
  clearEditor: () => void;
  focusComposer: () => void;
  /// Notifies the parent (`MessageComposer.emit`) so it can request
  /// the session terminal.
  emitRequestCommandTerminal: () => void;
  /// Composer-level "is the editor disabled" — gates `!` entry so
  /// the trigger doesn't fire from a read-only pane.
  isDisabled: () => boolean;
}

export interface UseComposerCommandModeReturn {
  enterCommandMode: () => Promise<void>;
  exitCommandMode: () => void;
  /// Handler for the terminal-pane keydown — drives the Esc-Esc /
  /// Ctrl+Backspace exit paths.
  onCommandModeKeydown: (event: KeyboardEvent) => void;
  /// Handler for the editor-pane keydown — arms + fires the `!`
  /// entry trigger.
  onComposerKeydown: (event: KeyboardEvent) => void;
}

export function useComposerCommandMode(
  opts: UseComposerCommandModeOptions,
): UseComposerCommandModeReturn {
  let bangArmed = false;
  let escArmed = false;
  let escTimer: ReturnType<typeof setTimeout> | null = null;

  async function enterCommandMode(): Promise<void> {
    opts.clearEditor();
    opts.commandMode.value = true;
    opts.emitRequestCommandTerminal();
    await nextTick();
  }

  function exitCommandMode(): void {
    opts.commandMode.value = false;
    bangArmed = false;
    escArmed = false;

    if (escTimer) {
      clearTimeout(escTimer);
      escTimer = null;
    }

    setTimeout(() => opts.focusComposer(), 0);
  }

  function onCommandModeKeydown(event: KeyboardEvent): void {
    // Double-Esc exits command mode
    if (event.key === 'Escape') {
      if (escArmed) {
        event.preventDefault();
        event.stopPropagation();
        escArmed = false;

        if (escTimer) {
          clearTimeout(escTimer);
          escTimer = null;
        }

        exitCommandMode();

        return;
      }

      escArmed = true;

      if (escTimer) clearTimeout(escTimer);

      escTimer = setTimeout(() => {
        escArmed = false;
        escTimer = null;
      }, 400);

      return;
    }

    // Ctrl+Backspace exits command mode
    if (event.key === 'Backspace' && event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      exitCommandMode();

      return;
    }

    escArmed = false;
  }

  function onComposerKeydown(event: KeyboardEvent): void {
    if (opts.isDisabled() || opts.commandMode.value) return;

    if (event.key !== '!' || event.ctrlKey || event.altKey || event.metaKey) {
      bangArmed = false;

      return;
    }

    const text = opts.getEditorText();

    if (!bangArmed && text.length === 0) {
      bangArmed = true;

      return;
    }

    if (bangArmed && text === '!') {
      event.preventDefault();
      void enterCommandMode();

      return;
    }

    bangArmed = false;
  }

  return {
    enterCommandMode,
    exitCommandMode,
    onCommandModeKeydown,
    onComposerKeydown,
  };
}
