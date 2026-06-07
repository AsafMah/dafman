/**
 * Unit tests for the keyboard shortcuts editor utilities.
 * Tests pure logic: normalization, conflict detection, reset helpers, search filter.
 *
 * These are deliberately not Vue component rendering tests — the logic that can
 * break is in the pure helpers; component wiring is covered by the existing
 * shortcutRegistry and SettingsGroup tests.
 */

import { describe, expect, test } from 'bun:test';
import type {
  DefaultKeyBinding,
  KeyboardShortcutPrefs,
  ShortcutScope,
} from '@/lib/shortcuts/types';
import type { EffectiveBinding } from '@/lib/shortcuts/types';
import {
  buildChordFromEvent,
  buildNewPrefsForBinding,
  buildRows,
  detectConflictsForChord,
  filterRows,
  resetCommandPrefs,
  SCOPE_LABELS,
  type ShortcutRow,
} from '@/lib/shortcuts/editorUtils';

// ---------------------------------------------------------------------------
// Helpers
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

function makeEffective(
  overrides: Partial<EffectiveBinding> & { id: string; commandId: string; keys: string },
): EffectiveBinding {
  return {
    scope: 'global',
    source: 'default',
    reassignable: true,
    ...overrides,
  };
}

function emptyPrefs(): KeyboardShortcutPrefs {
  return { customBindings: [], disabledDefaultBindingIds: [] };
}

