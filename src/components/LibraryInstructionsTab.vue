<script setup lang="ts">
/// Phase 23 — Library → Instructions tab.
///
/// Read-only inventory of global + project instruction files. Editing is
/// intentionally deferred: saving AGENTS.md / copilot-instructions.md is a
/// project file write and must go through a permissioned editor flow.

import { computed, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import { invokeCommand } from '../ipc/invoke';
import type { InstructionSource } from '../ipc/types';
import { useLayoutStore } from '../stores/layoutStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useToastStore } from '../stores/toastStore';
import MessageContent from './MessageContent.vue';
import { toErrorMessage } from '../lib/errorMessage';

const toasts = useToastStore();
const layoutStore = useLayoutStore();
const sessionsStore = useSessionsStore();

const sources = ref<InstructionSource[]>([]);
const loaded = ref(false);
const error = ref<string | null>(null);
const expanded = ref<Set<string>>(new Set());

const activeSession = computed(() => {
  const id = layoutStore.activeSessionId;

  if (!id) return null;

  return sessionsStore.getSession(id) ?? null;
});

const groups = computed(() => ({
  project: sources.value.filter((s) => s.scope === 'project'),
  global: sources.value.filter((s) => s.scope === 'global'),
}));

function keyFor(src: InstructionSource): string {
  return `${src.scope}:${src.path}`;
}

function isExpanded(src: InstructionSource): boolean {
  return expanded.value.has(keyFor(src));
}

function toggle(src: InstructionSource) {
  const next = new Set(expanded.value);
  const key = keyFor(src);

  if (next.has(key)) next.delete(key);
  else next.add(key);

  expanded.value = next;
}

function sizeLabel(src: InstructionSource): string {
  if (!src.exists) return 'missing';

  if (src.sizeBytes === null || src.sizeBytes === undefined) return 'unknown';

  if (src.sizeBytes < 1024) return `${src.sizeBytes} B`;

  return `${(src.sizeBytes / 1024).toFixed(1)} KB`;
}

async function load() {
  error.value = null;
  loaded.value = false;

  try {
    sources.value = await invokeCommand('listInstructionSources', {
      ...(activeSession.value?.workingDirectory
        ? { workingDirectory: activeSession.value.workingDirectory }
        : {}),
    });
    loaded.value = true;
  } catch (err) {
    error.value = toErrorMessage(err);
    loaded.value = true;
  }
}

async function reveal(src: InstructionSource) {
  if (!src.exists) return;

  try {
    await invokeCommand('revealPath', { path: src.path });
  } catch (err) {
    toasts.error('Reveal failed', toErrorMessage(err));
  }
}

onMounted(load);
watch(
  () => activeSession.value?.workingDirectory ?? '',
  () => {
    void load();
  },
);
</script>

<template>
  <div class="instructions-tab">
    <header class="instructions-header">
      <span class="instructions-summary">
        <span v-if="!loaded">Loading…</span>
        <span
          v-else-if="error"
          class="error"
          >{{ error }}</span
        >
        <span v-else>
          {{ sources.filter((s) => s.exists).length }} file{{
            sources.filter((s) => s.exists).length === 1 ? '' : 's'
          }}
          found
        </span>
      </span>
      <Button
        icon="pi pi-refresh"
        size="small"
        severity="secondary"
        text
        label="Refresh"
        @click="load"
      />
    </header>

    <div
      v-if="!activeSession"
      class="hint"
    >
      No active workspace. Showing global instruction candidates only. Open a session with a working
      directory to include project files.
    </div>
    <div
      v-else
      class="hint"
    >
      Project scope is based on the active session workspace:
      <code>{{ activeSession.workingDirectory || 'default process cwd' }}</code>
    </div>

    <template v-if="loaded && !error">
      <section
        v-if="groups.project.length > 0"
        class="instruction-group"
      >
        <h3 class="group-title">Project ({{ groups.project.filter((s) => s.exists).length }})</h3>
        <ul class="instruction-list">
          <li
            v-for="src in groups.project"
            :key="keyFor(src)"
            class="instruction-row"
            :class="{ missing: !src.exists }"
          >
            <button
              type="button"
              class="instruction-name-button"
              :disabled="!src.exists"
              :aria-expanded="src.exists && isExpanded(src)"
              @click="src.exists && toggle(src)"
            >
              <i
                v-if="src.exists"
                class="pi instruction-chevron"
                :class="isExpanded(src) ? 'pi-chevron-down' : 'pi-chevron-right'"
                aria-hidden="true"
              />
              <span class="instruction-name">{{ src.name }}</span>
              <small class="instruction-size">{{ sizeLabel(src) }}</small>
            </button>
            <div
              class="instruction-path"
              :title="src.path"
            >
              {{ src.relativePath }}
            </div>
            <div class="instruction-actions">
              <Button
                icon="pi pi-external-link"
                size="small"
                severity="secondary"
                text
                :disabled="!src.exists"
                :aria-label="`Reveal ${src.name}`"
                @click="reveal(src)"
              />
            </div>
            <div
              v-if="src.exists && isExpanded(src) && src.content"
              class="instruction-content"
            >
              <MessageContent
                :text="src.content"
                label="Instruction markdown"
              />
            </div>
          </li>
        </ul>
      </section>

      <section class="instruction-group">
        <h3 class="group-title">Global ({{ groups.global.filter((s) => s.exists).length }})</h3>
        <ul class="instruction-list">
          <li
            v-for="src in groups.global"
            :key="keyFor(src)"
            class="instruction-row"
            :class="{ missing: !src.exists }"
          >
            <button
              type="button"
              class="instruction-name-button"
              :disabled="!src.exists"
              :aria-expanded="src.exists && isExpanded(src)"
              @click="src.exists && toggle(src)"
            >
              <i
                v-if="src.exists"
                class="pi instruction-chevron"
                :class="isExpanded(src) ? 'pi-chevron-down' : 'pi-chevron-right'"
                aria-hidden="true"
              />
              <span class="instruction-name">{{ src.name }}</span>
              <small class="instruction-size">{{ sizeLabel(src) }}</small>
            </button>
            <div
              class="instruction-path"
              :title="src.path"
            >
              {{ src.path }}
            </div>
            <div class="instruction-actions">
              <Button
                icon="pi pi-external-link"
                size="small"
                severity="secondary"
                text
                :disabled="!src.exists"
                :aria-label="`Reveal ${src.name}`"
                @click="reveal(src)"
              />
            </div>
            <div
              v-if="src.exists && isExpanded(src) && src.content"
              class="instruction-content"
            >
              <MessageContent
                :text="src.content"
                label="Instruction markdown"
              />
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.instructions-tab {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}

.instructions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.instructions-summary {
  min-width: 0;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  overflow-wrap: anywhere;
}

.hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  line-height: 1.35;
}

