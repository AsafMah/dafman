// Inline-callout handlers. These surface SDK-emitted messages as
// `kind: "system"` items in the timeline (info / warn / error
// severity). Distinct from `assistant.*` so they're styled
// differently and never confused with model output.

import { pickNumber, pickString } from './helpers';
import type { ChatItem } from '../chatEvents';
import type { Handler } from './context';

const COMPACTION_START = 'Compacting conversation...';
const COMPACTION_COMPLETE = 'Compaction complete.';
const COMPACTION_FAILED_PREFIX = 'Compaction failed:';

function lastCompactionItem(items: ChatItem[]): ChatItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];

    if (item?.kind !== 'system') continue;

    if (
      item.text === COMPACTION_START ||
      item.text === COMPACTION_COMPLETE ||
      item.text.startsWith(COMPACTION_FAILED_PREFIX)
    ) {
      return item;
    }
  }

  return null;
}

/// Parse the CLI's two fork-info wording variants:
///   "Forked this session into <name>." → into
///   "Forked from <name>[ before event N] as <name>." → from
/// Returns the direction + the OTHER session's display name (i.e. the
/// one the user might want to click through to).
function parseForkInfo(
  message: string,
): { direction: 'into' | 'from'; referenceName: string } | null {
  const into = message.match(/^Forked this session into\s+(.+?)\s*(?:\.|$)/i);

  if (into && into[1]) {
    return { direction: 'into', referenceName: into[1].trim() };
  }

  const from = message.match(/^Forked from\s+(.+?)(?:\s+before\s+event\s+\S+)?\s+as\s+/i);

  if (from && from[1]) {
    return { direction: 'from', referenceName: from[1].trim() };
  }

  return null;
}

export const calloutHandlers: Record<string, Handler> = {
  'session.info': (ctx, data, payload) => {
    const message = pickString(data, ['message']);

    if (!message) return;

    const infoType = pickString(data, ['infoType']);

    if (infoType === 'fork') {
      // Dedupe by envelope eventId — the CLI re-emits the same
      // session.info on replay, so live + persisted both arrive on
      // the next session resume after a fork.
      if (payload.eventId) {
        const seen = ctx.items.find(
          (i) => i.kind === 'forkNotice' && i.eventId === payload.eventId,
        );

        if (seen) return;
      }

      const parsed = parseForkInfo(message);

      if (!parsed) return; // unknown wording — fall back below

      ctx.items.push({
        id: ctx.counter.next++,
        kind: 'forkNotice',
        ...(payload.eventId ? { eventId: payload.eventId } : {}),
        direction: parsed.direction,
        referenceName: parsed.referenceName,
      });

      return;
    }

    const tip = pickString(data, ['tip']);

    ctx.pushSystem(tip ? `${message} (${tip})` : message, 'info');
  },

  'session.warning': (ctx, data) => {
    const message = pickString(data, ['message']);

    if (message) ctx.pushSystem(message, 'warn');
  },

  'system.notification': (ctx, data) => {
    const content = pickString(data, ['content']);

    if (content) ctx.pushSystem(content, 'info');
  },

  'session.truncation': (ctx, data) => {
    const removed = pickNumber(data, ['messagesRemovedDuringTruncation']);

    ctx.pushSystem(
      removed ? `Context truncated (${removed} messages removed).` : 'Context truncated.',
      'info',
    );
  },

  'session.compaction_start': (ctx) => {
    const last = lastCompactionItem(ctx.items);

    if (last?.kind === 'system' && last.text === COMPACTION_START) return;

    ctx.pushSystem(COMPACTION_START, 'info');
  },

  'session.compaction_complete': (ctx, data) => {
    const err = pickString(data, ['errorMessage']);
    const text = err ? `Compaction failed: ${err}` : COMPACTION_COMPLETE;
    const last = lastCompactionItem(ctx.items);

    if (last?.kind === 'system' && last.text === text) return;

    ctx.pushSystem(text, err ? 'warn' : 'info');
  },

  'model.call_failure': (ctx, data) => {
    const errMsg = pickString(data, ['errorMessage']) || 'Model call failed';
    const status = pickNumber(data, ['statusCode']);

    ctx.pushSystem(status ? `${errMsg} (HTTP ${status})` : errMsg, 'error');
  },
};
