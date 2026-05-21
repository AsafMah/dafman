// Conversation export — formatter tests.
//
// Pins the Markdown + JSON output shapes against a synthetic ChatItem
// stream so future reducer / renderer changes can't silently break
// the export wire. Markdown is asserted via substring/regex (the full
// text isn't worth snapshotting line-by-line); JSON gets a full
// snapshot.

import { describe, expect, test } from "bun:test";
import { exportFilenameStem, formatConversation } from "../exportConversation";
import type { ChatItem } from "../chatEvents";

const FIXED_NOW = "2026-05-22T00:00:00.000Z";

function input(items: ChatItem[]) {
  return {
    title: "Refactor playground",
    workingDirectory: "C:\\repo\\dafman",
    model: "gpt-5.5",
    exportedAt: FIXED_NOW,
    items,
  };
}

describe("formatConversation — markdown", () => {
  test("includes title + metadata header", () => {
    const md = formatConversation(input([]), "markdown");
    expect(md).toContain("# Refactor playground");
    expect(md).toContain("**Model:** `gpt-5.5`");
    expect(md).toContain("**Workspace:** `C:\\repo\\dafman`");
    expect(md).toContain("**Exported:** 2026-05-22T00:00:00.000Z");
    expect(md).toContain("**Messages:** 0");
  });

  test("renders a user message + attachments list", () => {
    const items: ChatItem[] = [
      {
        id: 1,
        kind: "user",
        text: "compare a.ts and b.ts",
        attachments: [
          { type: "file", path: "/abs/a.ts", displayName: "a.ts" },
          { type: "blob", data: "Zm9v", mimeType: "image/png", displayName: "shot.png" },
        ],
      },
    ];
    const md = formatConversation(input(items), "markdown");
    expect(md).toContain("## 👤 You");
    expect(md).toContain("compare a.ts and b.ts");
    expect(md).toContain("`a.ts` (file)");
    expect(md).toContain("`shot.png` (image/png)");
  });

  test("renders an assistant message with text", () => {
    const items: ChatItem[] = [
      { id: 1, kind: "assistant", text: "Here's the answer.", messageId: "m1" },
    ];
    const md = formatConversation(input(items), "markdown");
    expect(md).toContain("## 🤖 Assistant");
    expect(md).toContain("Here's the answer.");
  });

  test("skips empty assistant cards", () => {
    const items: ChatItem[] = [
      { id: 1, kind: "assistant", text: "", messageId: "m1" },
      { id: 2, kind: "assistant", text: "real reply", messageId: "m2" },
    ];
    const md = formatConversation(input(items), "markdown");
    // Only one Assistant heading appears.
    const matches = md.match(/## 🤖 Assistant/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  test("folds reasoning into <details>; encrypted variant shows placeholder", () => {
    const items: ChatItem[] = [
      {
        id: 1,
        kind: "reasoning",
        text: "Let me think step by step.",
        reasoningId: "r1",
      },
      {
        id: 2,
        kind: "reasoning",
        text: "",
        reasoningId: "r2",
        opaque: true,
      },
    ];
    const md = formatConversation(input(items), "markdown");
    expect(md).toContain("<details>");
    expect(md).toContain("<summary>💭 Reasoning</summary>");
    expect(md).toContain("Let me think step by step.");
    expect(md).toContain("<summary>💭 Reasoning (encrypted)</summary>");
    expect(md).toContain("encrypted reasoning");
  });

  test("renders tool calls with args + result + errors", () => {
    const items: ChatItem[] = [
      {
        id: 1,
        kind: "tool",
        toolCallId: "call-1",
        toolName: "shell",
        args: { command: "ls -la /tmp" },
        status: "success",
        partialOutput: "total 0\n",
        resultContent: "drwxr-xr-x  …",
      },
      {
        id: 2,
        kind: "tool",
        toolCallId: "call-2",
        toolName: "read",
        args: { path: "/etc/secrets" },
        status: "error",
        partialOutput: "",
        errorMessage: "permission denied",
        errorCode: "EACCES",
      },
    ];
    const md = formatConversation(input(items), "markdown");
    expect(md).toContain("### 🔧 Tool · shell (✓)");
    expect(md).toContain("ls -la /tmp");
    expect(md).toContain("**Result:**");
    expect(md).toContain("### 🔧 Tool · read (✗)");
    expect(md).toContain("**Error (EACCES):** permission denied");
  });

  test("system bubble icons by severity", () => {
    const items: ChatItem[] = [
      { id: 1, kind: "system", text: "info", severity: "info" },
      { id: 2, kind: "system", text: "warn", severity: "warn" },
      { id: 3, kind: "system", text: "err", severity: "error" },
    ];
    const md = formatConversation(input(items), "markdown");
    expect(md).toContain("> ℹ️ info");
    expect(md).toContain("> ⚠️ warn");
    expect(md).toContain("> 🛑 err");
  });

  test("pendingRequest items are NOT included in the export", () => {
    const items: ChatItem[] = [
      { id: 1, kind: "user", text: "hi" },
      {
        id: 2,
        kind: "pendingRequest",
        requestId: "req-1",
        pendingKind: "permission",
        message: "Allow shell?",
        request: { kind: "shell", summary: "ls -la", raw: { command: "ls -la" } },
      } as ChatItem,
    ];
    const md = formatConversation(input(items), "markdown");
    expect(md).not.toContain("Allow shell?");
    expect(md).not.toContain("req-1");
  });
});

describe("formatConversation — json", () => {
  test("returns a parseable JSON document with title + metadata + items", () => {
    const items: ChatItem[] = [
      { id: 1, kind: "user", text: "ping" },
      { id: 2, kind: "assistant", text: "pong", messageId: "m1" },
    ];
    const out = formatConversation(input(items), "json");
    const parsed = JSON.parse(out);
    expect(parsed.title).toBe("Refactor playground");
    expect(parsed.model).toBe("gpt-5.5");
    expect(parsed.workingDirectory).toBe("C:\\repo\\dafman");
    expect(parsed.exportedAt).toBe(FIXED_NOW);
    expect(parsed.items).toEqual(items);
  });
});

describe("exportFilenameStem", () => {
  test("sanitises whitespace + punctuation; appends extension + timestamp", () => {
    const name = exportFilenameStem("My Session: Cool!", "markdown");
    expect(name).toMatch(/^My-Session-Cool-/);
    expect(name).toMatch(/\.md$/);
  });

  test("falls back to 'session' on empty/whitespace-only titles", () => {
    const name = exportFilenameStem("   ", "json");
    expect(name).toMatch(/^session-/);
    expect(name).toMatch(/\.json$/);
  });

  test("caps the stem to keep filesystem-friendly", () => {
    const long = "x".repeat(200);
    const name = exportFilenameStem(long, "markdown");
    // 80 chars for the stem + timestamp suffix + extension.
    expect(name.length).toBeLessThan(140);
  });
});
