/// WebSocket implementation of the typed `RpcBridge` interface.
///
/// Used in E2E test mode when the renderer is loaded with
/// `?testBridge=ws://host:port` — `src/main.ts` swaps this in
/// place of the Electrobun bridge. Production builds never touch
/// this module.
///
/// Wire contract:
/// - request:  `{type:"request", id, name, args}`
/// - response: `{type:"response", id, result}` | `{type:"error", id, error}`
/// - message:  `{type:"message", name, payload}` (bun → renderer push)

import type {
  AuditEntry,
  CommandMap,
  CommandName,
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
  RpcBridge,
  SessionEventListener,
  TerminalEventListener,
} from './invoke';

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface WireRequest {
  type: 'request';
  id: number;
  name: CommandName;
  args: unknown;
}

interface WireResponse {
  type: 'response';
  id: number;
  result: unknown;
}

interface WireError {
  type: 'error';
  id: number;
  error: { kind?: string; message?: string };
}

interface WireMessage {
  type: 'message';
  name: string;
  payload: unknown;
}

export function createWebSocketBridge(url: string): RpcBridge {
  const sessionListeners = new Set<SessionEventListener>();
  const pendingListeners = new Set<PendingRequestListener>();
  const logListeners = new Set<LogEventListener>();
  const auditListeners = new Set<AuditEventListener>();
  const terminalListeners = new Set<TerminalEventListener>();
  const commandResultListeners = new Set<CommandResultEventListener>();
  const pending = new Map<number, PendingRpc>();
  let nextId = 1;
  let socket: WebSocket | null = null;
  let openPromise: Promise<void> | null = null;

  function ensureOpen(): Promise<void> {
    if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
    if (openPromise) return openPromise;
    openPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      socket = ws;
      ws.addEventListener('open', () => {
        resolve();
      });
      ws.addEventListener('error', () => {
        reject(new Error(`WebSocket connect failed: ${url}`));
      });
      ws.addEventListener('close', () => {
        // Drop pending requests; tests can decide whether to retry.
        for (const [, p] of pending) {
          p.reject(new Error('WebSocket closed'));
        }
        pending.clear();
        socket = null;
        openPromise = null;
      });
      ws.addEventListener('message', (event) => {
        let parsed: WireResponse | WireError | WireMessage;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (parsed.type === 'response') {
          const slot = pending.get(parsed.id);
          if (!slot) return;
          pending.delete(parsed.id);
          slot.resolve(parsed.result);
        } else if (parsed.type === 'error') {
          const slot = pending.get(parsed.id);
          if (!slot) return;
          pending.delete(parsed.id);
          slot.reject(
            new Error(parsed.error?.message ?? `RPC error: ${parsed.error?.kind ?? 'unknown'}`),
          );
        } else if (parsed.type === 'message') {
          dispatchMessage(parsed.name, parsed.payload);
        }
      });
    });
    return openPromise;
  }

  function dispatchMessage(name: string, payload: unknown): void {
    if (name === 'sessionEvent') {
      for (const l of sessionListeners) l(payload as SessionEventPayload);
    } else if (name === 'pendingRequest') {
      for (const l of pendingListeners) l(payload as PendingRequestPayload);
    } else if (name === 'logEvent') {
      for (const l of logListeners) l(payload as LogRecord);
    } else if (name === 'auditEvent') {
      for (const l of auditListeners) l(payload as AuditEntry);
    } else if (name === 'terminalEvent') {
      for (const l of terminalListeners) l(payload as TerminalEventPayload);
    } else if (name === 'commandResultEvent') {
      for (const l of commandResultListeners) l(payload as CommandResultEvent);
    }
  }

  async function request<N extends CommandName>(
    name: N,
    args: CommandMap[N]['args'],
  ): Promise<CommandMap[N]['result']> {
    await ensureOpen();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    const id = nextId++;
    const wire: WireRequest = { type: 'request', id, name, args };
    return new Promise<CommandMap[N]['result']>((resolve, reject) => {
      pending.set(id, {
        resolve: (v) => resolve(v as CommandMap[N]['result']),
        reject,
      });
      socket!.send(JSON.stringify(wire));
    });
  }

  // Kick off the connection eagerly so the first request doesn't wait
  // for the handshake.
  void ensureOpen().catch(() => {
    /* surfaced via request() if anyone calls it later */
  });

  return {
    request,
    onSessionEvent(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    onPendingRequest(listener) {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    onLogEvent(listener) {
      logListeners.add(listener);
      return () => logListeners.delete(listener);
    },
    onAuditEvent(listener) {
      auditListeners.add(listener);
      return () => auditListeners.delete(listener);
    },
    onTerminalEvent(listener) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    onCommandResultEvent(listener) {
      commandResultListeners.add(listener);
      return () => commandResultListeners.delete(listener);
    },
  };
}
