// Owns the lifecycle of the single SDK client.
//
// The backend keeps at most one client (see `src-tauri/src/app/state.rs`);
// this store mirrors that — `ready` flips once `create_client` succeeds and
// never goes back to false within a session. Per-session state lives in
// `sessionsStore`.

import { defineStore } from "pinia";
import { ref } from "vue";
import { invokeCommand } from "../ipc/invoke";
import { useToastStore } from "./toastStore";

export const useClientStore = defineStore("client", () => {
  const ready = ref(false);
  const isCreating = ref(false);
  const lastError = ref<string | null>(null);

  async function createClient(): Promise<void> {
    if (ready.value || isCreating.value) return;
    const toasts = useToastStore();
    isCreating.value = true;
    lastError.value = null;
    try {
      const status = await invokeCommand("create_client", {});
      ready.value = true;
      toasts.success(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError.value = message;
      toasts.error("Failed to start client", message);
      throw err;
    } finally {
      isCreating.value = false;
    }
  }

  return { ready, isCreating, lastError, createClient };
});
