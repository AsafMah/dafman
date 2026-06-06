// Unit tests for the fixed composer Enter keybinding scheme.
//
// Two layers:
//   1. `resolveEnterAction` — the pure decision matrix, tested directly
//      with plain chord literals (no editor needed).
//   2. `registerSubmitOnEnter` — the real Lexical command registration,
//      driven by dispatching `KEY_ENTER_COMMAND` against a live editor so
//      the consume / insert-paragraph / insert-line-break / defer
//      behaviour is exercised end-to-end (including the menu-active defer
//      via the per-editor `composerMenuState` registry).
//
// Scheme under test:
//   Enter              -> submit 'default'   (defer to an open menu)
//   Shift+Enter        -> soft line break    (consume only when menu open)
//   Ctrl/Cmd+Enter     -> hard newline (paragraph)
//   Ctrl+Shift+Enter   -> submit 'queue'
//   Alt+Enter          -> submit 'steer'
//   Ctrl+Alt+Enter     -> submit 'interrupt'

import { afterEach, describe, expect, test } from 'bun:test';
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  resolveEnterAction,
  registerSubmitOnEnter,
  type ComposerSubmitPayload,
  type EnterChord,
} from '@/lexical/plugins';
import { setComposerMenuActive } from '@/lexical/composerMenuState';

function chord(overrides: Partial<EnterChord> = {}): EnterChord {
  return { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides };
}

describe('resolveEnterAction', () => {
  test('plain Enter submits default when no menu is active', () => {
    expect(resolveEnterAction(chord(), false)).toEqual({ type: 'submit', mode: 'default' });
  });

  test('plain Enter defers (passthrough) when a menu is active', () => {
    expect(resolveEnterAction(chord(), true)).toEqual({ type: 'passthrough' });
  });

  test('Ctrl+Enter inserts a paragraph (hard newline), never submits', () => {
    expect(resolveEnterAction(chord({ ctrlKey: true }), false)).toEqual({
      type: 'insertParagraph',
    });
  });

  test('Cmd+Enter (metaKey) inserts a paragraph, even with a menu open', () => {
    expect(resolveEnterAction(chord({ metaKey: true }), true)).toEqual({ type: 'insertParagraph' });
  });

  test('Shift+Enter passes through to Lexical when no menu is active', () => {
    expect(resolveEnterAction(chord({ shiftKey: true }), false)).toEqual({ type: 'passthrough' });
  });

  test('Shift+Enter inserts a soft line break when a menu is active', () => {
    expect(resolveEnterAction(chord({ shiftKey: true }), true)).toEqual({
      type: 'insertLineBreak',
    });
  });

  test('Ctrl+Shift+Enter submits queue', () => {
    expect(resolveEnterAction(chord({ ctrlKey: true, shiftKey: true }), false)).toEqual({
      type: 'submit',
      mode: 'queue',
    });
  });

  test('Alt+Enter submits steer', () => {
    expect(resolveEnterAction(chord({ altKey: true }), false)).toEqual({
      type: 'submit',
      mode: 'steer',
    });
  });

  test('Ctrl+Alt+Enter submits interrupt', () => {
    expect(resolveEnterAction(chord({ ctrlKey: true, altKey: true }), false)).toEqual({
      type: 'submit',
      mode: 'interrupt',
    });
  });

  test('explicit submit chords ignore an open menu', () => {
    expect(resolveEnterAction(chord({ altKey: true }), true)).toEqual({
      type: 'submit',
      mode: 'steer',
    });
    expect(resolveEnterAction(chord({ ctrlKey: true, shiftKey: true }), true)).toEqual({
      type: 'submit',
      mode: 'queue',
    });
    expect(resolveEnterAction(chord({ ctrlKey: true, altKey: true }), true)).toEqual({
      type: 'submit',
      mode: 'interrupt',
    });
  });

  test('unrecognized combos (Ctrl+Shift+Alt) pass through', () => {
    expect(
      resolveEnterAction(chord({ ctrlKey: true, shiftKey: true, altKey: true }), false),
    ).toEqual({ type: 'passthrough' });
  });
});

interface EnterEventInit extends Partial<EnterChord> {
  isComposing?: boolean;
  key?: string;
}

function makeEnterEvent(init: EnterEventInit = {}): KeyboardEvent {
  let prevented = false;

  return {
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    isComposing: init.isComposing ?? false,
    key: init.key ?? 'Enter',
    preventDefault() {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as KeyboardEvent;
}

function makeEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'SubmitOnEnterTest',
    onError: (e) => {
      throw e;
    },
  });

  editor.setEditable(true);

  return editor;
}

function seedText(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const root = $getRoot();

      root.clear();
      const p = $createParagraphNode();

      p.append($createTextNode(text));
      root.append(p);
    },
    { discrete: true },
  );
}

