/// Reactive ref backed by localStorage with throttled writes,
/// optional validation, and an optional value cap.
///
/// Why not pinia-plugin-persistedstate? Because terminal scrollback
/// buffers can be hundreds of KB and the plugin runs JSON.stringify
/// on every mutation by default, with no built-in throttle or cap.
/// This helper gives us both, plus per-key validation so a corrupt
/// stored value can't crash the store on hydration.
///
/// Behaviour:
/// - Hydrates synchronously on construction from `localStorage[key]`.
/// - Falls back to `defaultValue` on any of: key missing, malformed
///   JSON, validator returning null.
/// - Writes are throttled by `throttleMs` (default 0 = synchronous).
///   The last write wins; intermediate values are dropped.
/// - If `cap` is provided, returns the value passed through `cap`
///   before writing (useful for trimming buffers).
/// - All errors are swallowed — persistence is best-effort. This is
///   a renderer-side convenience, not a source of truth.

import { ref, watch, type Ref } from 'vue';

export interface UsePersistedRefOptions<T> {
  /// Defensive deserialiser. Return the value to accept, or null to
  /// fall back to the default. Defaults to passthrough.
  validate?: (parsed: unknown) => T | null;
  /// Optional transformer applied to every value before write.
  /// Useful for capping buffer length / pruning keys.
  cap?: (value: T) => T;
  /// Coalesce rapid writes into one localStorage.setItem every
  /// `throttleMs`. 0 = synchronous (matches the prior hand-rolled
  /// pattern). Use >0 for high-frequency mutations like terminal
  /// scrollback.
  throttleMs?: number;
}

export function usePersistedRef<T>(
  key: string,
  defaultValue: T,
  options: UsePersistedRefOptions<T> = {},
): Ref<T> {
  const { validate, cap, throttleMs = 0 } = options;

  const initial = readFromStorage<T>(key, defaultValue, validate);
  const state = ref(initial) as Ref<T>;

  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (pending === null) return;

    const value = cap ? cap(pending) : pending;

    pending = null;
    timer = null;

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* persistence is best-effort */
    }
  }

  watch(
    state,
    (next) => {
      if (throttleMs === 0) {
        try {
          const value = cap ? cap(next) : next;

          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* persistence is best-effort */
        }

        return;
      }

      pending = next;

      timer ??= setTimeout(flush, throttleMs);
    },
    { deep: true },
  );

  return state;
}

function readFromStorage<T>(
  key: string,
  defaultValue: T,
  validate?: (parsed: unknown) => T | null,
): T {
  try {
    const raw = localStorage.getItem(key);

    if (raw === null) return defaultValue;

    const parsed: unknown = JSON.parse(raw);

    if (validate) {
      const validated = validate(parsed);

      return validated ?? defaultValue;
    }

    return parsed as T;
  } catch {
    return defaultValue;
  }
}
