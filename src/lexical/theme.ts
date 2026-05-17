// Lexical editor theme.
//
// Lexical applies these class names to its DOM during reconciliation. We
// keep them in a separate file so they're reusable across the composer
// (editable) and message display (read-only) editors, and so the styles
// live in a single global stylesheet — Vue scoped styles do not apply to
// the DOM Lexical creates dynamically (no scope-id attribute).

import type { EditorThemeClasses } from "lexical";

export const lexicalTheme: EditorThemeClasses = {
  paragraph: "lex-paragraph",
  quote: "lex-quote",
  heading: {
    h1: "lex-h1",
    h2: "lex-h2",
    h3: "lex-h3",
    h4: "lex-h4",
    h5: "lex-h5",
    h6: "lex-h6",
  },
  list: {
    ol: "lex-ol",
    ul: "lex-ul",
    listitem: "lex-li",
    nested: { listitem: "lex-li-nested" },
  },
  link: "lex-link",
  text: {
    bold: "lex-text-bold",
    italic: "lex-text-italic",
    underline: "lex-text-underline",
    strikethrough: "lex-text-strike",
    code: "lex-text-code",
  },
  code: "lex-code",
  codeHighlight: {},
};
