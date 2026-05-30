# Instructions theme fixture

Throwaway fixture for MANUAL_TESTS 19.1 / 19.2 (instruction markdown + raw HTML
theme inversion). Open a session whose working directory is this folder, then
Library → Instructions → expand `.github/copilot-instructions.md` and toggle the
app theme.

## Markdown surfaces (19.1)

A paragraph with a **bold** word, an _italic_ word, an inline `code span`, and a
[markdown link](https://example.com).

- first list item
- second list item with a `nested code span`
- third item

> A blockquote line — should invert with the theme, stay legible in both.

```ts
// fenced code block — should follow the editor theme, not stay stuck dark
const greeting: string = "hello";
console.log(greeting.toUpperCase());
```

| Column A | Column B |
| -------- | -------- |
| cell 1   | cell 2   |
| cell 3   | cell 4   |

## Raw HTML surfaces (19.2)

Here is a literal raw <code>inline code element</code> and a raw
<a href="https://example.com">anchor element</a> written as HTML, not markdown.

<pre>raw pre block
  preserves    whitespace</pre>

<blockquote>raw blockquote element — should match the markdown blockquote color.</blockquote>
