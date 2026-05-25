// Session lifecycle handlers — idle / error.
//
// `session.idle` is the SDK's "I'm done thinking, ready for input"
// signal. The caller clears its "sending" flag on the leading edge
// of this event (see `ChatWindow.vue`'s `processEvents` consumer).
//
// `session.error` surfaces backend-side failures as a red system
// item AND flips the dispatcher's `error: true` so the caller can
// also toast it. The reducer doesn't shut anything down — the SDK
// handles its own retry / disconnect lifecycle.

import { pickString } from '@/lib/chatEvents/helpers';
import type { Handler } from '@/lib/chatEvents/context';

export const lifecycleHandlers: Record<string, Handler> = {
  'session.idle': (ctx) => {
    ctx.setIdle();

    if (ctx.ambient.sawTurnBoundary) ctx.ambient.turnActive = false;

    ctx.ambient.intent = null;
  },

  'session.error': (ctx, data) => {
    const message = pickString(data, ['message']) || 'Unknown session error';

    ctx.pushSystem(`Session error: ${message}`, 'error');
    ctx.setError();
    ctx.ambient.turnActive = false;
    ctx.ambient.intent = null;
  },
};
