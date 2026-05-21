import { describe, expect, test } from "bun:test";
import {
  defaultAmbient,
  processEvents,
  TOOL_OUTPUT_CAP_BYTES,
  type IdCounter,
} from "../chatEvents";
import type { SessionEventPayload } from "../../ipc/types";

function event(data: Record<string, unknown>): SessionEventPayload {
  return {
    sessionId: "sess-1",
    eventType: "session.model_change",
    data,
  };
}

function toolEvent(
  eventType: string,
  data: Record<string, unknown>,
  extras: Partial<SessionEventPayload> = {},
): SessionEventPayload {
  return {
    sessionId: "sess-1",
    eventType,
    data,
    ...extras,
  };
}

describe("processEvents", () => {
  test("includes reasoning effort in model-change toasts", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        event({
          previousModel: "claude-sonnet-4.5",
          newModel: "gpt-5.5",
          previousReasoningEffort: "medium",
          reasoningEffort: "high",
        }),
      ],
      counter,
    );

    expect(result.ambient.model).toBe("gpt-5.5");
    expect(result.ambient.reasoningEffort).toBe("high");
    expect(result.toasts).toEqual([
      {
        severity: "info",
        summary: "Model changed",
        detail: "claude-sonnet-4.5 → gpt-5.5 (medium → high effort)",
      },
    ]);
  });

  test("suppresses duplicate model-change toasts", () => {
    const counter: IdCounter = { next: 1 };
    const payload = event({
      previousModel: "claude-sonnet-4.5",
      newModel: "gpt-5.5",
      reasoningEffort: "high",
    });
    const first = processEvents([], defaultAmbient(), [payload], counter);
    const second = processEvents([], first.ambient, [payload], counter);

    expect(first.toasts).toHaveLength(1);
    expect(second.toasts).toHaveLength(0);
  });

  test("skips model-change toast when previousModel is missing (initial setup)", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [event({ newModel: "gpt-5.5", reasoningEffort: "high" })],
      counter,
    );
    // Ambient is still updated so the UI reflects the model, but the
    // toast is suppressed — there's no actionable signal in "the SDK
    // told us what model it's using on startup".
    expect(result.ambient.model).toBe("gpt-5.5");
    expect(result.toasts).toEqual([]);
  });

  test("skips model-change toasts during replay (live: false)", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        event({
          previousModel: "claude-sonnet-4.5",
          newModel: "gpt-5.5",
          reasoningEffort: "high",
        }),
      ],
      counter,
      { live: false },
    );
    expect(result.ambient.model).toBe("gpt-5.5");
    expect(result.toasts).toEqual([]);
  });

  test("dedupes repeated compaction status events", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        {
          sessionId: "sess-1",
          eventType: "session.compaction_start",
          data: {},
        },
        {
          sessionId: "sess-1",
          eventType: "session.compaction_start",
          data: {},
        },
        {
          sessionId: "sess-1",
          eventType: "session.compaction_complete",
          data: {},
        },
        {
          sessionId: "sess-1",
          eventType: "session.compaction_complete",
          data: {},
        },
      ],
      counter,
    );

    expect(result.items).toEqual([
      {
        id: 1,
        kind: "system",
        text: "Compacting conversation...",
        severity: "info",
      },
      {
        id: 2,
        kind: "system",
        text: "Compaction complete.",
        severity: "info",
      },
    ]);
  });

  test("user.message from history replay appends a user item", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        {
          sessionId: "sess-1",
          eventType: "user.message",
          data: { content: "hello" },
          eventId: "evt-1",
        },
      ],
      counter,
    );
    expect(result.items).toEqual([
      { id: 1, kind: "user", text: "hello", messageId: "evt-1", eventId: "evt-1" },
    ]);
  });

  test("user.message dedupes against a local optimistic item", () => {
    const counter: IdCounter = { next: 5 };
    // appendUserMessage produces an item without a messageId.
    const optimistic = { id: 4, kind: "user" as const, text: "ping" };
    const result = processEvents(
      [optimistic],
      defaultAmbient(),
      [
        {
          sessionId: "sess-1",
          eventType: "user.message",
          data: { content: "ping" },
          eventId: "evt-9",
        },
      ],
      counter,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 4,
      kind: "user",
      text: "ping",
      messageId: "evt-9",
      eventId: "evt-9",
    });
    // counter was NOT advanced — adopting an existing item leaves
    // ID space intact.
    expect(counter.next).toBe(5);
  });

  test("user.message echo with no matching optimistic item appends a fresh bubble", () => {
    const counter: IdCounter = { next: 10 };
    const result = processEvents(
      [{ id: 9, kind: "user", text: "earlier" }],
      defaultAmbient(),
      [
        {
          sessionId: "sess-1",
          eventType: "user.message",
          data: { content: "different" },
          eventId: "evt-2",
        },
      ],
      counter,
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({
      id: 10,
      kind: "user",
      text: "different",
      messageId: "evt-2",
      eventId: "evt-2",
    });
  });

  test("user.message dedupes by messageId on repeat (idempotent replay)", () => {
    const counter: IdCounter = { next: 1 };
    const payload: SessionEventPayload = {
      sessionId: "sess-1",
      eventType: "user.message",
      data: { content: "hello" },
      eventId: "evt-7",
    };
    const first = processEvents([], defaultAmbient(), [payload], counter);
    const second = processEvents(
      first.items,
      first.ambient,
      [payload],
      counter,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.kind).toBe("user");
  });
});

