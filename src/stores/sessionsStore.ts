// Owns the list of active sessions and their event buffers.
//
// In the Electrobun rewrite every backend session event arrives on a
// single global `sessionEvent` channel (set up in `src/main.ts`); this
// store subscribes once via `onSessionEvent` and dispatches by
// `sessionId` to the right record. That replaces Tauri's per-session
// `Channel<SessionEventPayload>` and lets us keep `SessionRecord` plain
// reactive data.

import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { invokeCommand, onSessionEvent } from "../ipc/invoke";
import type {
  ReasoningVisibility,
  SessionEventPayload,
  SessionMode,
} from "../ipc/types";
import { accentForIndex } from "../lib/color";
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
};

let unsubscribe: (() => void) | null = null;

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
const MAX_PENDING_PER_SESSION = 5000;

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
  pendingEvents.clear();
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
    }
    // Both `session.start` (fresh create) and `session.resume` carry
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
  }

  function drainPending(sessionId: string, record: SessionRecord): number {
    const list = pendingEvents.get(sessionId);
    if (!list) return 0;
    pendingEvents.delete(sessionId);
    for (const event of list) applyToRecord(record, event);
    return list.length;
  }

  function ensureSubscription(): void {
    if (unsubscribe) return;
    unsubscribe = onSessionEvent(handleEvent);
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
        approveAll: true, // current backend default (`approveAll` permission handler)
        reasoningVisibilityOverride: "default",
        workingDirectory: wd && wd.length > 0 ? wd : null,
        defaultSendMode: "steer",
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
      // forked on resume (rare, but the contract allows it).
      const actualId = await invokeCommand("resumeSession", {
        sessionId,
        model: null,
        reasoningEffort: null,
      });
      // Idempotent: if a record for this id is already present (e.g.
      // double-restore), just return it.
      const existing = sessions.value.find((s) => s.id === actualId);
      if (existing) return existing;
      const accent = accentForIndex(creationCount++);
      const record: SessionRecord = reactive({
        id: actualId,
        accent,
        events: [],
        model: null,
        reasoningEffort: null,
        title: null,
        mode: null,
        approveAll: true,
        reasoningVisibilityOverride: "default",
        workingDirectory: null,
        defaultSendMode: "steer",
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
  ): Promise<void> {
    if (mode === "interrupt") {
      try {
        await invokeCommand("abortSession", { sessionId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        useToastStore().warn("Abort failed; sending anyway", message);
      }
      await invokeCommand("sendMessage", { sessionId, text });
      return;
    }
    const sdkMode = mode === "steer" ? "immediate" : "enqueue";
    await invokeCommand("sendMessage", { sessionId, text, mode: sdkMode });
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
    setSessionName,
    setSessionReasoningOverride,
  };
});
