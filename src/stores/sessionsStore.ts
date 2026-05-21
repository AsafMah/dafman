// Owns the list of active sessions and their event buffers.
//
// In the Electrobun rewrite every backend session event arrives on a
// single global `sessionEvent` channel (set up in `src/main.ts`); this
// store subscribes once via `onSessionEvent` and dispatches by
// `sessionId` to the right record. That replaces Tauri's per-session
// `Channel<SessionEventPayload>` and lets us keep `SessionRecord` plain
// reactive data.

import { defineStore } from "pinia";
import { reactive, ref, watch } from "vue";
import { invokeCommand, onPendingRequest, onSessionEvent } from "../ipc/invoke";
import type {
  ElicitationRequestData,
  PendingRequestPayload,
  PermissionRequestData,
  ReasoningVisibility,
  RespondToRequestParams,
  SessionEventPayload,
  SessionMode,
  UserInputRequestData,
} from "../ipc/types";
import { accentForIndex } from "../lib/color";
import { useLayoutStore } from "./layoutStore";
import { useNotificationsStore } from "./notificationsStore";
import { useToastStore } from "./toastStore";

/// User-facing send modes. Maps to SDK message delivery via
/// `sessionsStore.sendMessage`:
///   "steer"     -> session.send({ mode: "immediate" })
///   "queue"     -> session.send({ mode: "enqueue" })
///   "interrupt" -> session.abort() then session.send()
/// Only "steer" and "queue" are valid *default* modes (selectable from
/// the composer's SplitButton dropdown). Interrupt is always explicit.
export type SendMode = "steer" | "queue" | "interrupt";
export type DefaultSendMode = "steer" | "queue";

export type SessionRecord = {
  id: string;
  /// CSS color picked from a curated palette so the first N sessions are
  /// visually distinct.
  accent: string;
  events: SessionEventPayload[];
  /// Currently-selected model id; `null` until the user picks one or a
  /// `session.model_change` event arrives.
  model: string | null;
  /// Currently-selected reasoning effort, when the model supports it.
  reasoningEffort: string | null;
  /// Agent run mode. `null` until we fetch / observe a change.
  mode: SessionMode | null;
  /// Whether the SDK is auto-approving every permission request for this
  /// session. Tracked locally because the SDK doesn't emit an event for it.
  approveAll: boolean;
  /// Tab/pane title, derived from the SDK's `session.title_changed`
  /// event (which fires once the model auto-summarises the chat).
  /// `null` until that event arrives — callers fall back to a short
  /// form of `id` for display.
  title: string | null;
  /// Per-session override for reasoning visibility. `"default"` means
  /// fall back to `settings.appearance.reasoningVisibility`. In-memory
  /// only (we don't yet persist per-session UI preferences).
  reasoningVisibilityOverride: ReasoningVisibility | "default";
  /// Absolute filesystem path the SDK uses as `cwd` for tool invocations
  /// in this session. Populated either from the user's choice at
  /// creation time, or from the `session.start` event's
  /// `data.context.cwd` (which the CLI persists across resume).
  workingDirectory: string | null;
  /// Per-session default for the composer's primary send action. Used
  /// when the user hits Ctrl+Enter or clicks the SplitButton's main
  /// button. Initial value is "steer" — keeps the agent responsive
  /// (Ctrl+Enter while a turn is running injects rather than queues
  /// behind it). Not persisted across reloads in v1.
  defaultSendMode: DefaultSendMode;
  /// FIFO queue of SDK-blocking pending callbacks. New requests
  /// append; responses or matching `_completed` events remove by
  /// requestId. Mirrors the reducer's `ambient.pendingRequests` at
  /// the record level so cross-pane surfaces (sidebar dot, tab dot,
  /// global modal) react without the chat panel being mounted.
  pendingRequests: PendingRecordRequest[];
  /// Count of completed turns the user hasn't seen because the panel
  /// wasn't the dockview active panel at the time. Drives the
  /// "new activity" dot on the tab + sidebar row. Cleared on focus
  /// (via the `activeSessionId` watch below).
  unseenTurns: number;
  /// True while the agent is mid-turn for this session (between
  /// `assistant.turn_start` and `assistant.turn_end`). Drives the
  /// "Thinking…" indicator on the tab + sidebar row and the
  /// pending-spinner card inside the chat. The `sawTurnBoundary`
  /// flag below tracks whether we've ever observed a turn_start —
  /// SDKs that don't emit those boundaries fall back to the
  /// caller's optimistic flag (see `ChatWindow.vue::isSending`).
  isThinking: boolean;
  /// True once we've observed at least one `assistant.turn_start`.
  /// Tracks the same invariant as `ChatAmbient.sawTurnBoundary` but
  /// at the record level so other surfaces (the sidebar row) can
  /// trust `isThinking` without mounting the chat panel.
  sawTurnBoundary: boolean;
};

