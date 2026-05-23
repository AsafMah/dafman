import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { runLocalSlashCommand, SESSION_COMMANDS } from "../sessionCommands";
import { useSessionsStore } from "../../stores/sessionsStore";
import { setRpcBridge, type RpcBridge } from "../../ipc/invoke";

describe("sessionCommands", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    setRpcBridge(null);
  });

  test("/cd without args displays the tracked working directory", async () => {
    const sessions = useSessionsStore();
    sessions.sessions.push({
      id: "s1",
      accent: "#000",
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      mode: null,
      approveAll: true,
      title: null,
      reasoningVisibilityOverride: "default",
      workingDirectory: "C:\\repo\\dafman",
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
      _toastedOauthRequests: new Set<string>(),
      _artifactToolCallIds: new Set<string>(),
    });

    const handled = await runLocalSlashCommand("s1", "/cd");

    expect(handled).toBe(true);
    expect(sessions.sessions[0]?.events).toEqual([
      {
        sessionId: "s1",
        eventType: "system.notification",
        data: { content: "Current working directory: C:\\repo\\dafman" },
      },
    ]);
  });

  test("/cd with args changes the tracked working directory", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    setRpcBridge({
      async request(name, args) {
        calls.push({ name, args });
        return "C:\\other";
      },
      onSessionEvent() {
        return () => {};
      },
      onPendingRequest() {
        return () => {};
      },
      onLogEvent() {
        return () => {};
      },
      onAuditEvent() {
        return () => {};
      },
    } as RpcBridge);
    const sessions = useSessionsStore();
    sessions.sessions.push({
      id: "s1",
      accent: "#000",
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      mode: null,
      approveAll: true,
      title: null,
      reasoningVisibilityOverride: "default",
      workingDirectory: "C:\\repo\\dafman",
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
      _toastedOauthRequests: new Set<string>(),
      _artifactToolCallIds: new Set<string>(),
    });

    const handled = await runLocalSlashCommand("s1", "/cd C:\\other");

    expect(handled).toBe(true);
    expect(calls).toEqual([
      {
        name: "setSessionWorkingDirectory",
        args: {
          sessionId: "s1",
          workingDirectory: "C:\\other",
          baseWorkingDirectory: "C:\\repo\\dafman",
        },
      },
    ]);
    expect(sessions.sessions[0]?.workingDirectory).toBe("C:\\other");
    expect(sessions.sessions[0]?.events).toEqual([
      {
        sessionId: "s1",
        eventType: "system.notification",
        data: { content: "Working directory changed to C:\\other" },
      },
    ]);
  });

  test("/plan sends a CLI-style plan prompt and switches mode", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    setRpcBridge({
      async request(name, args) {
        calls.push({ name, args });
        return name === "setSessionMode" ? "plan" : true;
      },
      onSessionEvent() {
        return () => {};
      },
      onPendingRequest() {
        return () => {};
      },
      onLogEvent() {
        return () => {};
      },
      onAuditEvent() {
        return () => {};
      },
    } as RpcBridge);
    const sessions = useSessionsStore();
    sessions.sessions.push({
      id: "s1",
      accent: "#000",
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      mode: null,
      approveAll: false,
      title: null,
      reasoningVisibilityOverride: "default",
      workingDirectory: "C:\\repo\\dafman",
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
      _toastedOauthRequests: new Set<string>(),
      _artifactToolCallIds: new Set<string>(),
    });

    const handled = await runLocalSlashCommand("s1", "/plan build mode parity");

    expect(handled).toBe(true);
    expect(calls).toEqual([
      {
        name: "setSessionMode",
        args: { sessionId: "s1", mode: "plan" },
      },
      {
        name: "sendMessage",
        args: {
          sessionId: "s1",
          text: "[[PLAN]] build mode parity",
          mode: "immediate",
        },
      },
    ]);
    expect(sessions.sessions[0]?.mode).toBe("plan");
  });

  test("SDK passthrough commands appear but are not intercepted", async () => {
    const slashes = SESSION_COMMANDS.map((cmd) => cmd.slash);
    expect(slashes).toContain("/mcp");
    expect(slashes).toContain("/skill");
    expect(slashes).toContain("/skills");
    expect(slashes).toContain("/agent");
    expect(slashes).toContain("/model");

    const handled = await runLocalSlashCommand("s1", "/mcp list");

    expect(handled).toBe(false);
  });
});
