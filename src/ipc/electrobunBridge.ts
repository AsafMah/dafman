// Electrobun-bridged implementation of the typed `RpcBridge` interface.
//
// `src/main.ts` instantiates the Electroview with this bridge wired up,
// and routes the global `sessionEvent` message into a single fan-out
// listener so multiple stores (sessions, permissions, etc.) can all
// subscribe without the renderer needing to re-register handlers.

import { Electroview } from "electrobun/view";
import type {
  CommandMap,
  CommandName,
  SessionEventPayload,
} from "./types";
import type { RpcBridge, SessionEventListener } from "./invoke";

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
    messages: { sessionEvent: SessionEventPayload };
  };
}

export function createElectrobunBridge(): {
  bridge: RpcBridge;
  electroview: unknown;
} {
  const listeners = new Set<SessionEventListener>();

  const rpc = Electroview.defineRPC<ElectrobunRpcType>({
    maxRequestTime: 30000,
    handlers: {
      requests: {},
      messages: {
        sessionEvent: (payload) => {
          for (const listener of listeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error("[sessionEvent listener threw]", err);
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
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return { bridge, electroview };
}
