<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import type { ReasoningVisibility } from "../ipc/types";

const props = defineProps<{
  text: string;
  visibility: ReasoningVisibility;
}>();

const expanded = ref(false);

const preview = computed(() => {
  const firstLine = props.text.split("\n", 1)[0] ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
});

const showFull = computed(
  () => props.visibility === "expanded" || expanded.value,
);
</script>

<template>
  <div v-if="props.visibility !== 'hidden'" class="reasoning-card">
    <div class="reasoning-header">
      <span class="role-label">Reasoning</span>
      <Button
        v-if="props.visibility === 'compact'"
        :icon="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
        text
        rounded
        size="small"
        :aria-label="expanded ? 'Collapse reasoning' : 'Expand reasoning'"
        @click="expanded = !expanded"
      />
    </div>
    <p v-if="showFull" class="reasoning-body">{{ props.text || "Thinking..." }}</p>
    <p v-else class="reasoning-preview">{{ preview || "Thinking..." }}</p>
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

.role-label {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.reasoning-body,
.reasoning-preview {
  margin: 0.25rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.reasoning-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
