// Electrobun-bridged implementation of the typed `RpcBridge` interface.
//
// `src/main.ts` instantiates the Electroview with this bridge wired up,
// and routes the global `sessionEvent` + `pendingRequest` messages into
// fan-out listeners so multiple stores can all subscribe without the
// renderer needing to re-register handlers.

import { Electroview } from "electrobun/view";
import type {
  CommandMap,
  CommandName,
  PendingRequestPayload,
  SessionEventPayload,
} from "./types";
import type {
  PendingRequestListener,
  RpcBridge,
  SessionEventListener,
} from "./invoke";

interface ElectrobunRpcType {
  bun: {
    requests: {
      [K in CommandName]: {
        params: CommandMap[K]["args"];
        response: CommandMap[K]["result"];
      };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      sessionEvent: SessionEventPayload;
      pendingRequest: PendingRequestPayload;
    };
  };
}

export function createElectrobunBridge(): {
  bridge: RpcBridge;
  electroview: unknown;
} {
  const sessionListeners = new Set<SessionEventListener>();
  const pendingListeners = new Set<PendingRequestListener>();

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
              console.error("[sessionEvent listener threw]", err);
            }
          }
        },
        pendingRequest: (payload) => {
          for (const listener of pendingListeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error("[pendingRequest listener threw]", err);
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
        (electroview as { rpc: { request: Record<CommandName, (a: unknown) => Promise<unknown>> } }).rpc
      ).request[name];
      return requester(args);
    }) as RpcBridge["request"],
    onSessionEvent(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    onPendingRequest(listener) {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
  };

  return { bridge, electroview };
}
