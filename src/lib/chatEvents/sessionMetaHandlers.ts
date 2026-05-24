// Session-metadata handlers — title, model, usage.
//
// `session.model_change` drives the "Model changed" toast and
// `ambient.model` / `.reasoningEffort` (header pill). Toast
// suppression:
//   - replay (`!isLive`) → no toast (already happened)
//   - initial-setup events without `previousModel` → no toast
//   - identical model+effort signature as the last toasted change
//     → no toast (the SDK can emit duplicate events on resume)

import { pickNumber, pickString } from "./helpers";
import type { Handler } from "./context";
import { normalizeContextLimit } from "../normalizeContextLimit";

export const sessionMetaHandlers: Record<string, Handler> = {
  "session.title_changed": (ctx, data) => {
    const title = pickString(data, ["title"]);
    if (title) ctx.ambient.title = title;
  },

  "session.model_change": (ctx, data) => {
    const newModel = pickString(data, ["newModel"]);
    const prev = pickString(data, ["previousModel"]);
    const effort = pickString(data, ["reasoningEffort"]);
    const prevEffort = pickString(data, ["previousReasoningEffort"]);
    if (!newModel) return;
    ctx.ambient.model = newModel;
    if (effort) ctx.ambient.reasoningEffort = effort;
    if (!prev || !ctx.isLive) return;
    const key = [prev, newModel, prevEffort, effort].join("\0");
    if (ctx.ambient.lastModelChangeToastKey === key) return;
    const modelDetail = `${prev} → ${newModel}`;
    const detail = effort
      ? prevEffort && prevEffort !== effort
        ? `${modelDetail} (${prevEffort} → ${effort} effort)`
        : `${modelDetail} (${effort} effort)`
      : modelDetail;
    ctx.toasts.push({
      severity: "info",
      summary: "Model changed",
      detail,
    });
    ctx.ambient.lastModelChangeToastKey = key;
  },

  // Both events ship the same useful fields for us. `assistant.usage`
  // is the end-of-turn breakdown; `session.usage_info` is the
  // pre-turn / status snapshot. We merge both into `ambient.usage`.
  "session.usage_info": (ctx, data) => mergeUsage(ctx, data),
  "assistant.usage": (ctx, data) => mergeUsage(ctx, data),

  // 19a: per-session custom agent selection. Subagent.selected fires
  // when a custom agent is chosen for the session (either via our
  // `selectAgent` RPC or via the SDK's own /agent slash command).
  // Subagent.deselected fires when reverting to the default agent.
  // We mirror the choice into ambient.currentAgent so the header
  // chip + rail can render reactively without a follow-up RPC.
  //
  // NOTE: SDK emits `subagent.selected` for both session-level agent
  // selection AND for transient sub-agent delegation during a fleet
  // turn. We disambiguate by `agentName` presence: session-level
  // selection carries name+displayName; transient delegation carries
  // an instance id (parentToolCallId, agentInstanceId). When
  // agentName is missing we leave currentAgent unchanged — the
  // running-subagent concept is rendered separately in 19c.
  "subagent.selected": (ctx, data) => {
    const d = (data ?? {}) as {
      agentName?: unknown;
      agentDisplayName?: unknown;
      agentDescription?: unknown;
      agentPath?: unknown;
      parentToolCallId?: unknown;
    };
    if (typeof d.agentName !== "string") return;
    // Transient delegation events carry a parentToolCallId; session
    // selection does not. Skip the transient ones for the header chip.
    if (typeof d.parentToolCallId === "string" && d.parentToolCallId.length > 0) {
      return;
    }
    ctx.ambient.currentAgent = {
      name: d.agentName,
      displayName: typeof d.agentDisplayName === "string" ? d.agentDisplayName : d.agentName,
      description: typeof d.agentDescription === "string" ? d.agentDescription : "",
      ...(typeof d.agentPath === "string" ? { path: d.agentPath } : {}),
    };
  },

  "subagent.deselected": (ctx, _data) => {
    ctx.ambient.currentAgent = null;
  },
};

function mergeUsage(
  ctx: Parameters<Handler>[0],
  data: unknown,
): void {
  const current = pickNumber(data, ["currentTokens", "inputTokens"]);
  const rawLimit = pickNumber(data, ["tokenLimit"]);
  const limit = rawLimit === null ? null : normalizeContextLimit(rawLimit);
  if (current !== null && limit !== null) {
    ctx.ambient.usage = { currentTokens: current, tokenLimit: limit };
  } else if (current !== null && ctx.ambient.usage) {
    ctx.ambient.usage = { ...ctx.ambient.usage, currentTokens: current };
  }
}
