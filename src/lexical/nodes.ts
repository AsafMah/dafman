// Lexical node bundle for markdown-capable editors.
//
// Required because `@lexical/markdown`'s built-in transformers reference
// these node classes; if they aren't registered with the editor on
// creation, `$convertFromMarkdownString` will silently drop those nodes.
// We register the same set on both the composer (so markdown shortcuts
// can promote a paragraph to a heading/list/etc. as the user types) and
// the read-only display (so streamed assistant markdown renders).

import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { Klass, LexicalNode } from 'lexical';
import { HorizontalRuleNode } from 'lexical-vue/LexicalHorizontalRuleNode';
import { AttachmentNode } from './AttachmentNode';

export const markdownNodes: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  HorizontalRuleNode,
  AttachmentNode,
];
