/**
 * Pure helper functions for the Keyboard Shortcuts settings editor.
 * Exported for unit tests; the Vue component imports from here.
 */

import type {
  DefaultKeyBinding,
  EffectiveBinding,
  KeyboardShortcutPrefs,
  ShortcutConflict,
  ShortcutScope,
} from './types';
import { detectConflicts } from './conflicts';
import { normalizeKeySequence } from './normalize';

// ---------------------------------------------------------------------------
// Scope display labels
// ---------------------------------------------------------------------------

export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: 'Global',
  commandPalette: 'Command Palette',
  composer: 'Composer',
  composerTypeahead: 'Composer Typeahead',
  composerCommandTerminal: 'Composer Command Terminal',
  terminal: 'Terminal',
  filePicker: 'File Picker',
  messageEditor: 'Message Editor',
  pendingRequest: 'Pending Request',
  accessibility: 'Accessibility',
  dockviewTabRename: 'Tab Rename',
};

// ---------------------------------------------------------------------------
// Row model
// ---------------------------------------------------------------------------

export interface ShortcutRow {
  commandId: string;
  scope: ShortcutScope;
  label: string;
  /** Display group name (from SCOPE_LABELS) */
  group: string;
  /** Whether the user may reassign this binding */
  reassignable: boolean;
  /** Normalized key sequences currently in effect for this command+scope */
  effectiveKeys: string[];
  /** Normalized key sequences from the default keymap for this command+scope */
  defaultKeys: string[];
  /** true when user has a custom binding OR has disabled a default for this command+scope */
  isUserModified: boolean;
  /** Conflicts involving any of this row's bindings */
  conflicts: ShortcutConflict[];
}

/**
 * Builds a flat list of ShortcutRow items from defaultKeymap + effective bindings.
 * Each unique (commandId, scope) pair produces one row.
 */
export function buildRows(
  km: DefaultKeyBinding[],
  effectiveBindings: EffectiveBinding[],
  prefs: KeyboardShortcutPrefs,
  allConflicts: ShortcutConflict[],
  getLabel: (commandId: string) => string,
): ShortcutRow[] {
  const seen = new Set<string>();
  const pairs: Array<{ commandId: string; scope: ShortcutScope }> = [];

  for (const b of km) {
    const key = `${b.commandId}|${b.scope}`;

    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ commandId: b.commandId, scope: b.scope });
    }
  }

  return pairs.map(({ commandId, scope }) => {
    const defaultForCmd = km.filter((b) => b.commandId === commandId && b.scope === scope);
    const effectiveForCmd = effectiveBindings.filter(
      (b) => b.commandId === commandId && b.scope === scope,
    );
    const defaultIds = defaultForCmd.map((b) => b.id);

    const isUserModified =
      effectiveForCmd.some((b) => b.source === 'user') ||
      defaultIds.some((id) => prefs.disabledDefaultBindingIds.includes(id));

    // Include conflicts where this command is either the subject or the other party
    const bindingIds = new Set(effectiveForCmd.map((b) => b.id));
    const conflictsForCmd = allConflicts.filter(
      (c) =>
        (c.commandId === commandId && c.scope === scope) ||
        (c.conflictingBindingId !== undefined &&
          c.conflictingBindingId !== null &&
          bindingIds.has(c.conflictingBindingId)),
    );

    return {
      commandId,
      scope,
      label: getLabel(commandId),
      group: SCOPE_LABELS[scope] ?? scope,
      reassignable: defaultForCmd.some((b) => b.reassignable),
      effectiveKeys: effectiveForCmd.map((b) => b.keys),
      defaultKeys: defaultForCmd.map((b) => normalizeKeySequence(b.keys)),
      isUserModified,
      conflicts: conflictsForCmd,
    };
  });
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

/**
 * Filters ShortcutRow list by a search query.
 * Matches label, commandId, group/scope name, or any key sequence.
 */
export function filterRows(rows: ShortcutRow[], query: string): ShortcutRow[] {
  const q = query.trim().toLowerCase();

  if (!q) return rows;

  return rows.filter(
    (row) =>
      row.label.toLowerCase().includes(q) ||
      row.commandId.toLowerCase().includes(q) ||
      row.group.toLowerCase().includes(q) ||
      row.scope.toLowerCase().includes(q) ||
      row.effectiveKeys.some((k) => k.toLowerCase().includes(q)),
  );
}

// ---------------------------------------------------------------------------
// Prefs mutation helpers (return new objects — never mutate)
// ---------------------------------------------------------------------------

/**
 * Returns new prefs with a specific command's user customizations cleared.
 * Removes user bindings for (commandId, scope) and re-enables any disabled defaults.
 */
