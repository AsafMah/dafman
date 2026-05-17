import { describe, expect, test } from "bun:test";
import { defaultAmbient, processEvents, type IdCounter } from "../chatEvents";
import type { SessionEventPayload } from "../../ipc/types";

function event(data: Record<string, unknown>): SessionEventPayload {
  return {
    sessionId: "sess-1",
    eventType: "session.model_change",
    data,
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
});
