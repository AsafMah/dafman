import { describe, expect, it } from "vitest";
import {
  appendSystemMessage,
  appendUserMessage,
  defaultAmbient,
  processEvents,
  type ChatItem,
  type IdCounter,
} from "../chatEvents";
import type { SessionEventPayload } from "../../ipc/types";

function mkCounter(start = 1): IdCounter {
  return { next: start };
}

function ev(type: string, data: Record<string, unknown>): SessionEventPayload {
  return { eventType: type, data };
}

describe("processEvents", () => {
  it("accumulates assistant deltas into one bubble keyed by messageId", () => {
    const counter = mkCounter();
    const { items } = processEvents([], defaultAmbient(), [
        ev("assistant.message_start", { messageId: "m1" }),
        ev("assistant.message_delta", { messageId: "m1", deltaContent: "Hel" }),
        ev("assistant.message_delta", { messageId: "m1", deltaContent: "lo" }),
      ],
      counter,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "assistant",
      text: "Hello",
      messageId: "m1",
    });
  });

  it("accumulates reasoning deltas into a separate item keyed by reasoningId", () => {
    const counter = mkCounter();
    const { items } = processEvents([], defaultAmbient(), [
        ev("assistant.reasoning_delta", {
          reasoningId: "r1",
          deltaContent: "First I should ",
        }),
        ev("assistant.reasoning_delta", {
          reasoningId: "r1",
          deltaContent: "consider...",
        }),
      ],
      counter,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "reasoning",
      reasoningId: "r1",
      text: "First I should consider...",
    });
  });

  it("interleaves reasoning and message items", () => {
    const counter = mkCounter();
    const { items } = processEvents([], defaultAmbient(), [
        ev("assistant.reasoning_delta", { reasoningId: "r1", deltaContent: "..." }),
        ev("assistant.message_delta", { messageId: "m1", deltaContent: "Answer" }),
      ],
      counter,
    );
    expect(items.map((i) => i.kind)).toEqual(["reasoning", "assistant"]);
  });

  it("assistant.message replaces the accumulated text with the canonical content", () => {
    const counter = mkCounter();
    const seeded = processEvents([], defaultAmbient(), [ev("assistant.message_delta", { messageId: "m1", deltaContent: "draft" })],
      counter,
    );
    const final = processEvents(seeded.items, seeded.ambient, [ev("assistant.message", { messageId: "m1", content: "Final" })],
      counter,
    );
    const assistant = final.items.find((i) => i.kind === "assistant");
    expect(assistant && "text" in assistant && assistant.text).toBe("Final");
  });

  it("flags session.idle without adding an item", () => {
    const counter = mkCounter();
    const { items, idle } = processEvents([], defaultAmbient(), [ev("session.idle", {})], counter);
    expect(items).toHaveLength(0);
    expect(idle).toBe(true);
  });

  it("appends a system message for session.error and flags error=true", () => {
    const counter = mkCounter();
    const { items, error } = processEvents([], defaultAmbient(), [ev("session.error", { message: "boom" })],
      counter,
    );
    expect(error).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "system",
      text: "Session error: boom",
    });
  });

  it("ignores unknown event types", () => {
    const counter = mkCounter();
    const { items } = processEvents([], defaultAmbient(), [ev("tool.something_new", { foo: "bar" })],
      counter,
    );
    expect(items).toHaveLength(0);
  });

  it("does NOT create an empty reasoning card when delta has no id and no text", () => {
    const counter = mkCounter();
    const { items } = processEvents([], defaultAmbient(), [ev("assistant.reasoning_delta", {})],
      counter,
    );
    expect(items).toHaveLength(0);
  });

  it("does NOT create an empty reasoning card when assistant.reasoning has no id and no content", () => {
    const counter = mkCounter();
    const { items } = processEvents([], defaultAmbient(), [ev("assistant.reasoning", {})],
      counter,
    );
    expect(items).toHaveLength(0);
  });

  it("does NOT create a card for OpenAI's opaque reasoning blob (empty content, base64 id)", () => {
    // GPT-5.5 emits this AFTER the canonical reasoning event. The id is
    // the encrypted blob the SDK uses to re-submit reasoning context on
    // follow-up turns; it must not produce a UI card.
    const counter = mkCounter();
    const opaqueId =
      "j8NsbxF6k3hyOuiAkHx+3cwEFYP0xgsUDtQmGAXgxTdIkzJDVk6WpdL8d8s0RKeM" +
      "atF+ciUoX4pKPKXubbVMNArkSXfdlQzDDpt8I+hTJCWZw+Raxps9bpheFx7AFLC8";
    const { items } = processEvents([], defaultAmbient(), [ev("assistant.reasoning", { content: "", reasoningId: opaqueId })],
      counter,
    );
    expect(items).toHaveLength(0);
  });

  it("updates an existing reasoning card when assistant.reasoning carries content for a known id", () => {
    // The canonical OpenAI/Claude flow: deltas stream first, then a
    // final assistant.reasoning event arrives with the full content for
    // the same reasoningId. Updating MUST work even though we now skip
    // empty-content events.
    const counter = mkCounter();
    const seeded = processEvents([], defaultAmbient(), [
        ev("assistant.reasoning_delta", { reasoningId: "r1", deltaContent: "draft" }),
      ],
      counter,
    );
    const final = processEvents(seeded.items, seeded.ambient, [ev("assistant.reasoning", { reasoningId: "r1", content: "final text" })],
      counter,
    );
    const reasoning = final.items.find((i) => i.kind === "reasoning");
    expect(reasoning && "text" in reasoning && reasoning.text).toBe(
      "final text",
    );
    expect(final.items.filter((i) => i.kind === "reasoning")).toHaveLength(1);
  });

  it("accepts reasoning delta under alternate field name 'delta'", () => {
    const counter = mkCounter();
    const { items } = processEvents([], defaultAmbient(), [
        ev("assistant.reasoning_delta", { reasoningId: "r1", delta: "Hmm" }),
      ],
      counter,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "reasoning", text: "Hmm" });
  });

  it("accepts assistant.reasoning content under alternate field name 'text'", () => {
    const counter = mkCounter();
    const { items } = processEvents([], defaultAmbient(), [ev("assistant.reasoning", { reasoningId: "r1", text: "Done" })],
      counter,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "reasoning", text: "Done" });
  });
});