export function resetCommandPrefs(
  prefs: KeyboardShortcutPrefs,
  commandId: string,
  scope: ShortcutScope,
  km: DefaultKeyBinding[],
): KeyboardShortcutPrefs {
  const defaultIds = km
    .filter((b) => b.commandId === commandId && b.scope === scope)
    .map((b) => b.id);

  return {
    customBindings: prefs.customBindings.filter(
      (cb) => !(cb.commandId === commandId && cb.scope === scope),
    ),
    disabledDefaultBindingIds: prefs.disabledDefaultBindingIds.filter(
      (id) => !defaultIds.includes(id),
    ),
  };
}

/**
 * Returns new prefs with a user binding added (or replaced) for (commandId, scope, keys).
 * All default bindings for the same command+scope are disabled.
 */
export function buildNewPrefsForBinding(
  prefs: KeyboardShortcutPrefs,
  commandId: string,
  scope: ShortcutScope,
  keys: string,
  km: DefaultKeyBinding[],
): KeyboardShortcutPrefs {
  const normalized = normalizeKeySequence(keys);
  const defaultIdsToDisable = km
    .filter((b) => b.commandId === commandId && b.scope === scope)
    .map((b) => b.id);

  return {
    customBindings: [
      ...prefs.customBindings.filter((cb) => !(cb.commandId === commandId && cb.scope === scope)),
      { commandId, scope, keys: normalized },
    ],
    disabledDefaultBindingIds: [
      ...new Set([...prefs.disabledDefaultBindingIds, ...defaultIdsToDisable]),
    ],
  };
}

// ---------------------------------------------------------------------------
// Conflict detection for a proposed chord
// ---------------------------------------------------------------------------

/**
 * Detects conflicts for a proposed new chord/sequence against existing effective bindings.
 * Returns only conflicts that involve the proposed binding.
 */
export function detectConflictsForChord(
  chord: string,
  scope: ShortcutScope,
  commandId: string,
  existingBindings: EffectiveBinding[],
): ShortcutConflict[] {
  const proposedId = '__proposed__';
  const normalized = normalizeKeySequence(chord);

  const bindings: DefaultKeyBinding[] = [
    ...existingBindings.map((b) => ({
      id: b.id,
      commandId: b.commandId,
      scope: b.scope,
      keys: b.keys,
      reassignable: b.reassignable,
    })),
    {
      id: proposedId,
      commandId,
      scope,
      keys: normalized,
      reassignable: true,
    },
  ];

  const allConflicts = detectConflicts(bindings);

  return allConflicts.filter(
    (c) => c.bindingId === proposedId || c.conflictingBindingId === proposedId,
  );
}

// ---------------------------------------------------------------------------
// KeyboardEvent → tinykeys chord string
// ---------------------------------------------------------------------------

/** Keys that should not be captured as chord components. */
const IGNORED_KEYS: Record<string, true> = {
  Control: true,
  Meta: true,
  Alt: true,
  Shift: true,
  CapsLock: true,
  NumLock: true,
  ScrollLock: true,
  Dead: true,
  Process: true,
  Unidentified: true,
  OS: true,
  Win: true,
  ContextMenu: true,
  // F-keys are generally reserved / pass-through in Electron — omit for now
  F1: true,
  F2: true,
  F3: true,
  F4: true,
  F5: true,
  F6: true,
  F7: true,
  F8: true,
  F9: true,
  F10: true,
  F11: true,
  F12: true,
  // Tab is accessibility focus
  Tab: true,
};

/**
 * Converts a KeyboardEvent to a tinykeys-syntax chord string.
 * Returns `null` for modifier-only presses, composition events, or ignored keys.
 *
 * Uses `$mod` for the platform primary modifier (Ctrl on Windows/Linux, Meta on Mac)
 * to match the defaultKeymap convention.
 */
export function buildChordFromEvent(event: KeyboardEvent): string | null {
  if (!event.key || IGNORED_KEYS[event.key]) return null;

  if (event.isComposing) return null;

  const parts: string[] = [];

  const isMac =
    typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform.toLowerCase());

  // Primary modifier → $mod
  if (isMac) {
    if (event.metaKey) parts.push('$mod');
    else if (event.ctrlKey) parts.push('Ctrl');
  } else {
    if (event.ctrlKey) parts.push('$mod');
    else if (event.metaKey) parts.push('Meta');
  }

  if (event.altKey) parts.push('Alt');

  if (event.shiftKey) parts.push('Shift');

  // Single ASCII letter → uppercase; otherwise use event.key verbatim
  let key = event.key;

  if (key.length === 1) key = key.toUpperCase();

  parts.push(key);

  // If no modifier and single printable char, it's probably just typing — skip.
  // (Must have at least one modifier to be a shortcut chord, except for special
  //  keys like Escape, Enter, ArrowDown, Backspace, etc.)
  if (key.length === 1 && parts.length === 1) return null;

  try {
    return normalizeKeySequence(parts.join('+'));
  } catch {
    return null;
  }
}