describe('registerSubmitOnEnter', () => {
  let editor: LexicalEditor;
  let unregister: (() => void) | null = null;
  let submissions: ComposerSubmitPayload[];

  function register(): void {
    submissions = [];
    unregister = registerSubmitOnEnter(editor, (payload) => submissions.push(payload));
  }

  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  test('plain Enter submits the trimmed text at mode default', () => {
    editor = makeEditor();
    register();
    seedText(editor, 'hello world');

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent());

    expect(handled).toBe(true);
    expect(submissions).toEqual([{ text: 'hello world', mode: 'default' }]);
  });

  test('Ctrl+Enter inserts a paragraph and does NOT submit', () => {
    editor = makeEditor();
    register();
    seedText(editor, 'keep typing');

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent({ ctrlKey: true }));

    expect(handled).toBe(true);
    expect(submissions).toHaveLength(0);
    // Text is preserved (not consumed/cleared).
    const text = editor.getEditorState().read(() => $getRoot().getTextContent());
    expect(text).toContain('keep typing');
  });

  test('Alt+Enter submits steer; Ctrl+Shift+Enter submits queue; Ctrl+Alt+Enter submits interrupt', () => {
    editor = makeEditor();
    register();

    seedText(editor, 'one');
    expect(editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent({ altKey: true }))).toBe(true);

    seedText(editor, 'two');
    expect(
      editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent({ ctrlKey: true, shiftKey: true })),
    ).toBe(true);

    seedText(editor, 'three');
    expect(
      editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent({ ctrlKey: true, altKey: true })),
    ).toBe(true);

    expect(submissions).toEqual([
      { text: 'one', mode: 'steer' },
      { text: 'two', mode: 'queue' },
      { text: 'three', mode: 'interrupt' },
    ]);
  });

  test('plain Enter defers (does not submit) while a menu is active', () => {
    editor = makeEditor();
    register();
    seedText(editor, '/model');
    setComposerMenuActive(editor, 'slash', true);

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent());

    expect(handled).toBe(false);
    expect(submissions).toHaveLength(0);

    setComposerMenuActive(editor, 'slash', false);
  });

  test('Shift+Enter consumes (soft break) while a menu is active so it does not select', () => {
    editor = makeEditor();
    register();
    seedText(editor, '@file');
    setComposerMenuActive(editor, 'mention', true);

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent({ shiftKey: true }));

    expect(handled).toBe(true);
    expect(submissions).toHaveLength(0);

    setComposerMenuActive(editor, 'mention', false);
  });

  test('Shift+Enter passes through to Lexical when no menu is active', () => {
    editor = makeEditor();
    register();
    seedText(editor, 'line');

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent({ shiftKey: true }));

    expect(handled).toBe(false);
    expect(submissions).toHaveLength(0);
  });

  test('Ctrl+Enter still inserts (consumes) even while a menu is active', () => {
    editor = makeEditor();
    register();
    seedText(editor, '@file');
    setComposerMenuActive(editor, 'mention', true);

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent({ ctrlKey: true }));

    expect(handled).toBe(true);
    expect(submissions).toHaveLength(0);

    setComposerMenuActive(editor, 'mention', false);
  });

  test('empty composer + plain Enter is a no-op (consumed, no submit)', () => {
    editor = makeEditor();
    register();
    seedText(editor, '   ');

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent());

    expect(handled).toBe(true);
    expect(submissions).toHaveLength(0);
  });

  test('IME composition Enter is never consumed', () => {
    editor = makeEditor();
    register();
    seedText(editor, 'こんにち');

    const handled = editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      makeEnterEvent({ isComposing: true }),
    );

    expect(handled).toBe(false);
    expect(submissions).toHaveLength(0);
  });

  test('#178 — Enter on empty-after-delete composer is a no-op even with stale menu-active state', () => {
    // Scenario: user typed "/model", slash menu opened (menuActive=true),
    // then deleted ALL text without the TypeaheadMenuPlugin firing
    // queryChange(null) (e.g. via select-all+delete path that emits
    // 'close' instead). The editor is empty but isComposerMenuActive
    // still returns true. Without the empty-guard, plain Enter falls
    // through to Lexical's default handler and inserts a stray newline.
    editor = makeEditor();
    register();
    // Editor is empty (simulates post-delete-all state).
    seedText(editor, '');
    // Simulate stale menu-active registry.
    setComposerMenuActive(editor, 'slash', true);

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent());

    // Should be consumed (no passthrough to default handler).
    expect(handled).toBe(true);
    // Should NOT submit (nothing to send).
    expect(submissions).toHaveLength(0);

    // Clean up menu state so it doesn't leak into other tests.
    setComposerMenuActive(editor, 'slash', false);
  });

  test('#178 — whitespace-only composer with stale menu state is also a no-op', () => {
    editor = makeEditor();
    register();
    seedText(editor, '   ');
    setComposerMenuActive(editor, 'mention', true);

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent());

    expect(handled).toBe(true);
    expect(submissions).toHaveLength(0);

    setComposerMenuActive(editor, 'mention', false);
  });

  test('#178 — Ctrl+Enter on empty composer is also a no-op (no paragraph inserted)', () => {
    editor = makeEditor();
    register();
    seedText(editor, '');
    setComposerMenuActive(editor, 'slash', true);

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, makeEnterEvent({ ctrlKey: true }));

    expect(handled).toBe(true);
    expect(submissions).toHaveLength(0);

    setComposerMenuActive(editor, 'slash', false);
  });
});
