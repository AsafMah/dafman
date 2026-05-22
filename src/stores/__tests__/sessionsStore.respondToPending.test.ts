/// respondToPending rollback on RPC failure.
///
/// Before 20a, respondToPending spliced the pending request entry +
/// appended the dafman.pending_response event BEFORE awaiting the
/// bun-side RPC. If the RPC threw (e.g. session disconnected mid-
/// flight), the UI would drop the card while the SDK still had the
/// request open, leaving the user stuck.
///
/// Now: snapshot the entry + its index BEFORE the splice, and
/// re-insert it in catch. This test asserts both the rollback
/// shape AND the error toast.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import {
  setRpcBridge,
  type RpcBridge,
  type PendingRequestListener,
  type SessionEventListener,
} from "../../ipc/invoke";
import { useSessionsStore, _resetSessionsStoreForTest } from "../sessionsStore";
import { useToastStore } from "../toastStore";
import type {
  CommandMap,
  CommandName,
  PendingRequestPayload,
  SessionEventPayload,
} from "../../ipc/types";

function makeBridge(opts: {
  respondToRequestShouldThrow?: boolean;
}): {
  bridge: RpcBridge;
  fire: (payload: SessionEventPayload) => void;
  firePending: (payload: PendingRequestPayload) => void;
} {
  const sessionListeners = new Set<SessionEventListener>();
  const pendingListeners = new Set<PendingRequestListener>();
  const fire = (payload: SessionEventPayload) => {
    for (const l of sessionListeners) l(payload);
  };
  const firePending = (payload: PendingRequestPayload) => {
    for (const l of pendingListeners) l(payload);
  };
  const bridge: RpcBridge = {
    request: (async <N extends CommandName>(
      name: N,
      args: CommandMap[N]["args"],
    ) => {
      if (name === "resumeSession") {
        return { sessionId: (args as { sessionId: string }).sessionId, cwd: null } as unknown as CommandMap[N]["result"];
      }
      if (name === "respondToRequest") {
        if (opts.respondToRequestShouldThrow) {
          throw new Error("AppErrorPayload:" + JSON.stringify({ kind: "Sdk", data: "session gone" }));
        }
        return true as unknown as CommandMap[N]["result"];
      }
      return undefined as unknown as CommandMap[N]["result"];
    }) as RpcBridge["request"],
    onSessionEvent: (l) => {
      sessionListeners.add(l);
      return () => sessionListeners.delete(l);
    },
    onPendingRequest: (l) => {
      pendingListeners.add(l);
      return () => pendingListeners.delete(l);
    },
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };
  return { bridge, fire, firePending };
}

async function seedPendingRequest(
  store: ReturnType<typeof useSessionsStore>,
  firePending: (p: PendingRequestPayload) => void,
  sessionId: string,
  requestId: string,
): Promise<void> {
  await store.restoreSession(sessionId);
  firePending({
    sessionId,
    requestId,
    kind: "permission",
    request: { kind: "shell", summary: "ls", raw: { kind: "shell" } },
  });
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("sessionsStore.respondToPending — rollback on RPC failure", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
  });

  afterEach(() => {
    setRpcBridge(null);
  });

  test("happy path: splices entry, never restores it", async () => {
    const { bridge, firePending } = makeBridge({ respondToRequestShouldThrow: false });
    setRpcBridge(bridge);
    const store = useSessionsStore();
    await seedPendingRequest(store, firePending, "s1", "req-1");

    const record = store.sessions.find((s) => s.id === "s1");
    expect(record?.pendingRequests).toHaveLength(1);

    await store.respondToPending({
      sessionId: "s1",
      requestId: "req-1",
      response: { kind: "approve-once" },
    });

    expect(record?.pendingRequests).toEqual([]);
  });

  test("RPC failure: restores the pending entry + fires error toast", async () => {
    const { bridge, firePending } = makeBridge({ respondToRequestShouldThrow: true });
    setRpcBridge(bridge);
    const store = useSessionsStore();
    const toasts = useToastStore();
    await seedPendingRequest(store, firePending, "s1", "req-1");

    const record = store.sessions.find((s) => s.id === "s1");
    expect(record?.pendingRequests).toHaveLength(1);
    const before = record!.pendingRequests[0];

    await store.respondToPending({
      sessionId: "s1",
      requestId: "req-1",
      response: { kind: "approve-once" },
    });

    // Rollback: pending entry is back in place, same identity.
    expect(record?.pendingRequests).toHaveLength(1);
    expect(record?.pendingRequests[0]).toBe(before);

    // Error toast queued.
    const errs = toasts.pending.filter((t) => t.severity === "error");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0]?.summary).toBe("Failed to send response");
  });
});
