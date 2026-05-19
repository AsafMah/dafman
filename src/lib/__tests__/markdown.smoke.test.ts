import { describe, expect, test } from "bun:test";

// Simulates a fresh browser load: import the renderMarkdown chain
// from scratch. Any module-evaluation throw inside `markdown.ts`,
// `prismExtraLanguages`, or the plugin chain surfaces here as a
// test runner failure on the dynamic import itself.

describe("markdown module-load smoke", () => {
  test("renderMarkdown chain loads without throwing on a fresh import", async () => {
    const mod = await import("../markdown");
    expect(typeof mod.renderMarkdown).toBe("function");
    // Light render to exercise every plugin's transformer path so a
    // plugin that throws on first invocation (rather than at module
    // load) also surfaces here.
    const html = mod.renderMarkdown(
      [
        "# H1",
        "",
        "Para with **bold**, _italic_, ~~strike~~, `code`.",
        "",
        "- [ ] task",
        "- [x] done",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "Term",
        ": Definition",
        "",
        "$E=mc^2$ and footnote[^1].",
        "",
        "[^1]: note",
        "",
        "<details><summary>more</summary>x</details>",
        "",
        ":smile:",
        "",
        "```python",
        "def x(): pass",
        "```",
      ].join("\n"),
    );
    expect(html).toContain("<h1");
    expect(html).toContain("katex"); // math rendered
    expect(html).toContain("footnote-ref");
    expect(html).toContain("😄");
    expect(html).toContain("<dl>");
    expect(html).toContain("<details>");
    expect(html).toContain("language-python"); // python prism registered
  });
});
