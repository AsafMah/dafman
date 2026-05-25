<script setup lang="ts">
/// Parse + render the `*** Begin Patch` patch format.
///
/// Each file gets its own card with the op (badge) + path (PathChip)
/// + hunks rendered via DiffEditor. We reconstruct the before/after
/// text for each hunk from the +/-/context lines so CM6's MergeView
/// can show real language-aware syntax highlighting.

import { computed } from 'vue';
import { parseApplyPatch } from '@/lib/diff';
import PathChip from '@/components/details/PathChip.vue';
import DiffEditor from '@/components/details/DiffEditor.vue';

const props = defineProps<{
  patch: string;
}>();

const files = computed(() => parseApplyPatch(props.patch));

function opLabel(op: 'update' | 'add' | 'delete'): string {
  switch (op) {
    case 'update':
      return 'Update';
    case 'add':
      return 'Add';
    case 'delete':
      return 'Delete';
  }
}

/// Reconstruct the "before" text from hunk lines (context + removed,
/// in order). For Add files, before is empty.
function hunkBefore(
  op: 'update' | 'add' | 'delete',
  lines: Array<{ kind: 'added' | 'removed' | 'context'; text: string }>,
): string {
  if (op === 'add') return '';

  return lines
    .filter((l) => l.kind !== 'added')
    .map((l) => l.text)
    .join('\n');
}

/// Reconstruct the "after" text from hunk lines (context + added,
/// in order). For Delete files, after is empty.
function hunkAfter(
  op: 'update' | 'add' | 'delete',
  lines: Array<{ kind: 'added' | 'removed' | 'context'; text: string }>,
): string {
  if (op === 'delete') return '';

  return lines
    .filter((l) => l.kind !== 'removed')
    .map((l) => l.text)
    .join('\n');
}
</script>

<template>
  <div
    v-if="files.length > 0"
    class="apply-patch"
  >
    <article
      v-for="(file, idx) in files"
      :key="idx"
      class="apply-patch-file"
    >
      <header class="apply-patch-header">
        <span :class="['apply-patch-op', `op-${file.op}`]">{{ opLabel(file.op) }}</span>
        <PathChip
          :path="file.path"
          :icon="file.op === 'delete' ? 'trash' : 'file-edit'"
        />
      </header>
      <DiffEditor
        v-for="(hunk, hi) in file.hunks"
        :key="hi"
        class="apply-patch-hunk"
        :old-text="hunkBefore(file.op, hunk.lines)"
        :new-text="hunkAfter(file.op, hunk.lines)"
        :filename="file.path"
      />
      <p
        v-if="file.hunks.length === 0"
        class="apply-patch-empty"
      >
        (no hunks)
      </p>
    </article>
  </div>
  <p
    v-else
    class="apply-patch-empty"
  >
    Empty patch.
  </p>
</template>

<style scoped>
.apply-patch {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-self: stretch;
}

.apply-patch-file {
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  overflow: hidden;
}

.apply-patch-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-surface-border);
}

.apply-patch-op {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.4rem;
  border-radius: var(--p-border-radius-sm);
}

.apply-patch-op.op-update {
  background: color-mix(in srgb, var(--p-orange-500) 18%, transparent);
  color: var(--p-orange-600, var(--p-orange-500));
}

.apply-patch-op.op-add {
  background: color-mix(in srgb, var(--p-green-500) 18%, transparent);
  color: var(--p-green-700, var(--p-green-500));
}

.apply-patch-op.op-delete {
  background: color-mix(in srgb, var(--p-red-500) 18%, transparent);
  color: var(--p-red-600, var(--p-red-500));
}

.apply-patch-hunk {
  border: 0;
  border-radius: 0;
  border-top: 1px dashed var(--p-surface-border);
}

.apply-patch-hunk:first-of-type {
  border-top: 0;
}

.apply-patch-empty {
  margin: 0;
  padding: 0.4rem 0.6rem;
  font-style: italic;
  color: var(--p-text-muted-color);
}
</style>
