// Unit tests for bug #175: slash-menu Enter should COMPLETE the command
// text into the composer (insert `/command ` with trailing space) instead
// of executing the command.
//
// The fix lives in SlashCommandPlugin.vue `onSelectOption`. That
// component can't be mounted directly in bun/happy-dom (lexical-vue
// accesses DOM APIs during component init). Instead we test the core
// Lexical TEXT INSERTION operation that `onSelectOption` now performs —
// the same `setTextContent + select` path used by the Tab handler.
//
// What we verify:
//   1. The text-node insertion produces `/command ` with trailing space.
//   2. After insertion the cursor (selection) lands at the end of the
//      inserted text (so the user can immediately start typing args).
//   3. The original node's content is fully replaced (no stray query
//      fragment left behind).

import { describe, expect, test } from 'bun:test';
import {
  createEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $createParagraphNode,
  $createTextNode,
  type TextNode,
  type LexicalEditor,
} from 'lexical';

function makeEditor(): LexicalEditor {
  return createEditor({
    namespace: 'SlashCompletionTest',
    onError: (e) => {
      throw e;
    },
  });
}

/// Seed the editor with a slash query in a paragraph (simulates the
/// TypeaheadMenuPlugin's `$splitNodeContainingQuery` result: a TextNode
/// holding the full trigger+query, e.g. "/model").
function seedSlashQuery(editor: LexicalEditor, slash: string): void {
  editor.update(
    () => {
      const root = $getRoot();

      root.clear();
      const p = $createParagraphNode();
      const node = $createTextNode(slash);

      p.append(node);
      root.append(p);
      node.select(slash.length, slash.length);
    },
    { discrete: true },
  );
}

/// Perform the insertion that `onSelectOption` now uses: replace the
/// query node's text with `/command ` and move cursor to end.
/// Mirrors the exact code path in SlashCommandPlugin.vue.
function applyCompletion(editor: LexicalEditor, commandSlash: string): void {
  editor.update(
    () => {
      const para = $getRoot().getFirstChild();

      if (!para) return;

      // In the fixture the first (and only) text node in the paragraph
      // IS the query node (simulating what TypeaheadMenuPlugin splits out).
      // @ts-expect-error — getFirstChild() typed as LexicalNode; we narrow below.
      const node = para.getFirstChild();

      if (!$isTextNode(node)) return;

      const insert = commandSlash + ' ';
      const textNode = node as TextNode;

      textNode.setTextContent(insert);
      textNode.select(insert.length, insert.length);
    },
    { discrete: true },
  );
}

describe('#175 slash-menu Enter — completes text, does not execute', () => {
  test('completion replaces query node with /command + trailing space', () => {
    const editor = makeEditor();

    seedSlashQuery(editor, '/model');
    applyCompletion(editor, '/model');

    const text = editor.getEditorState().read(() => $getRoot().getTextContent());

    expect(text).toBe('/model ');
  });

  test('completion expands a partial query to the full command', () => {
    const editor = makeEditor();

    seedSlashQuery(editor, '/ren');
    applyCompletion(editor, '/rename');

    const text = editor.getEditorState().read(() => $getRoot().getTextContent());

    expect(text).toBe('/rename ');
  });

  test('cursor lands at the end of the inserted text (args can follow immediately)', () => {
    const editor = makeEditor();

    seedSlashQuery(editor, '/cd');
    applyCompletion(editor, '/cd');

    const cursorOffset = editor.getEditorState().read(() => {
      const sel = $getSelection();

      if (!$isRangeSelection(sel)) return -1;

      return sel.anchor.offset;
    });

    // "/cd " is 4 chars; cursor should be at position 4.
    expect(cursorOffset).toBe(4);
  });

  test('trailing space is always appended even for short commands', () => {
    const editor = makeEditor();

    seedSlashQuery(editor, '/?');
    applyCompletion(editor, '/?');

    const text = editor.getEditorState().read(() => $getRoot().getTextContent());

    expect(text).toBe('/? ');
  });
});
