// Audit log store — live tail of audit entries.
//
// Companion to logStore. Audit entries are the security trail
// (permission grants/denials, URL opens); kept in a separate
// renderer-side ring + bun-side append-only JSONL file. The Activity
// view in the Diagnostics panel binds to `entries`.

import { ref } from 'vue';
import { defineStore } from 'pinia';
import { invokeCommand, onAuditEvent } from '../../ipc/invoke';
import type { AuditEntry } from '../../ipc/types';

const RENDERER_CAP = 1000;

export const useAuditStore = defineStore('audit', () => {
  const entries = ref<AuditEntry[]>([]);
  const initialised = ref(false);
  let unsubscribe: (() => void) | null = null;

  async function ensureInitialised(): Promise<void> {
    if (initialised.value) return;

    initialised.value = true;

    try {
      const state = await invokeCommand('getAuditState', { recentLimit: 500 });

      entries.value = state.recent;
    } catch (err) {
      console.warn('[auditStore] initial load failed', err);
    }

    unsubscribe = onAuditEvent((entry) => {
      entries.value.push(entry);

      if (entries.value.length > RENDERER_CAP) {
        entries.value.splice(0, entries.value.length - RENDERER_CAP);
      }
    });
  }

  function clear(): void {
    entries.value = [];
  }

  function dispose(): void {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    initialised.value = false;
  }

  return { entries, ensureInitialised, clear, dispose };
});
