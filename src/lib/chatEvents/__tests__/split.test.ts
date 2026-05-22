import { describe, expect, test } from "bun:test";
import { calloutHandlers } from "../calloutHandlers";
import { IGNORED_EVENTS } from "../ignored";
import { lifecycleHandlers } from "../lifecycleHandlers";
import { messageHandlers } from "../messageHandlers";
import { notificationHandlers } from "../notificationHandlers";
import { reasoningHandlers } from "../reasoningHandlers";
import { sessionMetaHandlers } from "../sessionMetaHandlers";
import { toolHandlers } from "../toolHandlers";
import { turnHandlers } from "../turnHandlers";
import { HANDLED_EVENT_TYPES } from "../../chatEvents";

const FAMILIES: Array<[string, Record<string, unknown>]> = [
  ["message", messageHandlers],
  ["reasoning", reasoningHandlers],
  ["tool", toolHandlers],
  ["turn", turnHandlers],
  ["sessionMeta", sessionMetaHandlers],
  ["callout", calloutHandlers],
  ["lifecycle", lifecycleHandlers],
  ["notification", notificationHandlers],
];

describe("chatEvents — split invariants", () => {
  test("no two family modules claim the same event type", () => {
    const owner: Record<string, string> = {};
    const collisions: Array<{
      eventType: string;
      first: string;
      second: string;
    }> = [];
    for (const [family, map] of FAMILIES) {
      for (const eventType of Object.keys(map)) {
        if (owner[eventType]) {
          collisions.push({
            eventType,
            first: owner[eventType],
            second: family,
          });
        } else {
          owner[eventType] = family;
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  test("handled set and ignored set are disjoint", () => {
    const overlap: string[] = [];
    for (const eventType of HANDLED_EVENT_TYPES) {
      if (IGNORED_EVENTS.has(eventType)) overlap.push(eventType);
    }
    expect(overlap).toEqual([]);
  });

  test("every documented SDK event type is either handled or ignored", () => {
    const KNOWN_SDK_EVENTS = [
      "assistant.message_start",
      "assistant.message_delta",
      "assistant.message",
      "assistant.streaming_delta",
      "assistant.reasoning_delta",
      "assistant.reasoning",
      "user.message",
      "system.message",
      "assistant.turn_start",
      "assistant.turn_end",
      "assistant.intent",
      "tool.user_requested",
      "tool.execution_start",
      "tool.execution_partial_result",
      "tool.execution_progress",
      "tool.execution_complete",
      "session.title_changed",
      "session.model_change",
      "session.usage_info",
      "assistant.usage",
      "session.info",
      "session.warning",
      "system.notification",
      "session.truncation",
      "session.compaction_start",
      "session.compaction_complete",
      "model.call_failure",
      "session.idle",
      "session.error",
      "session.start",
      "session.resume",
      "session.shutdown",
      "session.tools_updated",
      "session.skills_loaded",
      "session.custom_agents_updated",
      "session.mcp_servers_loaded",
      "session.mcp_server_status_changed",
      "session.extensions_loaded",
      "session.context_changed",
      "pending_messages.modified",
      "permission.requested",
      "permission.completed",
      "user_input.requested",
      "user_input.completed",
      "elicitation.requested",
      "elicitation.completed",
      "external_tool.requested",
      "external_tool.completed",
      "command.queued",
      "command.execute",
      "command.completed",
      "subagent.started",
      "subagent.completed",
      "subagent.failed",
      "subagent.selected",
      "subagent.deselected",
      "hook.start",
      "hook.end",
      "sampling.requested",
      "sampling.completed",
      "mcp.oauth_required",
      "mcp.oauth_completed",
    ];
    const untriaged = KNOWN_SDK_EVENTS.filter(
      (e) =>
        !HANDLED_EVENT_TYPES.has(e) &&
        !IGNORED_EVENTS.has(e) &&
        // 19c: subagent.started/.completed/.failed are handled inline
        // by processEvents (they drive the SubagentChatItem lifecycle),
        // so they are neither in HANDLED_EVENT_TYPES nor IGNORED_EVENTS.
        !INLINE_HANDLED.has(e),
    );
    expect(untriaged).toEqual([]);
  });
});

/// 19c inline-handled event types — drive nested SubagentChatItem
/// lifecycle in `processEvents`. Exempt from the "every event is
/// handled or ignored" completeness check.
const INLINE_HANDLED: ReadonlySet<string> = new Set([
  "subagent.started",
  "subagent.completed",
  "subagent.failed",
]);

describe("chatEvents — family ownership", () => {
  test("message handlers own assistant.message* + user.message", () => {
    expect(Object.keys(messageHandlers).sort()).toEqual([
      "assistant.message",
      "assistant.message_delta",
      "assistant.message_start",
      "user.message",
    ]);
  });

  test("reasoning handlers own assistant.reasoning*", () => {
    expect(Object.keys(reasoningHandlers).sort()).toEqual([
      "assistant.reasoning",
      "assistant.reasoning_delta",
    ]);
  });

  test("tool handlers own tool.*", () => {
    expect(Object.keys(toolHandlers).sort()).toEqual([
      "tool.execution_complete",
      "tool.execution_partial_result",
      "tool.execution_progress",
      "tool.execution_start",
      "tool.user_requested",
    ]);
  });

  test("turn handlers own assistant.turn_*/intent", () => {
    expect(Object.keys(turnHandlers).sort()).toEqual([
      "assistant.intent",
      "assistant.turn_end",
      "assistant.turn_start",
    ]);
  });

  test("sessionMeta handlers own title/model/usage + subagent.selected/deselected", () => {
    expect(Object.keys(sessionMetaHandlers).sort()).toEqual([
      "assistant.usage",
      "session.model_change",
      "session.title_changed",
      "session.usage_info",
      "subagent.deselected",
      "subagent.selected",
    ]);
  });

  test("callout handlers own info/warning/notification/truncation/compaction/model.call_failure", () => {
    expect(Object.keys(calloutHandlers).sort()).toEqual([
      "model.call_failure",
      "session.compaction_complete",
      "session.compaction_start",
      "session.info",
      "session.truncation",
      "session.warning",
      "system.notification",
    ]);
  });

  test("lifecycle handlers own idle/error", () => {
    expect(Object.keys(lifecycleHandlers).sort()).toEqual([
      "session.error",
      "session.idle",
    ]);
  });

  test("notification handlers own permission/user_input/elicitation .requested+.completed + dafman.pending_request/_response", () => {
    expect(Object.keys(notificationHandlers).sort()).toEqual([
      "dafman.pending_request",
      "dafman.pending_response",
      "elicitation.completed",
      "elicitation.requested",
      "permission.completed",
      "permission.requested",
      "user_input.completed",
      "user_input.requested",
    ]);
  });
});
