// Events we explicitly know about but deliberately don't render
// (handled elsewhere or non-displayable). Kept as a Set rather than
// switch cases so the completeness check in the test suite can
// assert that every event type the SDK emits is either handled or
// in this set — no silent drops.
//
// When you add a handler in another file, REMOVE the event type
// from this set. When you observe a new SDK event type, add it
// here (with a comment explaining why it's ignored) OR add a
// handler.

export const IGNORED_EVENTS: ReadonlySet<string> = new Set([
  // Duplicates the message_delta stream.
  "assistant.streaming_delta",
  // Raw system prompt; not user-facing.
  "system.message",
  // Catalog updates surfaced via sidebars (Sessions Manager etc.),
  // not the chat timeline.
  "session.tools_updated",
  "session.skills_loaded",
  "session.custom_agents_updated",
  "session.mcp_servers_loaded",
  "session.mcp_server_status_changed",
  "session.extensions_loaded",
  "pending_messages.modified",
  "session.context_changed",
  // Boundary events used by the bun-side resume path, not the
  // renderer.
  "session.start",
  "session.resume",
  "session.shutdown",

  // ---- Pending UX, intentionally not surfaced as system items ----
  // Permission modal will handle these.
  "permission.requested",
  "permission.completed",
  // Elicitation / user-input UX (URL elicitation, MCP OAuth prompts)
  // will handle these.
  "user_input.requested",
  "user_input.completed",
  "elicitation.requested",
  "elicitation.completed",
  // External tool registration — we don't ship any yet.
  "external_tool.requested",
  "external_tool.completed",
  // TUI slash-command lifecycle (not relevant in the desktop UI).
  "command.queued",
  "command.execute",
  "command.completed",
  // Sub-agents / hooks / sampling / MCP OAuth — surfaced later.
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
]);
