// Lexical editor theme.
//
// Lexical applies these class names to its DOM during reconciliation. We
// keep them in a separate file so they're reusable across the composer
// (editable) and message display (read-only) editors, and so the styles
// live in a single global stylesheet — Vue scoped styles do not apply to
// the DOM Lexical creates dynamically (no scope-id attribute).

import type { EditorThemeClasses } from 'lexical';

export const lexicalTheme: EditorThemeClasses = {
  paragraph: 'lex-paragraph',
  quote: 'lex-quote',
  heading: {
    h1: 'lex-h1',
    h2: 'lex-h2',
    h3: 'lex-h3',
    h4: 'lex-h4',
    h5: 'lex-h5',
    h6: 'lex-h6',
  },
  list: {
    ol: 'lex-ol',
    ul: 'lex-ul',
    listitem: 'lex-li',
    nested: { listitem: 'lex-li-nested' },
  },
  link: 'lex-link',
  text: {
    bold: 'lex-text-bold',
    italic: 'lex-text-italic',
    underline: 'lex-text-underline',
    strikethrough: 'lex-text-strike',
    code: 'lex-text-code',
  },
  code: 'lex-code',
  /// Class names per prism token type. Matched against the
  /// `data-highlight-language` Lexical assigns the parent code block.
  /// We map every token type to a single CSS class so the styling
  /// lives in one place (`lexical.css`).
  codeHighlight: {
    atrule: 'lex-token-atrule',
    attr: 'lex-token-attr',
    boolean: 'lex-token-boolean',
    builtin: 'lex-token-builtin',
    cdata: 'lex-token-comment',
    char: 'lex-token-string',
    class: 'lex-token-class',
    'class-name': 'lex-token-class',
    comment: 'lex-token-comment',
    constant: 'lex-token-constant',
    deleted: 'lex-token-deleted',
    doctype: 'lex-token-comment',
    entity: 'lex-token-entity',
    function: 'lex-token-function',
    important: 'lex-token-important',
    inserted: 'lex-token-inserted',
    keyword: 'lex-token-keyword',
    namespace: 'lex-token-namespace',
    number: 'lex-token-number',
    operator: 'lex-token-operator',
    prolog: 'lex-token-comment',
    property: 'lex-token-property',
    punctuation: 'lex-token-punctuation',
    regex: 'lex-token-regex',
    selector: 'lex-token-selector',
    string: 'lex-token-string',
    symbol: 'lex-token-symbol',
    tag: 'lex-token-tag',
    url: 'lex-token-url',
    variable: 'lex-token-variable',
  },
};
