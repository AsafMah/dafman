// Regression test for the resume-race buffer fix.
//
// On `restoreSession`, the bun-side `SessionRegistry.resume` fires the
// full history through `webview.rpc.send.sessionEvent` *during* the
// RPC handler — before the awaiting promise resolves. Those events
// arrive at the renderer with no matching `SessionRecord` yet, so they
// must be buffered until the record is created, then drained into it.
//
// This test simulates that flow via a fake RPC bridge that fires
// sessionEvents BEFORE resolving the resumeSession response, and
// verifies the resulting record has all the history.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import {
  setRpcBridge,
  type RpcBridge,
  type SessionEventListener,
} from "../../ipc/invoke";
import type {
  CommandMap,
  CommandName,
  SessionEventPayload,
} from "../../ipc/types";
import { useSessionsStore, _resetSessionsStoreForTest } from "../sessionsStore";

function makeFakeBridge(): {
  bridge: RpcBridge;
  fire: (payload: SessionEventPayload) => void;
  calls: Array<{ name: string; args: unknown }>;
  handlers: Partial<{
    [K in CommandName]: (
      args: CommandMap[K]["args"],
      fire: (payload: SessionEventPayload) => void,
    ) => Promise<CommandMap[K]["result"]>;
  }>;
} {
  const listeners = new Set<SessionEventListener>();
  const fire = (payload: SessionEventPayload) => {
    for (const l of listeners) l(payload);
  };
  const calls: Array<{ name: string; args: unknown }> = [];
  const handlers: Partial<{
    [K in CommandName]: (
      args: CommandMap[K]["args"],
      fire: (p: SessionEventPayload) => void,
    ) => Promise<CommandMap[K]["result"]>;
  }> = {};
  const bridge: RpcBridge = {
    request: (async <N extends CommandName>(
      name: N,
      args: CommandMap[N]["args"],
    ) => {
      calls.push({ name, args });
      const handler = handlers[name];
      if (handler) {
        return (await (handler as (
          a: CommandMap[N]["args"],
          f: typeof fire,
        ) => Promise<CommandMap[N]["result"]>)(args, fire));
      }
      return undefined as unknown as CommandMap[N]["result"];
    }) as RpcBridge["request"],
    onSessionEvent: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { bridge, fire, calls, handlers };
}

function event(
  sessionId: string,
  type: string,
  data: Record<string, unknown> = {},
): SessionEventPayload {
  return { sessionId, eventType: type, data };
}

describe("sessionsStore.restoreSession — buffer + drain", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
  });
  afterEach(() => {
    setRpcBridge(null);
    _resetSessionsStoreForTest();
  });

  test("events fired DURING the resumeSession RPC end up on the record", async () => {
    const { bridge, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args, fire) => {
      const { sessionId } = args as { sessionId: string };
      fire(event(sessionId, "session.resume", { context: { cwd: "/r" } }));
      fire(event(sessionId, "assistant.message_start", { messageId: "m1" }));
      fire(
        event(sessionId, "assistant.message_delta", {
          messageId: "m1",
          deltaContent: "hello ",
        }),
      );
      fire(
        event(sessionId, "assistant.message_delta", {
          messageId: "m1",
          deltaContent: "world",
        }),
      );
      return { sessionId, cwd: null };
    };
    setRpcBridge(bridge);

    const store = useSessionsStore();
    const record = await store.restoreSession("sess-abc");

    expect(record).not.toBeNull();
    expect(record!.id).toBe("sess-abc");
    expect(record!.events).toHaveLength(4);
    expect(record!.events[0]?.eventType).toBe("session.resume");
    expect(record!.events[3]?.eventType).toBe("assistant.message_delta");
    expect(record!.workingDirectory).toBe("/r");
  });

  test("events fired AFTER the RPC resolves are appended live", async () => {
    const { bridge, fire, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args) =>
      ({ sessionId: (args as { sessionId: string }).sessionId, cwd: null });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    const record = await store.restoreSession("sess-live");
    expect(record!.events).toHaveLength(0);

    fire(event("sess-live", "assistant.turn_start", { turnId: "t1" }));
    expect(record!.events).toHaveLength(1);
    expect(record!.events[0]?.eventType).toBe("assistant.turn_start");
  });

  test("events for unknown sessions buffer indefinitely then drain on a later restore", async () => {
    const { bridge, fire, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args) =>
      ({ sessionId: (args as { sessionId: string }).sessionId, cwd: null });
    setRpcBridge(bridge);
    const store = useSessionsStore();

    // Trigger subscription via a first restoreSession.
    await store.restoreSession("sess-other");

    // Fire an event for a session that has no record yet.
    fire(event("sess-late", "assistant.message_start", { messageId: "m1" }));

    const record = await store.restoreSession("sess-late");
    expect(record!.events).toHaveLength(1);
    expect(record!.events[0]?.eventType).toBe("assistant.message_start");
  });
});
