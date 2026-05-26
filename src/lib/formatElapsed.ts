// formatElapsed — terse human-readable duration formatter shared by
// the three session/job/subagent UI surfaces. Extracted in Phase E.2
// per the 2026-05-26 rubber-duck (which flagged the original
// `useTaskAggregation` plan as a jscpd false positive — the actual
// duplicated code was this formatter, not aggregation).
//
// Output examples:
//   500 → "500ms"
//   5000 → "5s"
//   65000 → "1m 5s"
//   3700000 → "1h 1m"
//
// Returns `""` when neither input source resolves to a finite number
// — callers don't have to guard.

export interface FormatElapsedInput {
  /// Preferred direct duration. SDK task records ship this for
  /// long-running shells/agents; we use it when present.
  activeTimeMs?: number | null;
  /// ISO timestamp of when the work started. Used as a fallback
  /// when `activeTimeMs` isn't present.
  startedAt?: string | null;
  /// ISO timestamp of when the work completed. When absent we
  /// fall back to `Date.now()` so live durations tick.
  completedAt?: string | null;
}

export function formatElapsed(input: FormatElapsedInput): string {
  let ms: number | null = null;

  if (typeof input.activeTimeMs === 'number' && Number.isFinite(input.activeTimeMs)) {
    ms = input.activeTimeMs;
  } else if (input.startedAt) {
    const start = Date.parse(input.startedAt);
    const end = input.completedAt ? Date.parse(input.completedAt) : Date.now();

    if (Number.isFinite(start) && Number.isFinite(end)) ms = end - start;
  }

  if (ms === null) return '';

  if (ms < 1000) return `${ms}ms`;

  const s = Math.round(ms / 1000);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);
  const rem = s % 60;

  if (m < 60) return `${m}m ${rem}s`;

  const h = Math.floor(m / 60);

  return `${h}h ${m % 60}m`;
}
