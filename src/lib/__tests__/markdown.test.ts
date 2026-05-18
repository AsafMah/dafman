import { describe, expect, test } from "bun:test";
import { fenced } from "../markdown";

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
