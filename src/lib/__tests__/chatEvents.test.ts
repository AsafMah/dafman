import { describe, expect, it } from "vitest";
import {
  appendSystemMessage,
  appendUserMessage,
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
    const { items } = processEvents(
      [],
      [
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
    const { items } = processEvents(
      [],
      [
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
    const { items } = processEvents(
      [],
      [
        ev("assistant.reasoning_delta", { reasoningId: "r1", deltaContent: "..." }),
        ev("assistant.message_delta", { messageId: "m1", deltaContent: "Answer" }),
      ],
      counter,
    );
    expect(items.map((i) => i.kind)).toEqual(["reasoning", "assistant"]);
  });

  it("assistant.message replaces the accumulated text with the canonical content", () => {
    const counter = mkCounter();
    const seeded = processEvents(
      [],
      [ev("assistant.message_delta", { messageId: "m1", deltaContent: "draft" })],
      counter,
    );
    const final = processEvents(
      seeded.items,
      [ev("assistant.message", { messageId: "m1", content: "Final" })],
      counter,
    );
    const assistant = final.items.find((i) => i.kind === "assistant");
    expect(assistant && "text" in assistant && assistant.text).toBe("Final");
  });

  it("flags session.idle without adding an item", () => {
    const counter = mkCounter();
    const { items, idle } = processEvents([], [ev("session.idle", {})], counter);
    expect(items).toHaveLength(0);
    expect(idle).toBe(true);
  });

  it("appends a system message for session.error and flags error=true", () => {
    const counter = mkCounter();
    const { items, error } = processEvents(
      [],
      [ev("session.error", { message: "boom" })],
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
    const { items } = processEvents(
      [],
      [ev("tool.something_new", { foo: "bar" })],
      counter,
    );
    expect(items).toHaveLength(0);
  });

  it("does NOT create an empty reasoning card when delta has no id and no text", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      [ev("assistant.reasoning_delta", {})],
      counter,
    );
    expect(items).toHaveLength(0);
  });

  it("does NOT create an empty reasoning card when assistant.reasoning has no id and no content", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      [ev("assistant.reasoning", {})],
      counter,
    );
    expect(items).toHaveLength(0);
  });

  it("accepts reasoning delta under alternate field name 'delta'", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      [
        ev("assistant.reasoning_delta", { reasoningId: "r1", delta: "Hmm" }),
      ],
      counter,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "reasoning", text: "Hmm" });
  });

  it("accepts assistant.reasoning content under alternate field name 'text'", () => {
    const counter = mkCounter();
    const { items } = processEvents(
      [],
      [ev("assistant.reasoning", { reasoningId: "r1", text: "Done" })],
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

  it("appendSystemMessage carries through the text verbatim", () => {
    const counter = mkCounter();
    const next = appendSystemMessage([], "Error: nope", counter);
    expect(next[0]).toMatchObject({ kind: "system", text: "Error: nope" });
  });
});
