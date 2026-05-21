<script setup lang="ts">
/// Horizontal strip of attachment chips shown directly above the
/// composer input. Lets the user see what's queued and remove
/// individual attachments before sending.

import type { SendMessageAttachment } from "../ipc/types";

defineProps<{
  attachments: SendMessageAttachment[];
}>();

const emit = defineEmits<{
  (e: "remove", index: number): void;
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
    <button
      v-for="(a, idx) in attachments"
      :key="idx"
      type="button"
      class="attachment-chip"
      role="listitem"
      :title="`Remove ${labelFor(a, idx)}`"
      :aria-label="`Remove ${labelFor(a, idx)}`"
      @click="emit('remove', idx)"
    >
      <i class="pi attachment-chip-icon" :class="iconFor(a)" aria-hidden="true" />
      <span class="attachment-chip-label">{{ labelFor(a, idx) }}</span>
      <i class="pi pi-times attachment-chip-x" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.3rem 0.5rem 0;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-primary-500) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--p-primary-500) 30%, transparent);
  color: var(--p-text-color);
  font-size: 0.75rem;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  max-width: 22rem;
}

.attachment-chip:hover {
  background: color-mix(in srgb, var(--p-primary-500) 20%, transparent);
  border-color: var(--p-primary-500);
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

.attachment-chip-x {
  font-size: 0.65rem;
  color: var(--p-text-muted-color);
  flex: 0 0 auto;
}

.attachment-chip:hover .attachment-chip-x {
  color: var(--p-text-color);
}
</style>
