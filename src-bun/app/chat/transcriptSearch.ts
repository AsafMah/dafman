/// Pure transcript-matching helpers for Phase 1 cross-session search
/// (issue #241). Extracted from `SessionRegistry.searchTranscripts` so
/// the per-event extraction / snippet logic stays focused and testable
/// without a live session — the registry only owns the cross-session
/// iteration + global cap.

import type { TranscriptMatch } from '../../rpc';

/// Newest events scanned per session. Bounds work for very long
/// transcripts (Phase 1 searches the live tail only).
const MAX_EVENTS_PER_SESSION = 2000;

/// Characters of leading/trailing context kept around the match in the
/// rendered snippet.
const CONTEXT_CHARS = 150;

type Searchable = { role: TranscriptMatch['role']; text: string };

/// The transcript event types we index, mapped to the role we surface
/// and the `data` field that holds the searchable text. Collapses what
/// were three near-identical `if` branches into one table.
const SEARCHABLE_EVENTS: Record<string, { role: TranscriptMatch['role']; key: string }> = {
  'user.message': { role: 'user', key: 'message' },
  'assistant.message_complete': { role: 'assistant', key: 'text' },
  'system.notification': { role: 'system', key: 'message' },
};

/// Pull the {role, text} out of one raw transcript event, or null when
/// the event is not a searchable kind / carries no string text.
function extractSearchable(raw: { type?: string; data?: unknown }): Searchable | null {
  const field = SEARCHABLE_EVENTS[typeof raw.type === 'string' ? raw.type : ''];

  if (!field) return null;

  const data = raw.data;

  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;

  const value = (data as Record<string, unknown>)[field.key];

  return typeof value === 'string' && value ? { role: field.role, text: value } : null;
}

/// Build the `<<match>>`-delimited context snippet for the first
/// occurrence of the query in `text`. Ellipses mark elided context.
function buildSnippet(text: string, matchPos: number, queryLen: number): string {
  const snipStart = Math.max(0, matchPos - CONTEXT_CHARS);
  const snipEnd = Math.min(text.length, matchPos + queryLen + CONTEXT_CHARS);
  const pre = (snipStart > 0 ? '\u2026' : '') + text.slice(snipStart, matchPos);
  const match = text.slice(matchPos, matchPos + queryLen);
  const post = text.slice(matchPos + queryLen, snipEnd) + (snipEnd < text.length ? '\u2026' : '');

  return `${pre}<<${match}>>${post}`;
}

/// Scan one session's events for `lowerQuery` (already lower-cased),
/// returning up to `maxMatches` matches. `eventIndex` is the absolute
/// index into `events` so the renderer can reveal the exact message.
/// Only the newest `MAX_EVENTS_PER_SESSION` events are scanned.
export function matchSessionEvents(
  events: ReadonlyArray<unknown>,
  lowerQuery: string,
  queryLen: number,
  maxMatches: number,
): TranscriptMatch[] {
  if (maxMatches <= 0 || !lowerQuery) return [];

  const startOffset =
    events.length > MAX_EVENTS_PER_SESSION ? events.length - MAX_EVENTS_PER_SESSION : 0;
  const matches: TranscriptMatch[] = [];

  for (let i = startOffset; i < events.length; i++) {
    if (matches.length >= maxMatches) break;

    const raw = events[i] as { type?: string; data?: unknown; timestamp?: unknown };
    const searchable = extractSearchable(raw);

    if (!searchable) continue;

    const matchPos = searchable.text.toLowerCase().indexOf(lowerQuery);

    if (matchPos === -1) continue;

    const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : undefined;

    matches.push({
      eventIndex: i,
      role: searchable.role,
      snippet: buildSnippet(searchable.text, matchPos, queryLen),
      ...(timestamp !== undefined ? { timestamp } : {}),
    });
  }

  return matches;
}
