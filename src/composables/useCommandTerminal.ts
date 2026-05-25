// Composable for managing the embedded command terminal in a chat session.
//
// Extracted from ChatWindow.vue to reduce its size. Owns the PTY lifecycle
// (create/focus/close), the watcher that converts shell-integration command
// records into `CommandResultRecord`s, and the auto-attach flow that inserts
// command-result pills into the composer.

import { nextTick, ref, watch, type Ref } from 'vue';

import { useCommandResultsStore } from '@/stores/chat/commandResultsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useTerminalStore } from '@/stores/terminal/terminalStore';
import { useToastStore } from '@/stores/app/toastStore';
import { cleanTerminalCommandOutput } from '@/lib/ansi';
import { toErrorMessage } from '@/lib/errorMessage';
import type { CommandResultRecord, SendMessageAttachment } from '@/ipc/types';

export interface CommandTerminalRefs {
  /// Ref to the composer component, used for addAttachment / exitCommandMode.
  composerRef: Ref<{
    focus: () => void;
    appendText?: (text: string) => void;
    addAttachment?: (attachment: SendMessageAttachment) => void;
    exitCommandMode?: () => void;
    enterCommandMode?: () => void;
  } | null>;
}

export interface CommandTerminalReturn {
  commandTerminalId: Ref<string>;
  commandModeOpenedAt: Ref<number>;
  commandResults: Ref<CommandResultRecord[]>;
  commandResultOrder: Ref<Record<string, number>>;
  ensureCommandTerminal: () => Promise<string | null>;
  onRequestCommandTerminal: () => Promise<void>;
  openFullSessionTerminal: () => Promise<void>;
  addCommandResultAttachment: (record: CommandResultRecord) => void;
  cancelCommandResult: (record: CommandResultRecord) => Promise<void>;
  initCommandResults: () => void;
}

export function useCommandTerminal(
  sessionId: Ref<string>,
  idCounter: { next: number },
  opts: CommandTerminalRefs,
): CommandTerminalReturn {
  const commandResultsStore = useCommandResultsStore();
  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();
  const toasts = useToastStore();

  const commandTerminalId = ref<string>('');
  const commandModeOpenedAt = ref<number>(0);
  const commandResultOrder = ref<Record<string, number>>({});
  const autoAttachedCommandIds = new Set<string>();
  const capturedTerminalCommandIds = new Set<string>();

  const commandResults = ref<CommandResultRecord[]>([]);

  watch(
    () => commandResultsStore.recordsBySession[sessionId.value] ?? [],
    (records) => {
      commandResults.value = records;
    },
    { immediate: true },
  );

  async function ensureCommandTerminal(): Promise<string | null> {
    if (commandTerminalId.value) return commandTerminalId.value;

    try {
      const terminal = await terminalStore.getOrCreateSessionTerminal(sessionId.value);

      commandTerminalId.value = terminal.id;
      layoutStore.closePanel(`terminal-${terminal.id}`);

      return terminal.id;
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to open session terminal', message);

      return null;
    }
  }

  async function onRequestCommandTerminal(): Promise<void> {
    commandModeOpenedAt.value = Date.now();
    await ensureCommandTerminal();
    await nextTick();

    if (commandTerminalId.value) {
      window.dispatchEvent(
        new CustomEvent('dafman:focus-terminal', {
          detail: { terminalId: commandTerminalId.value },
        }),
      );
    }
  }

  async function openFullSessionTerminal(): Promise<void> {
    const terminalId = await ensureCommandTerminal();

    if (!terminalId) return;

    opts.composerRef.value?.exitCommandMode?.();
    const terminal = terminalStore.terminals.find((t) => t.id === terminalId);

    layoutStore.addTerminalPanel(terminalId, terminal?.title ?? 'Session Shell');
  }

  function addCommandResultAttachment(record: CommandResultRecord): void {
    opts.composerRef.value?.addAttachment?.({
      type: 'commandResult',
      result: record,
      displayName: `command-result-${record.id.slice(0, 8)}.md`,
    });
  }

  async function cancelCommandResult(record: CommandResultRecord): Promise<void> {
    await commandResultsStore.cancel(sessionId.value, record.id);
  }

  // Auto-attach completed command results as composer pills.
  watch(commandResults, (records) => {
    for (const record of records) {
      if (commandResultOrder.value[record.id] === undefined) {
        commandResultOrder.value = {
          ...commandResultOrder.value,
          [record.id]: idCounter.next++,
        };
      }

      if (record.status === 'running' || autoAttachedCommandIds.has(record.id)) continue;

      autoAttachedCommandIds.add(record.id);
      addCommandResultAttachment(record);
    }
  });

  // Convert shell-integration terminal command records into command results.
  watch(
    () => (commandTerminalId.value ? (terminalStore.commands[commandTerminalId.value] ?? []) : []),
    (commands) => {
      for (const command of commands) {
        if (!command.command || capturedTerminalCommandIds.has(command.id)) continue;

        if (new Date(command.startedAt).getTime() < commandModeOpenedAt.value) continue;

        capturedTerminalCommandIds.add(command.id);
        const now = new Date().toISOString();
        const output = cleanTerminalCommandOutput(command.output ?? '');

        commandResultsStore.addLocal({
          id: command.id,
          sessionId: sessionId.value,
          command: command.command,
          cwd: command.cwd ?? '',
          shell: 'session terminal',
          status: command.exitCode === 0 ? 'completed' : 'failed',
          stdout: output,
          stderr: '',
          truncated: false,
          createdAt: command.startedAt,
          completedAt: command.endedAt ?? now,
          exitCode: command.exitCode ?? null,
        });
        opts.composerRef.value?.exitCommandMode?.();
      }
    },
    { deep: true },
  );

  function initCommandResults(): void {
    void commandResultsStore
      .refresh(sessionId.value)
      .then(() => {
        for (const record of commandResultsStore.recordsBySession[sessionId.value] ?? []) {
          autoAttachedCommandIds.add(record.id);
        }
      })
      .catch(() => {
        /* non-critical persisted command history */
      });
  }

  return {
    commandTerminalId,
    commandModeOpenedAt,
    commandResults,
    commandResultOrder,
    ensureCommandTerminal,
    onRequestCommandTerminal,
    openFullSessionTerminal,
    addCommandResultAttachment,
    cancelCommandResult,
    initCommandResults,
  };
}
