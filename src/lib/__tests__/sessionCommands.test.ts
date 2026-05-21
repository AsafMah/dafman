import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { runLocalSlashCommand } from "../sessionCommands";
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
});