describe("appendUserMessage / appendSystemMessage", () => {
  it("returns a new array (no mutation) with the appended item", () => {
    const counter = mkCounter();
    const original: ChatItem[] = [];
    const next = appendUserMessage(original, "hi", counter);
    expect(original).toHaveLength(0);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: "user", text: "hi" });
  });

  it("appendSystemMessage carries through the text verbatim with default severity 'error'", () => {
    const counter = mkCounter();
    const next = appendSystemMessage([], "Error: nope", counter);
    expect(next[0]).toMatchObject({
      kind: "system",
      text: "Error: nope",
      severity: "error",
    });
  });
});

describe("processEvents ambient state", () => {
  it("updates title on session.title_changed", () => {
    const counter = mkCounter();
    const { ambient } = processEvents(
      [],
      defaultAmbient(),
      [ev("session.title_changed", { title: "Refactor X" })],
      counter,
    );
    expect(ambient.title).toBe("Refactor X");
  });

  it("tracks current model on session.model_change and queues a toast", () => {
    const counter = mkCounter();
    const { ambient, toasts } = processEvents(
      [],
      defaultAmbient(),
      [
        ev("session.model_change", {
          previousModel: "claude-sonnet-4.5",
          newModel: "gpt-5.5",
        }),
      ],
      counter,
    );
    expect(ambient.model).toBe("gpt-5.5");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      severity: "info",
      summary: "Model changed",
    });
    expect(toasts[0]?.detail).toContain("claude-sonnet-4.5");
    expect(toasts[0]?.detail).toContain("gpt-5.5");
  });

  it("tracks token usage on session.usage_info", () => {
    const counter = mkCounter();
    const { ambient } = processEvents(
      [],
      defaultAmbient(),
      [
        ev("session.usage_info", { currentTokens: 1234, tokenLimit: 200000 }),
      ],
      counter,
    );
    expect(ambient.usage).toEqual({ currentTokens: 1234, tokenLimit: 200000 });
  });

  it("turn_start -> turnActive=true, sawTurnBoundary=true; turn_end -> false", () => {
    const counter = mkCounter();
    const r1 = processEvents(
      [],
      defaultAmbient(),
      [ev("assistant.turn_start", { turnId: "t1" })],
      counter,
    );
    expect(r1.ambient.turnActive).toBe(true);
    expect(r1.ambient.sawTurnBoundary).toBe(true);

    const r2 = processEvents(
      r1.items,
      r1.ambient,
      [ev("assistant.turn_end", { turnId: "t1" })],
      counter,
    );
    expect(r2.ambient.turnActive).toBe(false);
  });

  it("assistant.intent populates intent; turn_end clears it", () => {
    const counter = mkCounter();
    const r1 = processEvents(
      [],
      defaultAmbient(),
      [
        ev("assistant.turn_start", { turnId: "t1" }),
        ev("assistant.intent", { intent: "Searching the codebase" }),
      ],
      counter,
    );
    expect(r1.ambient.intent).toBe("Searching the codebase");

    const r2 = processEvents(
      r1.items,
      r1.ambient,
      [ev("assistant.turn_end", { turnId: "t1" })],
      counter,
    );
    expect(r2.ambient.intent).toBeNull();
  });
});

