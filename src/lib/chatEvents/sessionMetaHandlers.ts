// Session-metadata handlers — title, model, usage.
//
// `session.model_change` drives the "Model changed" toast and
// `ambient.model` / `.reasoningEffort` (header pill). Toast
// suppression:
//   - replay (`!isLive`) → no toast (already happened)
//   - initial-setup events without `previousModel` → no toast
//   - identical model+effort signature as the last toasted change
//     → no toast (the SDK can emit duplicate events on resume)

import { pickNumber, pickString } from "../chatEvents";
import type { Handler } from "./context";

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
};

function mergeUsage(
  ctx: Parameters<Handler>[0],
  data: unknown,
): void {
  const current = pickNumber(data, ["currentTokens", "inputTokens"]);
  const limit = pickNumber(data, ["tokenLimit"]);
  if (current !== null && limit !== null) {
    ctx.ambient.usage = { currentTokens: current, tokenLimit: limit };
  } else if (current !== null && ctx.ambient.usage) {
    ctx.ambient.usage = { ...ctx.ambient.usage, currentTokens: current };
  }
}
