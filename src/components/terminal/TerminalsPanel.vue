<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useTerminalStore } from '@/stores/terminal/terminalStore';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

const terminalStore = useTerminalStore();
const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();

const shell = ref('');
const args = ref('');
const cwd = ref('');

const terminals = computed(() =>
  [...terminalStore.terminals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

const activeSession = computed(() => sessionsStore.getSession(layoutStore.activeSessionId));

function splitArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function createTerminal(useSessionCwd = false): Promise<void> {
  try {
    const sessionCwd = useSessionCwd
      ? (activeSession.value?.workingDirectory ?? undefined)
      : undefined;
    const summary = await terminalStore.createTerminal({
      cols: 80,
      rows: 24,
      ...(shell.value.trim() ? { shell: shell.value.trim() } : {}),
      ...(args.value.trim() ? { args: splitArgs(args.value) } : {}),
      ...(cwd.value.trim() || sessionCwd ? { cwd: cwd.value.trim() || sessionCwd } : {}),
      ...(useSessionCwd && activeSession.value ? { sessionId: activeSession.value.id } : {}),
      title: shell.value.trim() || (useSessionCwd ? 'Session Terminal' : 'Terminal'),
    });

    layoutStore.addTerminalPanel(summary.id, summary.title);
  } catch (err) {
    toasts.error('Failed to create terminal', toErrorMessage(err));
  }
}

function openTerminal(id: string, title: string): void {
  layoutStore.addTerminalPanel(id, title);
}

function displayCwd(terminalId: string, fallback: string): string {
  return terminalStore.currentCwd[terminalId] ?? fallback;
}

function activeCommandLabel(terminalId: string): string | null {
  const active = terminalStore.activeCommands[terminalId];

  if (!active) return null;

  return active.command ? `Running: ${active.command}` : 'Running command';
}

function recentCommands(terminalId: string) {
  return (terminalStore.commands[terminalId] ?? []).slice(-5).reverse();
}

async function copyCommand(command: string | undefined): Promise<void> {
  if (!command) return;

  await navigator.clipboard.writeText(command);
  toasts.success('Command copied');
}
</script>

<template>
  <section class="terminals-panel">
    <header class="terminals-header">
      <div>
        <h2>Terminals</h2>
        <p>{{ terminals.length }} terminal{{ terminals.length === 1 ? '' : 's' }}</p>
      </div>
      <Button
        icon="pi pi-refresh"
        text
        rounded
        size="small"
        aria-label="Refresh terminals"
        @click="terminalStore.refresh"
      />
    </header>

    <section class="terminal-create">
      <h3>New terminal</h3>
      <label class="field">
        <span>Command</span>
        <InputText
          v-model="shell"
          size="small"
          placeholder="Platform default"
        />
      </label>
      <label class="field">
        <span>Args</span>
        <InputText
          v-model="args"
          size="small"
          placeholder="-NoLogo"
        />
      </label>
      <label class="field">
        <span>CWD</span>
        <InputText
          v-model="cwd"
          size="small"
          placeholder="Current app directory"
        />
      </label>
      <div class="create-actions">
        <Button
          label="New"
          icon="pi pi-plus"
          size="small"
          @click="createTerminal(false)"
        />
        <Button
          label="From session"
          icon="pi pi-folder-open"
          size="small"
          severity="secondary"
          :disabled="!activeSession"
          @click="createTerminal(true)"
        />
      </div>
    </section>

    <ul class="terminal-list">
      <li
        v-for="terminal in terminals"
        :key="terminal.id"
        class="terminal-row"
      >
        <div class="terminal-main">
          <i
            class="pi pi-window-maximize"
            aria-hidden="true"
          />
          <div class="terminal-text">
            <strong>{{ terminal.title }}</strong>
            <span>{{ terminal.shell }} {{ terminal.args.join(' ') }}</span>
            <small>{{ displayCwd(terminal.id, terminal.cwd) }}</small>
            <small
              v-if="activeCommandLabel(terminal.id)"
              class="terminal-command"
            >
              {{ activeCommandLabel(terminal.id) }}
            </small>
            <small
              v-if="terminalStore.droppedCommandCounts[terminal.id]"
              class="terminal-history-note"
            >
              {{ terminalStore.droppedCommandCounts[terminal.id] }} older commands elided
            </small>
          </div>
          <span
            class="terminal-status"
            :class="`status-${terminal.status}`"
            >{{ terminal.status }}</span
          >
        </div>
        <div class="terminal-actions">
          <Button
            label="Open"
            icon="pi pi-external-link"
            size="small"
            text
            @click="openTerminal(terminal.id, terminal.title)"
          />
          <Button
            v-if="terminal.status === 'running'"
            label="Kill"
            icon="pi pi-times"
            size="small"
            text
            severity="danger"
            @click="terminalStore.killTerminal(terminal.id)"
          />
        </div>
        <details
          v-if="recentCommands(terminal.id).length"
          class="command-history"
        >
          <summary>Recent commands</summary>
          <ul>
            <li
              v-for="command in recentCommands(terminal.id)"
              :key="command.id"
            >
              <span class="command-meta">
                {{ command.exitCode === undefined ? '?' : command.exitCode }}
              </span>
              <code>{{ command.command || 'Command line unavailable' }}</code>
              <Button
                v-if="command.command"
                icon="pi pi-copy"
                text
                rounded
                size="small"
                aria-label="Copy command"
                @click="copyCommand(command.command)"
              />
            </li>
          </ul>
        </details>
      </li>
    </ul>

    <p
      v-if="terminals.length === 0"
      class="empty"
    >
      No terminals yet.
    </p>
  </section>
</template>

<style scoped>
.terminals-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
  min-width: 0;
  padding: 0.75rem;
  overflow-y: auto;
  color: var(--p-text-color);
  container-type: inline-size;
}

.terminals-header,
.terminal-main,
.create-actions,
.terminal-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.terminals-header {
  justify-content: space-between;
  border-bottom: 1px solid var(--p-surface-border);
  padding-bottom: 0.55rem;
}

.terminals-header h2,
.terminal-create h3 {
  margin: 0;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.terminals-header p,
.empty {
  margin: 0.15rem 0 0;
  color: var(--p-text-muted-color);
  font-size: 0.76rem;
}

.terminal-create {
  display: grid;
  gap: 0.45rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  padding: 0.6rem;
  background: color-mix(in srgb, var(--p-primary-color) 5%, transparent);
}

.field {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.field span {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.create-actions,
.terminal-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.terminal-list {
  display: grid;
  gap: 0.45rem;
  list-style: none;
  padding: 0;
  margin: 0;
}

.terminal-row {
  display: grid;
  gap: 0.35rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  padding: 0.55rem;
  background: var(--p-content-background);
}

.terminal-main {
  min-width: 0;
}

.terminal-main > .pi {
  flex: 0 0 auto;
  color: var(--p-primary-color);
}

.terminal-text {
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  gap: 0.05rem;
}

.terminal-text strong,
.terminal-text span,
.terminal-text small,
.terminal-command {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-text span,
.terminal-text small {
  color: var(--p-text-muted-color);
  font-size: 0.72rem;
}

.terminal-command,
.terminal-history-note {
  color: var(--p-primary-color);
}

.terminal-history-note {
  color: var(--p-text-muted-color);
}

.terminal-status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 0.1rem 0.4rem;
  font-size: 0.68rem;
  color: var(--p-text-muted-color);
  background: color-mix(in srgb, var(--p-text-muted-color) 14%, transparent);
}

.terminal-status.status-running {
  color: var(--p-green-500);
  background: color-mix(in srgb, var(--p-green-500) 15%, transparent);
}

.command-history {
  min-width: 0;
  border-top: 1px solid var(--p-surface-border);
  padding-top: 0.35rem;
}

.command-history summary {
  cursor: pointer;
  color: var(--p-text-muted-color);
  font-size: 0.72rem;
}

.command-history ul {
  display: grid;
  gap: 0.25rem;
  padding: 0.35rem 0 0;
  margin: 0;
  list-style: none;
}

.command-history li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.command-history code {
  min-width: 0;
  overflow: hidden;
  color: var(--p-text-color);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-meta {
  min-width: 1.5rem;
  border-radius: 999px;
  padding: 0.05rem 0.3rem;
  color: var(--p-text-muted-color);
  background: color-mix(in srgb, var(--p-text-muted-color) 12%, transparent);
  font-size: 0.68rem;
  text-align: center;
}

@container (max-width: 22rem) {
  .terminal-main {
    align-items: flex-start;
  }

  .terminal-actions :deep(.p-button-label),
  .create-actions :deep(.p-button-label) {
    display: none;
  }
}
</style>
