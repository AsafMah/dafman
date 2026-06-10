import { describe, expect, test } from 'bun:test';
import { matchSessionEvents } from '../app/chat/transcriptSearch';

/// Minimal raw transcript-event shape, matching what `getEvents()` returns.
/// Bodies live on `data.content` (the canonical CLI field) — see
/// `src/lib/chatEvents/messageHandlers.ts` and the fake client.
function userMsg(text: string): { type: string; data: Record<string, unknown> } {
  return { type: 'user.message', data: { messageId: 'u1', content: text } };
}

function assistantMsg(text: string): { type: string; data: Record<string, unknown> } {
  return { type: 'assistant.message', data: { messageId: 'a1', content: text } };
}

function systemMsg(text: string): { type: string; data: Record<string, unknown> } {
  return { type: 'system.notification', data: { content: text } };
}

describe('matchSessionEvents', () => {
  test('matches across user / assistant / system messages with correct roles', () => {
    const events = [
      userMsg('please find the zebrafish'),
      assistantMsg('ok: located the zebrafish sample'),
      systemMsg('zebrafish job complete'),
    ];

    const matches = matchSessionEvents(events, 'zebrafish', 'zebrafish'.length, 50);

    expect(matches.map((m) => m.role)).toEqual(['user', 'assistant', 'system']);
    expect(matches.map((m) => m.eventIndex)).toEqual([0, 1, 2]);
  });

  test('is case-insensitive and wraps the hit in << >> with surrounding context', () => {
    const matches = matchSessionEvents(
      [userMsg('The Quick Brown Fox')],
      'quick',
      'quick'.length,
      50,
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.snippet).toContain('<<Quick>>');
  });

  test('returns nothing when the query is absent', () => {
    const matches = matchSessionEvents([userMsg('hello world')], 'absent', 'absent'.length, 50);

    expect(matches).toEqual([]);
  });

  test('ignores non-searchable event types (tool calls, deltas, etc.)', () => {
    const events = [
      { type: 'assistant.message_delta', data: { content: 'zebrafish streaming chunk' } },
      { type: 'tool.call', data: { name: 'zebrafish', args: {} } },
      { type: 'assistant.turn_complete', data: {} },
    ];

    expect(matchSessionEvents(events, 'zebrafish', 'zebrafish'.length, 50)).toEqual([]);
  });

  test('falls back to data.text / data.message when content is absent', () => {
    const events = [
      { type: 'user.message', data: { text: 'find zebrafish via text field' } },
      { type: 'assistant.message', data: { message: 'zebrafish via message field' } },
    ];

    expect(matchSessionEvents(events, 'zebrafish', 'zebrafish'.length, 50)).toHaveLength(2);
  });

  test('tolerates malformed / missing data without throwing', () => {
    const events = [
      { type: 'user.message', data: null },
      { type: 'user.message', data: ['array'] },
      { type: 'user.message', data: { content: 42 } },
      { type: 'user.message' },
      { type: 'user.message', data: { content: 'real zebrafish' } },
    ] as unknown[];

    const matches = matchSessionEvents(events, 'zebrafish', 'zebrafish'.length, 50);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.eventIndex).toBe(4);
  });

  test('caps results at maxMatches and returns [] when budget is non-positive', () => {
    const events = Array.from({ length: 10 }, () => userMsg('zebrafish'));

    expect(matchSessionEvents(events, 'zebrafish', 'zebrafish'.length, 3)).toHaveLength(3);
    expect(matchSessionEvents(events, 'zebrafish', 'zebrafish'.length, 0)).toEqual([]);
  });

  test('eventIndex stays absolute when only the newest events are scanned', () => {
    // > MAX_EVENTS_PER_SESSION (2000) events; the match sits near the end.
    const events: Array<{ type: string; data: Record<string, unknown> }> = Array.from(
      { length: 2100 },
      () => userMsg('noise'),
    );
    events[2050] = userMsg('the zebrafish marker');

    const matches = matchSessionEvents(events, 'zebrafish', 'zebrafish'.length, 50);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.eventIndex).toBe(2050);
  });

  test('carries a string timestamp through and omits it otherwise', () => {
    const withTs = [
      { type: 'user.message', data: { content: 'zebrafish' }, timestamp: '2026-01-01T00:00:00Z' },
    ];
    const withoutTs = [userMsg('zebrafish')];

    expect(matchSessionEvents(withTs, 'zebrafish', 'zebrafish'.length, 50)[0]?.timestamp).toBe(
      '2026-01-01T00:00:00Z',
    );
    expect(
      matchSessionEvents(withoutTs, 'zebrafish', 'zebrafish'.length, 50)[0]?.timestamp,
    ).toBeUndefined();
  });
});
