// Unit tests for `formatElapsed`, the duration helper shared by
// SubagentBlock / useSessionTasks / JobsPanel after Phase E.2.
//
// Per rubber-duck guidance for #3: targeted tests covering activeTimeMs,
// valid startedAt/completedAt, invalid dates, and the seconds/minutes/
// hours boundaries.

import { describe, expect, test } from 'bun:test';

import { formatElapsed } from '@/lib/formatElapsed';

describe('formatElapsed', () => {
  test('returns "" when no inputs resolve to a duration', () => {
    expect(formatElapsed({})).toBe('');
    expect(formatElapsed({ activeTimeMs: null })).toBe('');
    expect(formatElapsed({ startedAt: null })).toBe('');
  });

  test('prefers activeTimeMs over date-derived duration', () => {
    expect(formatElapsed({ activeTimeMs: 250 })).toBe('250ms');
    // startedAt + completedAt would give 1000ms but activeTimeMs wins.
    expect(
      formatElapsed({
        activeTimeMs: 250,
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
      }),
    ).toBe('250ms');
  });

  test('formats sub-second values in milliseconds', () => {
    expect(formatElapsed({ activeTimeMs: 0 })).toBe('0ms');
    expect(formatElapsed({ activeTimeMs: 500 })).toBe('500ms');
    expect(formatElapsed({ activeTimeMs: 999 })).toBe('999ms');
  });

  test('formats sub-minute values in whole seconds (rounded)', () => {
    expect(formatElapsed({ activeTimeMs: 1000 })).toBe('1s');
    expect(formatElapsed({ activeTimeMs: 1499 })).toBe('1s');
    expect(formatElapsed({ activeTimeMs: 1500 })).toBe('2s');
    expect(formatElapsed({ activeTimeMs: 59_000 })).toBe('59s');
  });

  test('formats sub-hour values as "Nm Ks"', () => {
    expect(formatElapsed({ activeTimeMs: 60_000 })).toBe('1m 0s');
    expect(formatElapsed({ activeTimeMs: 65_000 })).toBe('1m 5s');
    expect(formatElapsed({ activeTimeMs: 3_599_000 })).toBe('59m 59s');
  });

  test('formats hour+ values as "Nh Mm"', () => {
    expect(formatElapsed({ activeTimeMs: 3_600_000 })).toBe('1h 0m');
    expect(formatElapsed({ activeTimeMs: 3_660_000 })).toBe('1h 1m');
    expect(formatElapsed({ activeTimeMs: 7_320_000 })).toBe('2h 2m');
  });

  test('derives duration from startedAt + completedAt', () => {
    const ms = formatElapsed({
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
    });

    expect(ms).toBe('5s');
  });

  test('uses Date.now() when completedAt is absent', () => {
    const now = Date.now();
    const startedAt = new Date(now - 30_000).toISOString();
    const result = formatElapsed({ startedAt });
    // Approx 30s — allow 29s/30s/31s for test scheduling jitter.
    expect(['29s', '30s', '31s']).toContain(result);
  });

  test('returns "" on invalid startedAt', () => {
    expect(formatElapsed({ startedAt: 'not-a-date' })).toBe('');
    expect(
      formatElapsed({
        startedAt: 'not-a-date',
        completedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe('');
  });

  test('returns "" on invalid completedAt', () => {
    expect(
      formatElapsed({
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: 'not-a-date',
      }),
    ).toBe('');
  });

  test('activeTimeMs takes precedence even when also rejecting NaN', () => {
    expect(formatElapsed({ activeTimeMs: NaN, startedAt: 'not-a-date' })).toBe('');
  });
});
