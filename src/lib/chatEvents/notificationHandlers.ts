// Handlers for permission / user-input / elicitation events.
//
// The reducer only tracks "is something blocking this session right
// now?" via `ambient.pendingRequest`. The actual "accept / deny"
// surface is a separate ticket (real permission UX); for now we
// surface the state so:
//   - the composer banner in ChatWindow.vue shows what's blocking
//   - ChatTab + SessionsManager row paint a status dot
//   - sessionsStore fires an OS notification when the user isn't on
//     this session's panel
//
// All three event families have the same shape for our purposes —
// `.requested` arrives with a human-readable summary, `.completed`
// clears it. We don't try to match request IDs because the SDK
// always fires `_completed` for the same channel the `_requested`
// came from.

import { pickString } from "../chatEvents";
import type { Handler } from "./context";

function describePermission(data: unknown): string {
  // The SDK ships permission requests with shapes like
  // `{ tool, summary }` or `{ tool, args }`. Cheap human-readable
  // fallback chain: summary > tool > "Tool wants permission".
  return (
    pickString(data, ["summary", "description", "message"]) ||
    pickString(data, ["tool", "toolName"]) ||
    "Tool wants permission"
  );
}

function describeInput(data: unknown): string {
  return (
    pickString(data, ["prompt", "summary", "message", "description"]) ||
    "Awaiting input"
  );
}

function describeElicitation(data: unknown): string {
  return (
    pickString(data, ["prompt", "summary", "message", "description", "url"]) ||
    "Awaiting input"
  );
}

export const notificationHandlers: Record<string, Handler> = {
  "permission.requested": (ctx, data) => {
    ctx.ambient.pendingRequest = {
      type: "permission",
      message: describePermission(data),
    };
  },
  "permission.completed": (ctx) => {
    if (ctx.ambient.pendingRequest?.type === "permission") {
      ctx.ambient.pendingRequest = null;
    }
  },

  "user_input.requested": (ctx, data) => {
    ctx.ambient.pendingRequest = {
      type: "userInput",
      message: describeInput(data),
    };
  },
  "user_input.completed": (ctx) => {
    if (ctx.ambient.pendingRequest?.type === "userInput") {
      ctx.ambient.pendingRequest = null;
    }
  },

  "elicitation.requested": (ctx, data) => {
    ctx.ambient.pendingRequest = {
      type: "elicitation",
      message: describeElicitation(data),
    };
  },
  "elicitation.completed": (ctx) => {
    if (ctx.ambient.pendingRequest?.type === "elicitation") {
      ctx.ambient.pendingRequest = null;
    }
  },
};
