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
  firePending: (payload: import("../../ipc/types").PendingRequestPayload) => void;
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
  const pendingListeners = new Set<(p: import("../../ipc/types").PendingRequestPayload) => void>();
  const firePending = (payload: import("../../ipc/types").PendingRequestPayload) => {
    for (const l of pendingListeners) l(payload);
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
    onPendingRequest: (l) => {
      pendingListeners.add(l);
      return () => pendingListeners.delete(l);
    },
  };
  return { bridge, fire, firePending, calls, handlers };
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

  test("commands.changed populates record.commands for the slash typeahead", async () => {
    const { bridge, fire, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args) =>
      ({ sessionId: (args as { sessionId: string }).sessionId, cwd: null });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    const record = await store.restoreSession("sess-cmds");
    expect(record!.commands).toEqual([]);

    fire(
      event("sess-cmds", "commands.changed", {
        commands: [
          { name: "/help", description: "show help" },
          { name: "/clear" },
          // bogus entries should be filtered out
          { description: "no name" },
          "not-an-object",
          null,
        ],
      }),
    );

    expect(record!.commands).toEqual([
      { name: "/help", description: "show help" },
      { name: "/clear" },
    ]);
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

  test("dafman pendingRequest mirrors into record.pendingRequests; .completed clears", async () => {
    const { bridge, fire, firePending, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args) => ({
      sessionId: (args as { sessionId: string }).sessionId,
      cwd: null,
    });
    setRpcBridge(bridge);
    const store = useSessionsStore();
    const record = await store.restoreSession("s1");
    expect(record!.pendingRequests).toEqual([]);

    firePending({
      sessionId: "s1",
      requestId: "req-1",
      kind: "permission",
      request: { kind: "shell", summary: "run `ls`", raw: {} },
    });
    expect(record!.pendingRequests).toHaveLength(1);
    expect(record!.pendingRequests[0]?.kind).toBe("permission");
    expect(record!.pendingRequests[0]?.message).toBe("run `ls`");

    fire(event("s1", "permission.completed", {}));
    expect(record!.pendingRequests).toEqual([]);
  });

  test("unrelated .completed events don't clear a pendingRequest of a different kind", async () => {
    const { bridge, fire, firePending, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args) => ({
      sessionId: (args as { sessionId: string }).sessionId,
      cwd: null,
    });
    setRpcBridge(bridge);
    const store = useSessionsStore();
    const record = await store.restoreSession("s1");

    firePending({
      sessionId: "s1",
      requestId: "req-1",
      kind: "userInput",
      request: { question: "name?", allowFreeform: true },
    });
    expect(record!.pendingRequests[0]?.kind).toBe("userInput");

    // permission.completed shouldn't clear a userInput-channel request.
    fire(event("s1", "permission.completed", {}));
    expect(record!.pendingRequests[0]?.kind).toBe("userInput");

    fire(event("s1", "user_input.completed", {}));
    expect(record!.pendingRequests).toEqual([]);
  });

  test("assistant.turn_end bumps unseenTurns when session isn't the active dock panel", async () => {
    // layoutStore.activeSessionId starts null in tests (no dockview
    // wired) — every session is treated as 'not focused', so every
    // turn_end bumps the counter. This pins the counter behavior;
    // the "skip when focused" path is exercised by inspecting the
    // active-session id (verified separately in
    // layoutStore.addPanel.test.ts).
    const { bridge, fire, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args) => ({
      sessionId: (args as { sessionId: string }).sessionId,
      cwd: null,
    });
    setRpcBridge(bridge);
    const store = useSessionsStore();
    const record = await store.restoreSession("s1");
    expect(record!.unseenTurns).toBe(0);

    fire(event("s1", "assistant.turn_end", { turnId: "t1" }));
    fire(event("s1", "assistant.turn_end", { turnId: "t2" }));
    expect(record!.unseenTurns).toBe(2);
  });

  test("isThinking tracks assistant.turn_start / turn_end / session.idle", async () => {
    // Drives the "Thinking…" spinner icon on the tab + sidebar row.
    // Lives on the record (not just ChatAmbient) so sibling sessions
    // can react without their chat panels being mounted.
    const { bridge, fire, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args) => ({
      sessionId: (args as { sessionId: string }).sessionId,
      cwd: null,
    });
    setRpcBridge(bridge);
    const store = useSessionsStore();
    const record = await store.restoreSession("s1");
    expect(record!.isThinking).toBe(false);
    expect(record!.sawTurnBoundary).toBe(false);

    fire(event("s1", "assistant.turn_start", { turnId: "t1" }));
    expect(record!.isThinking).toBe(true);
    expect(record!.sawTurnBoundary).toBe(true);

    fire(event("s1", "assistant.turn_end", { turnId: "t1" }));
    expect(record!.isThinking).toBe(false);

    // session.idle is the SDK's "I'm done" fallback for older
    // boundaries; should also clear isThinking.
    fire(event("s1", "assistant.turn_start", { turnId: "t2" }));
    expect(record!.isThinking).toBe(true);
    fire(event("s1", "session.idle", {}));
    expect(record!.isThinking).toBe(false);
  });

  test("OS notification fires for every pending-request channel AND turn_end (not just permission)", async () => {
    // Pins the contract the user surfaced after the first
    // notifications PR: notifications must cover ALL of
    // permission.requested, user_input.requested, elicitation.requested,
    // AND assistant.turn_end — not just permission. Each event for
    // a non-active session should produce a notificationsStore.notify
    // call with the right `kind`.
    const { useNotificationsStore } = await import("../notificationsStore");
    const { useSettingsStore } = await import("../settingsStore");
    const notifications = useNotificationsStore();
    const settings = useSettingsStore();
    // Allow both kinds so we can observe firing decisions purely
    // through the recorded calls below.
    settings.settings.notifications = { turnEnd: true, waitingForInput: true };
    const calls: Array<{ kind: string; title: string; body: string }> = [];
    // Spy by overwriting the action. Pinia lets us reassign directly.
    notifications.notify = (opts) => {
      calls.push({ kind: opts.kind, title: opts.title, body: opts.body });
      return true;
    };

    const { bridge, fire, firePending, handlers } = makeFakeBridge();
    handlers.resumeSession = async (args) => ({
      sessionId: (args as { sessionId: string }).sessionId,
      cwd: null,
    });
    setRpcBridge(bridge);
    const store = useSessionsStore();
    await store.restoreSession("s1");

    // Three SDK-pending-callback channels arrive over the new
    // dafman pendingRequest push. The reducer no longer reacts to
    // the SDK `*.requested` events for state purposes.
    firePending({
      sessionId: "s1",
      requestId: "req-1",
      kind: "permission",
      request: { kind: "shell", summary: "run x", raw: {} },
    });
    firePending({
      sessionId: "s1",
      requestId: "req-2",
      kind: "userInput",
      request: { question: "your name?", allowFreeform: true },
    });
    firePending({
      sessionId: "s1",
      requestId: "req-3",
      kind: "elicitation",
      request: { message: "https://oauth.example", mode: "url", url: "https://oauth.example" },
    });
    fire(event("s1", "assistant.turn_end", { turnId: "t1" }));

    // 3 waitingForInput + 1 turnEnd = 4 notify calls.
    expect(calls).toHaveLength(4);
    const kinds = calls.map((c) => c.kind);
    expect(kinds.filter((k) => k === "waitingForInput")).toHaveLength(3);
    expect(kinds.filter((k) => k === "turnEnd")).toHaveLength(1);
    // The waitingForInput bodies carry the per-kind summary so the
    // notification shows what's being asked.
    expect(calls.find((c) => c.body === "run x")).toBeTruthy();
    expect(calls.find((c) => c.body === "your name?")).toBeTruthy();
    expect(calls.find((c) => c.body === "https://oauth.example")).toBeTruthy();
  });
});
