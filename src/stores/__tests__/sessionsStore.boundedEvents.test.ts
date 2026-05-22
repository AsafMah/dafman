// Bounded events-buffer regression test.
//
// `record.events` is capped at MAX_EVENTS_PER_SESSION; once a session
// pushes past the cap we trim from the front and bump
// `droppedEventCount` so consumers (`ChatWindow.flush`) can compute
// absolute progress instead of an index that would shift with each
// trim. This pins both invariants so a future store refactor can't
// silently let the buffer grow unbounded again.

import { describe, expect, test, beforeEach } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import {
  useSessionsStore,
  MAX_EVENTS_PER_SESSION,
} from "../../stores/sessionsStore";
import type { SessionRecord } from "../../stores/sessionsStore";
import type { SessionEventPayload } from "../../ipc/types";

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
    _toastedOauthRequests: new Set<string>(),
  };
}

function makeEvent(i: number, sid: string): SessionEventPayload {
  return {
    sessionId: sid,
    eventType: "system.notification",
    data: { seq: i },
  };
}

describe("sessionsStore — bounded events", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("appendEvent pushes below the cap without trimming", () => {
    const sessions = useSessionsStore();
    const rec = makeRecord("s1");
    sessions.sessions.push(rec);
    for (let i = 0; i < 10; i++) sessions.appendEvent(rec, makeEvent(i, "s1"));
    expect(rec.events.length).toBe(10);
    expect(rec.droppedEventCount).toBe(0);
  });

  test("appendEvent trims the front and bumps droppedEventCount past the cap", () => {
    const sessions = useSessionsStore();
    const rec = makeRecord("s1");
    sessions.sessions.push(rec);
    const overflow = 25;
    const total = MAX_EVENTS_PER_SESSION + overflow;
    for (let i = 0; i < total; i++)
      sessions.appendEvent(rec, makeEvent(i, "s1"));
    expect(rec.events.length).toBe(MAX_EVENTS_PER_SESSION);
    expect(rec.droppedEventCount).toBe(overflow);
    // The earliest still-kept event must be `overflow` — the front
    // was trimmed in order.
    const first = rec.events[0]?.data as { seq: number } | undefined;
    expect(first?.seq).toBe(overflow);
    // The last event is the most recent.
    const last = rec.events[rec.events.length - 1]?.data as { seq: number } | undefined;
    expect(last?.seq).toBe(total - 1);
  });

  test("absolute progress = droppedEventCount + events.length stays monotonic across trims", () => {
    const sessions = useSessionsStore();
    const rec = makeRecord("s1");
    sessions.sessions.push(rec);
    let prev = 0;
    for (let i = 0; i < MAX_EVENTS_PER_SESSION + 200; i++) {
      sessions.appendEvent(rec, makeEvent(i, "s1"));
      const abs = rec.droppedEventCount + rec.events.length;
      expect(abs).toBe(prev + 1);
      prev = abs;
    }
    // Total absolute progress matches total pushes.
    expect(rec.droppedEventCount + rec.events.length).toBe(
      MAX_EVENTS_PER_SESSION + 200,
    );
  });
});
