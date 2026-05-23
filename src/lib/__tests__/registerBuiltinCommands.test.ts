import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import { registerBuiltinCommands, type ConfirmHandle } from "../registerBuiltinCommands";
import { useCommandRegistry } from "../../stores/commandRegistry";
import { useSessionsStore } from "../../stores/sessionsStore";
import { useClientStore } from "../../stores/clientStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { setRpcBridge, type RpcBridge } from "../../ipc/invoke";

// Lightweight stub for the PrimeVue useConfirm() return value.
// Captures the options object so tests can assert what would be
// shown to the user and decide whether to "accept" or "reject"
// imperatively.
function makeConfirmStub() {
  const calls: Array<{
    message: unknown;
    header: unknown;
    accept?: () => void;
  }> = [];
  const handle: ConfirmHandle = {
    require(options) {
      calls.push({
        message: options.message,
        header: options.header,
        accept: options.accept as undefined | (() => void),
      });
    },
  };
  return { handle, calls };
}

describe("registerBuiltinCommands — Reset Layout", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    setRpcBridge(null);
  });

  test("with 0 open sessions, runs immediately without prompting", () => {
    const stub = makeConfirmStub();
    registerBuiltinCommands({ confirm: stub.handle });
    const registry = useCommandRegistry();
    const reset = registry.visibleCommands.find((c) => c.id === "layout.reset");
    expect(reset).toBeTruthy();
    reset?.run();
    expect(stub.calls).toHaveLength(0);
  });

  test("with 1 open session, runs without prompting (single tab close is low friction)", () => {
    const stub = makeConfirmStub();
    const sessionsStore = useSessionsStore();
    // Push a fake record so sessions.length === 1.
    sessionsStore.sessions.push({
      id: "s1",
      accent: "#000",
      events: [],
      model: null,
      reasoningEffort: null,
      title: null,
      mode: null,
      approveAll: true,
      reasoningVisibilityOverride: "default",
      workingDirectory: null,
      defaultSendMode: "steer",
    } as never);
    registerBuiltinCommands({ confirm: stub.handle });
    const registry = useCommandRegistry();
    registry.commands.get("layout.reset")?.run();
    expect(stub.calls).toHaveLength(0);
  });

  test("with 2+ open sessions, asks for confirmation before resetting", () => {
    const stub = makeConfirmStub();
    const sessionsStore = useSessionsStore();
    sessionsStore.sessions.push(
      { id: "s1", events: [] } as never,
      { id: "s2", events: [] } as never,
      { id: "s3", events: [] } as never,
    );
    registerBuiltinCommands({ confirm: stub.handle });
    useCommandRegistry().commands.get("layout.reset")?.run();
    expect(stub.calls).toHaveLength(1);
    expect(String(stub.calls[0]?.message)).toContain("3 open sessions");
    expect(stub.calls[0]?.header).toBe("Reset Layout");
    // The action should fire when accept is invoked. We can't easily
    // assert the side effect (would need a full fake DockviewApi)
    // but we can at least verify accept is supplied.
    expect(stub.calls[0]?.accept).toBeTypeOf("function");
  });

  test("New Session command is hidden when client isn't ready (when() = false)", () => {
    const stub = makeConfirmStub();
    const clientStore = useClientStore();
    expect(clientStore.ready).toBe(false);
    registerBuiltinCommands({ confirm: stub.handle });
    const visible = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(visible).not.toContain("session.new");
  });

  test("New Session command becomes visible when clientStore.ready = true", () => {
    const stub = makeConfirmStub();
    const clientStore = useClientStore();
    clientStore.ready = true;
    registerBuiltinCommands({ confirm: stub.handle });
    const visible = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(visible).toContain("session.new");
  });

  test("Switch to: <session> hides sessions not currently in the dock", () => {
    const stub = makeConfirmStub();
    const sessionsStore = useSessionsStore();
    sessionsStore.sessions.push({
      id: "not-in-dock",
      accent: "#000",
      events: [],
      model: null,
      reasoningEffort: null,
      title: "Some title",
      mode: null,
      approveAll: true,
      reasoningVisibilityOverride: "default",
      workingDirectory: null,
      defaultSendMode: "steer",
    } as never);
    // No layoutStore.api set, so getPanel returns undefined → when() false.
    void useLayoutStore();
    registerBuiltinCommands({ confirm: stub.handle });
    const visible = useCommandRegistry().visibleCommands.map((c) => c.id);
    expect(visible).not.toContain("session.switch.not-in-dock");
  });

  test("SDK passthrough slash commands send the slash text to the active session", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    setRpcBridge({
      async request(name, args) {
        calls.push({ name, args });
        return "ok";
      },
      onSessionEvent: () => () => {},
      onPendingRequest: () => () => {},
      onLogEvent: () => () => {},
      onAuditEvent: () => () => {},
    } as RpcBridge);
    const sessionsStore = useSessionsStore();
    sessionsStore.sessions.push({
      id: "s1",
      accent: "#000",
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      title: null,
      mode: null,
      approveAll: true,
      reasoningVisibilityOverride: "default",
      workingDirectory: null,
      defaultSendMode: "steer",
      pendingRequests: [],
      unseenTurns: 0,
      isThinking: false,
      sawTurnBoundary: false,
      currentAgent: null,
      tasksRefreshCounter: 0,
      planRefreshCounter: 0,
      touchedFiles: [],
      commandsRun: 0,
      _toastedOauthRequests: new Set(),
      _artifactToolCallIds: new Set(),
    });
    const layoutStore = useLayoutStore();
    layoutStore.activeSessionId = "s1";
    registerBuiltinCommands({ confirm: makeConfirmStub().handle });

    await useCommandRegistry().commands.get("session.cmd.model")?.run();

    expect(calls).toContainEqual({
      name: "sendMessage",
      args: { sessionId: "s1", text: "/model", mode: "immediate" },
    });
  });
});
