<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import type { ReasoningVisibility } from '../ipc/types';
import MessageContent from './MessageContent.vue';

const props = defineProps<{
  text: string;
  visibility: ReasoningVisibility;
  /// True when the SDK only supplied encrypted (`reasoningOpaque`)
  /// reasoning — text is empty by design. Render a privacy placeholder
  /// instead of an empty bubble or stuck "Thinking..." preview.
  opaque?: boolean;
}>();

const expanded = ref(false);

const OPAQUE_PREVIEW = 'Reasoned privately (encrypted by the model)';
const OPAQUE_BODY =
  "This model used encrypted reasoning. The thinking happened — the SDK just doesn't expose it as readable text. Tokens are billed against your reasoning budget all the same.";

const preview = computed(() => {
  if (props.opaque) return OPAQUE_PREVIEW;
  const firstLine = props.text.split('\n', 1)[0] ?? '';
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
});

const showFull = computed(() => props.visibility === 'expanded' || expanded.value);
</script>

<template>
  <div
    v-if="props.visibility !== 'hidden'"
    class="reasoning-card"
  >
    <!-- Compact mode: the preview line lives in the header next to the
         chevron, and the standalone "REASONING" label is dropped. The
         label only appears in fully-expanded mode (no toggle), where
         there's no preview to act as a title. -->
    <div
      v-if="props.visibility === 'compact'"
      class="reasoning-header reasoning-header-compact"
      :class="{ 'is-expanded': expanded }"
      role="button"
      tabindex="0"
      :aria-expanded="expanded"
      :aria-label="expanded ? 'Collapse reasoning' : 'Expand reasoning'"
      @click="expanded = !expanded"
      @keydown.enter.prevent="expanded = !expanded"
      @keydown.space.prevent="expanded = !expanded"
    >
      <span class="reasoning-preview">{{ preview || 'Thinking...' }}</span>
      <Button
        :icon="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
        text
        rounded
        size="small"
        :aria-label="expanded ? 'Collapse reasoning' : 'Expand reasoning'"
        tabindex="-1"
        @click.stop="expanded = !expanded"
      />
    </div>
    <div
      v-else
      class="reasoning-header"
    >
      <span class="role-label">Reasoning</span>
    </div>
    <MessageContent
      v-if="showFull"
      class="reasoning-body"
      :text="opaque ? OPAQUE_BODY : props.text || 'Thinking...'"
      label="Reasoning content"
    />
  </div>
</template>

<style scoped>
.reasoning-card {
  padding: 0.5rem 0.75rem;
  /* Theme-aware token so dark mode keeps text-on-bg contrast; the previous
     `:global(.app-dark)` override didn't compose reliably with scoped style
     hashing, which left the body white-on-light in dark mode. */
  background: color-mix(in srgb, var(--p-primary-color) 8%, var(--p-content-background));
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
  border-left: 3px solid var(--p-primary-color, var(--p-text-muted-color));
  border-radius: var(--p-border-radius-md);
  font-size: 0.875rem;
}

.reasoning-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.reasoning-header-compact {
  cursor: pointer;
  user-select: none;
}

.reasoning-header-compact:hover .reasoning-preview {
  color: var(--p-text-color);
}

.role-label {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.reasoning-body {
  margin: 0.25rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* In compact mode the preview line acts as the header's "title": muted,
   single-line, truncated. Expanding hides it (full content shows
   below), so we fade it slightly to make the affordance obvious. */
.reasoning-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
  color: var(--p-text-muted-color);
}

.is-expanded .reasoning-preview {
  opacity: 0.7;
}
</style>
