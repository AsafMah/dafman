// Handlers for permission / user-input / elicitation events.
//
// The reducer now maintains a per-session FIFO queue
// (`ambient.pendingRequests`) of SDK-blocking callbacks. The actual
// modal lives at App.vue level — see `PendingRequestModal.vue` — and
// responds via the `respondToRequest` RPC.
//
// **Sources of state changes for the queue:**
//
//   1. **`dafman.pending_request`** — synthetic event the sessionsStore
//      pushes through the reducer when bun's `pendingRequest` channel
//      fires. This is the authoritative "the SDK is blocked" signal,
//      because the SDK callback is what gates the actual session.
//      Carries the full typed `request` payload + `requestId`.
//
//   2. **SDK `*.requested`** — informational, fires alongside the
//      callback. We DON'T set state from these because (a) the
//      payload lacks our generated requestId and (b) the bun-side
//      handler is already firing the canonical synthetic event.
//      Kept as no-ops here so the completeness test still owns the
//      events and doesn't move them to IGNORED.
//
//   3. **SDK `*.completed`** — stale-state cleanup. If the SDK
//      resolves a request out-of-band (e.g. via resume with
//      continuePendingWork:true that we don't know about), we still
//      want to clear the queue entry. Best-effort match by kind
//      since the completed event lacks our requestId — we remove
//      the OLDEST entry of the same kind. Rare path.

import { pickString } from "../chatEvents";
import type { PendingRequest } from "../chatEvents";
import type {
  ElicitationRequestData,
  PermissionRequestData,
  UserInputRequestData,
} from "../../ipc/types";
import type { Handler } from "./context";

function describePermission(data: PermissionRequestData | unknown): string {
  // Bun side already computes a `summary` field — prefer it. Fall
  // back to legacy path for the SDK informational events that lack
  // our enriched shape.
  if (data && typeof data === "object" && typeof (data as PermissionRequestData).summary === "string") {
    return (data as PermissionRequestData).summary;
  }
  return (
    pickString(data, ["summary", "description", "message"]) ||
    pickString(data, ["tool", "toolName"]) ||
    "Tool wants permission"
  );
}

function describeInput(data: UserInputRequestData | unknown): string {
  if (data && typeof data === "object" && typeof (data as UserInputRequestData).question === "string") {
    return (data as UserInputRequestData).question;
  }
  return (
    pickString(data, ["question", "prompt", "summary", "message", "description"]) ||
    "Awaiting input"
  );
}

function describeElicitation(data: ElicitationRequestData | unknown): string {
  if (data && typeof data === "object" && typeof (data as ElicitationRequestData).message === "string") {
    return (data as ElicitationRequestData).message;
  }
  return (
    pickString(data, ["message", "prompt", "summary", "description", "url"]) ||
    "Awaiting input"
  );
}

/// Removes the first queue entry whose `kind` matches AND (when a
/// requestId is provided) whose `requestId` matches. Used by the
/// `_completed` stale-state cleanup path where the SDK doesn't echo
/// our generated id.
function removePending(
  queue: PendingRequest[],
  kind: PendingRequest["kind"],
  requestId?: string,
): PendingRequest[] {
  const idx = requestId
    ? queue.findIndex((p) => p.kind === kind && p.requestId === requestId)
    : queue.findIndex((p) => p.kind === kind);
  if (idx < 0) return queue;
  const next = queue.slice();
  next.splice(idx, 1);
  return next;
}

export const notificationHandlers: Record<string, Handler> = {
  /// Synthetic event pushed by sessionsStore when the bun-side
  /// pending-request channel fires. Carries the full typed shape
  /// + requestId.
  "dafman.pending_request": (ctx, data) => {
    const d = data as
      | {
          requestId?: unknown;
          kind?: unknown;
          request?:
            | PermissionRequestData
            | UserInputRequestData
            | ElicitationRequestData
            | unknown;
        }
      | undefined;
    if (!d || typeof d.requestId !== "string" || typeof d.kind !== "string") {
      return;
    }
    // Idempotency: ignore re-pushes of the same requestId (e.g. an
    // IPC retry).
    if (ctx.ambient.pendingRequests.some((p) => p.requestId === d.requestId)) {
      return;
    }
    let entry: PendingRequest | null = null;
    switch (d.kind) {
      case "permission":
        entry = {
          kind: "permission",
          requestId: d.requestId,
          message: describePermission(d.request),
          request: d.request as PermissionRequestData,
        };
        break;
      case "userInput":
        entry = {
          kind: "userInput",
          requestId: d.requestId,
          message: describeInput(d.request),
          request: d.request as UserInputRequestData,
        };
        break;
      case "elicitation":
        entry = {
          kind: "elicitation",
          requestId: d.requestId,
          message: describeElicitation(d.request),
          request: d.request as ElicitationRequestData,
        };
        break;
    }
    if (entry) ctx.ambient.pendingRequests.push(entry);
  },

  /// Synthetic event the sessionsStore fires when the user responds
  /// via `respondToRequest`. The bun side has already resolved the
  /// SDK callback by the time this lands; we just remove the queue
  /// entry so the modal closes immediately (instead of waiting for
  /// the SDK `_completed` event, which can lag).
  "dafman.pending_response": (ctx, data) => {
    const d = data as { requestId?: unknown } | undefined;
    if (!d || typeof d.requestId !== "string") return;
    ctx.ambient.pendingRequests = ctx.ambient.pendingRequests.filter(
      (p) => p.requestId !== d.requestId,
    );
  },

  // SDK informational events — no-op for state purposes. Owned here so
  // they don't trip the completeness test.
  "permission.requested": () => {
    /* informational; state is set by dafman.pending_request */
  },
  "permission.completed": (ctx) => {
    // Stale-state cleanup: SDK said the request resolved. Drop the
    // oldest permission queue entry. If we already removed via
    // dafman.pending_response, this is a no-op.
    ctx.ambient.pendingRequests = removePending(
      ctx.ambient.pendingRequests,
      "permission",
    );
  },

  "user_input.requested": () => {
    /* informational; state is set by dafman.pending_request */
  },
  "user_input.completed": (ctx) => {
    ctx.ambient.pendingRequests = removePending(
      ctx.ambient.pendingRequests,
      "userInput",
    );
  },

  "elicitation.requested": () => {
    /* informational; state is set by dafman.pending_request */
  },
  "elicitation.completed": (ctx) => {
    ctx.ambient.pendingRequests = removePending(
      ctx.ambient.pendingRequests,
      "elicitation",
    );
  },
};
