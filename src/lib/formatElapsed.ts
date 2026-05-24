// Terse human-readable elapsed duration from milliseconds.
//
// Precision drops at larger durations:
//   <1s → "123ms"
//   <1m → "45s"
//   <1h → "3m 12s"
//   ≥1h → "2h 15m"

export function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