.hint code {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
}

.error {
  color: var(--p-red-400);
}

.instruction-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.group-title {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.instruction-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.instruction-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.25rem 0.4rem;
  padding: 0.35rem 0.45rem;
  border-radius: var(--p-border-radius-sm);
  min-width: 0;
}

.instruction-row:hover {
  background: color-mix(in srgb, var(--p-content-hover-background) 40%, transparent);
}

.instruction-row.missing {
  opacity: 0.65;
}

.instruction-name-button {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--p-text-color);
  font: inherit;
  text-align: left;
  min-width: 0;
  overflow: hidden;
}

.instruction-name-button:disabled {
  cursor: default;
}

.instruction-chevron {
  font-size: 0.55rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.instruction-name {
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.instruction-size {
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.instruction-path {
  grid-column: 1 / 2;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instruction-actions {
  grid-row: 1 / span 2;
  grid-column: 2;
}

.instruction-content {
  grid-column: 1 / -1;
  margin: 0.25rem 0 0;
  padding: 0.5rem;
  max-height: 18rem;
  overflow: auto;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  background: var(--p-surface-100);
  color: var(--p-text-color);
}

.instruction-content :deep(.md-html-segment) {
  font-size: 0.72rem;
  line-height: 1.35;
}

:global(.app-dark) .instruction-content {
  background: var(--p-surface-900);
  color: var(--p-text-color);
}

:global(.app-dark) .instruction-content :deep(code) {
  background: var(--p-surface-800);
  color: var(--p-text-color);
}

:global(.app-dark) .instruction-content :deep(pre) {
  background: var(--p-surface-800);
}

:global(.app-dark) .instruction-content :deep(a) {
  color: var(--p-primary-color);
}
</style>
