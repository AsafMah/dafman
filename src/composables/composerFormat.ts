// Composer formatting helpers — pure functions + the format-action
// data table, extracted from MessageComposer.vue (Phase D.4.1).
//
// Centralizes the Lexical formatting wire so MessageComposer's setup
// shrinks and the toolbar / overflow popover can render the same
// action list without duplicating the data.

import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import { $createCodeNode, $isCodeNode } from '@lexical/code';
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';

export type EditorFormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'code'
  | 'bullet'
  | 'number'
  | 'h1'
  | 'h2'
  | 'quote'
  | 'codeblock';

export const TEXT_FORMAT_ACTIONS = new Set<EditorFormatAction>([
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'code',
]);

export interface EditorFormatActionDescriptor {
  label: string;
  title: string;
  action: EditorFormatAction;
  icon?: string;
  glyph?: string;
  inline?: boolean;
  priority: 1 | 2 | 3 | 4;
}

export const editorFormatActions: ReadonlyArray<EditorFormatActionDescriptor> = [
  { label: 'Bold', glyph: 'B', title: 'Bold', action: 'bold', inline: true, priority: 1 },
  { label: 'Italic', glyph: 'I', title: 'Italic', action: 'italic', inline: true, priority: 1 },
  {
    label: 'Code',
    icon: 'pi pi-code',
    title: 'Inline code',
    action: 'code',
    inline: true,
    priority: 1,
  },
  {
    label: 'Bullet list',
    icon: 'pi pi-list',
    title: 'Bullet list',
    action: 'bullet',
    inline: true,
    priority: 1,
  },
  { label: 'Underline', glyph: 'U', title: 'Underline', action: 'underline', priority: 2 },
  {
    label: 'Numbered list',
    icon: 'pi pi-list-check',
    title: 'Numbered list',
    action: 'number',
    priority: 2,
  },
  {
    label: 'Strikethrough',
    glyph: 'S',
    title: 'Strikethrough',
    action: 'strikethrough',
    priority: 3,
  },
  { label: 'Heading 1', glyph: 'H1', title: 'Heading 1', action: 'h1', priority: 3 },
  { label: 'Heading 2', glyph: 'H2', title: 'Heading 2', action: 'h2', priority: 3 },
  { label: 'Quote', glyph: '❝', title: 'Quote block', action: 'quote', priority: 4 },
  { label: 'Code block', glyph: '{ }', title: 'Code block', action: 'codeblock', priority: 4 },
] as const;

export type EditorFormatState = Record<EditorFormatAction, boolean>;

export const INITIAL_FORMAT_STATE: EditorFormatState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  bullet: false,
  number: false,
  h1: false,
  h2: false,
  quote: false,
  codeblock: false,
};

/// Apply a format action to the live editor. Text-level actions
/// dispatch FORMAT_TEXT_COMMAND; list actions dispatch their
/// INSERT_*_LIST_COMMAND; block actions use $setBlocksType inside an
/// `editor.update`. After applying, returns focus to the editor.
export function applyEditorFormat(editor: LexicalEditor, action: EditorFormatAction): void {
  if (TEXT_FORMAT_ACTIONS.has(action)) {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, action as TextFormatType);
  } else if (action === 'bullet') {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  } else if (action === 'number') {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  } else {
    editor.update(() => {
      const selection = $getSelection();

      if (!$isRangeSelection(selection)) return;

      if (action === 'h1') {
        $setBlocksType(selection, () => $createHeadingNode('h1'));
      } else if (action === 'h2') {
        $setBlocksType(selection, () => $createHeadingNode('h2'));
      } else if (action === 'quote') {
        $setBlocksType(selection, () => $createQuoteNode());
      } else if (action === 'codeblock') {
        $setBlocksType(selection, () => $createCodeNode());
      }
    });
  }

  editor.focus();
}

/// Inspect the current selection and derive the active-format flags
/// for every action. MUST be called from inside an `editor.read` /
/// `editor.update` callback so `$getSelection()` returns the live
/// selection. Block-level detection walks up from the anchor node
/// — stops at the first list/heading/quote/code ancestor.
export function computeFormatState(): EditorFormatState {
  const selection = $getSelection();
  let inBulletList = false;
  let inNumberList = false;
  let inHeading1 = false;
  let inHeading2 = false;
  let inQuote = false;
  let inCodeBlock = false;

  if ($isRangeSelection(selection)) {
    let node = selection.anchor.getNode();

    while (node) {
      if ($isListNode(node)) {
        inBulletList = node.getListType() === 'bullet';
        inNumberList = node.getListType() === 'number';
        break;
      }

      if ($isHeadingNode(node)) {
        inHeading1 = node.getTag() === 'h1';
        inHeading2 = node.getTag() === 'h2';
      } else if ($isQuoteNode(node)) {
        inQuote = true;
      } else if ($isCodeNode(node)) {
        inCodeBlock = true;
      }

      const parent = node.getParent();

      if (!parent) break;

      node = parent;
    }
  }

  const rangeSel = $isRangeSelection(selection) ? selection : null;

  return {
    bold: rangeSel ? rangeSel.hasFormat('bold') : false,
    italic: rangeSel ? rangeSel.hasFormat('italic') : false,
    underline: rangeSel ? rangeSel.hasFormat('underline') : false,
    strikethrough: rangeSel ? rangeSel.hasFormat('strikethrough') : false,
    code: rangeSel ? rangeSel.hasFormat('code') : false,
    bullet: inBulletList,
    number: inNumberList,
    h1: inHeading1,
    h2: inHeading2,
    quote: inQuote,
    codeblock: inCodeBlock,
  };
}
