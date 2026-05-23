import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { invokeCommand, onTerminalEvent } from "../ipc/invoke";
import type { TerminalEventPayload, TerminalSummary } from "../ipc/types";
import { useToastStore } from "./toastStore";
import { useSessionsStore } from "./sessionsStore";

const MAX_BUFFER = 256_000;

export const useTerminalStore = defineStore("terminals", () => {
  const terminals = ref<TerminalSummary[]>([]);
  const buffers = ref<Record<string, string>>({});
  const loaded = ref(false);
  const sessionTerminalIds = ref<Record<string, string>>({});

  const running = computed(() =>
    terminals.value.filter((t) => t.status === "running" || t.status === "exiting"),
  );

  async function refresh(): Promise<void> {
    terminals.value = await invokeCommand("listTerminals", {});
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
    const summary = await invokeCommand("createTerminal", params);
    upsert(summary);
    return summary;
  }

  async function getOrCreateSessionTerminal(sessionId: string): Promise<TerminalSummary> {
    const existingId = sessionTerminalIds.value[sessionId];
    const existing = existingId
      ? terminals.value.find((terminal) => terminal.id === existingId)
      : null;
    if (existing && existing.status === "running") return existing;
    const session = useSessionsStore().sessions.find((s) => s.id === sessionId);
    const summary = await createTerminal({
      cols: 80,
      rows: 8,
      ...(session?.workingDirectory ? { cwd: session.workingDirectory } : {}),
      sessionId,
      title: "Session Shell",
    });
    sessionTerminalIds.value = {
      ...sessionTerminalIds.value,
      [sessionId]: summary.id,
    };
    return summary;
  }

  async function writeTerminal(terminalId: string, data: string): Promise<boolean> {
    return invokeCommand("writeTerminal", { terminalId, data });
  }

  async function resizeTerminal(
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<boolean> {
    return invokeCommand("resizeTerminal", { terminalId, cols, rows });
  }

  async function killTerminal(terminalId: string): Promise<boolean> {
    const ok = await invokeCommand("killTerminal", { terminalId });
    await refresh().catch(() => {});
    return ok;
  }

  function upsert(summary: TerminalSummary): void {
    const idx = terminals.value.findIndex((t) => t.id === summary.id);
    if (idx >= 0) terminals.value.splice(idx, 1, summary);
    else terminals.value.push(summary);
  }

  function applyEvent(event: TerminalEventPayload): void {
    if (event.kind === "output") {
      const prev = buffers.value[event.terminalId] ?? "";
      const next = `${prev}${event.data}`;
      buffers.value = {
        ...buffers.value,
        [event.terminalId]: next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next,
      };
      return;
    }
    if (event.kind === "status" || event.kind === "exit") {
      upsert(event.summary);
      return;
    }
    if (event.kind === "error") {
      useToastStore().error("Terminal error", event.message);
    }
  }

  let unsubscribe: (() => void) | null = null;
  function ensureSubscription(): void {
    if (unsubscribe) return;
    unsubscribe = onTerminalEvent(applyEvent);
  }

  ensureSubscription();
  void refresh().catch(() => {
    /* app may be starting; explicit actions surface errors */
  });

  return {
    terminals,
    buffers,
    loaded,
    running,
    refresh,
    createTerminal,
    getOrCreateSessionTerminal,
    writeTerminal,
    resizeTerminal,
    killTerminal,
    applyEvent,
  };
});
