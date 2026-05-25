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
import type { RpcBridge } from './invoke';
import { createListenerRegistry } from './listenerRegistry';

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
  const registry = createListenerRegistry();

  const rpc = Electroview.defineRPC<ElectrobunRpcType>({
    maxRequestTime: 120000,
    handlers: {
      requests: {},
      messages: {
        sessionEvent: (payload) => registry.dispatchSessionEvent(payload),
        pendingRequest: (payload) => registry.dispatchPendingRequest(payload),
        logEvent: (payload) => registry.dispatchLogEvent(payload),
        auditEvent: (payload) => registry.dispatchAuditEvent(payload),
        terminalEvent: (payload) => registry.dispatchTerminalEvent(payload),
        commandResultEvent: (payload) => registry.dispatchCommandResultEvent(payload),
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
    onSessionEvent: registry.onSessionEvent,
    onPendingRequest: registry.onPendingRequest,
    onLogEvent: registry.onLogEvent,
    onAuditEvent: registry.onAuditEvent,
    onTerminalEvent: registry.onTerminalEvent,
    onCommandResultEvent: registry.onCommandResultEvent,
  };

  return { bridge, electroview };
}
