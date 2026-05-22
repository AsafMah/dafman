/**
 * Color helpers — shared between chat panes and other accent-using UI.
 *
 * See `plans/plan-messagingAndUx.prompt.md` ("session accent color") and
 * `plans/plan-architecture.prompt.md` (lib/color.ts).
 */

/**
 * Curated palette of 12 visually-distinct hues. Tuned for good contrast
 * against both light and dark PrimeVue surfaces. Cycled by creation index
 * so the first 12 sessions in a client are always maximally distinct
 * (the previous id-hashed strategy regularly produced near-identical
 * colours for adjacent sessions).
 */
const PALETTE = [
  "hsl(  4, 78%, 56%)", // red
  "hsl( 28, 90%, 55%)", // orange
  "hsl( 48, 92%, 50%)", // amber
  "hsl( 84, 60%, 48%)", // lime
  "hsl(150, 60%, 42%)", // emerald
  "hsl(178, 65%, 42%)", // teal
  "hsl(200, 80%, 52%)", // sky
  "hsl(225, 75%, 60%)", // indigo
  "hsl(262, 65%, 60%)", // violet
  "hsl(295, 60%, 56%)", // purple
  "hsl(328, 75%, 58%)", // pink
  "hsl(  0,  0%, 52%)", // slate
];

/// Picks one of the curated palette colours by creation index.
export function accentForIndex(index: number): string {
  const slot = ((index % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[slot] as string;
}
