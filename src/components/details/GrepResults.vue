<script setup lang="ts">
/// Parse grep output (`path:line:content` per match) into per-file
/// groups, then render each as a header (PathChip + match count) +
/// list of `line | content` rows. Pattern matches in the content
/// get highlighted via the optional `pattern` prop.
///
/// Streaming partial output: trailing partial line is dropped so we
/// don't render a broken half-row.

import { computed } from 'vue';
import PathChip from './PathChip.vue';

const props = defineProps<{
  output: string;
  pattern?: string;
}>();

type Hit = { lineNumber: number | null; content: string };

const groups = computed<Array<{ path: string; hits: Hit[] }>>(() => {
  const lines = props.output.split('\n');
  // Drop possibly-truncated last line during streaming. Safe because
  // the source produces a trailing newline on complete output.
  const trimmedLast = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;

  const map = new Map<string, Hit[]>();

  for (const raw of trimmedLast) {
    if (raw.length === 0) continue;

    // Match `path:line:content` (path may itself contain `:` on
    // Windows so we anchor to the FIRST `:\d+:` boundary).
    const m = raw.match(/^(.+?):(\d+):(.*)$/);

    if (m) {
      const [, path, lineStr, content] = m;
      const hits = map.get(path) ?? [];

      hits.push({ lineNumber: parseInt(lineStr, 10), content: content ?? '' });
      map.set(path, hits);
    } else {
      // No `:line:` — treat as a path-only hit (e.g. `grep -l`).
      const hits = map.get(raw) ?? [];

      hits.push({ lineNumber: null, content: '' });
      map.set(raw, hits);
    }
  }

  return Array.from(map.entries()).map(([path, hits]) => ({ path, hits }));
});

const totalMatches = computed(() => groups.value.reduce((sum, g) => sum + g.hits.length, 0));

/// Build escape-safe HTML with `<mark>` wrapped around each pattern
/// match. We escape the source content first, then substitute. The
/// pattern is matched as a literal string (no regex) — for the tool
/// surface, that's what users mean ~95% of the time and avoids
/// surprising matches on `(`/`*` etc.
function highlight(content: string): string {
  const escaped = escapeHtml(content);
  const pat = props.pattern;

  if (!pat || pat.length === 0) return escaped;

  const escPat = escapeHtml(pat);
  // Case-sensitive match (grep default). i flag would need a runtime
  // setting; skip for now.
  const parts = escaped.split(escPat);

  if (parts.length === 1) return escaped;

  return parts.join(`<mark class="grep-mark">${escPat}</mark>`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
</script>

<template>
  <div
    v-if="groups.length > 0"
    class="grep-results"
  >
    <p class="grep-summary">
      {{ totalMatches }} match{{ totalMatches === 1 ? '' : 'es' }} across {{ groups.length }} file{{
        groups.length === 1 ? '' : 's'
      }}
    </p>
    <article
      v-for="g in groups"
      :key="g.path"
      class="grep-group"
    >
      <header class="grep-group-header">
        <PathChip
          :path="g.path"
          icon="file"
        />
        <span class="grep-count">{{ g.hits.length }}</span>
      </header>
      <ol class="grep-hits">
        <li
          v-for="(hit, idx) in g.hits"
          :key="idx"
          class="grep-hit"
        >
          <span
            v-if="hit.lineNumber !== null"
            class="grep-line"
          >
            {{ hit.lineNumber }}
          </span>
          <code
            class="grep-content"
            v-html="highlight(hit.content)"
          />
        </li>
      </ol>
    </article>
  </div>
  <p
    v-else
    class="grep-empty"
  >
    No matches.
  </p>
</template>

<style scoped>
.grep-results {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-self: stretch;
}

.grep-summary {
  margin: 0;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
}

.grep-group {
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  overflow: hidden;
}

.grep-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-surface-border);
}

.grep-count {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: var(--p-primary-100, color-mix(in srgb, var(--p-primary-500) 18%, transparent));
  color: var(--p-primary-700, var(--p-primary-500));
}

.grep-hits {
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
}

.grep-hit {
  display: grid;
  grid-template-columns: 3em 1fr;
  gap: 0.5rem;
  padding: 0.1rem 0.5rem;
}

.grep-hit:nth-child(odd) {
  background: color-mix(in srgb, var(--p-content-hover-background) 50%, transparent);
}

.grep-line {
  text-align: right;
  color: var(--p-text-muted-color);
  font-size: 0.76rem;
  user-select: none;
}

.grep-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  background: transparent;
  padding: 0;
}

.grep-content :deep(.grep-mark) {
  background: color-mix(in srgb, var(--p-yellow-500) 35%, transparent);
  color: inherit;
  padding: 0 0.1em;
  border-radius: 2px;
}

.grep-empty {
  margin: 0;
  font-style: italic;
  color: var(--p-text-muted-color);
}
</style>
