<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import Button from "primevue/button";
import { useTerminalStore } from "../stores/terminalStore";

type UserParams = { terminalId?: string; compact?: boolean };
type WrappedParams = { params?: UserParams };
const props = defineProps<{ params: UserParams & WrappedParams }>();
const compact = computed(() => props.params?.params?.compact === true || (props.params as { compact?: boolean })?.compact === true);

const terminalStore = useTerminalStore();
const host = ref<HTMLElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;

const terminalId = computed(() => props.params?.params?.terminalId ?? props.params?.terminalId ?? "");
const summary = computed(() =>
  terminalStore.terminals.find((t) => t.id === terminalId.value),
);
const buffer = computed(() => terminalStore.buffers[terminalId.value] ?? "");

function fitAndNotify(): void {
  if (!fit || !term || !terminalId.value) return;
  try {
    fit.fit();
    void terminalStore.resizeTerminal(terminalId.value, term.cols, term.rows);
  } catch {
    /* xterm can throw before first layout; next resize will recover */
  }
}

onMounted(async () => {
  await nextTick();
  if (!host.value) return;
  term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    scrollback: 10_000,
    fontFamily: "Cascadia Mono, Consolas, ui-monospace, monospace",
    fontSize: 13,
    theme: {
      background: "#111827",
      foreground: "#d1d5db",
    },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host.value);
  if (buffer.value) term.write(buffer.value);
  term.onData((data) => {
    if (terminalId.value) void terminalStore.writeTerminal(terminalId.value, data);
  });
  resizeObserver = new ResizeObserver(() => fitAndNotify());
  resizeObserver.observe(host.value);
  setTimeout(fitAndNotify, 0);
});

watch(buffer, (next, prev) => {
  if (!term) return;
  if (next.length < prev.length) {
    term.reset();
    term.write(next);
  } else if (next.length > prev.length) {
    term.write(next.slice(prev.length));
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  term?.dispose();
  term = null;
  fit = null;
});
</script>

<template>
  <section class="terminal-panel" :class="{ compact }">
    <header v-if="!compact" class="terminal-header">
      <div class="terminal-title">
        <strong>{{ summary?.title ?? "Terminal" }}</strong>
        <small>{{ summary?.cwd }}</small>
      </div>
      <Button
        v-if="summary?.status === 'running'"
        label="Kill"
        size="small"
        severity="secondary"
        @click="terminalStore.killTerminal(terminalId)"
      />
      <span v-else class="terminal-status">{{ summary?.status ?? "missing" }}</span>
    </header>
    <div ref="host" class="terminal-host" />
  </section>
</template>

<style scoped>
.terminal-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #111827;
}

.terminal-panel.compact {
  border-radius: var(--p-border-radius-sm);
}

.terminal-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid color-mix(in srgb, white 12%, transparent);
  color: #d1d5db;
}

.terminal-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.terminal-title strong,
.terminal-title small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-title small,
.terminal-status {
  color: #9ca3af;
  font-size: 0.72rem;
}

.terminal-host {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  padding: 0.35rem;
}

.terminal-host :deep(.xterm) {
  height: 100%;
}
</style>
