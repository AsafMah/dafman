// Typed wrapper over the Electrobun RPC bridge.
//
// Components and stores MUST call `invokeCommand` instead of touching
// the raw RPC client directly; the same rule that applied to
// `@tauri-apps/api`'s `invoke` still holds. The Electrobun bridge is
// injected by `src/main.ts` via `setRpcBridge`, which mockable
// alternatives (tests, the dev playground) override before the app
// mounts.

import type {
  AppErrorPayload,
  AuditEntry,
  CommandMap,
  CommandName,
  CommandResultEvent,
  LogRecord,
  PendingRequestPayload,
  SessionEventPayload,
  TerminalEventPayload,
} from '@/ipc/types';

export type InvokeResult<N extends CommandName> = CommandMap[N]['result'];

export class AppError extends Error {
  readonly payload: AppErrorPayload;
  constructor(payload: AppErrorPayload) {
    super(formatAppError(payload));
    this.name = 'AppError';
    this.payload = payload;
  }
}

function formatAppError(payload: AppErrorPayload): string {
  switch (payload.kind) {
    case 'ClientNotStarted':
      return 'Copilot client not started';
    case 'SessionNotFound':
      return `Session ${payload.data} not found`;
    case 'Settings':
      return `Settings error: ${payload.data}`;
    case 'Sdk':
      return `SDK error: ${payload.data}`;
    case 'Io':
      return `I/O error: ${payload.data}`;
  }
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  if (!value || typeof value !== 'object') return false;

  const kind = (value as { kind?: unknown }).kind;

  return (
    kind === 'ClientNotStarted' ||
    kind === 'SessionNotFound' ||
    kind === 'Settings' ||
    kind === 'Sdk' ||
    kind === 'Io'
  );
}

/// The bun side encodes `AppErrorPayload` into the `Error.message` as
/// `AppErrorPayload:{json}` — Electrobun's bridge only forwards
/// `error.message` (and silently drops non-Error throws — see
/// node_modules/electrobun/dist/api/shared/rpc.ts:398). Decode here.
const APP_ERROR_PREFIX = 'AppErrorPayload:';

function tryDecodeAppErrorMessage(message: string): AppErrorPayload | null {
  if (!message.startsWith(APP_ERROR_PREFIX)) return null;

  try {
    const payload = JSON.parse(message.slice(APP_ERROR_PREFIX.length));

    return isAppErrorPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export type SessionEventListener = (event: SessionEventPayload) => void;
export type PendingRequestListener = (payload: PendingRequestPayload) => void;
export type LogEventListener = (record: LogRecord) => void;
export type AuditEventListener = (entry: AuditEntry) => void;
export type TerminalEventListener = (event: TerminalEventPayload) => void;
export type CommandResultEventListener = (event: CommandResultEvent) => void;

/// Minimal surface that the IPC bridge has to implement. Both the real
/// Electrobun bridge and unit-test fakes match this shape; tests inject a
/// stub via `setRpcBridge`.
export interface RpcBridge {
  request<N extends CommandName>(name: N, args: CommandMap[N]['args']): Promise<InvokeResult<N>>;
  onSessionEvent(listener: SessionEventListener): () => void;
  onPendingRequest(listener: PendingRequestListener): () => void;
  onLogEvent(listener: LogEventListener): () => void;
  onAuditEvent(listener: AuditEventListener): () => void;
  onTerminalEvent?(listener: TerminalEventListener): () => void;
  onCommandResultEvent?(listener: CommandResultEventListener): () => void;
}

let bridge: RpcBridge | null = null;

/// Channel that queues subscriptions until the bridge is attached.
/// `bind` is called once on bridge attach to forward every queued
/// listener; until then, `subscribe` keeps them in a local Set so
/// no events are missed during the (very brief) gap between Pinia
/// store init and `setRpcBridge()` being called from main.ts.
interface DeferredChannel<L> {
  subscribe(listener: L): () => void;
  flush(next: RpcBridge): void;
}

function createDeferredChannel<L>(
  bind: (next: RpcBridge, listener: L) => (() => void) | undefined,
): DeferredChannel<L> {
  const pending = new Set<L>();

  return {
    subscribe(listener) {
      if (bridge) {
        const off = bind(bridge, listener);

        return off ?? (() => undefined);
      }

      pending.add(listener);

      return () => pending.delete(listener);
    },
    flush(next) {
      for (const listener of pending) bind(next, listener);

      pending.clear();
    },
  };
}

const sessionChannel = createDeferredChannel<SessionEventListener>((b, l) => b.onSessionEvent(l));
const pendingRequestChannel = createDeferredChannel<PendingRequestListener>((b, l) =>
  b.onPendingRequest(l),
);
const logChannel = createDeferredChannel<LogEventListener>((b, l) => b.onLogEvent(l));
const auditChannel = createDeferredChannel<AuditEventListener>((b, l) => b.onAuditEvent(l));
const terminalChannel = createDeferredChannel<TerminalEventListener>((b, l) =>
  b.onTerminalEvent?.(l),
);
const commandResultChannel = createDeferredChannel<CommandResultEventListener>((b, l) =>
  b.onCommandResultEvent?.(l),
);

export function setRpcBridge(next: RpcBridge | null): void {
  bridge = next;

  if (!next) return;

  sessionChannel.flush(next);
  pendingRequestChannel.flush(next);
  logChannel.flush(next);
  auditChannel.flush(next);
  terminalChannel.flush(next);
  commandResultChannel.flush(next);
}

export async function invokeCommand<N extends CommandName>(
  name: N,
  args: CommandMap[N]['args'],
): Promise<InvokeResult<N>> {
  if (!bridge) {
    throw new Error(`RPC bridge not initialized; cannot invoke '${name}'`);
  }

  try {
    return await bridge.request(name, args);
  } catch (raw) {
    if (isAppErrorPayload(raw)) throw new AppError(raw);

    if (raw instanceof Error) {
      const decoded = tryDecodeAppErrorMessage(raw.message);

      if (decoded) throw new AppError(decoded);

      throw raw;
    }

    throw new Error(String(raw));
  }
}

export const onSessionEvent = sessionChannel.subscribe;
export const onPendingRequest = pendingRequestChannel.subscribe;
export const onLogEvent = logChannel.subscribe;
export const onAuditEvent = auditChannel.subscribe;
export const onTerminalEvent = terminalChannel.subscribe;
export const onCommandResultEvent = commandResultChannel.subscribe;
