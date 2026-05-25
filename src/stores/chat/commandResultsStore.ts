import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { invokeCommand, onCommandResultEvent } from '../../ipc/invoke';
import type { CommandResultEvent, CommandResultRecord } from '../../ipc/types';
import { useToastStore } from '../app/toastStore';

export const useCommandResultsStore = defineStore('commandResults', () => {
  const recordsBySession = ref<Record<string, CommandResultRecord[]>>({});

  const runningBySession = computed(() => {
    const out: Record<string, CommandResultRecord | undefined> = {};

    for (const [sessionId, records] of Object.entries(recordsBySession.value)) {
      out[sessionId] = records.find((record) => record.status === 'running');
    }

    return out;
  });

  function upsert(record: CommandResultRecord): void {
    const existing = recordsBySession.value[record.sessionId] ?? [];
    const idx = existing.findIndex((item) => item.id === record.id);
    const next =
      idx >= 0
        ? existing.map((item) => (item.id === record.id ? record : item))
        : [...existing, record];

    recordsBySession.value = {
      ...recordsBySession.value,
      [record.sessionId]: next,
    };
  }

  function addLocal(record: CommandResultRecord): void {
    upsert(record);
  }

  function patch(
    sessionId: string,
    commandId: string,
    updater: (record: CommandResultRecord) => CommandResultRecord,
  ): void {
    const existing = recordsBySession.value[sessionId] ?? [];

    recordsBySession.value = {
      ...recordsBySession.value,
      [sessionId]: existing.map((record) => (record.id === commandId ? updater(record) : record)),
    };
  }

  function applyEvent(event: CommandResultEvent): void {
    if (event.kind === 'started' || event.kind === 'completed' || event.kind === 'cancelled') {
      upsert(event.record);

      return;
    }

    if (event.kind === 'stdout' || event.kind === 'stderr') {
      patch(event.sessionId, event.commandId, (record) => ({
        ...record,
        [event.kind]: `${record[event.kind]}${event.data}`,
      }));

      return;
    }

    if (event.kind === 'truncated') {
      patch(event.sessionId, event.commandId, (record) => ({ ...record, truncated: true }));
    }
  }

  async function refresh(sessionId: string): Promise<void> {
    const records = await invokeCommand('listCommandResults', { sessionId });

    recordsBySession.value = { ...recordsBySession.value, [sessionId]: records };
  }

  async function start(sessionId: string, command: string): Promise<CommandResultRecord> {
    const running = runningBySession.value[sessionId];

    if (running) {
      useToastStore().warn('Command already running', 'Wait for it to finish or cancel it first.');

      return running;
    }

    const record = await invokeCommand('startSessionCommand', { sessionId, command });

    upsert(record);

    return record;
  }

  async function cancel(sessionId: string, commandId: string): Promise<boolean> {
    return invokeCommand('cancelSessionCommand', { sessionId, commandId });
  }

  let unsubscribe: (() => void) | null = null;

  function ensureSubscription(): void {
    if (unsubscribe) return;

    unsubscribe = onCommandResultEvent(applyEvent);
  }

  ensureSubscription();

  return {
    recordsBySession,
    runningBySession,
    refresh,
    start,
    cancel,
    applyEvent,
    addLocal,
  };
});
