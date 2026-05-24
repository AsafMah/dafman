// Clamp or reject a context-token limit value.
//
// The SDK occasionally reports implausible values (negative, zero, or
// enormous). Returns the value unchanged if it's positive and within
// the plausible range; returns null otherwise.

const MAX_PLAUSIBLE_CONTEXT_TOKENS = 500_000;

export function normalizeContextLimit(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value > MAX_PLAUSIBLE_CONTEXT_TOKENS) return null;
  return value;
}
