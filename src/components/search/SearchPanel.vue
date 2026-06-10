<script setup lang="ts">
/// Phase 1 cross-session transcript search panel (issue #241).
///
/// Hosts a debounced search input that calls `searchSessionTranscripts`
/// via IPC and renders matches grouped by session. Clicking a match
/// brings the owning session into focus and scrolls to the matching event.

import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useJobsStore } from '@/stores/observability/jobsStore';
import type { TranscriptSearchResult, TranscriptMatch } from '@/ipc/types';
import { on as busOn } from '@/lib/bus';

const layoutStore = useLayoutStore();
const jobsStore = useJobsStore();

const inputEl = ref<HTMLInputElement | null>(null);
const query = ref('');
const results = ref<TranscriptSearchResult[]>([]);
const loading = ref(false);
const searched = ref(false);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onInput(e: Event): void {
  const val = (e.target as HTMLInputElement).value;

  query.value = val;

  if (debounceTimer !== null) clearTimeout(debounceTimer);

  if (!val.trim()) {
    results.value = [];
    searched.value = false;

    return;
  }

  debounceTimer = setTimeout(() => void runSearch(val.trim()), 200);
}

async function runSearch(q: string): Promise<void> {
  loading.value = true;

  try {
    const res = await invokeCommand('searchSessionTranscripts', { query: q });

    results.value = res;
    searched.value = true;
  } catch {
    results.value = [];
    searched.value = true;
  } finally {
    loading.value = false;
  }
}

const totalMatchCount = computed(() => results.value.reduce((sum, r) => sum + r.matches.length, 0));

/// Convert <<match>> delimiters in snippet to <mark> tags.
function snippetHtml(snippet: string): string {
  return snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;&lt;/g, '<mark class="search-match">')
    .replace(/&gt;&gt;/g, '</mark>');
}

function onResultClick(sessionId: string, match: TranscriptMatch): void {
  jobsStore.openOwningSession(sessionId);
  layoutStore.requestReveal(sessionId, { eventIndex: match.eventIndex });
}

/// Focus the input when the panel is activated via the command palette
/// or the `search.global` shortcut. Emitted on the `focus-search-panel`
/// bus channel so `registerBuiltinCommands.ts` can fire it after opening
/// the panel.
let offFocus: (() => void) | null = null;

onMounted(() => {
  offFocus = busOn('focus-search-panel', () => {
    inputEl.value?.focus();
    inputEl.value?.select();
  });
});

onBeforeUnmount(() => {
  offFocus?.();
});
</script>

<template>
  <div class="search-panel">
    <div class="search-input-wrap">
      <i
        class="pi pi-search search-icon"
        aria-hidden="true"
      />
      <input
        ref="inputEl"
        type="search"
        class="search-input"
        placeholder="Search sessions…"
        :value="query"
        autocomplete="off"
        spellcheck="false"
        @input="onInput"
      />
      <span
        v-if="loading"
        class="search-spinner pi pi-spin pi-spinner"
        aria-label="Searching…"
      />
    </div>

    <div
      v-if="searched && !loading && results.length === 0"
      class="search-empty"
    >
      No matches in open sessions.
    </div>

    <div
      v-else-if="results.length > 0"
      class="search-results"
    >
      <p class="search-summary">
        {{ totalMatchCount }} match{{ totalMatchCount === 1 ? '' : 'es' }} in
        {{ results.length }} session{{ results.length === 1 ? '' : 's' }}
      </p>

      <div
        v-for="group in results"
        :key="group.sessionId"
        class="result-group"
      >
        <h3 class="session-header">
          <i
            class="pi pi-comments session-icon"
            aria-hidden="true"
          />
          <span class="session-label">{{
            group.sessionSummary ?? group.sessionId.slice(0, 8) + '\u2026'
          }}</span>
        </h3>

        <button
          v-for="(match, matchIdx) in group.matches"
          :key="matchIdx"
          type="button"
          class="result-row"
          :title="`Navigate to ${match.role} message`"
          @click="onResultClick(group.sessionId, match)"
        >
          <span
            class="role-badge"
            :class="`role-${match.role}`"
          >
            {{ match.role === 'user' ? 'You' : match.role === 'assistant' ? 'AI' : 'Sys' }}
          </span>
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized via HTML-escaping + mark-only substitution -->
          <span
            class="snippet"
            v-html="snippetHtml(match.snippet)"
          />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--p-surface-900, #111827);
  color: var(--p-surface-100, #f3f4f6);
  font-size: 13px;
}

.search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--p-surface-700, #374151);
  flex-shrink: 0;
}

.search-icon {
  color: var(--p-surface-400, #9ca3af);
  font-size: 13px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  background: var(--p-surface-800, #1f2937);
  color: inherit;
  border: 1px solid var(--p-surface-600, #4b5563);
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 13px;
  outline: none;
  min-width: 0;
}

.search-input:focus {
  border-color: var(--p-primary-400, #34d399);
}

.search-spinner {
  color: var(--p-surface-400, #9ca3af);
  font-size: 13px;
  flex-shrink: 0;
}

.search-empty {
  padding: 24px 12px;
  color: var(--p-surface-400, #9ca3af);
  text-align: center;
}

.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.search-summary {
  padding: 0 12px 6px;
  font-size: 11px;
  color: var(--p-surface-400, #9ca3af);
  margin: 0;
}

.result-group {
  margin-bottom: 4px;
}

.session-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--p-surface-300, #d1d5db);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0;
  position: sticky;
  top: 0;
  background: var(--p-surface-900, #111827);
  z-index: 1;
}

.session-icon {
  font-size: 11px;
  color: var(--p-primary-400, #34d399);
}

.session-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
  transition: background 0.1s;
}

.result-row:hover {
  background: var(--p-surface-800, #1f2937);
}

.role-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-top: 2px;
}

.role-user {
  background: var(--p-primary-900, #064e3b);
  color: var(--p-primary-300, #6ee7b7);
}

.role-assistant {
  background: #1e3a5f;
  color: #93c5fd;
}

.role-system {
  background: var(--p-surface-700, #374151);
  color: var(--p-surface-300, #d1d5db);
}

.snippet {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--p-surface-300, #d1d5db);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

:deep(.search-match) {
  background: rgba(250, 204, 21, 0.25);
  color: #fde68a;
  border-radius: 2px;
  padding: 0 1px;
}
</style>
