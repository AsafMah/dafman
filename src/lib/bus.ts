/// Typed in-renderer event bus.
///
/// Replaces the previous `window.dispatchEvent(new CustomEvent('dafman:…'))`
/// pattern (untyped, no cleanup guarantee, untraceable) with a single
/// typed mitt instance. See AGENTS.md rule 18 — never reach for window
/// events for in-app messaging.
///
/// Per-listener exceptions are caught and logged so one bad handler
/// can't block the rest. (mitt does NOT do this by default; we wrap
/// dispatch to preserve the contract from the old listenerRegistry.)

import mitt, { type Handler } from 'mitt';

/// All app-level events live here. Each key is the channel name,
/// each value is the payload type. Adding a new channel is a one-line
/// change to this interface plus a single `bus.on('foo', …)` call.
export type AppEvents = {
  'focus-session': { sessionId: string };
  'focus-composer': { sessionId: string | null };
  'focus-terminal': { terminalId: string };
  'open-command-terminal': { sessionId: string };
  'close-command-terminal': { sessionId: string };
  'scroll-to-bottom': { sessionId: string };
  'open-model-selector': { sessionId: string };
  'rename-session': { sessionId: string };
  'library-activate-tab': { tab: string };
};

type EventKey = keyof AppEvents;

const inner = mitt<AppEvents>();

/// Subscribe to an app event. Returns an unsubscribe callback.
/// Listener exceptions are logged but never propagated — see module
/// docstring.
export function on<K extends EventKey>(key: K, handler: Handler<AppEvents[K]>): () => void {
  const wrapped: Handler<AppEvents[K]> = (payload) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[app-bus:${key as string} listener threw]`, err);
    }
  };

  inner.on(key, wrapped);

  return () => inner.off(key, wrapped);
}

/// Fire an app event. Synchronous fan-out.
export function emit<K extends EventKey>(key: K, payload: AppEvents[K]): void {
  inner.emit(key, payload);
}

/// Remove all handlers for one channel (test cleanup mostly).
export function clear(key?: EventKey): void {
  if (key) inner.off(key);
  else inner.all.clear();
}

/// Underlying mitt instance, exposed for advanced uses (typed wildcard
/// subscription, etc.). Prefer `on`/`emit` over reaching for this.
export const _internal = inner;
