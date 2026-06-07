import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import {
  normalizeKeySequence,
  keySequencesEqual,
  formatKeySequenceForDisplay,
} from '@/lib/shortcuts/normalize';
import { detectConflicts, detectHardConflicts } from '@/lib/shortcuts/conflicts';
import type { DefaultKeyBinding } from '@/lib/shortcuts/types';
import { defaultKeymap } from '@/lib/defaultKeymap';
import { useShortcutRegistry } from '@/stores/shell/shortcutRegistry';

// ---------------------------------------------------------------------------
// Normalization tests
// ---------------------------------------------------------------------------

describe('normalizeKeySequence', () => {
  test('uppercases letter key', () => {
    expect(normalizeKeySequence('$mod+k')).toBe('$mod+K');
  });

  test('sorts modifiers in canonical order', () => {
    expect(normalizeKeySequence('Shift+$mod+K')).toBe('$mod+Shift+K');
    expect(normalizeKeySequence('Alt+Shift+$mod+K')).toBe('$mod+Alt+Shift+K');
  });

  test('collapses whitespace', () => {
    expect(normalizeKeySequence('  $mod+K  $mod+S  ')).toBe('$mod+K $mod+S');
  });

  test('is idempotent', () => {
    const s = '$mod+Shift+K';
    expect(normalizeKeySequence(normalizeKeySequence(s))).toBe(normalizeKeySequence(s));
  });

  test('handles named keys (Enter, Escape)', () => {
    expect(normalizeKeySequence('shift+enter')).toBe('Shift+Enter');
    expect(normalizeKeySequence('escape')).toBe('Escape');
  });

  test('keeps code values verbatim', () => {
    expect(normalizeKeySequence('$mod+Backquote')).toBe('$mod+Backquote');
  });

  test('multi-press sequence preserves press order', () => {
    expect(normalizeKeySequence('$mod+K $mod+S')).toBe('$mod+K $mod+S');
    expect(normalizeKeySequence('g i')).toBe('G I');
  });

  test('keeps $mod symbolic (not resolved to platform-specific modifier)', () => {
    // $mod stays $mod — display layer resolves it
    expect(normalizeKeySequence('$mod+K')).toBe('$mod+K');
    expect(normalizeKeySequence('$mod+K')).not.toBe('Ctrl+K');
    expect(normalizeKeySequence('$mod+K')).not.toBe('Meta+K');
  });
});

