/**
 * Keyboard-shortcut normalization and display formatting.
 *
 * Pure functions — no DOM, no Vue, no tinykeys runtime.
 * tinykeys is used only for `matchKeybindingPress` in the dispatch layer
 * (shortcutRegistry); this module owns canonical parsing & display.
 */

import type { KeySequence, Modifier, ParsedPress, ParsedSequence } from './types';

// ---------------------------------------------------------------------------
// Modifier ordering
// ---------------------------------------------------------------------------

/** Canonical modifier sort order. */
const MODIFIER_ORDER: ReadonlyArray<Modifier> = ['$mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];

/** Quick membership test — static lookup table. */
const MODIFIER_RANK: Record<string, number> = {
  $mod: 0,
  Ctrl: 1,
  Meta: 2,
  Alt: 3,
  Shift: 4,
};

/** Maps any casing of a known modifier name to its canonical `Modifier` form. */
const MODIFIER_CANONICAL: Record<string, Modifier> = {
  $mod: '$mod',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  meta: 'Meta',
  alt: 'Alt',
  shift: 'Shift',
};

// ---------------------------------------------------------------------------
// Parser — keeps $mod symbolic; does NOT call tinykeys at parse time.
// ---------------------------------------------------------------------------

/**
 * Normalises the "key" part of a chord:
 * - Single ASCII letter → uppercase (tinykeys matches case-insensitively, we
 *   store uppercase for unambiguous display)
 * - Multi-character named keys (Enter, Escape, ArrowDown, …) → first letter
 *   uppercase, rest preserved
 * - Code values (Backquote, Digit1, KeyK, …) → verbatim (already capitalised)
 * - Punctuation / symbols → as-is
 */
function normalizeKeyName(raw: string): string {
  if (raw.length === 1) return raw.toUpperCase();

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Splits a tinykeys-syntax chord string into modifiers + key.
 *
 * Handles:
 *  - "K"                         → `{ modifiers: [], key: 'K' }`
 *  - "$mod+K"                    → `{ modifiers: ['$mod'], key: 'K' }`
 *  - "$mod+Shift+K"              → `{ modifiers: ['$mod','Shift'], key: 'K' }`
 *  - "Backquote"                 → `{ modifiers: [], key: 'Backquote' }`
 *
 * Optional modifiers (`[Shift]`) are treated as required for Dafman-owned
 * bindings (we don't use optional syntax in the default keymap).
 */
function parseChord(chord: string): ParsedPress {
  const parts = chord.split(/(?<=\w|\])\+/);
  const rawKey = parts.pop()!;

  const modifiers: Modifier[] = [];

  for (const part of parts) {
    // Strip optional-modifier brackets, then canonicalize case
    const stripped = part.replace(/^\[(.+)\]$/, '$1');
    // Map lowercase input to canonical form (e.g. "shift" → "Shift")
    const canonical = MODIFIER_CANONICAL[stripped.toLowerCase()];

    if (canonical) modifiers.push(canonical);
    // Unknown modifiers (AltGraph, etc.) silently dropped from canonical form
  }

  return {
    modifiers: [...modifiers].sort(
      (a, b) =>
        (MODIFIER_RANK[a] ?? MODIFIER_ORDER.length) - (MODIFIER_RANK[b] ?? MODIFIER_ORDER.length),
    ),
    key: normalizeKeyName(rawKey),
  };
}

/**
 * Parses a tinykeys-syntax sequence string into an array of `ParsedPress`.
 *
 * `"a b c"` → three presses; `"$mod+K $mod+S"` → two presses.
 */
export function parseKeySequence(keys: KeySequence): ParsedSequence {
  return keys.trim().split(/\s+/).map(parseChord);
}

/**
 * Serialises a `ParsedPress` back to canonical tinykeys syntax.
 *
 * `{ modifiers: ['$mod', 'Shift'], key: 'K' }` → `"$mod+Shift+K"`
 */
export function serializePress(press: ParsedPress): string {
  return [...press.modifiers, press.key].join('+');
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalises a `KeySequence` string to canonical form:
 * - Modifiers sorted in canonical order
 * - Letter keys uppercased
 * - Extra whitespace collapsed
 *
 * Idempotent: `normalizeKeySequence(normalizeKeySequence(s)) === normalizeKeySequence(s)`
 */
export function normalizeKeySequence(keys: KeySequence): KeySequence {
  return parseKeySequence(keys).map(serializePress).join(' ');
}

/**
 * Returns `true` if two key sequences are equivalent after normalisation.
 * `$mod` is treated as a symbolic modifier — same on all platforms.
 */
export function keySequencesEqual(a: KeySequence, b: KeySequence): boolean {
  return normalizeKeySequence(a) === normalizeKeySequence(b);
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

export type Platform = 'mac' | 'other';

/** Key display overrides for human-friendly rendering. */
const KEY_DISPLAY_NAMES: Record<string, string> = {
  Enter: '↵',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: '␣',
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
};

/** Mac-specific modifier display symbols. */
const MOD_DISPLAY_MAC: Record<string, string> = {
  $mod: '⌘',
  Meta: '⌘',
  Ctrl: '⌃',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
};

/** Non-mac modifier display text. */
const MOD_DISPLAY_OTHER: Record<string, string> = {
  $mod: 'Ctrl',
  Meta: 'Meta',
  Ctrl: 'Ctrl',
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
};

/**
 * Formats one `ParsedPress` for human display.
 *
 * On Mac, uses symbols (⌘⇧⌃⌥) with no separators between modifiers and key.
 * On other platforms, uses text with `+` separators.
 *
 * Examples:
 *  - `$mod+K` on mac   → `⌘K`
 *  - `$mod+K` on win   → `Ctrl+K`
 *  - `$mod+Shift+S` on mac → `⌘⇧S`
 *  - `Escape` on any   → `Esc`
 */
function formatPressForDisplay(press: ParsedPress, platform: Platform): string {
  const dispMap = platform === 'mac' ? MOD_DISPLAY_MAC : MOD_DISPLAY_OTHER;
  const mods = press.modifiers.map((m) => dispMap[m] ?? m);
  const key = KEY_DISPLAY_NAMES[press.key] ?? press.key;

  if (platform === 'mac') return mods.join('') + key;

  return [...mods, key].join('+');
}

/**
 * Formats a full `KeySequence` for human display.
 *
 * Multi-press sequences are joined with a space.
 *
 * @param keys     tinykeys-syntax key sequence (may contain `$mod`)
 * @param platform `'mac'` for macOS symbol style, `'other'` for text style
 *
 * @example
 * formatKeySequenceForDisplay("$mod+K", "mac")         // "⌘K"
 * formatKeySequenceForDisplay("$mod+K", "other")       // "Ctrl+K"
 * formatKeySequenceForDisplay("$mod+K $mod+S", "mac")  // "⌘K ⌘S"
 */
export function formatKeySequenceForDisplay(keys: KeySequence, platform: Platform): string {
  return parseKeySequence(keys)
    .map((p) => formatPressForDisplay(p, platform))
    .join(' ');
}

/**
 * Derives the current platform from `navigator.platform` (if available in
 * the renderer) or falls back to `'other'`.
 *
 * Call once at app boot and cache the result.
 */
export function detectPlatform(): Platform {
  if (typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)) {
    return 'mac';
  }

  return 'other';
}
