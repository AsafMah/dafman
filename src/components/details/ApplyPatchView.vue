<script setup lang="ts">
/// Parse + render the `*** Begin Patch` patch format.
///
/// Each file gets its own card with the op (badge) + path (PathChip)
/// + colored hunks. Hunks are shown directly (without an LCS pass)
/// because the patch already encodes which lines are +/-/context.

import { computed } from "vue";
import { parseApplyPatch } from "../../lib/diff";
import PathChip from "./PathChip.vue";

const props = defineProps<{
  patch: string;
}>();

const files = computed(() => parseApplyPatch(props.patch));

function opLabel(op: "update" | "add" | "delete"): string {
  switch (op) {
    case "update":
      return "Update";
    case "add":
      return "Add";
    case "delete":
      return "Delete";
  }
}
</script>

<template>
  <div v-if="files.length > 0" class="apply-patch">
    <article v-for="(file, idx) in files" :key="idx" class="apply-patch-file">
      <header class="apply-patch-header">
        <span :class="['apply-patch-op', `op-${file.op}`]">{{ opLabel(file.op) }}</span>
        <PathChip :path="file.path" :icon="file.op === 'delete' ? 'trash' : 'file-edit'" />
      </header>
      <table
        v-for="(hunk, hi) in file.hunks"
        :key="hi"
        class="apply-patch-table"
      >
        <tbody>
          <tr
            v-for="(line, li) in hunk.lines"
            :key="li"
            :class="`patch-row patch-${line.kind}`"
          >
            <td class="patch-sign">
              {{ line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " " }}
            </td>
            <td class="patch-content">{{ line.text }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="file.hunks.length === 0" class="apply-patch-empty">
        (no hunks)
      </p>
    </article>
  </div>
  <p v-else class="apply-patch-empty">Empty patch.</p>
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

.apply-patch-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
}

.apply-patch-table + .apply-patch-table {
  border-top: 1px dashed var(--p-surface-border);
}

.patch-row td {
  padding: 0.02rem 0.4rem;
  vertical-align: top;
}

.patch-sign {
  width: 1.2em;
  text-align: center;
  user-select: none;
  font-weight: bold;
  color: var(--p-text-muted-color);
}

.patch-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.patch-context {
  color: var(--p-text-muted-color);
}

.patch-removed {
  background: color-mix(in srgb, var(--p-red-500) 12%, transparent);
}

.patch-removed .patch-sign,
.patch-removed .patch-content {
  color: var(--p-red-600, var(--p-red-500));
}

.patch-added {
  background: color-mix(in srgb, var(--p-green-500) 12%, transparent);
}

.patch-added .patch-sign,
.patch-added .patch-content {
  color: var(--p-green-700, var(--p-green-500));
}

.apply-patch-empty {
  margin: 0;
  padding: 0.4rem 0.6rem;
  font-style: italic;
  color: var(--p-text-muted-color);
}
</style>
