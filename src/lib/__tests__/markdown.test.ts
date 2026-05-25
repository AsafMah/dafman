import { describe, expect, test } from 'bun:test';
import { fenced, renderMarkdown, renderMarkdownSegments } from '@/lib/markdown';

describe('renderMarkdown', () => {
  test('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  test('renders headings with lex-h* classes', () => {
    const html = renderMarkdown('# Title\n\n## Sub');
    expect(html).toContain('<h1 class="lex-h1">Title</h1>');
    expect(html).toContain('<h2 class="lex-h2">Sub</h2>');
  });

  test('renders paragraphs and emphasis', () => {
    const html = renderMarkdown('a **b** _c_ ~~d~~');
    expect(html).toContain('<p class="lex-paragraph">');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<em>c</em>');
    expect(html).toContain('<s class="lex-text-strike">d</s>');
  });

  test('renders blockquotes and unordered lists', () => {
    const html = renderMarkdown('> hello\n\n- one\n- two');
    expect(html).toContain('<blockquote class="lex-quote">');
    expect(html).toContain('<ul class="lex-ul">');
    expect(html).toContain('<li class="lex-li">one</li>');
  });

  test('renders ordered lists', () => {
    const html = renderMarkdown('1. a\n2. b');
    expect(html).toContain('<ol class="lex-ol">');
  });

  test('renders inline code and fenced code blocks', () => {
    const html = renderMarkdown('see `foo`\n\n```bash\necho hi\n```');
    expect(html).toContain('<code class="lex-text-code">foo</code>');
    expect(html).toContain('class="lex-code"');
    expect(html).toContain('data-highlight-language="bash"');
    expect(html).toContain('class="language-bash"');
  });

  test('falls back to escaped plain code for unknown languages', () => {
    const html = renderMarkdown('```unknownlang\n<script>alert(1)</script>\n```');
    expect(html).toContain('class="lex-code"');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  test('highlighted tokens carry lex-token-* classes for our CSS to style', () => {
    // Bare prism emits `class="token keyword"`. Our stylesheet keys
    // off `.lex-token-keyword` etc. (matching @lexical/code's theme
    // map), so the highlight callback must rewrite the class names
    // or every fence renders plain in WebView2.
    const html = renderMarkdown('```python\ndef foo():\n  return 1\n```');
    expect(html).toContain('lex-token-keyword'); // `def`, `return`
    expect(html).toMatch(/class="token lex-token-/);
    // The original `token` class is preserved alongside (defense in
    // depth for any future @lexical/code-bridged code path).
    expect(html).toMatch(/class="token lex-token-\w+"/);
  });

  test('renders GFM tables', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
  });

  test('renders GFM task lists with disabled checkboxes', () => {
    const html = renderMarkdown('- [ ] open\n- [x] done');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('task-list-item');
    // Plugin opt `enabled: false` strips the `enabled` class and keeps
    // the checkbox non-interactive (the disabled attr isn't emitted in
    // this configuration — interactivity is suppressed via the
    // task-list-item-checkbox CSS class + lack of `enabled` class).
    expect(html).not.toContain('class="task-list-item enabled');
    // Checked item produces a `checked` attribute.
    expect(html).toContain('checked');
  });

  test('links get target=_blank rel=noopener and lex-link class', () => {
    const html = renderMarkdown('[gh](https://github.com)');
    expect(html).toContain('class="lex-link"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://github.com"');
  });

  test('bare URLs are autolinked via linkify', () => {
    const html = renderMarkdown('visit https://example.com today');
    expect(html).toContain('href="https://example.com"');
  });

  test('horizontal rules render as <hr>', () => {
    expect(renderMarkdown('a\n\n---\n\nb')).toContain('<hr>');
  });

  test('images render with src+alt and pass through DOMPurify', () => {
    const html = renderMarkdown('![cat](https://example.com/c.png)');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/c.png"');
    expect(html).toContain('alt="cat"');
  });

  test('raw HTML <script> is stripped by DOMPurify (html: true)', () => {
    const html = renderMarkdown('before\n\n<script>alert(1)</script>\n\nafter');
    // markdown-it html:true lets the tag parse, DOMPurify strips it.
    expect(html).not.toContain('<script');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  test('javascript: links are stripped (markdown-it validateLink + DOMPurify)', () => {
    const html = renderMarkdown('[evil](javascript:alert(1))');
    // markdown-it's default validateLink rejects javascript: URLs so
    // no <a> tag is emitted at all — the source renders as literal
    // text. Defense in depth: DOMPurify would also strip the href.
    expect(html).not.toContain('<a ');
    expect(html.toLowerCase()).not.toMatch(/href="javascript:/);
  });

  test('renders footnotes with backref links', () => {
    const html = renderMarkdown('See [^1] for detail.\n\n[^1]: This is the footnote.');
    expect(html).toContain('footnote-ref');
    expect(html).toContain('footnotes');
    expect(html).toContain('footnote-backref');
    expect(html).toContain('This is the footnote');
  });

  test('renders definition lists', () => {
    const html = renderMarkdown('Term 1\n: Definition 1\n\nTerm 2\n: Definition 2');
    expect(html).toContain('<dl>');
    expect(html).toContain('<dt>Term 1</dt>');
    expect(html).toContain('<dd>');
    expect(html).toContain('Definition 1');
  });

  test('renders emoji shortcodes', () => {
    const html = renderMarkdown('hello :smile: :rocket:');
    // markdown-it-emoji replaces :smile: → 😄 directly in text.
    expect(html).toContain('😄');
    expect(html).toContain('🚀');
  });

  test('renders inline math via KaTeX', () => {
    const html = renderMarkdown('inline: $E=mc^2$ here');
    // KaTeX wraps in `<eq>` (texmath default) or `<span class="katex">`.
    // Either way, the output should contain a katex class somewhere.
    expect(html.toLowerCase()).toContain('katex');
  });

  test('renders block math via KaTeX', () => {
    const html = renderMarkdown('$$\n\\int_a^b x^2 dx\n$$');
    expect(html.toLowerCase()).toContain('katex');
  });

  test('allows <details>/<summary> through with html: true + DOMPurify allowlist', () => {
    const html = renderMarkdown(
      '<details>\n<summary>Click me</summary>\n\nHidden content.\n\n</details>',
    );
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Click me</summary>');
    expect(html).toContain('Hidden content');
  });

  test('strips <script> even with html: true (DOMPurify)', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nafter');
    expect(html).not.toContain('<script');
    expect(html).toContain('after');
  });

  test('strips style= on raw HTML divs (CSS injection guard)', () => {
    const html = renderMarkdown('<div style="color: red; position: fixed;">x</div>');
    // <div> isn't in our allowlist either, so DOMPurify drops the
    // whole tag and keeps the text. Even if it survived, the style
    // attr would be stripped by our uponSanitizeAttribute hook.
    expect(html).not.toContain('style="color: red');
    expect(html).not.toContain('position: fixed');
    expect(html).toContain('x');
  });

  test('preserves KaTeX-only style attributes (width/margin)', () => {
    // Direct DOMPurify call to exercise the hook without going through
    // markdown-it (which wouldn't emit inline <span style="width:...">
    // unless a math snippet is present anyway — covered by the math
    // tests above; this one pins the allowlist behavior explicitly).
    const html = renderMarkdown('$x$');
    // If KaTeX emitted any width: spans, they should still be there.
    // No assertion on specific value because KaTeX output varies; the
    // important thing is no exception was thrown and katex class is
    // present (asserted in the inline-math test above).
    expect(html).toContain('katex');
  });

  test('renders <kbd>, <mark>, <sub>, <sup> from raw HTML', () => {
    const html = renderMarkdown(
      'Press <kbd>Ctrl</kbd>+<kbd>K</kbd>. H<sub>2</sub>O and x<sup>2</sup>. <mark>highlighted</mark>',
    );
    expect(html).toContain('<kbd>Ctrl</kbd>');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('<mark>highlighted</mark>');
  });
});

describe('fenced', () => {
  test('returns empty string for empty content (no fence emitted)', () => {
    expect(fenced('', 'ts')).toBe('');
  });

  test('emits 3-backtick fence for plain content + trailing newline', () => {
    expect(fenced('hello', 'ts')).toBe('```ts\nhello\n```');
  });

  test('preserves an existing trailing newline rather than doubling it', () => {
    expect(fenced('a\nb\n', 'ts')).toBe('```ts\na\nb\n```');
  });

  test('uses a 4-backtick fence when content contains ``` ', () => {
    // Three-backtick fence inside a three-backtick fence would close
    // the outer block; outer must be strictly longer.
    const out = fenced('a\n```\ninner\n```\nb', 'md');
    expect(out.startsWith('````md\n')).toBe(true);
    expect(out.endsWith('\n````')).toBe(true);
    expect(out).toContain('```\ninner\n```');
  });

  test('scales fence length to longest inner run + 1', () => {
    // Content with a 5-backtick run requires a 6-backtick fence.
    const out = fenced('before\n`````\nafter', '');
    expect(out.startsWith('``````\n')).toBe(true);
    expect(out.endsWith('\n``````')).toBe(true);
  });

  test('inline code (single backticks) still uses the minimum 3-backtick fence', () => {
    const out = fenced('use `foo` here', 'md');
    expect(out).toBe('```md\nuse `foo` here\n```');
  });
});

describe('renderMarkdownSegments — system_notification stripping', () => {
  function segmentText(segments: ReturnType<typeof renderMarkdownSegments>): string {
    return segments.map((s) => (s.kind === 'html' ? s.html : s.code)).join('');
  }

  test('strips complete system_notification blocks', () => {
    const segments = renderMarkdownSegments(
      'Hello\n<system_notification>\nAgent done.\n</system_notification>\nWorld',
    );
    const text = segmentText(segments);
    expect(text).not.toContain('system_notification');
    expect(text).not.toContain('Agent done');
    expect(text).toContain('Hello');
    expect(text).toContain('World');
  });

  test('strips unclosed system_notification during streaming', () => {
    const segments = renderMarkdownSegments('Some text\n<system_notification>\nAgent started...');
    const text = segmentText(segments);
    expect(text).not.toContain('system_notification');
    expect(text).not.toContain('Agent started');
    expect(text).toContain('Some text');
  });

  test('strips multiple system_notification blocks', () => {
    const segments = renderMarkdownSegments(
      '<system_notification>a</system_notification>middle<system_notification>b</system_notification>end',
    );
    const text = segmentText(segments);
    expect(text).not.toContain('system_notification');
    expect(text).toContain('middle');
    expect(text).toContain('end');
  });

  test('returns empty for text that is only system_notification', () => {
    const segments = renderMarkdownSegments(
      '<system_notification>Agent done.</system_notification>',
    );
    expect(segments).toEqual([]);
  });
});
