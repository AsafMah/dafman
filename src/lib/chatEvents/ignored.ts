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
  // Elicitation / user-input UX (URL elicitation, MCP OAuth prompts)
  // are now surfaced via the notification handlers + ambient.pendingRequest,
  // not here. permission.* / user_input.* / elicitation.* are NOT in
  // IGNORED_EVENTS anymore — see `notificationHandlers.ts`.
  // External tool registration — we don't ship any yet.
  "external_tool.requested",
  "external_tool.completed",
  // TUI slash-command lifecycle (not relevant in the desktop UI).
  "command.queued",
  "command.execute",
  "command.completed",
  // 19c: subagent.started/.completed/.failed are now handled INLINE
  // by `processEvents` (they drive nested SubagentChatItem
  // lifecycle), so they're neither in IGNORED nor in HANDLED_EVENT_TYPES.
  // subagent.selected/.deselected continue to live in
  // sessionMetaHandlers — those are the session-level picker events.
  "hook.start",
  "hook.end",
  "sampling.requested",
  "sampling.completed",
  "mcp.oauth_required",
  "mcp.oauth_completed",
]);
