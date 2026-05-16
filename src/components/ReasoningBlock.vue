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
  background: var(--p-surface-100, var(--p-content-background));
  border-left: 3px solid var(--p-text-muted-color);
  border-radius: var(--p-border-radius-md);
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

:global(.app-dark) .reasoning-card {
  background: var(--p-surface-800, var(--p-content-background));
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
