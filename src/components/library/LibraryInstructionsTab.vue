<script setup lang="ts">
/// Phase 23 — Library → Instructions tab.
///
/// Read-only inventory of global + project instruction files. Editing is
/// intentionally deferred: saving AGENTS.md / copilot-instructions.md is a
/// project file write and must go through a permissioned editor flow.

import { computed, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import type { InstructionSource } from '@/ipc/types';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import MessageContent from '@/components/chat/MessageContent.vue';
import { revealPath } from '@/lib/pathActions';
import { useInstructionsLibrary } from '@/composables/library/useInstructionsLibrary';

const layoutStore = useLayoutStore();
const sessionsStore = useSessionsStore();

const { sources, loaded, error, load: loadSources } = useInstructionsLibrary();
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
  await loadSources(activeSession.value?.workingDirectory);
}

async function reveal(src: InstructionSource) {
  if (!src.exists) return;

  await revealPath(src.path, 'Reveal failed');
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
  /* Invertible inset surface: mix page text into the content background
   * so it tracks the theme automatically (mirrors .lex-code in
   * lexical.css). The numeric surface scale (--p-surface-100/900) does
   * NOT invert under .app-dark, which is why the old hand-rolled
   * `:global(.app-dark)` overrides existed — replaced here with tokens
   * that flip on their own. */
  background: color-mix(in srgb, var(--p-text-color) 4%, var(--p-content-background));
  color: var(--p-text-color);
}

.instruction-content :deep(.md-html-segment) {
  font-size: 0.72rem;
  line-height: 1.35;
}

/* Fallbacks for raw-HTML <a>/<code>/<pre> that markdown-it passes through
 * verbatim (allowed by the DOMPurify config in lib/markdown.ts) and so
 * never receive the .lex-link/.lex-text-code/.lex-code classes. Markdown
 * *syntax* already inverts via those lex-* classes; these guards cover the
 * raw-HTML case in BOTH themes using invertible tokens. */
.instruction-content :deep(a:not(.lex-link)) {
  color: var(--p-primary-color);
}

.instruction-content :deep(code:not(.lex-text-code):not(.lex-code)) {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  background: color-mix(in srgb, var(--p-text-color) 10%, transparent);
  border-radius: var(--p-border-radius-sm);
  padding: 0.05rem 0.3rem;
}

.instruction-content :deep(pre:not(.lex-code)) {
  background: color-mix(in srgb, var(--p-text-color) 8%, var(--p-content-background));
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-md);
  padding: 0.5rem 0.75rem;
}
</style>