describe('keySequencesEqual', () => {
  test('same normalised form → equal', () => {
    expect(keySequencesEqual('$mod+K', '$mod+k')).toBe(true);
    expect(keySequencesEqual('shift+$mod+k', '$mod+Shift+K')).toBe(true);
  });

  test('different sequences → not equal', () => {
    expect(keySequencesEqual('$mod+K', 'Ctrl+K')).toBe(false);
    expect(keySequencesEqual('$mod+K', 'Meta+K')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Display formatting tests
// ---------------------------------------------------------------------------

describe('formatKeySequenceForDisplay — $mod', () => {
  test('$mod+K on mac → ⌘K', () => {
    expect(formatKeySequenceForDisplay('$mod+K', 'mac')).toBe('⌘K');
  });

  test('$mod+K on other → Ctrl+K', () => {
    expect(formatKeySequenceForDisplay('$mod+K', 'other')).toBe('Ctrl+K');
  });

  test('Ctrl+K remains Ctrl+K on both platforms (explicit Ctrl, not $mod)', () => {
    expect(formatKeySequenceForDisplay('Ctrl+K', 'mac')).toBe('⌃K');
    expect(formatKeySequenceForDisplay('Ctrl+K', 'other')).toBe('Ctrl+K');
  });

  test('Meta+K remains Meta on other (explicit Meta, not $mod)', () => {
    expect(formatKeySequenceForDisplay('Meta+K', 'other')).toBe('Meta+K');
    expect(formatKeySequenceForDisplay('Meta+K', 'mac')).toBe('⌘K');
  });

  test('$mod+Shift+S on mac → ⌘⇧S', () => {
    expect(formatKeySequenceForDisplay('$mod+Shift+S', 'mac')).toBe('⌘⇧S');
  });

  test('$mod+Shift+S on other → Ctrl+Shift+S', () => {
    expect(formatKeySequenceForDisplay('$mod+Shift+S', 'other')).toBe('Ctrl+Shift+S');
  });

  test('multi-press sequence joined with space', () => {
    expect(formatKeySequenceForDisplay('$mod+K $mod+S', 'mac')).toBe('⌘K ⌘S');
    expect(formatKeySequenceForDisplay('$mod+K $mod+S', 'other')).toBe('Ctrl+K Ctrl+S');
  });

  test('Enter renders as ↵', () => {
    expect(formatKeySequenceForDisplay('Enter', 'other')).toBe('↵');
    expect(formatKeySequenceForDisplay('$mod+Enter', 'other')).toBe('Ctrl+↵');
  });

  test('Escape renders as Esc', () => {
    expect(formatKeySequenceForDisplay('Escape', 'other')).toBe('Esc');
  });

  test('Backquote renders as backtick character', () => {
    expect(formatKeySequenceForDisplay('$mod+Backquote', 'other')).toBe('Ctrl+`');
    expect(formatKeySequenceForDisplay('$mod+Backquote', 'mac')).toBe('⌘`');
  });
});

// ---------------------------------------------------------------------------
// Conflict detection tests
// ---------------------------------------------------------------------------

function makeBinding(
  overrides: Partial<DefaultKeyBinding> & { id: string; commandId: string; keys: string },
): DefaultKeyBinding {
  return {
    scope: 'global',
    reassignable: true,
    ...overrides,
  };
}

describe('detectConflicts — exact same-scope', () => {
  test('two bindings with same scope + same keys → exact conflict', () => {
    const bindings = [
      makeBinding({ id: 'a', commandId: 'cmd.a', keys: '$mod+K', scope: 'global' }),
      makeBinding({ id: 'b', commandId: 'cmd.b', keys: '$mod+K', scope: 'global' }),
    ];
    const conflicts = detectConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('exact');
    expect(conflicts[0]!.bindingId).toBe('a');
    expect(conflicts[0]!.conflictingBindingId).toBe('b');
  });

  test('same keys but different scopes → no exact conflict', () => {
    const bindings = [
      makeBinding({ id: 'a', commandId: 'cmd.a', keys: 'Enter', scope: 'global' }),
      makeBinding({ id: 'b', commandId: 'cmd.b', keys: 'Enter', scope: 'composer' }),
    ];
    const exact = detectConflicts(bindings).filter((c) => c.kind === 'exact');
    expect(exact).toHaveLength(0);
  });

  test('case-normalised keys match for exact conflict', () => {
    const bindings = [
      makeBinding({ id: 'a', commandId: 'cmd.a', keys: '$mod+k', scope: 'global' }),
      makeBinding({ id: 'b', commandId: 'cmd.b', keys: '$mod+K', scope: 'global' }),
    ];
    const conflicts = detectConflicts(bindings);
    expect(conflicts.some((c) => c.kind === 'exact')).toBe(true);
  });
});

describe('detectConflicts — scope shadow', () => {
  test('composer Enter shadows global Enter → scope-shadow warning', () => {
    const bindings = [
      makeBinding({ id: 'global.enter', commandId: 'cmd.global', keys: 'Enter', scope: 'global' }),
      makeBinding({
        id: 'composer.enter',
        commandId: 'cmd.composer',
        keys: 'Enter',
        scope: 'composer',
      }),
    ];
    const shadows = detectConflicts(bindings).filter((c) => c.kind === 'scope-shadow');
    expect(shadows).toHaveLength(1);
    // composer (priority 5) shadows global (priority 8) → composer binding reported
    expect(shadows[0]!.bindingId).toBe('composer.enter');
    expect(shadows[0]!.scope).toBe('composer');
  });

  test('two non-overlapping scopes at same priority → no shadow', () => {
    // composerTypeahead (1) and filePicker (1) have same priority — no canShadow either way
    const bindings = [
      makeBinding({ id: 'a', commandId: 'cmd.a', keys: 'Enter', scope: 'composerTypeahead' }),
      makeBinding({ id: 'b', commandId: 'cmd.b', keys: 'Enter', scope: 'filePicker' }),
    ];
    const shadows = detectConflicts(bindings).filter((c) => c.kind === 'scope-shadow');
    expect(shadows).toHaveLength(0);
  });
});

describe('detectConflicts — prefix conflicts', () => {
  test('G is a prefix of G I in same scope → prefix conflict', () => {
    const bindings = [
      makeBinding({ id: 'a', commandId: 'cmd.a', keys: 'G', scope: 'global' }),
      makeBinding({ id: 'b', commandId: 'cmd.b', keys: 'G I', scope: 'global' }),
    ];
    const conflicts = detectConflicts(bindings).filter((c) => c.kind === 'prefix');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.bindingId).toBe('a');
  });

  test('Escape is a prefix of Escape Escape in same scope → prefix conflict', () => {
    const bindings = [
      makeBinding({ id: 'a', commandId: 'cmd.a', keys: 'Escape', scope: 'commandPalette' }),
      makeBinding({ id: 'b', commandId: 'cmd.b', keys: 'Escape Escape', scope: 'commandPalette' }),
    ];
    const conflicts = detectConflicts(bindings).filter((c) => c.kind === 'prefix');
    expect(conflicts).toHaveLength(1);
  });

  test('prefix in different scopes → no prefix conflict', () => {
    const bindings = [
      makeBinding({ id: 'a', commandId: 'cmd.a', keys: 'G', scope: 'global' }),
      makeBinding({ id: 'b', commandId: 'cmd.b', keys: 'G I', scope: 'composer' }),
    ];
    const conflicts = detectConflicts(bindings).filter((c) => c.kind === 'prefix');
    expect(conflicts).toHaveLength(0);
  });
});

describe('detectConflicts — unknown-command', () => {
  test('empty commandId → unknown-command', () => {
    const bindings = [makeBinding({ id: 'bad', commandId: '', keys: '$mod+K' })];
    const conflicts = detectConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('unknown-command');
  });
});

// ---------------------------------------------------------------------------
// Default keymap integrity tests
// ---------------------------------------------------------------------------

describe('defaultKeymap integrity', () => {
  test('no duplicate binding ids', () => {
    const ids = defaultKeymap.map((b) => b.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('no intra-scope exact conflicts', () => {
    const hardConflicts = detectHardConflicts(defaultKeymap).filter((c) => c.kind === 'exact');
    expect(hardConflicts).toHaveLength(0);
  });

  test('all commandIds are non-empty', () => {
    const empty = defaultKeymap.filter((b) => !b.commandId.trim());
    expect(empty).toHaveLength(0);
  });

  test('composer bindings are all non-reassignable', () => {
    const composerBindings = defaultKeymap.filter((b) => b.scope === 'composer');
    expect(composerBindings.length).toBeGreaterThan(0);
    for (const b of composerBindings) {
      expect(b.reassignable).toBe(false);
    }
  });

  test('all scopes used are valid ShortcutScope values', () => {
    const validScopes = new Set([
      'global',
      'commandPalette',
      'composer',
      'composerTypeahead',
      'terminal',
      'filePicker',
      'messageEditor',
      'pendingRequest',
      'composerCommandTerminal',
      'dockviewTabRename',
      'accessibility',
    ]);
    for (const b of defaultKeymap) {
      expect(validScopes.has(b.scope)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// shortcutRegistry store — merge logic
// ---------------------------------------------------------------------------

describe('shortcutRegistry — effective bindings merge', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    // pinia is reset via createPinia in beforeEach
  });

  test('empty prefs → all defaults visible', () => {
    const registry = useShortcutRegistry();
    expect(registry.effectiveBindings.length).toBe(defaultKeymap.length);
  });

  test('disabled default id removes that binding', () => {
    const registry = useShortcutRegistry();
    const target = defaultKeymap[0]!;
    registry.setPrefs({
      customBindings: [],
      disabledDefaultBindingIds: [target.id],
    });
    const found = registry.effectiveBindings.find((b) => b.id === target.id);
    expect(found).toBeUndefined();
    expect(registry.effectiveBindings.length).toBe(defaultKeymap.length - 1);
  });

  test('custom binding is added on top of defaults', () => {
    const registry = useShortcutRegistry();
    registry.setPrefs({
      customBindings: [{ commandId: 'session.new', scope: 'global', keys: '$mod+Shift+N' }],
      disabledDefaultBindingIds: [],
    });
    const custom = registry.effectiveBindings.find((b) => b.source === 'user');
    expect(custom).toBeDefined();
    expect(custom!.commandId).toBe('session.new');
    expect(custom!.keys).toBe('$mod+Shift+N');
  });

  test('disabled default + custom replacement → one effective binding for command', () => {
    const registry = useShortcutRegistry();
    // Find the default binding for session.new
    const original = defaultKeymap.find((b) => b.commandId === 'session.new')!;
    expect(original).toBeDefined();

    registry.setPrefs({
      customBindings: [{ commandId: 'session.new', scope: 'global', keys: '$mod+Shift+N' }],
      disabledDefaultBindingIds: [original.id],
    });

    const all = registry.effectiveBindingsForCommand('session.new');
    expect(all).toHaveLength(1);
    expect(all[0]!.source).toBe('user');
    expect(all[0]!.keys).toBe('$mod+Shift+N');
  });

  test('effectiveBindingsForCommand returns empty array when no bindings', () => {
    const registry = useShortcutRegistry();
    expect(registry.effectiveBindingsForCommand('nonexistent.command')).toHaveLength(0);
  });

  test('bindingsForScope filters by scope', () => {
    const registry = useShortcutRegistry();
    const global = registry.bindingsForScope('global');
    const composer = registry.bindingsForScope('composer');
    expect(global.every((b) => b.scope === 'global')).toBe(true);
    expect(composer.every((b) => b.scope === 'composer')).toBe(true);
    expect(global.length).toBeGreaterThan(0);
    expect(composer.length).toBeGreaterThan(0);
  });

  test('custom binding keys are normalised on merge', () => {
    const registry = useShortcutRegistry();
    registry.setPrefs({
      customBindings: [{ commandId: 'session.new', scope: 'global', keys: 'shift+$mod+n' }],
      disabledDefaultBindingIds: [],
    });
    const custom = registry.effectiveBindings.find((b) => b.source === 'user');
    expect(custom!.keys).toBe('$mod+Shift+N');
  });

  test('setPrefs is reactive — effectiveBindings updates', () => {
    const registry = useShortcutRegistry();
    const before = registry.effectiveBindings.length;

    const target = defaultKeymap[0]!;
    registry.setPrefs({
      customBindings: [],
      disabledDefaultBindingIds: [target.id],
    });
    expect(registry.effectiveBindings.length).toBe(before - 1);

    // Reset to empty prefs → back to full defaults
    registry.setPrefs({ customBindings: [], disabledDefaultBindingIds: [] });
    expect(registry.effectiveBindings.length).toBe(before);
  });
});