/** Creates a synthetic KeyboardEvent from a descriptor. */
function fakeKeyEvent(
  key: string,
  modifiers: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  } = {},
): KeyboardEvent {
  return {
    key,
    isComposing: false,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    altKey: modifiers.altKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// 1. Recorder normalizes + detects a conflict
// ---------------------------------------------------------------------------

describe('buildChordFromEvent — normalization', () => {
  test('Ctrl+K on Windows becomes $mod+K', () => {
    // Simulate Windows: navigator.platform will be something else (no "mac")
    const event = fakeKeyEvent('k', { ctrlKey: true });
    const chord = buildChordFromEvent(event);
    // On non-mac, ctrlKey → $mod; key 'k' → uppercase 'K'
    expect(chord).toBe('$mod+K');
  });

  test('Ctrl+Shift+S normalizes modifier order', () => {
    const event = fakeKeyEvent('s', { ctrlKey: true, shiftKey: true });
    const chord = buildChordFromEvent(event);
    expect(chord).toBe('$mod+Shift+S');
  });

  test('Alt+Enter normalizes correctly', () => {
    const event = fakeKeyEvent('Enter', { altKey: true });
    const chord = buildChordFromEvent(event);
    expect(chord).toBe('Alt+Enter');
  });

  test('standalone modifier key returns null', () => {
    expect(buildChordFromEvent(fakeKeyEvent('Control'))).toBeNull();
    expect(buildChordFromEvent(fakeKeyEvent('Shift'))).toBeNull();
    expect(buildChordFromEvent(fakeKeyEvent('Alt'))).toBeNull();
    expect(buildChordFromEvent(fakeKeyEvent('Meta'))).toBeNull();
  });

  test('bare printable letter (no modifier) returns null — not a shortcut', () => {
    expect(buildChordFromEvent(fakeKeyEvent('a'))).toBeNull();
    expect(buildChordFromEvent(fakeKeyEvent('z'))).toBeNull();
  });

  test('special key without modifier is captured (Escape, Enter, etc.)', () => {
    expect(buildChordFromEvent(fakeKeyEvent('Escape'))).toBe('Escape');
    expect(buildChordFromEvent(fakeKeyEvent('Backspace'))).toBe('Backspace');
  });

  test('Tab is ignored (accessibility)', () => {
    expect(buildChordFromEvent(fakeKeyEvent('Tab'))).toBeNull();
    expect(buildChordFromEvent(fakeKeyEvent('Tab', { ctrlKey: true }))).toBeNull();
  });
});

describe('detectConflictsForChord — conflict detection', () => {
  const existingGlobal = makeEffective({
    id: 'global.commandPalette.toggle',
    commandId: 'commandPalette.toggle',
    scope: 'global',
    keys: '$mod+K',
  });

  test('detects exact conflict when same scope + sequence already bound', () => {
    const conflicts = detectConflictsForChord('$mod+K', 'global', 'new.command', [existingGlobal]);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].kind).toBe('exact');
  });

  test('detects scope-shadow for same sequence in nested scope', () => {
    // '$mod+K' in 'composer' scope shadows the global binding
    const conflicts = detectConflictsForChord('$mod+K', 'composer', 'composer.action', [
      existingGlobal,
    ]);
    // Should detect scope-shadow since composer is more specific than global
    expect(conflicts.some((c) => c.kind === 'scope-shadow')).toBe(true);
  });

  test('no conflict when sequence is unique', () => {
    const conflicts = detectConflictsForChord('$mod+Shift+Z', 'global', 'new.command', [
      existingGlobal,
    ]);
    expect(conflicts).toHaveLength(0);
  });

  test('detects prefix conflict', () => {
    // '$mod+K' is a prefix of '$mod+K $mod+S' in the same scope
    const withSequence = makeEffective({
      id: 'global.cmd.seq',
      commandId: 'some.command',
      scope: 'global',
      keys: '$mod+K $mod+S',
    });
    const conflicts = detectConflictsForChord('$mod+K', 'global', 'new.command', [withSequence]);
    expect(conflicts.some((c) => c.kind === 'prefix')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Reset restores defaults
// ---------------------------------------------------------------------------

describe('resetCommandPrefs', () => {
  const km: DefaultKeyBinding[] = [
    makeBinding({ id: 'global.settings.open', commandId: 'settings.open', keys: '$mod+,' }),
    makeBinding({ id: 'global.session.new', commandId: 'session.new', keys: '$mod+N' }),
  ];

  test('removes user custom binding for the command', () => {
    const prefs: KeyboardShortcutPrefs = {
      customBindings: [
        { commandId: 'settings.open', scope: 'global', keys: '$mod+P' },
        { commandId: 'session.new', scope: 'global', keys: '$mod+T' },
      ],
      disabledDefaultBindingIds: [],
    };

    const result = resetCommandPrefs(prefs, 'settings.open', 'global', km);

    // settings.open custom binding removed, session.new preserved
    expect(result.customBindings).toHaveLength(1);
    expect(result.customBindings[0].commandId).toBe('session.new');
  });

  test('re-enables disabled default binding ids for the command', () => {
    const prefs: KeyboardShortcutPrefs = {
      customBindings: [],
      disabledDefaultBindingIds: ['global.settings.open', 'global.session.new'],
    };

    const result = resetCommandPrefs(prefs, 'settings.open', 'global', km);

    // global.settings.open removed from disabled list; global.session.new preserved
    expect(result.disabledDefaultBindingIds).toEqual(['global.session.new']);
  });

  test('returns identical prefs when command has no customizations', () => {
    const prefs = emptyPrefs();
    const result = resetCommandPrefs(prefs, 'settings.open', 'global', km);
    expect(result).toEqual(prefs);
  });

  test('does not mutate the original prefs', () => {
    const prefs: KeyboardShortcutPrefs = {
      customBindings: [{ commandId: 'settings.open', scope: 'global', keys: '$mod+P' }],
      disabledDefaultBindingIds: ['global.settings.open'],
    };
    const original = JSON.stringify(prefs);

    resetCommandPrefs(prefs, 'settings.open', 'global', km);

    expect(JSON.stringify(prefs)).toBe(original);
  });
});

describe('buildNewPrefsForBinding', () => {
  const km: DefaultKeyBinding[] = [
    makeBinding({ id: 'global.settings.open', commandId: 'settings.open', keys: '$mod+,' }),
  ];

  test('adds custom binding and disables the default', () => {
    const result = buildNewPrefsForBinding(emptyPrefs(), 'settings.open', 'global', '$mod+P', km);

    expect(result.customBindings).toHaveLength(1);
    expect(result.customBindings[0]).toMatchObject({
      commandId: 'settings.open',
      scope: 'global',
      keys: '$mod+P',
    });
    expect(result.disabledDefaultBindingIds).toContain('global.settings.open');
  });

  test('replaces an existing user binding for the same command+scope', () => {
    const existing: KeyboardShortcutPrefs = {
      customBindings: [{ commandId: 'settings.open', scope: 'global', keys: '$mod+P' }],
      disabledDefaultBindingIds: ['global.settings.open'],
    };

    const result = buildNewPrefsForBinding(existing, 'settings.open', 'global', '$mod+O', km);

    expect(result.customBindings).toHaveLength(1);
    expect(result.customBindings[0].keys).toBe('$mod+O');
  });
});

// ---------------------------------------------------------------------------
// 3. Non-reassignable row can't be edited
// ---------------------------------------------------------------------------

describe('buildRows — reassignable flag', () => {
  const km: DefaultKeyBinding[] = [
    makeBinding({
      id: 'global.settings.open',
      commandId: 'settings.open',
      keys: '$mod+,',
      reassignable: true,
    }),
    makeBinding({
      id: 'composer.submit',
      commandId: 'composer.submit.default',
      keys: 'Enter',
      scope: 'composer',
      reassignable: false,
    }),
  ];

  function buildTestRows(): ShortcutRow[] {
    return buildRows(km, [], emptyPrefs(), [], (id) => id);
  }

  test('reassignable row has reassignable: true', () => {
    const rows = buildTestRows();
    const row = rows.find((r) => r.commandId === 'settings.open');
    expect(row?.reassignable).toBe(true);
  });

  test('non-reassignable row has reassignable: false', () => {
    const rows = buildTestRows();
    const row = rows.find((r) => r.commandId === 'composer.submit.default');
    expect(row?.reassignable).toBe(false);
  });

  test('non-reassignable row does not appear as user-modifiable', () => {
    const rows = buildTestRows();
    const row = rows.find((r) => r.commandId === 'composer.submit.default');
    // Not user-modified by default
    expect(row?.isUserModified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Search filters rows
// ---------------------------------------------------------------------------

describe('filterRows — search', () => {
  function makeRow(overrides: Partial<ShortcutRow> & { commandId: string }): ShortcutRow {
    return {
      scope: 'global' as ShortcutScope,
      label: overrides.label ?? overrides.commandId,
      group: SCOPE_LABELS.global,
      reassignable: true,
      effectiveKeys: [],
      defaultKeys: [],
      isUserModified: false,
      conflicts: [],
      ...overrides,
    };
  }

  const rows: ShortcutRow[] = [
    makeRow({ commandId: 'settings.open', label: 'Open Settings', effectiveKeys: ['$mod+,'] }),
    makeRow({ commandId: 'session.new', label: 'New Session', effectiveKeys: ['$mod+N'] }),
    makeRow({
      commandId: 'terminal.new',
      label: 'New Terminal',
      scope: 'terminal' as ShortcutScope,
      group: SCOPE_LABELS.terminal,
      effectiveKeys: ['$mod+Shift+Backquote'],
    }),
  ];

  test('empty query returns all rows', () => {
    expect(filterRows(rows, '')).toHaveLength(3);
    expect(filterRows(rows, '  ')).toHaveLength(3);
  });

  test('filters by label (case-insensitive)', () => {
    const result = filterRows(rows, 'settings');
    expect(result).toHaveLength(1);
    expect(result[0].commandId).toBe('settings.open');
  });

  test('filters by commandId', () => {
    const result = filterRows(rows, 'session.new');
    expect(result).toHaveLength(1);
    expect(result[0].commandId).toBe('session.new');
  });

  test('filters by scope/group', () => {
    const result = filterRows(rows, 'terminal');
    // Matches label "New Terminal" and scope "terminal"
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((r) => r.commandId === 'terminal.new')).toBe(true);
  });

  test('filters by key chord', () => {
    const result = filterRows(rows, '$mod+N');
    expect(result).toHaveLength(1);
    expect(result[0].commandId).toBe('session.new');
  });

  test('returns empty array when nothing matches', () => {
    expect(filterRows(rows, 'zzz-no-match')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. SCOPE_LABELS coverage
// ---------------------------------------------------------------------------

describe('SCOPE_LABELS', () => {
  test('every ShortcutScope has a display label', () => {
    const scopes: ShortcutScope[] = [
      'global',
      'commandPalette',
      'composer',
      'composerTypeahead',
      'composerCommandTerminal',
      'terminal',
      'filePicker',
      'messageEditor',
      'pendingRequest',
      'accessibility',
      'dockviewTabRename',
    ];
    for (const scope of scopes) {
      expect(SCOPE_LABELS[scope]).toBeTruthy();
    }
  });
});
