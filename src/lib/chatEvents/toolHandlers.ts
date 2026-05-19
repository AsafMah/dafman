// Tool-call handlers. Tool items are keyed by `toolCallId`; status
// transitions are monotonic — once a tool reaches `success` or
// `error` we don't regress to `running` even if a delayed `start` /
// `user_requested` event arrives. Result-content priority is
// `result.detailedContent ?? result.content` because the SDK's
// `content` is LLM-truncated while `detailedContent` is the full
// UI/timeline blob.
//
// `_partial_result` accumulates streamed output (clamped to
// TOOL_OUTPUT_CAP_BYTES); `_progress` overwrites the latest progress
// message (no accumulation — that's an MCP-style status line).

import { clampOutput, pickString } from "../chatEvents";
import type { Handler } from "./context";

// Shared between `tool.user_requested` and `tool.execution_start` —
// they have identical wire shapes for our purposes.
const onToolStart: Handler = (ctx, data, payload) => {
  const toolCallId = pickString(data, ["toolCallId"]);
  const toolName = pickString(data, ["toolName"]);
  if (!toolCallId) return;
  const item = ctx.upsertTool(toolCallId, toolName || undefined);
  if (item.kind !== "tool") return;
  if (toolName) item.toolName = toolName;
  const args = (data as Record<string, unknown>).arguments;
  if (args && typeof args === "object") {
    item.args = args as Record<string, unknown>;
  }
  const mcpServer = pickString(data, ["mcpServerName"]);
  if (mcpServer) item.mcpServerName = mcpServer;
  const mcpTool = pickString(data, ["mcpToolName"]);
  if (mcpTool) item.mcpToolName = mcpTool;
  if (payload.agentId) item.agentId = payload.agentId;
  // Never overwrite a terminal status — late `start` events can
  // arrive after `complete` in pathological ordering. (Currently a
  // no-op assignment; kept explicit so the invariant reads in code.)
  if (item.status === "running") item.status = "running";
};

export const toolHandlers: Record<string, Handler> = {
  "tool.user_requested": onToolStart,
  "tool.execution_start": onToolStart,

  "tool.execution_partial_result": (ctx, data) => {
    const toolCallId = pickString(data, ["toolCallId"]);
    const partial = pickString(data, ["partialOutput"]);
    if (!toolCallId || !partial) return;
    const item = ctx.upsertTool(toolCallId);
    if (item.kind !== "tool") return;
    item.partialOutput = clampOutput(item.partialOutput + partial);
  },

  "tool.execution_progress": (ctx, data) => {
    const toolCallId = pickString(data, ["toolCallId"]);
    const progress = pickString(data, ["progressMessage"]);
    if (!toolCallId) return;
    const item = ctx.upsertTool(toolCallId);
    if (item.kind !== "tool") return;
    if (progress) item.progressMessage = progress;
  },

  "tool.execution_complete": (ctx, data) => {
    const toolCallId = pickString(data, ["toolCallId"]);
    if (!toolCallId) return;
    const item = ctx.upsertTool(toolCallId);
    if (item.kind !== "tool") return;
    const success = (data as { success?: unknown }).success === true;
    item.status = success ? "success" : "error";
    const result = (data as { result?: unknown }).result;
    if (result && typeof result === "object") {
      const detailed = pickString(result, ["detailedContent", "content"]);
      if (detailed) item.resultContent = clampOutput(detailed);
    }
    const err = (data as { error?: unknown }).error;
    if (err && typeof err === "object") {
      const message = pickString(err, ["message"]);
      if (message) item.errorMessage = message;
      const code = pickString(err, ["code"]);
      if (code) item.errorCode = code;
    }
  },
};
