/**
 * Factory for the fan-out listener sets shared by electrobunBridge and wsBridge.
 *
 * Each event channel (session, pending, log, audit, terminal, commandResult)
 * follows the same pattern: a Set<Listener>, an `onX(cb)` subscribe method
 * that returns an unsubscribe callback, and a `dispatchX(payload)` function
 * that fans out to all current listeners.
 */

import type {
  AuditEntry,
  CommandResultEvent,
  LogRecord,
  PendingRequestPayload,
  SessionEventPayload,
  TerminalEventPayload,
} from './types';
import type {
  AuditEventListener,
  CommandResultEventListener,
  LogEventListener,
  PendingRequestListener,
  SessionEventListener,
  TerminalEventListener,
} from './invoke';

export interface ListenerMethods {
  onSessionEvent: (listener: SessionEventListener) => () => void;
  onPendingRequest: (listener: PendingRequestListener) => () => void;
  onLogEvent: (listener: LogEventListener) => () => void;
  onAuditEvent: (listener: AuditEventListener) => () => void;
  onTerminalEvent: (listener: TerminalEventListener) => () => void;
  onCommandResultEvent: (listener: CommandResultEventListener) => () => void;
}

export interface ListenerDispatchers {
  dispatchSessionEvent: (payload: SessionEventPayload) => void;
  dispatchPendingRequest: (payload: PendingRequestPayload) => void;
  dispatchLogEvent: (payload: LogRecord) => void;
  dispatchAuditEvent: (payload: AuditEntry) => void;
  dispatchTerminalEvent: (payload: TerminalEventPayload) => void;
  dispatchCommandResultEvent: (payload: CommandResultEvent) => void;
}

function subscribe<T>(set: Set<T>): (listener: T) => () => void {
  return (listener: T) => {
    set.add(listener);

    return () => set.delete(listener);
  };
}

function fanOut<T>(set: Set<T>, label: string): (payload: Parameters<Extract<T, (...a: never[]) => void>>[0]) => void {
  return (payload) => {
    for (const listener of set) {
      try {
        (listener as (p: typeof payload) => void)(payload);
      } catch (err) {
        console.error(`[${label} listener threw]`, err);
      }
    }
  };
}

/**
 * Creates the full set of listener subscribe/dispatch pairs used by both
 * the Electrobun bridge and the WebSocket bridge.
 */
export function createListenerRegistry(): ListenerMethods & ListenerDispatchers {
  const sessionListeners = new Set<SessionEventListener>();
  const pendingListeners = new Set<PendingRequestListener>();
  const logListeners = new Set<LogEventListener>();
  const auditListeners = new Set<AuditEventListener>();
  const terminalListeners = new Set<TerminalEventListener>();
  const commandResultListeners = new Set<CommandResultEventListener>();

  return {
    onSessionEvent: subscribe(sessionListeners),
    onPendingRequest: subscribe(pendingListeners),
    onLogEvent: subscribe(logListeners),
    onAuditEvent: subscribe(auditListeners),
    onTerminalEvent: subscribe(terminalListeners),
    onCommandResultEvent: subscribe(commandResultListeners),

    dispatchSessionEvent: fanOut(sessionListeners, 'sessionEvent'),
    dispatchPendingRequest: fanOut(pendingListeners, 'pendingRequest'),
    dispatchLogEvent: fanOut(logListeners, 'logEvent'),
    dispatchAuditEvent: fanOut(auditListeners, 'auditEvent'),
    dispatchTerminalEvent: fanOut(terminalListeners, 'terminalEvent'),
    dispatchCommandResultEvent: fanOut(commandResultListeners, 'commandResultEvent'),
  };
}
