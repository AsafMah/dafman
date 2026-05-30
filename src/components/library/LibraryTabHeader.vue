<script setup lang="ts">
import Button from 'primevue/button';
import type { LibraryTabHeaderAction } from '@/components/library/libraryTabHeader';

defineProps<{
  actions: LibraryTabHeaderAction[];
}>();

const emit = defineEmits<{
  action: [key: string];
}>();

function onAction(action: LibraryTabHeaderAction) {
  if (action.disabled) return;

  emit('action', action.key);
}
</script>

<template>
  <header class="library-tab-header">
    <div class="library-tab-header__summary">
      <slot />
    </div>
    <div
      class="library-tab-header__actions"
      aria-label="Library tab actions"
    >
      <Button
        v-for="action in actions"
        :key="action.key"
        class="library-tab-header__action"
        :icon="action.icon"
        :label="action.label"
        :aria-label="action.ariaLabel ?? action.label"
        :title="action.title ?? action.label"
        :disabled="action.disabled"
        size="small"
        :severity="action.variant === 'primary' ? undefined : 'secondary'"
        :text="action.variant !== 'primary'"
        @click="onAction(action)"
      />
    </div>
  </header>
</template>

<style scoped>
.library-tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--p-surface-border);
}

.library-tab-header__summary {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  overflow-wrap: anywhere;
}

.library-tab-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-inline-start: auto;
}

.library-tab-header__actions :deep(.p-button) {
  flex-shrink: 0;
}
</style>
