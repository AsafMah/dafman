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

import type { CommandMap, CommandName } from '@/ipc/types';
import type { RpcBridge } from '@/ipc/invoke';
import { createListenerRegistry } from '@/ipc/listenerRegistry';

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
  const registry = createListenerRegistry();
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
    const dispatchers: Record<string, ((p: never) => void) | undefined> = {
      sessionEvent: registry.dispatchSessionEvent,
      pendingRequest: registry.dispatchPendingRequest,
      logEvent: registry.dispatchLogEvent,
      auditEvent: registry.dispatchAuditEvent,
      terminalEvent: registry.dispatchTerminalEvent,
      commandResultEvent: registry.dispatchCommandResultEvent,
    };

    dispatchers[name]?.(payload as never);
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
    onSessionEvent: registry.onSessionEvent,
    onPendingRequest: registry.onPendingRequest,
    onLogEvent: registry.onLogEvent,
    onAuditEvent: registry.onAuditEvent,
    onTerminalEvent: registry.onTerminalEvent,
    onCommandResultEvent: registry.onCommandResultEvent,
  };
}