describe("processEvents system callouts", () => {
  it("session.warning produces a system item with warn severity", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      defaultAmbient(),
      [
        ev("session.warning", {
          message: "Approaching context limit",
          warningType: "context_window",
        }),
      ],
      counter,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "system",
      severity: "warn",
      text: "Approaching context limit",
    });
  });

  it("session.info produces a system item with info severity, appending tip when present", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      defaultAmbient(),
      [
        ev("session.info", {
          infoType: "mcp",
          message: "Server connected",
          tip: "Use /mcp list to inspect",
        }),
      ],
      counter,
    );
    expect(items[0]).toMatchObject({ kind: "system", severity: "info" });
    expect((items[0] as { text: string }).text).toContain("Server connected");
    expect((items[0] as { text: string }).text).toContain("Use /mcp list");
  });

  it("model.call_failure produces a system item with error severity and status code", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      defaultAmbient(),
      [
        ev("model.call_failure", {
          errorMessage: "rate limited",
          statusCode: 429,
          source: "user-initiated",
        }),
      ],
      counter,
    );
    expect(items[0]).toMatchObject({ kind: "system", severity: "error" });
    expect((items[0] as { text: string }).text).toContain("rate limited");
    expect((items[0] as { text: string }).text).toContain("429");
  });

  it("session.truncation produces an info callout with removed message count", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      defaultAmbient(),
      [
        ev("session.truncation", {
          messagesRemovedDuringTruncation: 7,
          performedBy: "BasicTruncator",
          postTruncationMessagesLength: 20,
          postTruncationTokensInMessages: 4000,
          preTruncationMessagesLength: 27,
          preTruncationTokensInMessages: 9000,
          tokenLimit: 8192,
          tokensRemovedDuringTruncation: 5000,
        }),
      ],
      counter,
    );
    expect(items[0]).toMatchObject({ kind: "system", severity: "info" });
    expect((items[0] as { text: string }).text).toContain("7 messages");
  });

  it("session.compaction_complete with errorMessage gets warn severity", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      defaultAmbient(),
      [ev("session.compaction_complete", { errorMessage: "oom" })],
      counter,
    );
    expect(items[0]).toMatchObject({ kind: "system", severity: "warn" });
    expect((items[0] as { text: string }).text).toContain("oom");
  });

  it("explicitly-ignored events (e.g. assistant.streaming_delta) produce nothing", () => {
    const counter = mkCounter();
    const { items, ambient, toasts } = processEvents(
      [],
      defaultAmbient(),
      [
        ev("assistant.streaming_delta", { delta: "x" }),
        ev("system.message", { content: "ignore me", role: "system" }),
        ev("session.tools_updated", {}),
      ],
      counter,
    );
    expect(items).toHaveLength(0);
    expect(toasts).toHaveLength(0);
    expect(ambient.title).toBeNull();
  });
});
