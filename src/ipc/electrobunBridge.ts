// Electrobun-bridged implementation of the typed `RpcBridge` interface.
//
// `src/main.ts` instantiates the Electroview with this bridge wired up,
// and routes the global `sessionEvent` + `pendingRequest` messages into
// fan-out listeners so multiple stores can all subscribe without the
// renderer needing to re-register handlers.

import { Electroview } from 'electrobun/view';
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

interface ElectrobunRpcType {
  bun: {
    requests: {
      [K in CommandName]: {
        params: CommandMap[K]['args'];
        response: CommandMap[K]['result'];
      };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      sessionEvent: SessionEventPayload;
      pendingRequest: PendingRequestPayload;
      logEvent: LogRecord;
      auditEvent: AuditEntry;
      terminalEvent: TerminalEventPayload;
      commandResultEvent: CommandResultEvent;
    };
  };
}

export function createElectrobunBridge(): {
  bridge: RpcBridge;
  electroview: unknown;
} {
  const sessionListeners = new Set<SessionEventListener>();
  const pendingListeners = new Set<PendingRequestListener>();
  const logListeners = new Set<LogEventListener>();
  const auditListeners = new Set<AuditEventListener>();
  const terminalListeners = new Set<TerminalEventListener>();
  const commandResultListeners = new Set<CommandResultEventListener>();

  const rpc = Electroview.defineRPC<ElectrobunRpcType>({
    maxRequestTime: 120000,
    handlers: {
      requests: {},
      messages: {
        sessionEvent: (payload) => {
          for (const listener of sessionListeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error('[sessionEvent listener threw]', err);
            }
          }
        },
        pendingRequest: (payload) => {
          for (const listener of pendingListeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error('[pendingRequest listener threw]', err);
            }
          }
        },
        logEvent: (payload) => {
          for (const listener of logListeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error('[logEvent listener threw]', err);
            }
          }
        },
        auditEvent: (payload) => {
          for (const listener of auditListeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error('[auditEvent listener threw]', err);
            }
          }
        },
        terminalEvent: (payload) => {
          for (const listener of terminalListeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error('[terminalEvent listener threw]', err);
            }
          }
        },
        commandResultEvent: (payload) => {
          for (const listener of commandResultListeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error('[commandResultEvent listener threw]', err);
            }
          }
        },
      },
    },
  });

  const electroview = new Electroview({ rpc });

  const bridge: RpcBridge = {
    request: ((name, args) => {
      const requester = (
        electroview as { rpc: { request: Record<CommandName, (a: unknown) => Promise<unknown>> } }
      ).rpc.request[name];
      return requester(args);
    }) as RpcBridge['request'],
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

  return { bridge, electroview };
}