/// Per-record mirror of a single pending request. Matches the
/// `PendingRequest` discriminated union in `chatEvents.ts`; lives
/// here so the SessionRecord shape is self-contained (no cross-
/// module import dance from places like SessionsManager that don't
/// need the rest of the reducer).
export type PendingRecordRequest =
  | {
      kind: "permission";
      requestId: string;
      message: string;
      request: PermissionRequestData;
    }
  | {
      kind: "userInput";
      requestId: string;
      message: string;
      request: UserInputRequestData;
    }
  | {
      kind: "elicitation";
      requestId: string;
      message: string;
      request: ElicitationRequestData;
    };

let unsubscribe: (() => void) | null = null;
let unsubscribePending: (() => void) | null = null;

/// Pending events for sessions whose `SessionRecord` doesn't exist
/// yet. Triggered by the resume race: bun emits the full history via
/// `webview.rpc.send.sessionEvent` *during* the `resumeSession` RPC
/// handler — those messages travel over the same channel as the RPC
/// response and arrive at the renderer before the awaiting promise
/// resolves. Without this buffer, every replayed event (transcript,
/// `session.start`, model, title, …) would hit `handleEvent` with no
/// matching record and be silently dropped, leaving the resumed pane
/// blank.
///
/// Capped per-session so a runaway producer doesn't pin memory.
const pendingEvents = new Map<string, SessionEventPayload[]>();
const pendingRequestBuffer = new Map<string, PendingRequestPayload[]>();
const MAX_PENDING_PER_SESSION = 5000;

/// Sentinel session id used by `src/dev/Playground.vue` to exercise
/// the PendingRequestModal without a real bun-side handler. The
/// store's `respondToPending` short-circuits the RPC call when the
/// `sessionId` matches this constant so the modal can be tested in
/// isolation. Not exported — the playground constructs the same
/// string literal.
const PLAYGROUND_PENDING_SESSION_ID = "playground-pending";

