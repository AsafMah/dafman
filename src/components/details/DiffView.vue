<script setup lang="ts">
/// Unified diff renderer. Walks `lineDiff()` output and emits
/// rows with a gutter (line numbers) + a sign column + content.
///
/// Keeps `equal` rows but visually fades them; this is cheap and
/// preserves enough context that a 1-line edit doesn't look
/// like a 100-line replacement.

import { computed } from "vue";
import { lineDiff } from "../../lib/diff";

const props = defineProps<{
  oldText: string;
  newText: string;
  /// Optional language hint — not used yet (highlighting per-line
  /// would need to handle partial tokens). Reserved for a future
  /// pass once prismjs can be invoked per-line cheaply.
  lang?: string;
  /// Hide unchanged lines beyond this distance from a change. 0
  /// disables the collapse and shows everything.
  contextLines?: number;
}>();

const rows = computed(() => lineDiff(props.oldText, props.newText));

/// Optionally collapse long runs of equal lines, keeping `contextLines`
/// on either side of any change. Default behavior: show everything.
const displayRows = computed(() => {
  const cl = props.contextLines;
  if (cl === undefined || cl < 0) return rows.value;
  const r = rows.value;
  const keep = new Array(r.length).fill(false);
  for (let i = 0; i < r.length; i++) {
    if (r[i]!.kind !== "equal") {
      for (let j = Math.max(0, i - cl); j <= Math.min(r.length - 1, i + cl); j++) {
        keep[j] = true;
      }
    }
  }
  const out: Array<
    | { kind: "row"; row: (typeof r)[number] }
    | { kind: "gap"; count: number }
  > = [];
  let gap = 0;
  for (let i = 0; i < r.length; i++) {
    if (keep[i]) {
      if (gap > 0) {
        out.push({ kind: "gap", count: gap });
        gap = 0;
      }
      out.push({ kind: "row", row: r[i]! });
    } else {
      gap++;
    }
  }
  if (gap > 0) out.push({ kind: "gap", count: gap });
  return out;
});

const hasChanges = computed(() =>
  rows.value.some((r) => r.kind !== "equal"),
);
</script>

<template>
  <div class="diff-view" role="region" aria-label="Diff">
    <table v-if="hasChanges" class="diff-table">
      <tbody>
        <template v-if="contextLines !== undefined && contextLines >= 0">
          <template v-for="(entry, idx) in (displayRows as any)" :key="idx">
            <tr v-if="entry.kind === 'gap'" class="diff-gap">
              <td colspan="4">… {{ entry.count }} unchanged line{{ entry.count === 1 ? "" : "s" }} hidden</td>
            </tr>
            <tr
              v-else
              class="diff-row"
              :class="`diff-${entry.row.kind}`"
            >
              <td class="diff-gutter">{{ entry.row.oldLine ?? "" }}</td>
              <td class="diff-gutter">{{ entry.row.newLine ?? "" }}</td>
              <td class="diff-sign">
                {{ entry.row.kind === "added" ? "+" : entry.row.kind === "removed" ? "−" : " " }}
              </td>
              <td class="diff-content">{{ entry.row.text }}</td>
            </tr>
          </template>
        </template>
        <template v-else>
          <tr
            v-for="(row, idx) in rows"
            :key="idx"
            class="diff-row"
            :class="`diff-${row.kind}`"
          >
            <td class="diff-gutter">{{ row.oldLine ?? "" }}</td>
            <td class="diff-gutter">{{ row.newLine ?? "" }}</td>
            <td class="diff-sign">
              {{ row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " " }}
            </td>
            <td class="diff-content">{{ row.text }}</td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-else class="diff-empty">No changes.</p>
  </div>
</template>

<style scoped>
.diff-view {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  overflow: auto;
  max-height: 480px;
  align-self: stretch;
  background: var(--p-content-background);
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
}

.diff-row td {
  padding: 0.05rem 0.4rem;
  vertical-align: top;
}

.diff-gutter {
  user-select: none;
  text-align: right;
  width: 2.5em;
  color: var(--p-text-muted-color);
  border-right: 1px solid var(--p-surface-border);
  font-size: 0.76rem;
}

.diff-sign {
  width: 1.2em;
  text-align: center;
  user-select: none;
  font-weight: bold;
}

.diff-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.82rem;
}

.diff-equal {
  color: var(--p-text-muted-color);
}

.diff-removed {
  background: color-mix(in srgb, var(--p-red-500) 12%, transparent);
}

.diff-removed .diff-sign,
.diff-removed .diff-content {
  color: var(--p-red-600, var(--p-red-500));
}

.diff-added {
  background: color-mix(in srgb, var(--p-green-500) 12%, transparent);
}

.diff-added .diff-sign,
.diff-added .diff-content {
  color: var(--p-green-700, var(--p-green-500));
}

.diff-gap td {
  text-align: center;
  font-style: italic;
  color: var(--p-text-muted-color);
  padding: 0.2rem;
  font-size: 0.76rem;
  background: var(--p-content-hover-background);
}

.diff-empty {
  margin: 0;
  padding: 0.4rem 0.6rem;
  color: var(--p-text-muted-color);
  font-style: italic;
}
</style>
