import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { invokeCommand, onTerminalEvent } from '@/ipc/invoke';
import type { TerminalEventPayload, TerminalSummary } from '@/ipc/types';
import { useToastStore } from '@/stores/app/toastStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { usePersistedRef } from '@/composables/usePersistedRef';

const MAX_BUFFER = 256_000;
const MAX_COMMANDS_PER_TERMINAL = 200;
const SESSION_TERMINALS_KEY = 'dafman.sessionTerminals';
const SESSION_TERMINAL_BUFFERS_KEY = 'dafman.sessionTerminalBuffers';
/// Buffers are written on every terminal output frame; coalesce to
/// one localStorage write per 250 ms so a chatty `ls -R` doesn't
/// serialise a 256 KB string 200 times in a second.
const BUFFER_THROTTLE_MS = 250;

function validateStringMap(parsed: unknown): Record<string, string> | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const out: Record<string, string> = {};

  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }

  return out;
}

function capBuffers(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [k, v] of Object.entries(map)) {
    out[k] = v.length > MAX_BUFFER ? v.slice(-MAX_BUFFER) : v;
  }

  return out;
}

export interface TerminalCommandRecord {
  id: string;
  command?: string;
  cwd?: string;
  output?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  protocol: 'osc633' | 'osc133';
  trusted: boolean;
}