describe("processEvents — fork notices", () => {
  test("session.info infoType=fork (source) parses into a forkNotice item", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        {
          sessionId: "s1",
          eventType: "session.info",
          data: {
            infoType: "fork",
            message: "Forked this session into Branch Idea 2.",
          },
          eventId: "evt-fork-1",
        },
      ],
      counter,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 1,
      kind: "forkNotice",
      eventId: "evt-fork-1",
      direction: "into",
      referenceName: "Branch Idea 2",
    });
  });

  test("session.info infoType=fork (destination) parses direction=from", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        {
          sessionId: "s2",
          eventType: "session.info",
          data: {
            infoType: "fork",
            message:
              "Forked from Original Convo before event abc123 as Branch.",
          },
          eventId: "evt-fork-2",
        },
      ],
      counter,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 1,
      kind: "forkNotice",
      eventId: "evt-fork-2",
      direction: "from",
      referenceName: "Original Convo",
    });
  });

  test("duplicate fork session.info with the same eventId only renders once", () => {
    const counter: IdCounter = { next: 1 };
    const event = {
      sessionId: "s1",
      eventType: "session.info",
      data: {
        infoType: "fork",
        message: "Forked this session into Branch A.",
      },
      eventId: "evt-dup",
    };
    const result = processEvents([], defaultAmbient(), [event, event], counter);
    expect(result.items).toHaveLength(1);
  });

  test("non-fork session.info still falls through to a system bubble", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        {
          sessionId: "s1",
          eventType: "session.info",
          data: { message: "Welcome." },
          eventId: "evt-info",
        },
      ],
      counter,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: "system",
      severity: "info",
      text: "Welcome.",
    });
  });
});

