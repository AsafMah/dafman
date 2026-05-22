// 22a: MCP OAuth toast wiring.
//
// `mcp.oauth_required` -> info toast prompting the user to sign in.
// `mcp.oauth_completed` -> success toast (only if we toasted the
// matching `_required` event — we want to ignore stray `_completed`
// events from other clients / resume replays).

import { describe, expect, test, beforeEach } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import { useSessionsStore, type SessionRecord } from "../sessionsStore";
import { useToastStore } from "../toastStore";

function makeRecord(id: string): SessionRecord {
  return {
    id,
    accent: "#000",
    events: [],
    droppedEventCount: 0,
    model: null,
    reasoningEffort: null,
    title: null,
    mode: null,
    approveAll: false,
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
    _toastedOauthRequests: new Set<string>(),
  };
}

describe("sessionsStore — MCP OAuth toast", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("oauth_required pushes an info toast naming the server", () => {
    const sessions = useSessionsStore();
    const toasts = useToastStore();
    const rec = makeRecord("s1");
    sessions.sessions.push(rec);

    sessions.applySessionEvent({
      sessionId: "s1",
      eventType: "mcp.oauth_required",
      data: {
        requestId: "req-1",
        serverName: "github",
        serverUrl: "https://example.com/oauth/authorize",
      },
    });

    expect(toasts.pending.length).toBe(1);
    expect(toasts.pending[0]?.severity).toBe("info");
    expect(toasts.pending[0]?.detail ?? "").toContain("github");
    expect(rec._toastedOauthRequests.has("s1:oauth:req-1")).toBe(true);
  });

  test("oauth_required is de-duped on resume / replay (same requestId)", () => {
    const sessions = useSessionsStore();
    const toasts = useToastStore();
    const rec = makeRecord("s1");
    sessions.sessions.push(rec);

    const payload = {
      sessionId: "s1",
      eventType: "mcp.oauth_required",
      data: { requestId: "req-1", serverName: "github" },
    };
    sessions.applySessionEvent(payload);
    sessions.applySessionEvent(payload);

    expect(toasts.pending.length).toBe(1);
  });

  test("oauth_completed after matching _required emits success toast and drains the map", () => {
    const sessions = useSessionsStore();
    const toasts = useToastStore();
    const rec = makeRecord("s1");
    sessions.sessions.push(rec);

    sessions.applySessionEvent({
      sessionId: "s1",
      eventType: "mcp.oauth_required",
      data: { requestId: "req-1", serverName: "github" },
    });
    toasts.consume(); // clear the required toast
    sessions.applySessionEvent({
      sessionId: "s1",
      eventType: "mcp.oauth_completed",
      data: { requestId: "req-1" },
    });

    expect(toasts.pending.length).toBe(1);
    expect(toasts.pending[0]?.severity).toBe("success");
    expect(rec._toastedOauthRequests.has("s1:oauth:req-1")).toBe(false);
  });

  test("stray oauth_completed (no matching _required) is silently ignored", () => {
    const sessions = useSessionsStore();
    const toasts = useToastStore();
    const rec = makeRecord("s1");
    sessions.sessions.push(rec);

    sessions.applySessionEvent({
      sessionId: "s1",
      eventType: "mcp.oauth_completed",
      data: { requestId: "req-orphan" },
    });

    expect(toasts.pending.length).toBe(0);
  });
});
