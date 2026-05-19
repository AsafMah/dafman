import { describe, expect, test } from "bun:test";
import { fenced, renderMarkdown } from "../markdown";

describe("renderMarkdown", () => {
  test("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  test("renders headings with lex-h* classes", () => {
    const html = renderMarkdown("# Title\n\n## Sub");
    expect(html).toContain('<h1 class="lex-h1">Title</h1>');
    expect(html).toContain('<h2 class="lex-h2">Sub</h2>');
  });

  test("renders paragraphs and emphasis", () => {
    const html = renderMarkdown("a **b** _c_ ~~d~~");
    expect(html).toContain('<p class="lex-paragraph">');
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>c</em>");
    expect(html).toContain('<s class="lex-text-strike">d</s>');
  });

  test("renders blockquotes and unordered lists", () => {
    const html = renderMarkdown("> hello\n\n- one\n- two");
    expect(html).toContain('<blockquote class="lex-quote">');
    expect(html).toContain('<ul class="lex-ul">');
    expect(html).toContain('<li class="lex-li">one</li>');
  });

  test("renders ordered lists", () => {
    const html = renderMarkdown("1. a\n2. b");
    expect(html).toContain('<ol class="lex-ol">');
  });

  test("renders inline code and fenced code blocks", () => {
    const html = renderMarkdown("see `foo`\n\n```bash\necho hi\n```");
    expect(html).toContain('<code class="lex-text-code">foo</code>');
    expect(html).toContain('class="lex-code"');
    expect(html).toContain('data-highlight-language="bash"');
    expect(html).toContain('class="language-bash"');
  });

  test("falls back to escaped plain code for unknown languages", () => {
    const html = renderMarkdown("```unknownlang\n<script>alert(1)</script>\n```");
    expect(html).toContain('class="lex-code"');
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("renders GFM tables", () => {
    const html = renderMarkdown(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
    );
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  test("renders GFM task lists with disabled checkboxes", () => {
    const html = renderMarkdown("- [ ] open\n- [x] done");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('task-list-item');
    // Plugin opt `enabled: false` strips the `enabled` class and keeps
    // the checkbox non-interactive (the disabled attr isn't emitted in
    // this configuration — interactivity is suppressed via the
    // task-list-item-checkbox CSS class + lack of `enabled` class).
    expect(html).not.toContain('class="task-list-item enabled');
    // Checked item produces a `checked` attribute.
    expect(html).toContain("checked");
  });

  test("links get target=_blank rel=noopener and lex-link class", () => {
    const html = renderMarkdown("[gh](https://github.com)");
    expect(html).toContain('class="lex-link"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://github.com"');
  });

  test("bare URLs are autolinked via linkify", () => {
    const html = renderMarkdown("visit https://example.com today");
    expect(html).toContain('href="https://example.com"');
  });

  test("horizontal rules render as <hr>", () => {
    expect(renderMarkdown("a\n\n---\n\nb")).toContain("<hr>");
  });

  test("images render with src+alt and pass through DOMPurify", () => {
    const html = renderMarkdown("![cat](https://example.com/c.png)");
    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/c.png"');
    expect(html).toContain('alt="cat"');
  });

  test("raw HTML is escaped to text (html: false)", () => {
    const html = renderMarkdown(
      "before\n\n<script>alert(1)</script>\n\nafter",
    );
    // markdown-it with html:false escapes the tags so they render as
    // visible text; nothing executable survives. DOMPurify is the
    // second line of defence if a future renderer rule emits raw HTML.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  test("javascript: links are stripped (markdown-it validateLink + DOMPurify)", () => {
    const html = renderMarkdown("[evil](javascript:alert(1))");
    // markdown-it's default validateLink rejects javascript: URLs so
    // no <a> tag is emitted at all — the source renders as literal
    // text. Defense in depth: DOMPurify would also strip the href.
    expect(html).not.toContain("<a ");
    expect(html.toLowerCase()).not.toMatch(/href="javascript:/);
  });
});

describe("fenced", () => {
  test("returns empty string for empty content (no fence emitted)", () => {
    expect(fenced("", "ts")).toBe("");
  });

  test("emits 3-backtick fence for plain content + trailing newline", () => {
    expect(fenced("hello", "ts")).toBe("```ts\nhello\n```");
  });

  test("preserves an existing trailing newline rather than doubling it", () => {
    expect(fenced("a\nb\n", "ts")).toBe("```ts\na\nb\n```");
  });

  test("uses a 4-backtick fence when content contains ``` ", () => {
    // Three-backtick fence inside a three-backtick fence would close
    // the outer block; outer must be strictly longer.
    const out = fenced("a\n```\ninner\n```\nb", "md");
    expect(out.startsWith("````md\n")).toBe(true);
    expect(out.endsWith("\n````")).toBe(true);
    expect(out).toContain("```\ninner\n```");
  });

  test("scales fence length to longest inner run + 1", () => {
    // Content with a 5-backtick run requires a 6-backtick fence.
    const out = fenced("before\n`````\nafter", "");
    expect(out.startsWith("``````\n")).toBe(true);
    expect(out.endsWith("\n``````")).toBe(true);
  });

  test("inline code (single backticks) still uses the minimum 3-backtick fence", () => {
    const out = fenced("use `foo` here", "md");
    expect(out).toBe("```md\nuse `foo` here\n```");
  });
});
