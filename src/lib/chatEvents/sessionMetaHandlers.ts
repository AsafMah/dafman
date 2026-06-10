// Session-metadata handlers — title, model, usage.
//
// `session.model_change` drives the "Model changed" toast and
// `ambient.model` / `.reasoningEffort` (header pill). Toast
// suppression:
//   - replay (`!isLive`) → no toast (already happened)
//   - initial-setup events without `previousModel` → no toast
//   - identical model+effort signature as the last toasted change
//     → no toast (the SDK can emit duplicate events on resume)

import { pickNumber } from '@/lib/chatEvents/helpers';
import { reduceSessionStatusEvent } from '@/lib/sessionStatus';
import type { Handler } from '@/lib/chatEvents/context';

const MAX_PLAUSIBLE_CONTEXT_TOKENS = 4_000_000;

function normalizeContextLimit(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;

  if (value > MAX_PLAUSIBLE_CONTEXT_TOKENS) return null;

  return value;
}

export const sessionMetaHandlers: Record<string, Handler> = {
  'session.title_changed': (ctx, _data, payload) => {
    const delta = reduceSessionStatusEvent(payload);

    if (delta?.kind === 'titleChanged') ctx.ambient.title = delta.title;
  },

  'session.model_change': (ctx, _data, payload) => {
    const delta = reduceSessionStatusEvent(payload);

    if (!delta || delta.kind !== 'modelChanged') return;

    ctx.ambient.model = delta.newModel;

    if (delta.reasoningEffort !== null) ctx.ambient.reasoningEffort = delta.reasoningEffort;

    if (!delta.previousModel || !ctx.isLive) return;

    const key = [
      delta.previousModel,
      delta.newModel,
      delta.previousReasoningEffort,
      delta.reasoningEffort,
    ].join('\0');

    if (ctx.ambient.lastModelChangeToastKey === key) return;

    const modelDetail = `${delta.previousModel} → ${delta.newModel}`;
    const detail = delta.reasoningEffort
      ? delta.previousReasoningEffort && delta.previousReasoningEffort !== delta.reasoningEffort
        ? `${modelDetail} (${delta.previousReasoningEffort} → ${delta.reasoningEffort} effort)`
        : `${modelDetail} (${delta.reasoningEffort} effort)`
      : modelDetail;

    ctx.toasts.push({
      severity: 'info',
      summary: 'Model changed',
      detail,
    });
    ctx.ambient.lastModelChangeToastKey = key;
  },

  // `session.usage_info` is the cumulative context-window snapshot and is the
  // sole source for the usage pill. `assistant.usage` fires for every LLM API
  // call (including sub-agent / mcp-sampling calls) and carries only per-call
  // `inputTokens`/`outputTokens` — NOT the cumulative `currentTokens`.
  // Wiring `assistant.usage` through `mergeUsage` used to overwrite the pill
  // with a single call's `inputTokens` (bug #219); it is now a no-op because
  // `mergeUsage` only reads `currentTokens`.
  'session.usage_info': (ctx, data) => mergeUsage(ctx, data),
  'assistant.usage': (ctx, data) => mergeUsage(ctx, data),

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
  'subagent.selected': (ctx, _data, payload) => {
    const delta = reduceSessionStatusEvent(payload);

    // delta is null for transient delegations (parentToolCallId present)
    // or events missing agentName — no-op in both cases.
    if (delta?.kind === 'currentAgentChanged') ctx.ambient.currentAgent = delta.agent;
  },

  'subagent.deselected': (ctx, _data, payload) => {
    const delta = reduceSessionStatusEvent(payload);

    if (delta?.kind === 'currentAgentChanged') ctx.ambient.currentAgent = delta.agent;
  },
};

function mergeUsage(ctx: Parameters<Handler>[0], data: unknown): void {
  const current = pickNumber(data, ['currentTokens']);
  const rawLimit = pickNumber(data, ['tokenLimit']);
  const limit = rawLimit === null ? null : normalizeContextLimit(rawLimit);

  if (current !== null && limit !== null) {
    ctx.ambient.usage = { currentTokens: current, tokenLimit: limit };
  } else if (current !== null && ctx.ambient.usage) {
    ctx.ambient.usage = { ...ctx.ambient.usage, currentTokens: current };
  }
}