/// Test-only seam: clears module-level state (subscription, buffered
/// events) so each unit test starts from a clean slate. Production
/// code never calls this — the module-level state is intentional
/// (one subscription per app lifetime) and survives store re-creation.
export function _resetSessionsStoreForTest(): void {
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch {
      /* best effort */
    }
    unsubscribe = null;
  }
  if (unsubscribePending) {
    try {
      unsubscribePending();
    } catch {
      /* best effort */
    }
    unsubscribePending = null;
  }
  pendingEvents.clear();
  pendingRequestBuffer.clear();
}

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionRecord[]>([]);
  const isCreating = ref(false);
  let creationCount = 0;

  function handleEvent(payload: SessionEventPayload): void {
    const record = sessions.value.find((s) => s.id === payload.sessionId);
    if (!record) {
      // Buffer for later — the SessionRecord is still in flight (see
      // `pendingEvents` comment). `drainPending` will replay these
      // through `applyToRecord` in order once the record materializes.
      const list = pendingEvents.get(payload.sessionId) ?? [];
      if (list.length < MAX_PENDING_PER_SESSION) {
        list.push(payload);
        pendingEvents.set(payload.sessionId, list);
      }
      if (import.meta.env.DEV) {
        console.debug(
          "[session-event] buffered",
          payload.eventType,
          payload.sessionId,
        );
      }
      return;
    }
    applyToRecord(record, payload);
  }

  function applyToRecord(record: SessionRecord, payload: SessionEventPayload): void {
    record.events.push(payload);

    if (import.meta.env.DEV) {
      console.debug("[session-event]", payload.eventType, payload.data);
    }

    // Keep model + reasoning effort in sync with backend-initiated changes
    // (rate-limit auto-switch, /model commands, etc.). The session.model_change
    // event ships both fields when applicable.
    if (payload.eventType === "session.model_change") {
      const data = payload.data as {
        newModel?: unknown;
        reasoningEffort?: unknown;
      };
      if (typeof data.newModel === "string") {
        record.model = data.newModel;
      }
      if (typeof data.reasoningEffort === "string") {
        record.reasoningEffort = data.reasoningEffort;
      }
    }

    // Backend may auto-switch the agent run mode (e.g. /plan command).
    if (payload.eventType === "session.mode_changed") {
      const data = payload.data as { newMode?: unknown };
      if (
        data.newMode === "interactive" ||
        data.newMode === "plan" ||
        data.newMode === "autopilot"
      ) {
        record.mode = data.newMode;
      }
    }

    // Track the SDK's auto-summarised title so the dockview tab can
    // show something meaningful instead of the raw uuid.
    if (payload.eventType === "session.title_changed") {
      const title = (payload.data as { title?: unknown }).title;
      if (typeof title === "string" && title.length > 0) {
        record.title = title;
      }
    }// Both `session.start` (fresh create) and `session.resume` carry
    // `data.context.cwd` from the SDK's `WorkingDirectoryContext`.
    // Resumed sessions don't fire `session.start` again, so we have
    // to listen on both — otherwise the workspace would only appear
    // on freshly-created sessions and never on restored ones.
    if (
      payload.eventType === "session.start" ||
      payload.eventType === "session.resume"
    ) {
      const ctx = (payload.data as { context?: { cwd?: unknown } }).context;
      const cwd = ctx?.cwd;
      if (typeof cwd === "string" && cwd.length > 0) {
        record.workingDirectory = cwd;
      }
    }

    // Mid-turn indicator: flips on at turn_start, off at turn_end /
    // session.idle / session.error. The reducer (`ChatAmbient`)
    // tracks the same thing inside the chat panel; this mirror lives
    // on the record so the tab + sidebar dot react without the
    // panel being mounted.
    if (payload.eventType === "assistant.turn_start") {
      record.isThinking = true;
      record.sawTurnBoundary = true;
    } else if (payload.eventType === "assistant.turn_end") {
      record.isThinking = false;
      // Unseen-activity dot + optional OS notification when the
      // session ISN'T the dock's active panel. Cleared on focus by
      // the activeSessionId watcher below.
      const layoutStore = useLayoutStore();
      if (layoutStore.activeSessionId !== record.id) {
        record.unseenTurns += 1;
        if (shouldFireForRecord(record)) {
          const notifications = useNotificationsStore();
          notifications.notify({
            kind: "turnEnd",
            title: record.title ?? `Session ${record.id.slice(0, 8)}`,
            body: "Turn complete.",
            sessionId: record.id,
            // Same tag → multiple turn-ends collapse to one entry
            // in the OS tray.
            tag: `${record.id}:turnEnd`,
          });
        }
      }
    } else if (
      payload.eventType === "session.idle" ||
      payload.eventType === "session.error"
    ) {
      record.isThinking = false;
    }

    // Stale-state cleanup for SDK-emitted `*.completed` events. The
    // dafman-internal `pendingRequest` channel is the canonical
    // source for adds (handled in `handlePendingRequest` below); we
    // remove on `_completed` as well in case the SDK resolves a
    // callback out-of-band (e.g. resume-with-continue-pending-work
    // re-emits). Best-effort match: remove the OLDEST entry of the
    // same kind since SDK events lack our generated requestId.
    let completedKind: PendingRecordRequest["kind"] | null = null;
    if (payload.eventType === "permission.completed") completedKind = "permission";
    else if (payload.eventType === "user_input.completed") completedKind = "userInput";
    else if (payload.eventType === "elicitation.completed") completedKind = "elicitation";
    if (completedKind) {
      const idx = record.pendingRequests.findIndex((p) => p.kind === completedKind);
      if (idx >= 0) record.pendingRequests.splice(idx, 1);
    }
  }

  /// True when the user can't see this session right now — either
  /// because their dockview focus is elsewhere, OR because the app
  /// window is hidden / blurred. The OS-notification call sites
  /// gate on this so notifications never fire for the session the
  /// user is actively watching.
  function shouldFireForRecord(record: SessionRecord): boolean {
    const layoutStore = useLayoutStore();
    if (layoutStore.activeSessionId !== record.id) return true;
    if (typeof document !== "undefined" && document.hidden) return true;
    if (typeof document !== "undefined" && !document.hasFocus()) return true;
    return false;
  }

  /// Bun-side `pendingRequest` push handler. Appends to the matching
  /// session's queue + fires the "waiting for input" OS notification
  /// when the session isn't the active panel. Buffers if the
  /// record doesn't exist yet (e.g. mid-resume) the same way
  /// `handleEvent` does, by storing into a synthetic
  /// `sessionEvent` and letting `drainPending` replay through
  /// `applyPendingToRecord`.
  function handlePendingRequest(payload: PendingRequestPayload): void {
    const record = sessions.value.find((s) => s.id === payload.sessionId);
    if (!record) {
      // Bun's pendingRequest channel can fire before the
      // createSession RPC promise resolves (early-session race —
      // same shape as the sessionEvent buffer). Stash on a parallel
      // queue keyed by sessionId so `drainPending` can replay.
      const list = pendingRequestBuffer.get(payload.sessionId) ?? [];
      list.push(payload);
      pendingRequestBuffer.set(payload.sessionId, list);
      return;
    }
    applyPendingToRecord(record, payload);
  }

  function applyPendingToRecord(
    record: SessionRecord,
    payload: PendingRequestPayload,
  ): void {
    // Idempotency: drop duplicate pushes of the same requestId.
    if (record.pendingRequests.some((p) => p.requestId === payload.requestId)) {
      return;
    }
    let entry: PendingRecordRequest;
    switch (payload.kind) {
      case "permission":
        entry = {
          kind: "permission",
          requestId: payload.requestId,
          message: payload.request.summary,
          request: payload.request,
        };
        break;
      case "userInput":
        entry = {
          kind: "userInput",
          requestId: payload.requestId,
          message: payload.request.question,
          request: payload.request,
        };
        break;
      case "elicitation":
        entry = {
          kind: "elicitation",
          requestId: payload.requestId,
          message: payload.request.message,
          request: payload.request,
        };
        break;
    }
    record.pendingRequests.push(entry);
    // Also push a synthetic `dafman.pending_request` event into the
    // record's event buffer so the reducer (which only sees the
    // event stream) builds the same queue inside `ChatAmbient`.
    record.events.push({
      sessionId: record.id,
      eventType: "dafman.pending_request",
      data: payload as unknown as Record<string, unknown>,
    });
    if (shouldFireForRecord(record)) {
      const notifications = useNotificationsStore();
      notifications.notify({
        kind: "waitingForInput",
        title: record.title ?? `Session ${record.id.slice(0, 8)}`,
        body: entry.message,
        sessionId: record.id,
        tag: `${record.id}:pendingRequest:${entry.requestId}`,
      });
    }
  }

  function drainPending(sessionId: string, record: SessionRecord): number {
    const list = pendingEvents.get(sessionId);
    if (list) {
      pendingEvents.delete(sessionId);
      for (const event of list) applyToRecord(record, event);
    }
    const pendingList = pendingRequestBuffer.get(sessionId);
    if (pendingList) {
      pendingRequestBuffer.delete(sessionId);
      for (const p of pendingList) applyPendingToRecord(record, p);
    }
    return (list?.length ?? 0) + (pendingList?.length ?? 0);
  }

  function ensureSubscription(): void {
    if (unsubscribe) return;
    unsubscribe = onSessionEvent(handleEvent);
    unsubscribePending = onPendingRequest(handlePendingRequest);
    // Clear the "unseen activity" dot on the session the user just
    // brought into focus. Watching layoutStore.activeSessionId means
    // we react to dockview's onDidActivePanelChange + onDidActiveGroupChange
    // (those drive activeSessionId in layoutStore.setApi).
    const layoutStore = useLayoutStore();
    watch(
      () => layoutStore.activeSessionId,
      (sid) => {
        if (!sid) return;
        const record = sessions.value.find((s) => s.id === sid);
        if (record && record.unseenTurns > 0) {
          record.unseenTurns = 0;
        }
      },
      { immediate: true },
    );
  }

  async function createSession(opts: { workingDirectory?: string } = {}): Promise<SessionRecord | null> {
    if (isCreating.value) return null;
    ensureSubscription();
    const toasts = useToastStore();
    isCreating.value = true;
    try {
      const wd = opts.workingDirectory?.trim();
      const id = await invokeCommand("createSession", {
        ...(wd ? { workingDirectory: wd } : {}),
      });
      const accent = accentForIndex(creationCount++);
      const record: SessionRecord = reactive({
        id,
        accent,
        events: [],
        model: null,
        reasoningEffort: null,
        title: null,
        mode: null,
        approveAll: false, // dafman handler now drives permissions; default is interactive
        reasoningVisibilityOverride: "default",
        workingDirectory: wd && wd.length > 0 ? wd : null,
        defaultSendMode: "steer",

        pendingRequests: [],
        unseenTurns: 0,
        isThinking: false,
        sawTurnBoundary: false,
      });
      sessions.value.push(record);
      drainPending(id, record);
      toasts.success("Session created", id);
      // Fire-and-forget: get the current run mode so the UI shows it.
      // Re-look up the record by id when the RPC resolves — if the
      // session was closed in the meantime it's no longer in
      // `sessions.value` and we must not mutate a stale closure capture.
      void invokeCommand("getSessionMode", { sessionId: id })
        .then((mode) => {
          const current = sessions.value.find((s) => s.id === id);
          if (current) current.mode = mode;
        })
        .catch(() => {
          /* mode RPC may be unavailable on older CLI hosts; ignore */
        });
      return record;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to create session", message);
      throw err;
    } finally {
      isCreating.value = false;
    }
  }

  /// Resumes a previously-created session by id (typically called
  /// during startup from persisted layout). Returns the new
  /// SessionRecord, or `null` if the SDK could not resume (deleted /
  /// corrupted / unknown id). Errors are reported as info toasts since
  /// "the user deleted this session via the CLI" is a common, benign
  /// case — we just drop the pane.
  async function restoreSession(sessionId: string): Promise<SessionRecord | null> {
    ensureSubscription();
    const toasts = useToastStore();
    try {
      // The bun RPC handler may return a different id if the SDK
      // forked on resume (rare, but the contract allows it). `cwd`
      // comes from the session catalog, not the event stream —
      // `getMessages()` history doesn't include `session.resume`, so
      // the workspace chip would otherwise stay hidden after restore.
      const response = await invokeCommand("resumeSession", {
        sessionId,
        model: null,
        reasoningEffort: null,
      });
      const actualId = response.sessionId;
      // Idempotent: if a record for this id is already present (e.g.
      // double-restore), just return it.
      const existing = sessions.value.find((s) => s.id === actualId);
      if (existing) {
        // Still backfill cwd if the existing record is missing it.
        if (!existing.workingDirectory && response.cwd) {
          existing.workingDirectory = response.cwd;
        }
        return existing;
      }
      const accent = accentForIndex(creationCount++);
      const record: SessionRecord = reactive({
        id: actualId,
        accent,
        events: [],
        model: null,
        reasoningEffort: null,
        title: null,
        mode: null,
        approveAll: false,
        reasoningVisibilityOverride: "default",
        workingDirectory: response.cwd ?? null,
        defaultSendMode: "steer",

        pendingRequests: [],
        unseenTurns: 0,
        isThinking: false,
        sawTurnBoundary: false,
      });
      sessions.value.push(record);
      // Drain any events that arrived between bun-side `resume()` and
      // the RPC response reaching us — chiefly the history replay
      // (assistant.message_*, tool.*, session.start, …), which would
      // otherwise be lost and the pane would render blank.
      const drained = drainPending(actualId, record);
      if (import.meta.env.DEV) {
        console.debug(
          "[restoreSession] resumed",
          {
            requestedId: sessionId,
            actualId,
            drainedEvents: drained,
            recordEvents: record.events.length,
          },
        );
      }
      // Pick up the run mode the SDK is currently using for the
      // restored session — same fire-and-forget shape as createSession.
      void invokeCommand("getSessionMode", { sessionId: actualId })
        .then((mode) => {
          const current = sessions.value.find((s) => s.id === actualId);
          if (current) current.mode = mode;
        })
        .catch(() => {
          /* mode RPC may be unavailable on older CLI hosts; ignore */
        });
      return record;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.info(
        "Session not restored",
        `${sessionId.slice(0, 8)}…: ${message}`,
      );
      return null;
    }
  }

  async function closeSession(id: string): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("disconnectSession", { sessionId: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to close session", message);
    } finally {
      sessions.value = sessions.value.filter((s) => s.id !== id);
    }
  }

  /// Sends a message with the given mode.
  /// - "steer" (default in v1): SDK `mode: "immediate"` — injects into a
  ///   running turn if any, otherwise starts a new one.
  /// - "queue": SDK `mode: "enqueue"` — waits behind the in-flight turn.
  /// - "interrupt": abort current turn, then send a fresh one. The abort
  ///   call resolves on SDK ack (not on idle); for v1 we let the SDK
  ///   handle the rejoin race rather than waiting for `session.idle`
  ///   ourselves. If we observe ordering issues we'll add a wait-for-idle
  ///   gate (rubber-duck flagged this in the original plan).
  async function sendMessage(
    sessionId: string,
    text: string,
    mode: SendMode = "steer",
    attachments?: import("../ipc/types").SendMessageAttachment[],
  ): Promise<void> {
    const atts = attachments && attachments.length > 0 ? attachments : undefined;
    if (mode === "interrupt") {
      try {
        await invokeCommand("abortSession", { sessionId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        useToastStore().warn("Abort failed; sending anyway", message);
      }
      await invokeCommand("sendMessage", {
        sessionId,
        text,
        ...(atts ? { attachments: atts } : {}),
      });
      return;
    }
    const sdkMode = mode === "steer" ? "immediate" : "enqueue";
    await invokeCommand("sendMessage", {
      sessionId,
      text,
      mode: sdkMode,
      ...(atts ? { attachments: atts } : {}),
    });
  }

  async function abortSession(sessionId: string): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("abortSession", { sessionId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to abort turn", message);
      throw err;
    }
  }

  /// In-memory only — the per-session default for the composer's primary
  /// send action. Mutating this updates `SessionRecord.defaultSendMode`,
  /// which the composer subscribes to.
  function setDefaultSendMode(
    sessionId: string,
    next: DefaultSendMode,
  ): void {
    const record = sessions.value.find((s) => s.id === sessionId);
    if (record) record.defaultSendMode = next;
  }

  async function setSessionModel(
    sessionId: string,
    model: string,
    reasoningEffort: string | null,
  ): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("setSessionModel", {
        sessionId,
        model,
        reasoningEffort,
      });
      const record = sessions.value.find((s) => s.id === sessionId);
      if (record) {
        record.model = model;
        record.reasoningEffort = reasoningEffort;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to switch model", message);
      throw err;
    }
  }

  async function setSessionMode(
    sessionId: string,
    mode: SessionMode,
  ): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("setSessionMode", { sessionId, mode });
      const record = sessions.value.find((s) => s.id === sessionId);
      if (record) record.mode = mode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to change run mode", message);
      throw err;
    }
  }

  async function setSessionApproveAll(
    sessionId: string,
    enabled: boolean,
  ): Promise<void> {
    // Playground sentinel: skip the RPC (no real bun session) but
    // still mirror the flag onto the in-memory record so the UI
    // reflects the toggle for inline testing.
    if (sessionId === PLAYGROUND_PENDING_SESSION_ID) {
      const record = sessions.value.find((s) => s.id === sessionId);
      if (record) record.approveAll = enabled;
      return;
    }
    const toasts = useToastStore();
    try {
      await invokeCommand("setSessionApproveAll", { sessionId, enabled });
      const record = sessions.value.find((s) => s.id === sessionId);
      if (record) record.approveAll = enabled;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to update auto-approval", message);
      throw err;
    }
  }

  async function resetSessionApprovals(sessionId: string): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("resetSessionApprovals", { sessionId });
      toasts.success("Session approvals cleared", sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to reset approvals", message);
      throw err;
    }
  }

  async function compactSessionHistory(sessionId: string): Promise<void> {
    const toasts = useToastStore();
    try {
      const result = await invokeCommand("compactSessionHistory", {
        sessionId,
      });
      if (result.success) {
        const parts: string[] = [];
        if (result.tokensFreed !== null) {
          parts.push(`${result.tokensFreed.toLocaleString()} tokens freed`);
        }
        if (result.messagesRemoved !== null) {
          parts.push(`${result.messagesRemoved} messages removed`);
        }
        toasts.success(
          "History compacted",
          parts.length > 0 ? parts.join(", ") : undefined,
        );
      } else {
        toasts.warn("Compaction did not complete", sessionId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to compact history", message);
      throw err;
    }
  }

  /// Truncate the session's history to (and including) `eventId`,
  /// then send the new text. Used by the Edit action on a user
  /// message: the user supplies replacement text in the composer,
  /// the SDK is told to forget from that point onward, and the new
  /// message is dispatched fresh.
  async function editUserMessage(
    sessionId: string,
    eventId: string,
    newText: string,
  ): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("truncateSessionHistory", { sessionId, eventId });
      // Drop local items at the truncation point too — otherwise we
      // double-render the edited message until the SDK echoes it.
      const record = sessions.value.find((s) => s.id === sessionId);
      if (record) {
        const idx = record.events.findIndex((e) => e.eventId === eventId);
        if (idx >= 0) record.events.splice(idx);
      }
      await invokeCommand("sendMessage", { sessionId, text: newText });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to edit message", message);
      throw err;
    }
  }

  /// Truncate to `eventId` (typically the preceding user message)
  /// and re-send its text — "retry from here" semantics. Caller
  /// passes the resolved user text so the store doesn't need to
  /// search the items array.
  async function retryFromEvent(
    sessionId: string,
    eventId: string,
    userText: string,
  ): Promise<void> {
    return editUserMessage(sessionId, eventId, userText);
  }

  /// Fork the session at an optional event boundary. When the new
  /// session id resolves, restoreSession opens it as a panel. Returns
  /// the new session id so the caller can route to it / focus it.
  async function forkSession(
    sessionId: string,
    toEventId?: string,
  ): Promise<string> {
    const toasts = useToastStore();
    try {
      const result = await invokeCommand("forkSession", {
        sessionId,
        ...(toEventId ? { toEventId } : {}),
      });
      await restoreSession(result.sessionId);
      return result.sessionId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to fork session", message);
      throw err;
    }
  }

  /// Fork-and-send: fork the session at the given event boundary,
  /// then send `newText` as the first user message in the new
  /// session. Returns the new session id so the caller can open it
  /// as a panel.
  async function forkAndSend(
    sessionId: string,
    toEventId: string,
    newText: string,
  ): Promise<string> {
    const newId = await forkSession(sessionId, toEventId);
    await sendMessage(newId, newText);
    return newId;
  }

  /// Best-effort lookup for the loaded session that matches a
  /// free-form name. Used by the fork-notice chip to resolve a
  /// CLI-supplied "name" to a sessionId we can activate. Matches
  /// exact title, then title-startsWith, then short-id prefix
  /// (CLI's default fork name format is `Session <8 hex>...`).
  function findSessionByName(name: string): SessionRecord | undefined {
    if (!name) return undefined;
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    const records = sessions.value;
    const exact = records.find((s) => (s.title ?? "").toLowerCase() === lower);
    if (exact) return exact;
    const titleStarts = records.find((s) =>
      (s.title ?? "").toLowerCase().startsWith(lower),
    );
    if (titleStarts) return titleStarts;
    const m = trimmed.match(/([0-9a-f]{4,})/i);
    if (m && m[1]) {
      const prefix = m[1].toLowerCase();
      const byId = records.find((s) => s.id.toLowerCase().startsWith(prefix));
      if (byId) return byId;
    }
    return undefined;
  }

  async function setSessionName(
    sessionId: string,
    name: string,
  ): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("setSessionName", { sessionId, name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to rename session", message);
      throw err;
    }
  }

  /// Per-session UI override for reasoning visibility. `"default"`
  /// means inherit from `settings.appearance.reasoningVisibility`.
  /// In-memory only — not persisted across reloads. No backend RPC.
  function setSessionReasoningOverride(
    sessionId: string,
    value: ReasoningVisibility | "default",
  ): void {
    const record = sessions.value.find((s) => s.id === sessionId);
    if (record) record.reasoningVisibilityOverride = value;
  }

  /// Sends the user's answer to a pending SDK callback. The bun
  /// side resolves the awaiting Promise; the matching queue entry
  /// is removed locally immediately (don't wait for the SDK
  /// `_completed` echo, which can lag), and we also push a
  /// synthetic `dafman.pending_response` into the record's event
  /// buffer so the reducer's `ambient.pendingRequests` queue +
  /// in-stream card both clear in the same tick.
  ///
  /// The `PLAYGROUND_PENDING_SESSION_ID` sentinel short-circuits
  /// the RPC call so the dev playground can exercise the card
  /// without a real bun-side handler (which would reject with
  /// `Session ${id} not found`).
  async function respondToPending(
    params: RespondToRequestParams,
  ): Promise<void> {
    const record = sessions.value.find((s) => s.id === params.sessionId);
    if (record) {
      const idx = record.pendingRequests.findIndex(
        (p) => p.requestId === params.requestId,
      );
      if (idx >= 0) record.pendingRequests.splice(idx, 1);
      record.events.push({
        sessionId: record.id,
        eventType: "dafman.pending_response",
        data: { requestId: params.requestId, kind: params.response.kind },
      });
    }
    if (params.sessionId === PLAYGROUND_PENDING_SESSION_ID) return;
    try {
      await invokeCommand("respondToRequest", params);
    } catch (err) {
      const toasts = useToastStore();
      toasts.error(
        "Failed to send response",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    sessions,
    isCreating,
    createSession,
    restoreSession,
    closeSession,
    sendMessage,
    abortSession,
    setDefaultSendMode,
    setSessionModel,
    setSessionMode,
    setSessionApproveAll,
    resetSessionApprovals,
    compactSessionHistory,
    editUserMessage,
    retryFromEvent,
    forkSession,
    forkAndSend,
    findSessionByName,
    setSessionName,
    setSessionReasoningOverride,
    respondToPending,
  };
});

