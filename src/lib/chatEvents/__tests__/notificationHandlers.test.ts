import { describe, expect, test } from "bun:test";
import {
  defaultAmbient,
  processEvents,
  type IdCounter,
} from "../../chatEvents";
import type { SessionEventPayload } from "../../../ipc/types";

function payload(
  eventType: string,
  data: Record<string, unknown>,
): SessionEventPayload {
  return { sessionId: "sess-1", eventType, data };
}

function run(payloads: SessionEventPayload[]) {
  const counter: IdCounter = { next: 1 };
  return processEvents([], defaultAmbient(), payloads, counter);
}

describe("notificationHandlers — ambient.pendingRequest", () => {
  test("permission.requested sets pendingRequest of type 'permission'", () => {
    const result = run([
      payload("permission.requested", {
        tool: "shell",
        summary: "Run `rm -rf /tmp/x`",
      }),
    ]);
    expect(result.ambient.pendingRequest).toEqual({
      type: "permission",
      message: "Run `rm -rf /tmp/x`",
    });
  });

  test("permission.requested falls back to tool name when no summary", () => {
    const result = run([
      payload("permission.requested", { tool: "shell" }),
    ]);
    expect(result.ambient.pendingRequest?.message).toBe("shell");
  });

  test("permission.completed clears a matching pendingRequest", () => {
    const result = run([
      payload("permission.requested", { tool: "shell", summary: "do x" }),
      payload("permission.completed", {}),
    ]);
    expect(result.ambient.pendingRequest).toBeNull();
  });

  test("permission.completed does NOT clear a userInput pendingRequest (different channel)", () => {
    const result = run([
      payload("user_input.requested", { prompt: "type something" }),
      payload("permission.completed", {}),
    ]);
    expect(result.ambient.pendingRequest).toEqual({
      type: "userInput",
      message: "type something",
    });
  });

  test("user_input.requested + .completed round-trip", () => {
    const requested = run([
      payload("user_input.requested", { prompt: "your name?" }),
    ]);
    expect(requested.ambient.pendingRequest).toEqual({
      type: "userInput",
      message: "your name?",
    });
    const completed = run([
      payload("user_input.requested", { prompt: "your name?" }),
      payload("user_input.completed", {}),
    ]);
    expect(completed.ambient.pendingRequest).toBeNull();
  });

  test("elicitation.requested with url falls back to the url string", () => {
    const result = run([
      payload("elicitation.requested", {
        url: "https://github.com/login/oauth",
      }),
    ]);
    expect(result.ambient.pendingRequest).toEqual({
      type: "elicitation",
      message: "https://github.com/login/oauth",
    });
  });

  test("elicitation.completed clears matching pendingRequest", () => {
    const result = run([
      payload("elicitation.requested", { prompt: "approve OAuth?" }),
      payload("elicitation.completed", {}),
    ]);
    expect(result.ambient.pendingRequest).toBeNull();
  });

  test("a new request overwrites an older one (last wins)", () => {
    // Real-world: SDK could fire permission.requested then a
    // user_input.requested before the first completes. Latest-wins
    // is a simplification but matches the "one banner at a time" UX.
    const result = run([
      payload("permission.requested", { summary: "first" }),
      payload("user_input.requested", { prompt: "second" }),
    ]);
    expect(result.ambient.pendingRequest).toEqual({
      type: "userInput",
      message: "second",
    });
  });

  test("default ambient has pendingRequest=null", () => {
    expect(defaultAmbient().pendingRequest).toBeNull();
  });
});
