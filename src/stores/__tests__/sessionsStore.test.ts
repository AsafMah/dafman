import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (name: string, args: unknown) => invokeMock(name, args),
    Channel: class FakeChannel {
      onmessage: ((payload: unknown) => void) | null = null;
    },
  };
});

import { useSessionsStore } from "../sessionsStore";
import { useToastStore } from "../toastStore";

describe("sessionsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
  });

  it("appends a session record on successful create", async () => {
    invokeMock.mockResolvedValueOnce("sess-1");
    const store = useSessionsStore();
    const record = await store.createSession();
    expect(record?.id).toBe("sess-1");
    expect(store.sessions).toHaveLength(1);
    expect(store.isCreating).toBe(false);
  });

  it("does not add a session and surfaces a toast on backend error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const store = useSessionsStore();
    const toasts = useToastStore();
    await expect(store.createSession()).rejects.toThrow("boom");
    expect(store.sessions).toHaveLength(0);
    expect(store.isCreating).toBe(false);
    expect(toasts.pending.some((t) => t.severity === "error")).toBe(true);
  });

  it("forwards channel events into the session's events buffer", async () => {
    invokeMock.mockImplementationOnce(async (_name, args: unknown) => {
      const { onEvent } = args as { onEvent: { onmessage?: (p: unknown) => void } };
      // Simulate the backend pushing one event before returning.
      onEvent.onmessage?.({ eventType: "session.idle", data: {} });
      return "sess-2";
    });
    const store = useSessionsStore();
    const record = await store.createSession();
    expect(record?.events).toEqual([
      { eventType: "session.idle", data: {} },
    ]);
  });

  it("removes the session from the list on closeSession even if backend errors", async () => {
    invokeMock.mockResolvedValueOnce("sess-3");
    const store = useSessionsStore();
    await store.createSession();
    expect(store.sessions).toHaveLength(1);

    invokeMock.mockRejectedValueOnce(new Error("disconnect failed"));
    await store.closeSession("sess-3");
    expect(store.sessions).toHaveLength(0);
  });
});
