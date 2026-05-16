/**
 * Color helpers — shared between chat panes and other accent-using UI.
 *
 * See `plans/plan-messagingAndUx.prompt.md` ("session accent color") and
 * `plans/plan-architecture.prompt.md` (lib/color.ts).
 */
/**
 * Deterministic FNV-1a-ish hash of a string. Returns an unsigned 32-bit int.
 *
 * Stable across runs and across platforms — used to derive per-session UI
 * accents that look the same every time a session is rendered.
 */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
/**
 * Picks an HSL color for a given session id. Hue is derived from the id hash;
 * saturation and lightness are tuned to look good against both light and dark
 * PrimeVue surfaces.
 */
export function accentForSession(sessionId: string): string {
  const hue = hashString(sessionId) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}
