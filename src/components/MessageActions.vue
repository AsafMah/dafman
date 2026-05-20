<script setup lang="ts">
/// Compact action bar under each chat message.
///
/// Action set varies by message kind:
/// - user:      Copy · Edit · Quote · Fork
/// - assistant: Copy · Copy as markdown · Quote · Retry · Fork
/// - reasoning: Copy
/// - tool:      Copy args · Copy result · Fork
/// - system:    Copy
///
/// Edit / Retry / Fork need an `eventId` anchor; the bar renders the
/// affected buttons disabled when the item has no eventId yet (live
/// streaming, before the SDK echoes back).

import { computed } from "vue";
import Button from "primevue/button";
import { useToastStore } from "../stores/toastStore";

type Kind = "user" | "assistant" | "reasoning" | "tool" | "system";

const props = defineProps<{
  kind: Kind;
  /// Display text for Copy / Quote (the markdown-as-rendered for
  /// assistant; raw text for user/reasoning/system). For tool kind,
  /// this is undefined — toolArgsText / toolResultText carry the
  /// payloads instead.
  text?: string;
  /// Anchor for truncate/fork. Undefined while the SDK hasn't
  /// echoed the event yet (live streaming).
  eventId?: string;
  /// Tool-specific payloads — JSON-stringified args / raw result.
  toolArgsText?: string;
  toolResultText?: string;
}>();

const emit = defineEmits<{
  (e: "edit", text: string): void;
  (e: "quote", text: string): void;
  (e: "retry"): void;
  (e: "fork"): void;
}>();

const toasts = useToastStore();

const canAnchor = computed(() => Boolean(props.eventId));

async function copyToClipboard(value: string, label = "Copied"): Promise<void> {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toasts.success(label);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toasts.error("Copy failed", message);
  }
}

function quoteToCommand(text: string): string {
  // Prefix every line with "> " so the composer renders a blockquote.
  const block = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${block}\n\n`;
}
</script>

<template>
  <div class="message-actions" role="toolbar" :aria-label="`${kind} message actions`">
    <!-- Universal copy. For tool kind we split into args / result. -->
    <template v-if="kind === 'tool'">
      <Button
        v-if="toolArgsText"
        icon="pi pi-copy"
        label="Copy args"
        text
        size="small"
        class="msg-action"
        @click="copyToClipboard(toolArgsText ?? '', 'Args copied')"
      />
      <Button
        v-if="toolResultText"
        icon="pi pi-copy"
        label="Copy result"
        text
        size="small"
        class="msg-action"
        @click="copyToClipboard(toolResultText ?? '', 'Result copied')"
      />
    </template>
    <template v-else>
      <Button
        icon="pi pi-copy"
        label="Copy"
        text
        size="small"
        class="msg-action"
        :disabled="!text"
        @click="copyToClipboard(text ?? '')"
      />
      <Button
        v-if="kind === 'assistant'"
        icon="pi pi-clone"
        label="Markdown"
        text
        size="small"
        class="msg-action"
        :disabled="!text"
        @click="copyToClipboard(text ?? '', 'Markdown copied')"
      />
    </template>

    <!-- Quote (insert as blockquote in composer) — text-bearing kinds. -->
    <Button
      v-if="kind === 'user' || kind === 'assistant' || kind === 'reasoning'"
      icon="pi pi-reply"
      label="Quote"
      text
      size="small"
      class="msg-action"
      :disabled="!text"
      @click="emit('quote', quoteToCommand(text ?? ''))"
    />

    <!-- Edit (user only): load text into composer, on submit truncate + send. -->
    <Button
      v-if="kind === 'user'"
      icon="pi pi-pencil"
      label="Edit"
      text
      size="small"
      class="msg-action"
      :disabled="!text || !canAnchor"
      :title="canAnchor ? 'Edit and resend (replaces history from here)' : 'Wait for the server to acknowledge this message'"
      @click="emit('edit', text ?? '')"
    />

    <!-- Retry (assistant only): re-run from the preceding user message. -->
    <Button
      v-if="kind === 'assistant'"
      icon="pi pi-refresh"
      label="Retry"
      text
      size="small"
      class="msg-action"
      :disabled="!canAnchor"
      title="Re-run the previous user message"
      @click="emit('retry')"
    />

    <!-- Fork (everything with an eventId anchor). -->
    <Button
      v-if="kind !== 'system'"
      icon="pi pi-share-alt"
      label="Fork"
      text
      size="small"
      class="msg-action"
      :disabled="!canAnchor"
      title="Create a new session branched at this point"
      @click="emit('fork')"
    />
  </div>
</template>

<style scoped>
.message-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem;
  margin-top: 0.2rem;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

.message-actions:hover,
.message-actions:focus-within {
  opacity: 1;
}

/* PrimeVue text buttons render a touch large for under-message use.
 * Bring them down to a denser scale that fits the chat rhythm. */
.msg-action :deep(.p-button) {
  padding: 0.15rem 0.4rem;
  font-size: 0.72rem;
  height: auto;
  min-height: 0;
  color: var(--p-text-muted-color);
}

.msg-action :deep(.p-button-icon) {
  font-size: 0.78rem;
}

.msg-action :deep(.p-button):hover {
  color: var(--p-text-color);
  background: var(--p-content-hover-background);
}

.msg-action :deep(.p-button):disabled {
  opacity: 0.4;
}
</style>