export const useTerminalStore = defineStore('terminals', () => {
  const terminals = ref<TerminalSummary[]>([]);
  const buffers = ref<Record<string, string>>({});
  const commands = ref<Record<string, TerminalCommandRecord[]>>({});
  const currentCwd = ref<Record<string, string>>({});
  const activeCommands = ref<Record<string, TerminalCommandRecord>>({});
  const droppedCommandCounts = ref<Record<string, number>>({});
  const loaded = ref(false);
  const sessionTerminalIds = usePersistedRef<Record<string, string>>(
    SESSION_TERMINALS_KEY,
    {},
    { validate: validateStringMap },
  );
  const sessionTerminalBuffers = usePersistedRef<Record<string, string>>(
    SESSION_TERMINAL_BUFFERS_KEY,
    {},
    {
      validate: (parsed) => {
        const map = validateStringMap(parsed);

        return map ? capBuffers(map) : null;
      },
      cap: capBuffers,
      throttleMs: BUFFER_THROTTLE_MS,
    },
  );
  const activeRendererOwner = ref<Record<string, 'compact' | 'full'>>({});

  const running = computed(() =>
    terminals.value.filter((t) => t.status === 'running' || t.status === 'exiting'),
  );

  async function refresh(): Promise<void> {
    terminals.value = await invokeCommand('listTerminals', {});
    const nextMap = { ...sessionTerminalIds.value };

    for (const terminal of terminals.value) {
      if (terminal.sessionId && terminal.status === 'running') {
        nextMap[terminal.sessionId] = terminal.id;
      }
    }

    sessionTerminalIds.value = nextMap;
    loaded.value = true;
  }

  async function createTerminal(params: {
    cwd?: string;
    shell?: string;
    args?: string[];
    cols?: number;
    rows?: number;
    title?: string;
    sessionId?: string;
  }): Promise<TerminalSummary> {
    const summary = await invokeCommand('createTerminal', params);

    upsert(summary);

    return summary;
  }

  async function getOrCreateSessionTerminal(sessionId: string): Promise<TerminalSummary> {
    const existingId = sessionTerminalIds.value[sessionId];
    const existing = existingId
      ? terminals.value.find((terminal) => terminal.id === existingId)
      : null;

    if (existing && existing.status === 'running') return existing;

    const linked = terminals.value.find(
      (terminal) => terminal.sessionId === sessionId && terminal.status === 'running',
    );

    if (linked) {
      sessionTerminalIds.value = { ...sessionTerminalIds.value, [sessionId]: linked.id };

      return linked;
    }

    const session = useSessionsStore().getSession(sessionId);
    const summary = await createTerminal({
      cols: 80,
      rows: 8,
      ...(session?.workingDirectory ? { cwd: session.workingDirectory } : {}),
      sessionId,
      title: 'Session Shell',
    });
    const restored = sessionTerminalBuffers.value[sessionId];

    if (restored) {
      buffers.value = { ...buffers.value, [summary.id]: restored };
    }

    sessionTerminalIds.value = { ...sessionTerminalIds.value, [sessionId]: summary.id };

    return summary;
  }

  async function writeTerminal(terminalId: string, data: string): Promise<boolean> {
    return invokeCommand('writeTerminal', { terminalId, data });
  }

  async function resizeTerminal(terminalId: string, cols: number, rows: number): Promise<boolean> {
    return invokeCommand('resizeTerminal', { terminalId, cols, rows });
  }

  async function killTerminal(terminalId: string): Promise<boolean> {
    const ok = await invokeCommand('killTerminal', { terminalId });

    await refresh().catch(() => {});

    return ok;
  }

  function upsert(summary: TerminalSummary): void {
    const idx = terminals.value.findIndex((t) => t.id === summary.id);

    if (idx >= 0) terminals.value.splice(idx, 1, summary);
    else terminals.value.push(summary);

    if (summary.sessionId && summary.status === 'running') {
      sessionTerminalIds.value = {
        ...sessionTerminalIds.value,
        [summary.sessionId]: summary.id,
      };
    }
  }

  function applyEvent(event: TerminalEventPayload): void {
    if (event.kind === 'output') {
      const prev = buffers.value[event.terminalId] ?? '';
      const next = `${prev}${event.data}`;
      const capped = next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next;

      buffers.value = {
        ...buffers.value,
        [event.terminalId]: capped,
      };
      const terminal = terminals.value.find((t) => t.id === event.terminalId);

      if (terminal?.sessionId) {
        sessionTerminalBuffers.value = {
          ...sessionTerminalBuffers.value,
          [terminal.sessionId]: capped,
        };
      }

      return;
    }

    if (event.kind === 'status' || event.kind === 'exit') {
      upsert(event.summary);

      return;
    }

    if (event.kind === 'error') {
      useToastStore().error('Terminal error', event.message);
    }
  }

  function updateTerminalCwd(terminalId: string, cwd: string): void {
    currentCwd.value = { ...currentCwd.value, [terminalId]: cwd };
  }

  function startCommand(
    terminalId: string,
    command: Omit<TerminalCommandRecord, 'id' | 'startedAt'> & { startedAt?: string },
  ): TerminalCommandRecord {
    const record: TerminalCommandRecord = {
      id: crypto.randomUUID(),
      startedAt: command.startedAt ?? new Date().toISOString(),
      ...command,
    };

    activeCommands.value = { ...activeCommands.value, [terminalId]: record };

    return record;
  }

  function updateActiveCommand(
    terminalId: string,
    patch: Partial<Omit<TerminalCommandRecord, 'id' | 'startedAt'>>,
  ): void {
    const record = activeCommands.value[terminalId];

    if (!record) return;

    activeCommands.value = {
      ...activeCommands.value,
      [terminalId]: { ...record, ...patch },
    };
  }

  function finishCommand(
    terminalId: string,
    exitCode?: number,
    output?: string,
  ): TerminalCommandRecord | null {
    const record = activeCommands.value[terminalId];

    if (!record) return null;

    const finished: TerminalCommandRecord = {
      ...record,
      ...(output !== undefined ? { output } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
      endedAt: new Date().toISOString(),
    };
    const { [terminalId]: _, ...nextActive } = activeCommands.value;

    activeCommands.value = nextActive;
    const existing = commands.value[terminalId] ?? [];
    const next = [...existing, finished];
    const overflow = Math.max(0, next.length - MAX_COMMANDS_PER_TERMINAL);

    commands.value = {
      ...commands.value,
      [terminalId]: overflow > 0 ? next.slice(overflow) : next,
    };

    if (overflow > 0) {
      droppedCommandCounts.value = {
        ...droppedCommandCounts.value,
        [terminalId]: (droppedCommandCounts.value[terminalId] ?? 0) + overflow,
      };
    }

    return finished;
  }

  let unsubscribe: (() => void) | null = null;

  function ensureSubscription(): void {
    if (unsubscribe) return;

    unsubscribe = onTerminalEvent(applyEvent);
  }

  // sessionTerminalIds + sessionTerminalBuffers hydrate themselves
  // via usePersistedRef on construction; no explicit hydrate needed.
  ensureSubscription();
  void refresh().catch(() => {
    /* app may be starting; explicit actions surface errors */
  });

  function claimRenderer(terminalId: string, owner: 'compact' | 'full'): void {
    activeRendererOwner.value = { ...activeRendererOwner.value, [terminalId]: owner };
  }

  function releaseRenderer(terminalId: string, owner: 'compact' | 'full'): void {
    if (activeRendererOwner.value[terminalId] === owner) {
      const { [terminalId]: _, ...next } = activeRendererOwner.value;

      activeRendererOwner.value = next;
    }
  }

  return {
    terminals,
    buffers,
    commands,
    currentCwd,
    activeCommands,
    droppedCommandCounts,
    sessionTerminalIds,
    sessionTerminalBuffers,
    activeRendererOwner,
    loaded,
    running,
    refresh,
    createTerminal,
    getOrCreateSessionTerminal,
    writeTerminal,
    resizeTerminal,
    killTerminal,
    applyEvent,
    updateTerminalCwd,
    startCommand,
    updateActiveCommand,
    finishCommand,
    claimRenderer,
    releaseRenderer,
  };
});
