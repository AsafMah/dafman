import { describe, expect, test } from "bun:test";
import {
  defaultAmbient,
  processEvents,
  type IdCounter,
} from "../../chatEvents";
import type {
  PermissionRequestData,
  SessionEventPayload,
  UserInputRequestData,
} from "../../../ipc/types";

function payload(
  eventType: string,
  data: Record<string, unknown>,
): SessionEventPayload {
  return { sessionId: "sess-1", eventType, data };
}

function pendingPush(
  requestId: string,
  kind: "permission" | "userInput" | "elicitation",
  request: unknown,
): SessionEventPayload {
  return payload("dafman.pending_request", {
    sessionId: "sess-1",
    requestId,
    kind,
    request,
  });
}

function run(payloads: SessionEventPayload[]) {
  const counter: IdCounter = { next: 1 };
  return processEvents([], defaultAmbient(), payloads, counter);
}

const SAMPLE_PERMISSION: PermissionRequestData = {
  kind: "shell",
  toolCallId: "tc-1",
  summary: "shell: rm -rf /tmp/x",
  raw: { command: "rm -rf /tmp/x" },
};

const SAMPLE_INPUT: UserInputRequestData = {
  question: "What is your name?",
  allowFreeform: true,
};

describe("notificationHandlers — ambient.pendingRequests (queue)", () => {
  test("dafman.pending_request appends a permission entry", () => {
    const result = run([pendingPush("req-1", "permission", SAMPLE_PERMISSION)]);
    expect(result.ambient.pendingRequests).toHaveLength(1);
    expect(result.ambient.pendingRequests[0]).toEqual({
      kind: "permission",
      requestId: "req-1",
      message: "shell: rm -rf /tmp/x",
      request: SAMPLE_PERMISSION,
    });
  });

  test("dafman.pending_response removes by requestId", () => {
    const result = run([
      pendingPush("req-1", "permission", SAMPLE_PERMISSION),
      payload("dafman.pending_response", { requestId: "req-1" }),
    ]);
    expect(result.ambient.pendingRequests).toEqual([]);
  });

  test("dafman.pending_response only removes the matching requestId", () => {
    const result = run([
      pendingPush("req-1", "permission", SAMPLE_PERMISSION),
      pendingPush("req-2", "userInput", SAMPLE_INPUT),
      payload("dafman.pending_response", { requestId: "req-1" }),
    ]);
    expect(result.ambient.pendingRequests).toHaveLength(1);
    expect(result.ambient.pendingRequests[0]?.requestId).toBe("req-2");
  });

  test("SDK permission.completed clears the oldest permission entry", () => {
    const result = run([
      pendingPush("req-1", "permission", SAMPLE_PERMISSION),
      pendingPush("req-2", "permission", SAMPLE_PERMISSION),
      payload("permission.completed", {}),
    ]);
    expect(result.ambient.pendingRequests).toHaveLength(1);
    expect(result.ambient.pendingRequests[0]?.requestId).toBe("req-2");
  });

  test("SDK permission.completed does NOT remove a userInput entry (channel scoped)", () => {
    const result = run([
      pendingPush("req-1", "userInput", SAMPLE_INPUT),
      payload("permission.completed", {}),
    ]);
    expect(result.ambient.pendingRequests).toHaveLength(1);
    expect(result.ambient.pendingRequests[0]?.kind).toBe("userInput");
  });

  test("SDK user_input.completed clears the oldest userInput entry", () => {
    const result = run([
      pendingPush("req-1", "userInput", SAMPLE_INPUT),
      payload("user_input.completed", {}),
    ]);
    expect(result.ambient.pendingRequests).toEqual([]);
  });

  test("SDK elicitation.completed clears the oldest elicitation entry", () => {
    const result = run([
      pendingPush("req-1", "elicitation", {
        message: "Open OAuth",
        mode: "url",
        url: "https://github.com",
      }),
      payload("elicitation.completed", {}),
    ]);
    expect(result.ambient.pendingRequests).toEqual([]);
  });

  test("SDK *.requested events are no-ops for state (canonical channel is dafman.pending_request)", () => {
    const result = run([
      payload("permission.requested", { tool: "shell" }),
      payload("user_input.requested", { prompt: "?" }),
      payload("elicitation.requested", { url: "https://example.com" }),
    ]);
    expect(result.ambient.pendingRequests).toEqual([]);
  });

  test("multiple pending requests stack as FIFO", () => {
    const result = run([
      pendingPush("req-1", "permission", SAMPLE_PERMISSION),
      pendingPush("req-2", "userInput", SAMPLE_INPUT),
      pendingPush("req-3", "elicitation", { message: "x", mode: "url" }),
    ]);
    expect(result.ambient.pendingRequests.map((p) => p.requestId)).toEqual([
      "req-1",
      "req-2",
      "req-3",
    ]);
  });

  test("dafman.pending_request is idempotent for duplicate requestIds", () => {
    const result = run([
      pendingPush("req-1", "permission", SAMPLE_PERMISSION),
      pendingPush("req-1", "permission", SAMPLE_PERMISSION),
    ]);
    expect(result.ambient.pendingRequests).toHaveLength(1);
  });

  test("default ambient has pendingRequests=[]", () => {
    expect(defaultAmbient().pendingRequests).toEqual([]);
  });
});