describe("processEvents — tool calls", () => {
  test("happy path: start → progress → partial → complete success", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        toolEvent("tool.execution_start", {
          toolCallId: "call-1",
          toolName: "shell",
          arguments: { command: "ls" },
        }),
        toolEvent("tool.execution_progress", {
          toolCallId: "call-1",
          progressMessage: "Spawning shell…",
        }),
        toolEvent("tool.execution_partial_result", {
          toolCallId: "call-1",
          partialOutput: "file-a\n",
        }),
        toolEvent("tool.execution_partial_result", {
          toolCallId: "call-1",
          partialOutput: "file-b\n",
        }),
        toolEvent("tool.execution_complete", {
          toolCallId: "call-1",
          success: true,
          result: { content: "ok", detailedContent: "file-a\nfile-b\n" },
        }),
      ],
      counter,
    );

    expect(result.items).toHaveLength(1);
    const tool = result.items[0];
    expect(tool.kind).toBe("tool");
    if (tool.kind !== "tool") return;
    expect(tool.toolCallId).toBe("call-1");
    expect(tool.toolName).toBe("shell");
    expect(tool.args).toEqual({ command: "ls" });
    expect(tool.status).toBe("success");
    expect(tool.progressMessage).toBe("Spawning shell…");
    expect(tool.partialOutput).toBe("file-a\nfile-b\n");
    // detailedContent wins over content (the SDK's content is LLM-truncated).
    expect(tool.resultContent).toBe("file-a\nfile-b\n");
  });

  test("error path: start → complete failure surfaces error message + code", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        toolEvent("tool.execution_start", {
          toolCallId: "call-1",
          toolName: "write",
        }),
        toolEvent("tool.execution_complete", {
          toolCallId: "call-1",
          success: false,
          error: { code: "EACCES", message: "permission denied" },
        }),
      ],
      counter,
    );

    const tool = result.items[0];
    if (tool.kind !== "tool") throw new Error("expected tool item");
    expect(tool.status).toBe("error");
    expect(tool.errorMessage).toBe("permission denied");
    expect(tool.errorCode).toBe("EACCES");
  });

  test("out-of-order: partial before start creates an item, start later fills metadata", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        toolEvent("tool.execution_partial_result", {
          toolCallId: "call-1",
          partialOutput: "early\n",
        }),
        toolEvent("tool.execution_start", {
          toolCallId: "call-1",
          toolName: "shell",
          arguments: { command: "echo hi" },
        }),
      ],
      counter,
    );

    const tool = result.items[0];
    if (tool.kind !== "tool") throw new Error("expected tool item");
    expect(tool.toolName).toBe("shell");
    expect(tool.args).toEqual({ command: "echo hi" });
    expect(tool.partialOutput).toBe("early\n");
  });

  test("terminal status is monotonic: late start does not regress completed tool to running", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        toolEvent("tool.execution_complete", {
          toolCallId: "call-1",
          success: true,
          result: { content: "ok" },
        }),
        toolEvent("tool.execution_start", {
          toolCallId: "call-1",
          toolName: "shell",
        }),
      ],
      counter,
    );

    const tool = result.items[0];
    if (tool.kind !== "tool") throw new Error("expected tool item");
    expect(tool.status).toBe("success");
    expect(tool.toolName).toBe("shell");
  });

  test("falls back to a shortened id when toolName is missing", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        toolEvent("tool.execution_partial_result", {
          toolCallId: "abcdef1234567890",
          partialOutput: "x",
        }),
      ],
      counter,
    );

    const tool = result.items[0];
    if (tool.kind !== "tool") throw new Error("expected tool item");
    expect(tool.toolName).toBe("tool abcdef12");
  });

  test("mcp metadata is preserved", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        toolEvent("tool.execution_start", {
          toolCallId: "call-1",
          toolName: "github_search",
          mcpServerName: "github",
          mcpToolName: "search_issues",
        }),
      ],
      counter,
    );

    const tool = result.items[0];
    if (tool.kind !== "tool") throw new Error("expected tool item");
    expect(tool.mcpServerName).toBe("github");
    expect(tool.mcpToolName).toBe("search_issues");
  });

  test("agentId from envelope is preserved on the tool item", () => {
    const counter: IdCounter = { next: 1 };
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        toolEvent(
          "tool.execution_start",
          { toolCallId: "call-1", toolName: "view" },
          { agentId: "sub-agent-7" },
        ),
      ],
      counter,
    );

    const tool = result.items[0];
    if (tool.kind !== "tool") throw new Error("expected tool item");
    expect(tool.agentId).toBe("sub-agent-7");
  });

  test("partialOutput is capped to avoid runaway memory", () => {
    const counter: IdCounter = { next: 1 };
    const huge = "x".repeat(TOOL_OUTPUT_CAP_BYTES + 5_000);
    const result = processEvents(
      [],
      defaultAmbient(),
      [
        toolEvent("tool.execution_start", {
          toolCallId: "call-1",
          toolName: "shell",
        }),
        toolEvent("tool.execution_partial_result", {
          toolCallId: "call-1",
          partialOutput: huge,
        }),
      ],
      counter,
    );

    const tool = result.items[0];
    if (tool.kind !== "tool") throw new Error("expected tool item");
    expect(tool.partialOutput.length).toBeLessThan(huge.length);
    expect(tool.partialOutput).toContain("output truncated");
  });
});
