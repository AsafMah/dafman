// Live log viewer store.
//
// Subscribes to the `logEvent` bridge message on first use and keeps a
// bounded ring buffer of records. Surfaces a level filter + free-text
// search; the Diagnostics edge panel binds to these computed views.
//
// The bun side keeps its own ring buffer (1000) and sends every emitted
// record (no level filter) so the renderer can flip its display filter
// without losing context. Bun-side `setLogLevel` controls which records
// are written to the file + stderr; the in-memory subscriber stream is
// always full-fidelity.

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { invokeCommand, onLogEvent } from '@/ipc/invoke';
import type { LogLevel, LogRecord } from '@/ipc/types';

/// How many records we keep in the renderer ring buffer. Display-side
/// only; the bun side has its own (smaller) buffer for "recent" replay.
const RENDERER_CAP = 4000;

export const LEVEL_NAMES: ReadonlyArray<LogLevel> = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
] as const;

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

export const useLogStore = defineStore('logs', () => {
  const records = ref<LogRecord[]>([]);
  /// Configured bun-side level — controls what reaches disk / stderr.
  /// Independent of the renderer's display filter.
  const level = ref<LogLevel>('info');
  /// Renderer-side display filter. Records below this are dropped from
  /// the UI list (but kept in the buffer so flipping the filter
  /// reveals them again).
  const displayLevel = ref<LogLevel>('info');
  /// Free-text search (case-insensitive substring) applied to the
  /// JSON-serialised record.
  const search = ref('');

  const initialised = ref(false);
  let unsubscribe: (() => void) | null = null;

  /// Mount-time fetch + live subscription. Idempotent — safe to call
  /// from multiple panels.
  async function ensureInitialised(): Promise<void> {
    if (initialised.value) return;

    initialised.value = true;

    try {
      const state = await invokeCommand('getLogState', { recentLimit: 500 });

      level.value = state.level;
      displayLevel.value = state.level;
      records.value = state.recent;
    } catch (err) {
      console.warn('[logStore] failed to load initial state', err);
    }

    unsubscribe = onLogEvent((record) => {
      pushRecord(record);
    });
  }

  function pushRecord(record: LogRecord): void {
    records.value.push(record);

    if (records.value.length > RENDERER_CAP) {
      records.value.splice(0, records.value.length - RENDERER_CAP);
    }
  }

  /// Flip the bun-side level. Persists for the rest of the run; not
  /// stored in settings yet (TODO once we sketch Settings → Diagnostics).
  /// Throws on RPC failure so callers can toast — previously the throw
  /// was swallowed by Electrobun's plain-object bridge.
  async function setLevel(next: LogLevel): Promise<LogLevel> {
    const updated = await invokeCommand('setLogLevel', { level: next });

    level.value = updated;
    // Default the display filter to follow the bun-side level when the
    // user changes it. They can still override per-session via the
    // display dropdown.
    displayLevel.value = updated;

    return updated;
  }

  function setDisplayLevel(next: LogLevel): void {
    displayLevel.value = next;
  }

  function setSearch(next: string): void {
    search.value = next;
  }

  function clear(): void {
    records.value = [];
  }

  /// Build the diagnostics bundle. Returns the export directory path
  /// for "Reveal in file explorer" follow-on.
  async function exportBundle(): Promise<{ path: string; files: string[]; totalBytes: number }> {
    return invokeCommand('exportDiagnostics', {});
  }

  const filtered = computed<LogRecord[]>(() => {
    const minRank = LEVEL_RANK[displayLevel.value];
    const needle = search.value.trim().toLowerCase();

    return records.value.filter((r) => {
      if (LEVEL_RANK[r.level] < minRank) return false;

      if (!needle) return true;

      // Cheap substring on the serialised record. We could pre-index
      // for speed, but 4000 records with a tight search runs in ~3 ms
      // and we re-evaluate only on filter change.
      try {
        return JSON.stringify(r).toLowerCase().includes(needle);
      } catch {
        return r.message.toLowerCase().includes(needle);
      }
    });
  });

  function dispose(): void {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    initialised.value = false;
  }

  return {
    records,
    filtered,
    level,
    displayLevel,
    search,
    ensureInitialised,
    setLevel,
    setDisplayLevel,
    setSearch,
    clear,
    exportBundle,
    dispose,
  };
});
