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
import type { SessionEventPayload, SessionMode } from "../ipc/types";
import { accentForIndex } from "../lib/color";
import { useToastStore } from "./toastStore";

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
};

let unsubscribe: (() => void) | null = null;

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionRecord[]>([]);
  const isCreating = ref(false);
  let creationCount = 0;

  function handleEvent(payload: SessionEventPayload): void {
    const record = sessions.value.find((s) => s.id === payload.sessionId);
    if (!record) return;
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
  }

  function ensureSubscription(): void {
    if (unsubscribe) return;
    unsubscribe = onSessionEvent(handleEvent);
  }

  async function createSession(): Promise<SessionRecord | null> {
    if (isCreating.value) return null;
    ensureSubscription();
    const toasts = useToastStore();
    isCreating.value = true;
    try {
      const id = await invokeCommand("createSession", {});
      const accent = accentForIndex(creationCount++);
      const record: SessionRecord = reactive({
        id,
        accent,
        events: [],
        model: null,
        reasoningEffort: null,
        mode: null,
        approveAll: true, // current backend default (`approveAll` permission handler)
      });
      sessions.value.push(record);
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

  async function sendMessage(sessionId: string, text: string): Promise<void> {
    await invokeCommand("sendMessage", { sessionId, text });
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

  return {
    sessions,
    isCreating,
    createSession,
    closeSession,
    sendMessage,
    setSessionModel,
    setSessionMode,
    setSessionApproveAll,
    resetSessionApprovals,
    compactSessionHistory,
    setSessionName,
  };
});
