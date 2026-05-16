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
import { generateSessionAlias } from "../lib/sessionAlias";
import { useToastStore } from "./toastStore";

export type SessionRecord = {
  id: string;
  /// Friendly two-word display name. Cosmetic only -- IPC uses `id`.
  alias: string;
  channel: Channel<SessionEventPayload>;
  events: SessionEventPayload[];
};

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionRecord[]>([]);
  const isCreating = ref(false);

  async function createSession(): Promise<SessionRecord | null> {
    if (isCreating.value) return null;
    const toasts = useToastStore();
    isCreating.value = true;
    const channel = new Channel<SessionEventPayload>();
    const events = reactive<SessionEventPayload[]>([]);
    channel.onmessage = (payload) => {
      events.push(payload);
    };
    try {
      const id = await invokeCommand("create_session", { onEvent: channel });
      const alias = generateSessionAlias();
      const record: SessionRecord = { id, alias, channel, events };
      sessions.value.push(record);
      toasts.success("Session created", alias);
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

  return { sessions, isCreating, createSession, closeSession, sendMessage };
});
