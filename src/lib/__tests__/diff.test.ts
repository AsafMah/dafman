import { describe, expect, test } from "bun:test";
import { lineDiff, parseApplyPatch } from "../diff";

describe("lineDiff", () => {
  test("identical text → all equal rows", () => {
    const rows = lineDiff("a\nb\nc", "a\nb\nc");
    expect(rows.every((r) => r.kind === "equal")).toBe(true);
    expect(rows.length).toBe(3);
  });

  test("one-line replacement → removed + added", () => {
    const rows = lineDiff("a\nb\nc", "a\nB\nc");
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
    const removed = rows.find((r) => r.kind === "removed");
    const added = rows.find((r) => r.kind === "added");
    expect(removed?.text).toBe("b");
    expect(added?.text).toBe("B");
  });

  test("addition at end → only added rows tail", () => {
    const rows = lineDiff("a\nb", "a\nb\nc");
    const tail = rows[rows.length - 1]!;
    expect(tail.kind).toBe("added");
    expect(tail.text).toBe("c");
  });

  test("removal at start → only removed rows head", () => {
    const rows = lineDiff("a\nb\nc", "b\nc");
    const head = rows[0]!;
    expect(head.kind).toBe("removed");
    expect(head.text).toBe("a");
  });

  test("preserves line numbers on kept lines", () => {
    const rows = lineDiff("a\nb\nc", "a\nB\nc");
    const equalA = rows.find((r) => r.kind === "equal" && r.text === "a");
    const equalC = rows.find((r) => r.kind === "equal" && r.text === "c");
    expect(equalA?.oldLine).toBe(1);
    expect(equalA?.newLine).toBe(1);
    expect(equalC?.oldLine).toBe(3);
    expect(equalC?.newLine).toBe(3);
  });
});

describe("parseApplyPatch", () => {
  test("parses an Update File hunk", () => {
    const patch =
      "*** Begin Patch\n" +
      "*** Update File: src/App.vue\n" +
      "@@\n" +
      "-const isDark = false;\n" +
      "+const isDark = true;\n" +
      "*** End Patch\n";
    const files = parseApplyPatch(patch);
    expect(files.length).toBe(1);
    expect(files[0]!.op).toBe("update");
    expect(files[0]!.path).toBe("src/App.vue");
    expect(files[0]!.hunks.length).toBe(1);
    const lines = files[0]!.hunks[0]!.lines;
    expect(lines[0]).toEqual({ kind: "removed", text: "const isDark = false;" });
    expect(lines[1]).toEqual({ kind: "added", text: "const isDark = true;" });
  });

  test("parses multiple files with different ops", () => {
    const patch =
      "*** Begin Patch\n" +
      "*** Add File: new.txt\n" +
      "+hello\n" +
      "*** Update File: a.txt\n" +
      "@@\n" +
      " context\n" +
      "-old\n" +
      "+new\n" +
      "*** Delete File: gone.txt\n" +
      "*** End Patch\n";
    const files = parseApplyPatch(patch);
    expect(files.map((f) => f.op)).toEqual(["add", "update", "delete"]);
    expect(files.map((f) => f.path)).toEqual(["new.txt", "a.txt", "gone.txt"]);
    expect(files[1]!.hunks[0]!.lines[0]).toEqual({
      kind: "context",
      text: "context",
    });
  });

  test("tolerates a missing trailing End Patch", () => {
    const patch =
      "*** Begin Patch\n" +
      "*** Update File: x.ts\n" +
      "@@\n" +
      "+added\n";
    const files = parseApplyPatch(patch);
    expect(files.length).toBe(1);
    expect(files[0]!.hunks[0]!.lines[0]).toEqual({
      kind: "added",
      text: "added",
    });
  });
});
