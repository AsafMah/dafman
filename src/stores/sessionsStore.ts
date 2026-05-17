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
import type { SessionEventPayload } from "../ipc/types";
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
  /// Tab/pane title, derived from the SDK's `session.title_changed`
  /// event (which fires once the model auto-summarises the chat).
  /// `null` until that event arrives — callers fall back to a short
  /// form of `id` for display.
  title: string | null;
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

    // Track the SDK's auto-summarised title so the dockview tab can
    // show something meaningful instead of the raw uuid.
    if (payload.eventType === "session.title_changed") {
      const title = (payload.data as { title?: unknown }).title;
      if (typeof title === "string" && title.length > 0) {
        record.title = title;
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
        title: null,
      });
      sessions.value.push(record);
      toasts.success("Session created", id);
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
      });
      sessions.value.push(record);
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

  return {
    sessions,
    isCreating,
    createSession,
    restoreSession,
    closeSession,
    sendMessage,
    setSessionModel,
  };
});
