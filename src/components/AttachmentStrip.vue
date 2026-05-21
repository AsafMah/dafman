<script setup lang="ts">
/// Horizontal strip of attachment chips shown directly above the
/// composer input. Each chip is a button that **opens** the
/// attachment (reveal-in-explorer for files / preview for blobs),
/// and a separate ✕ button removes it from the queue.

import type { SendMessageAttachment } from "../ipc/types";

defineProps<{
  attachments: SendMessageAttachment[];
}>();

const emit = defineEmits<{
  (e: "remove", index: number): void;
  (e: "open", index: number): void;
}>();

function labelFor(a: SendMessageAttachment, idx: number): string {
  switch (a.type) {
    case "file":
      return a.displayName ?? a.path;
    case "directory":
      return a.displayName ?? a.path;
    case "selection":
      return a.displayName || `selection ${idx + 1}`;
    case "blob":
      return a.displayName ?? `pasted ${a.mimeType.split("/")[1] ?? "blob"}`;
  }
}

function iconFor(a: SendMessageAttachment): string {
  switch (a.type) {
    case "file":
      return "pi-file";
    case "directory":
      return "pi-folder";
    case "selection":
      return "pi-align-left";
    case "blob":
      return a.mimeType.startsWith("image/") ? "pi-image" : "pi-paperclip";
  }
}
</script>

<template>
  <div v-if="attachments.length > 0" class="attachment-strip" role="list" aria-label="Attachments">
    <div
      v-for="(a, idx) in attachments"
      :key="idx"
      class="attachment-chip"
      role="listitem"
    >
      <button
        type="button"
        class="attachment-chip-main"
        :title="`Open ${labelFor(a, idx)}`"
        :aria-label="`Open ${labelFor(a, idx)}`"
        @click="emit('open', idx)"
      >
        <i class="pi attachment-chip-icon" :class="iconFor(a)" aria-hidden="true" />
        <span class="attachment-chip-label">{{ labelFor(a, idx) }}</span>
      </button>
      <button
        type="button"
        class="attachment-chip-remove"
        :title="`Remove ${labelFor(a, idx)}`"
        :aria-label="`Remove ${labelFor(a, idx)}`"
        @click.stop="emit('remove', idx)"
      >
        <i class="pi pi-times" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.5rem 0.5rem 0.2rem;
}

.attachment-chip {
  display: inline-flex;
  align-items: stretch;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-primary-500) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--p-primary-500) 30%, transparent);
  max-width: 22rem;
  overflow: hidden;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.attachment-chip:hover {
  background: color-mix(in srgb, var(--p-primary-500) 20%, transparent);
  border-color: var(--p-primary-500);
}

.attachment-chip-main {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.6rem;
  background: transparent;
  border: 0;
  color: var(--p-text-color);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  min-width: 0;
}

.attachment-chip-icon {
  font-size: 0.75rem;
  color: var(--p-primary-500);
  flex: 0 0 auto;
}

.attachment-chip-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
}

.attachment-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.4rem 0 0.2rem;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--p-text-muted-color);
  font-size: 0.65rem;
  border-left: 1px solid color-mix(in srgb, var(--p-primary-500) 25%, transparent);
}

.attachment-chip-remove:hover {
  color: var(--p-text-color);
  background: color-mix(in srgb, var(--p-red-500) 18%, transparent);
}
</style>
