/**
 * Keyboard-shortcut system — shared types contract.
 *
 * TaskB (shortcutRegistry Pinia store + Settings) imports from here.
 * Do NOT add Vue/Pinia imports; keep this a pure-TS module.
 */

// ---------------------------------------------------------------------------
// Public contract (used by TaskB and future consumers)
// ---------------------------------------------------------------------------

export type ShortcutScope =
  | 'global'
  | 'commandPalette'
  | 'composer'
  | 'composerTypeahead'
  | 'terminal'
  | 'filePicker'
  | 'messageEditor'
  | 'pendingRequest'
  | 'composerCommandTerminal'
  | 'dockviewTabRename'
  | 'accessibility';

/**
 * tinykeys-syntax key sequence: one or more space-separated chords, e.g.
 * "$mod+K $mod+S", "g i", "Shift+D".
 *
 * Canonical form produced by `normalizeKeySequence()`:
 *  - Modifiers sorted: $mod, Ctrl, Meta, Alt, Shift, then key
 *  - Key component uppercased for letters
 *  - Surrounding whitespace removed; inner spaces collapsed to single space
 */
export type KeySequence = string;

export interface DefaultKeyBinding {
  /** Stable id, e.g. "global.commandPalette.toggle" */
  id: string;
  /** Stable command id in commandRegistry */
  commandId: string;
  scope: ShortcutScope;
  /** tinykeys-syntax key sequence */
  keys: KeySequence;
  /**
   * Whether users may reassign this binding.
   * `false` for composer core, native accessibility, and native editor scopes.
   */
  reassignable: boolean;
}

/** User overrides persisted in settings.json under `keyboardShortcuts`. */
export interface KeyboardShortcutPrefs {
  customBindings: Array<{
    commandId: string;
    scope: ShortcutScope;
    keys: KeySequence;
  }>;
  disabledDefaultBindingIds: string[];
}

// ---------------------------------------------------------------------------
// Internal structured representation (used by normalize.ts + conflicts.ts)
// ---------------------------------------------------------------------------

/** Modifier tokens in canonical order. */
export type Modifier = '$mod' | 'Ctrl' | 'Meta' | 'Alt' | 'Shift';

/**
 * One parsed chord — modifiers plus key.
 * `$mod` is kept symbolic (not resolved to Ctrl/Meta) so canonical form is
 * platform-independent.
 */
export interface ParsedPress {
  modifiers: ReadonlyArray<Modifier>;
  /**
   * Logical key (uppercase for letters): "K", "Enter", "Backspace", etc.
   * OR a KeyboardEvent.code value such as "Backquote", "Digit1".
   */
  key: string;
}

/** A sequence of one or more parsed presses. */
export type ParsedSequence = ParsedPress[];

// ---------------------------------------------------------------------------
// Conflict types
// ---------------------------------------------------------------------------

export type ConflictKind =
  | 'exact' // same scope, same normalised sequence → hard error
  | 'scope-shadow' // different scopes, same sequence; more-specific wins → warn
  | 'prefix' // one sequence is a prefix of another in same scope → hard error
  | 'unknown-command';

export interface ShortcutConflict {
  kind: ConflictKind;
  /** id of the binding that has the conflict */
  bindingId: string;
  /** id of the binding it conflicts with (undefined for unknown-command) */
  conflictingBindingId?: string;
  commandId: string;
  scope: ShortcutScope;
  message: string;
}

// ---------------------------------------------------------------------------
// Effective binding (what the registry resolves after merging defaults + prefs)
// ---------------------------------------------------------------------------

export type BindingSource = 'default' | 'user';

export interface EffectiveBinding {
  /** Stable binding id – either `DefaultKeyBinding.id` or a generated user-binding id */
  id: string;
  commandId: string;
  scope: ShortcutScope;
  keys: KeySequence;
  source: BindingSource;
  reassignable: boolean;
}
