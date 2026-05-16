// Owns the list of active sessions and their per-session event buffers.
//
// Each session is paired with a `tauri::ipc::Channel<SessionEventPayload>`;
// events push into the session's `events` array which `ChatWindow.vue`
// watches. The store handles optimistic add/rollback so the UI never shows
// half-created sessions if the backend rejects `create_session`.

import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { Channel } from "@tauri-apps/api/core";
import type { SessionEventPayload } from "../ipc/types";
import { invokeCommand } from "../ipc/invoke";
import { accentForIndex } from "../lib/color";
import { useToastStore } from "./toastStore";

export type SessionRecord = {
  id: string;
  /// CSS color picked from a curated palette so the first N sessions are
  /// visually distinct.
  accent: string;
  channel: Channel<SessionEventPayload>;
  events: SessionEventPayload[];
  /// Currently-selected model id; `null` until the user picks one or a
  /// `session.model_change` event arrives.
  model: string | null;
  /// Currently-selected reasoning effort, when the model supports it.
  reasoningEffort: string | null;
};

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionRecord[]>([]);
  const isCreating = ref(false);
  let creationCount = 0;

  async function createSession(): Promise<SessionRecord | null> {
    if (isCreating.value) return null;
    const toasts = useToastStore();
    isCreating.value = true;
    const channel = new Channel<SessionEventPayload>();
    const events = reactive<SessionEventPayload[]>([]);
    channel.onmessage = (payload) => {
      events.push(payload);
      // Dev-time visibility into the raw wire shape -- helps debug when a
      // new SDK version drifts field names. Visible in the browser
      // devtools when "Verbose" logging is enabled.
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
        const record = sessions.value.find((s) => s.id === pendingId);
        if (record && typeof data.newModel === "string") {
          record.model = data.newModel;
        }
        if (record && typeof data.reasoningEffort === "string") {
          record.reasoningEffort = data.reasoningEffort;
        }
      }
    };
    let pendingId: string | null = null;
    try {
      const id = await invokeCommand("create_session", { onEvent: channel });
      pendingId = id;
      const accent = accentForIndex(creationCount++);
      const record: SessionRecord = {
        id,
        accent,
        channel,
        events,
        model: null,
        reasoningEffort: null,
      };
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

  async function closeSession(id: string): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("disconnect_session", { sessionId: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toasts.error("Failed to close session", message);
    } finally {
      sessions.value = sessions.value.filter((s) => s.id !== id);
    }
  }

  async function sendMessage(sessionId: string, text: string): Promise<void> {
    await invokeCommand("send_message", { sessionId, text });
  }

  async function setSessionModel(
    sessionId: string,
    model: string,
    reasoningEffort: string | null,
  ): Promise<void> {
    const toasts = useToastStore();
    try {
      await invokeCommand("set_session_model", {
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
    closeSession,
    sendMessage,
    setSessionModel,
  };
});
