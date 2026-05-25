// Turn boundary + intent handlers.
//
// `assistant.turn_start` / `assistant.turn_end` drive the
// "thinking…" spinner via `ambient.turnActive`. `sawTurnBoundary`
// flips on the first start/end so the caller knows it can trust
// `turnActive` going forward (older SDKs / non-streaming models that
// never emit boundaries fall back to a heuristic).
//
// `assistant.intent` is a short "what I'm doing now" hint surfaced
// above the streaming bubble; cleared on turn_end.

import { pickString } from './helpers';
import type { Handler } from './context';

export const turnHandlers: Record<string, Handler> = {
  'assistant.turn_start': (ctx) => {
    ctx.ambient.turnActive = true;
    ctx.ambient.sawTurnBoundary = true;
    ctx.ambient.intent = null;
  },

  'assistant.turn_end': (ctx) => {
    ctx.ambient.turnActive = false;
    ctx.ambient.sawTurnBoundary = true;
    ctx.ambient.intent = null;
  },

  'assistant.intent': (ctx, data) => {
    const intent = pickString(data, ['intent']);

    if (intent) ctx.ambient.intent = intent;
  },
};
