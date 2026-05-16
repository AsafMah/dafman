// Friendly two-word aliases for session ids (e.g. `apple-window`).
//
// Tiny inline wordlists -- no extra deps. 64 adjectives x 64 nouns gives
// 4096 combinations, more than enough for the foreseeable number of
// concurrent sessions in a single client. The alias is purely cosmetic;
// the real SDK-assigned session id is what flows through IPC.

const ADJECTIVES = [
  "amber", "azure", "bold", "brave", "brisk", "bronze", "calm", "clever",
  "cosmic", "crimson", "crystal", "curious", "daring", "dawn", "deep", "eager",
  "earnest", "ember", "fair", "fierce", "forest", "frost", "gentle", "gleaming",
  "glowing", "golden", "grand", "happy", "hidden", "humble", "icy", "iron",
  "ivory", "jade", "keen", "kind", "lively", "lucky", "lunar", "merry",
  "misty", "mossy", "noble", "nimble", "open", "orange", "pale", "patient",
  "polar", "proud", "quick", "quiet", "rapid", "rosy", "royal", "ruby",
  "rustic", "sage", "scarlet", "silent", "silver", "snowy", "solar", "soft",
];

const NOUNS = [
  "anchor", "apple", "arrow", "atlas", "badger", "basket", "beacon", "bird",
  "branch", "bridge", "brook", "canyon", "castle", "cedar", "cliff", "cloud",
  "comet", "compass", "coral", "crane", "crystal", "delta", "ember", "falcon",
  "feather", "fern", "field", "fjord", "flame", "forest", "fox", "garden",
  "glacier", "grove", "harbor", "harvest", "hawk", "heron", "horizon", "isle",
  "lantern", "ledge", "lily", "lotus", "marsh", "meadow", "mesa", "moon",
  "mountain", "oak", "ocean", "orchid", "otter", "owl", "pebble", "petal",
  "pine", "pond", "raven", "reef", "ridge", "river", "stone", "willow",
];

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

/// Returns a friendly two-word alias like `"amber-falcon"`.
///
/// Accepts an optional RNG for testability; defaults to `Math.random`.
export function generateSessionAlias(rng: () => number = Math.random): string {
  return `${pick(ADJECTIVES, rng)}-${pick(NOUNS, rng)}`;
}
