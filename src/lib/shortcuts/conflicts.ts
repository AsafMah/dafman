/**
 * Keyboard-shortcut conflict detection.
 *
 * Pure functions — no DOM, no Vue, no side effects.
 * Takes a flat array of bindings and returns every conflict found.
 */

import type { DefaultKeyBinding, ShortcutConflict, ShortcutScope } from './types';
import { normalizeKeySequence, parseKeySequence, serializePress } from './normalize';

// ---------------------------------------------------------------------------
// Scope priority (lower = higher priority = more specific)
// ---------------------------------------------------------------------------

const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
  commandPalette: 0,
  composerTypeahead: 1,
  filePicker: 1,
  messageEditor: 2,
  composerCommandTerminal: 3,
  terminal: 4,
  composer: 5,
  pendingRequest: 6,
  accessibility: 7,
  dockviewTabRename: 7,
  global: 8,
};

/**
 * Returns `true` when `inner` is "more specific" than `outer`—i.e. inner can
 * shadow outer when both are active for the same key event.
 */
function canShadow(inner: ShortcutScope, outer: ShortcutScope): boolean {
  return SCOPE_PRIORITY[inner] < SCOPE_PRIORITY[outer];
}

// ---------------------------------------------------------------------------
// Sequence prefix checking
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `shorter` is a strict prefix of `longer`.
 *
 * Prefix check is done on normalised chord strings so modifier order and key
 * casing cannot fool the comparison.
 */
function isPrefix(shorter: string, longer: string): boolean {
  const a = parseKeySequence(shorter);
  const b = parseKeySequence(longer);

  if (a.length >= b.length) return false;

  return a.every((press, i) => serializePress(press) === serializePress(b[i]));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects all conflicts in a flat list of bindings.
 *
 * Returns one `ShortcutConflict` per problem found. A binding can appear in
 * multiple conflicts (e.g. exact AND prefix for different counterparts).
 *
 * Conflict kinds:
 * - **exact**        — same normalised sequence, same scope, both enabled
 * - **scope-shadow** — same sequence, scopes where one can shadow the other
 * - **prefix**       — one sequence is a prefix of another in the same scope
 * - **unknown-command** — `commandId` is empty or obviously malformed
 */
export function detectConflicts(bindings: DefaultKeyBinding[]): ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = [];

  // Pre-normalise to avoid redundant work inside nested loops
  const normalised = bindings.map((b) => ({
    binding: b,
    norm: normalizeKeySequence(b.keys),
  }));

  for (let i = 0; i < normalised.length; i++) {
    const { binding: a, norm: na } = normalised[i];

    // Unknown-command check
    if (!a.commandId || !a.commandId.trim()) {
      conflicts.push({
        kind: 'unknown-command',
        bindingId: a.id,
        commandId: a.commandId,
        scope: a.scope,
        message: `Binding "${a.id}" has an empty commandId.`,
      });
      continue;
    }

    for (let j = i + 1; j < normalised.length; j++) {
      const { binding: b, norm: nb } = normalised[j];

      const sameScope = a.scope === b.scope;
      const sameSequence = na === nb;

      if (sameScope && sameSequence) {
        // Hard conflict: exact same scope + sequence
        conflicts.push({
          kind: 'exact',
          bindingId: a.id,
          conflictingBindingId: b.id,
          commandId: a.commandId,
          scope: a.scope,
          message: `Exact conflict: "${na}" is bound to both "${a.commandId}" and "${b.commandId}" in scope "${a.scope}".`,
        });
        continue;
      }

      if (!sameScope && sameSequence) {
        // Scope shadow: same sequence, different scopes
        if (canShadow(a.scope, b.scope)) {
          conflicts.push({
            kind: 'scope-shadow',
            bindingId: a.id,
            conflictingBindingId: b.id,
            commandId: a.commandId,
            scope: a.scope,
            message: `Scope shadow: "${na}" in "${a.scope}" shadows the same binding in "${b.scope}" (${b.commandId}).`,
          });
        } else if (canShadow(b.scope, a.scope)) {
          conflicts.push({
            kind: 'scope-shadow',
            bindingId: b.id,
            conflictingBindingId: a.id,
            commandId: b.commandId,
            scope: b.scope,
            message: `Scope shadow: "${nb}" in "${b.scope}" shadows the same binding in "${a.scope}" (${a.commandId}).`,
          });
        }

        continue;
      }

      if (sameScope) {
        // Prefix conflict: one sequence is a prefix of the other in the same scope
        if (isPrefix(na, nb)) {
          conflicts.push({
            kind: 'prefix',
            bindingId: a.id,
            conflictingBindingId: b.id,
            commandId: a.commandId,
            scope: a.scope,
            message: `Prefix conflict: "${na}" (${a.commandId}) is a prefix of "${nb}" (${b.commandId}) in scope "${a.scope}".`,
          });
        } else if (isPrefix(nb, na)) {
          conflicts.push({
            kind: 'prefix',
            bindingId: b.id,
            conflictingBindingId: a.id,
            commandId: b.commandId,
            scope: b.scope,
            message: `Prefix conflict: "${nb}" (${b.commandId}) is a prefix of "${na}" (${a.commandId}) in scope "${b.scope}".`,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Convenience: returns only conflicts of kind `'exact'` or `'prefix'`
 * (hard errors that prevent correct dispatch).
 */
export function detectHardConflicts(bindings: DefaultKeyBinding[]): ShortcutConflict[] {
  return detectConflicts(bindings).filter(
    (c) => c.kind === 'exact' || c.kind === 'prefix' || c.kind === 'unknown-command',
  );
}
