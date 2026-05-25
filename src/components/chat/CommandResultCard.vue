<script setup lang="ts">
import Button from 'primevue/button';
import type { CommandResultRecord } from '@/ipc/types';
import { cleanTerminalCommandOutput } from '@/lib/ansi';

defineProps<{ record: CommandResultRecord }>();
const emit = defineEmits<{
  add: [record: CommandResultRecord];
  cancel: [record: CommandResultRecord];
}>();

function markdownFor(record: CommandResultRecord): string {
  const stdout = cleanTerminalCommandOutput(record.stdout);
  const stderr = cleanTerminalCommandOutput(record.stderr);

  return [
    '```shell',
    record.command,
    '```',
    '',
    `cwd: ${record.cwd}`,
    `status: ${record.status}${typeof record.exitCode === 'number' ? ` (${record.exitCode})` : ''}`,
    record.truncated ? 'output: truncated' : '',
    '',
    'stdout:',
    '```text',
    stdout || '(empty)',
    '```',
    '',
    'stderr:',
    '```text',
    stderr || '(empty)',
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

async function copyText(text: string): Promise<void> {
  if (text) await navigator.clipboard.writeText(text);
}

function clean(value: string): string {
  return cleanTerminalCommandOutput(value);
}
</script>

<template>
  <article
    class="command-result-card"
    :class="`status-${record.status}`"
  >
    <header class="command-result-header">
      <div class="command-result-title">
        <span class="command-result-kicker">Command result</span>
        <code>{{ record.command }}</code>
      </div>
      <span class="command-result-status">{{ record.status }}</span>
    </header>
    <dl class="command-result-meta">
      <div>
        <dt>CWD</dt>
        <dd>{{ record.cwd }}</dd>
      </div>
      <div>
        <dt>Exit</dt>
        <dd>{{ record.exitCode ?? '…' }}</dd>
      </div>
      <div v-if="record.durationMs !== undefined">
        <dt>Time</dt>
        <dd>{{ record.durationMs }} ms</dd>
      </div>
      <div v-if="record.truncated">
        <dt>Output</dt>
        <dd>truncated</dd>
      </div>
    </dl>
    <pre
      v-if="record.stdout"
      class="command-output stdout"
      >{{ clean(record.stdout) }}</pre
    >
    <pre
      v-if="record.stderr"
      class="command-output stderr"
      >{{ clean(record.stderr) }}</pre
    >
    <p
      v-if="record.status === 'running' && !record.stdout && !record.stderr"
      class="command-running"
    >
      <i
        class="pi pi-spin pi-spinner"
        aria-hidden="true"
      />
      Running…
    </p>
    <footer class="command-result-actions">
      <Button
        label="Copy command"
        icon="pi pi-copy"
        size="small"
        text
        @click="copyText(record.command)"
      />
      <Button
        label="Copy output"
        icon="pi pi-align-left"
        size="small"
        text
        @click="copyText(clean(`${record.stdout}${record.stderr}`))"
      />
      <Button
        label="Copy markdown"
        icon="pi pi-code"
        size="small"
        text
        @click="copyText(markdownFor(record))"
      />
      <Button
        label="Add to composer"
        icon="pi pi-plus"
        size="small"
        text
        @click="emit('add', record)"
      />
      <Button
        v-if="record.status === 'running'"
        label="Cancel"
        icon="pi pi-times"
        size="small"
        text
        severity="danger"
        @click="emit('cancel', record)"
      />
    </footer>
  </article>
</template>

<style scoped>
.command-result-card {
  display: grid;
  gap: 0.55rem;
  border: 1px solid color-mix(in srgb, var(--p-orange-500) 34%, var(--p-surface-border));
  border-left: 3px solid var(--p-orange-500);
  border-radius: var(--p-border-radius-md);
  padding: 0.7rem;
  background: color-mix(in srgb, var(--p-orange-500) 7%, var(--p-content-background));
}

.command-result-header,
.command-result-actions,
.command-result-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.command-result-header {
  justify-content: space-between;
}

.command-result-title {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.command-result-title code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-result-kicker,
.command-result-status,
.command-result-meta {
  color: var(--p-text-muted-color);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.command-result-status {
  flex: 0 0 auto;
}

.command-result-meta {
  flex-wrap: wrap;
  text-transform: none;
  letter-spacing: normal;
}

.command-result-meta div {
  display: inline-flex;
  gap: 0.25rem;
  min-width: 0;
}

.command-result-meta dt,
.command-result-meta dd {
  margin: 0;
}

.command-result-meta dt {
  color: var(--p-text-muted-color);
}

.command-output {
  max-height: 14rem;
  overflow: auto;
  margin: 0;
  border-radius: var(--p-border-radius-sm);
  padding: 0.45rem 0.55rem;
  white-space: pre-wrap;
  word-break: break-word;
  background: color-mix(in srgb, var(--p-text-color) 7%, transparent);
}

.stderr {
  border-left: 2px solid var(--p-red-500);
}

.command-running {
  margin: 0;
  color: var(--p-text-muted-color);
}

.command-result-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}
</style>
