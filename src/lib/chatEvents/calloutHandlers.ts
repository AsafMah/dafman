// Inline-callout handlers. These surface SDK-emitted messages as
// `kind: "system"` items in the timeline (info / warn / error
// severity). Distinct from `assistant.*` so they're styled
// differently and never confused with model output.

import { pickNumber, pickString } from "../chatEvents";
import type { Handler } from "./context";

export const calloutHandlers: Record<string, Handler> = {
  "session.info": (ctx, data) => {
    const message = pickString(data, ["message"]);
    const tip = pickString(data, ["tip"]);
    if (message) ctx.pushSystem(tip ? `${message} (${tip})` : message, "info");
  },

  "session.warning": (ctx, data) => {
    const message = pickString(data, ["message"]);
    if (message) ctx.pushSystem(message, "warn");
  },

  "system.notification": (ctx, data) => {
    const content = pickString(data, ["content"]);
    if (content) ctx.pushSystem(content, "info");
  },

  "session.truncation": (ctx, data) => {
    const removed = pickNumber(data, ["messagesRemovedDuringTruncation"]);
    ctx.pushSystem(
      removed
        ? `Context truncated (${removed} messages removed).`
        : "Context truncated.",
      "info",
    );
  },

  "session.compaction_start": (ctx) => {
    ctx.pushSystem("Compacting conversation...", "info");
  },

  "session.compaction_complete": (ctx, data) => {
    const err = pickString(data, ["errorMessage"]);
    ctx.pushSystem(
      err ? `Compaction failed: ${err}` : "Compaction complete.",
      err ? "warn" : "info",
    );
  },

  "model.call_failure": (ctx, data) => {
    const errMsg =
      pickString(data, ["errorMessage"]) || "Model call failed";
    const status = pickNumber(data, ["statusCode"]);
    ctx.pushSystem(
      status ? `${errMsg} (HTTP ${status})` : errMsg,
      "error",
    );
  },
};
