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
  LogRecord,
  PendingRequestPayload,
  SessionEventPayload,
} from "./types";

export type InvokeResult<N extends CommandName> = CommandMap[N]["result"];

export class AppError extends Error {
  readonly payload: AppErrorPayload;
  constructor(payload: AppErrorPayload) {
    super(formatAppError(payload));
    this.name = "AppError";
    this.payload = payload;
  }
}

function formatAppError(payload: AppErrorPayload): string {
  switch (payload.kind) {
    case "ClientNotStarted":
      return "Copilot client not started";
    case "SessionNotFound":
      return `Session ${payload.data} not found`;
    case "Settings":
      return `Settings error: ${payload.data}`;
    case "Sdk":
      return `SDK error: ${payload.data}`;
    case "Io":
      return `I/O error: ${payload.data}`;
  }
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "ClientNotStarted" ||
    kind === "SessionNotFound" ||
    kind === "Settings" ||
    kind === "Sdk" ||
    kind === "Io"
  );
}

export type SessionEventListener = (event: SessionEventPayload) => void;
export type PendingRequestListener = (payload: PendingRequestPayload) => void;
export type LogEventListener = (record: LogRecord) => void;
export type AuditEventListener = (entry: AuditEntry) => void;

/// Minimal surface that the IPC bridge has to implement. Both the real
/// Electrobun bridge and unit-test fakes match this shape; tests inject a
/// stub via `setRpcBridge`.
export interface RpcBridge {
  request<N extends CommandName>(
    name: N,
    args: CommandMap[N]["args"],
  ): Promise<InvokeResult<N>>;
  onSessionEvent(listener: SessionEventListener): () => void;
  onPendingRequest(listener: PendingRequestListener): () => void;
  onLogEvent(listener: LogEventListener): () => void;
  onAuditEvent(listener: AuditEventListener): () => void;
}

let bridge: RpcBridge | null = null;
const pendingSessionListeners = new Set<SessionEventListener>();
const pendingPendingRequestListeners = new Set<PendingRequestListener>();
const pendingLogListeners = new Set<LogEventListener>();
const pendingAuditListeners = new Set<AuditEventListener>();

export function setRpcBridge(next: RpcBridge | null): void {
  bridge = next;
  if (!next) return;
  for (const listener of pendingSessionListeners) {
    next.onSessionEvent(listener);
  }
  pendingSessionListeners.clear();
  for (const listener of pendingPendingRequestListeners) {
    next.onPendingRequest(listener);
  }
  pendingPendingRequestListeners.clear();
  for (const listener of pendingLogListeners) {
    next.onLogEvent(listener);
  }
  pendingLogListeners.clear();
  for (const listener of pendingAuditListeners) {
    next.onAuditEvent(listener);
  }
  pendingAuditListeners.clear();
}

export async function invokeCommand<N extends CommandName>(
  name: N,
  args: CommandMap[N]["args"],
): Promise<InvokeResult<N>> {
  if (!bridge) {
    throw new Error(
      `RPC bridge not initialized; cannot invoke '${String(name)}'`,
    );
  }
  try {
    return await bridge.request(name, args);
  } catch (raw) {
    if (isAppErrorPayload(raw)) throw new AppError(raw);
    if (raw instanceof Error) throw raw;
    throw new Error(String(raw));
  }
}

export function onSessionEvent(listener: SessionEventListener): () => void {
  if (bridge) return bridge.onSessionEvent(listener);
  pendingSessionListeners.add(listener);
  return () => pendingSessionListeners.delete(listener);
}

export function onPendingRequest(listener: PendingRequestListener): () => void {
  if (bridge) return bridge.onPendingRequest(listener);
  pendingPendingRequestListeners.add(listener);
  return () => pendingPendingRequestListeners.delete(listener);
}

export function onLogEvent(listener: LogEventListener): () => void {
  if (bridge) return bridge.onLogEvent(listener);
  pendingLogListeners.add(listener);
  return () => pendingLogListeners.delete(listener);
}

export function onAuditEvent(listener: AuditEventListener): () => void {
  if (bridge) return bridge.onAuditEvent(listener);
  pendingAuditListeners.add(listener);
  return () => pendingAuditListeners.delete(listener);
}
