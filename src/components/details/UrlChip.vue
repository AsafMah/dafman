<script setup lang="ts">
// URL display with host emphasized and path/query muted. Used by
// PermissionDetails (url kind) and ToolDetails (fetch tool).
// Falls back to a single muted code block when the URL doesn't
// parse — defensive against odd CLI inputs.

import { computed } from "vue";

const props = defineProps<{ url: string }>();

const parts = computed(() => {
  try {
    const p = new URL(props.url);
    return {
      origin: `${p.protocol}//${p.host}`,
      path: p.pathname || "/",
      search: p.search,
      hash: p.hash,
    };
  } catch {
    return null;
  }
});
</script>

<template>
  <span class="url-chip">
    <i class="pi pi-external-link url-chip-icon" aria-hidden="true" />
    <span v-if="parts" class="url-chip-parts">
      <span class="url-chip-origin">{{ parts.origin }}</span><span class="url-chip-path">{{ parts.path }}{{ parts.search }}{{ parts.hash }}</span>
    </span>
    <code v-else class="url-chip-raw">{{ url }}</code>
  </span>
</template>

<style scoped>
.url-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-size: 0.82rem;
  max-width: 100%;
  overflow: auto;
}

.url-chip-icon {
  color: var(--p-text-muted-color);
  flex: 0 0 auto;
}

.url-chip-parts,
.url-chip-raw {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  word-break: break-all;
  min-width: 0;
}

.url-chip-origin {
  font-weight: 600;
  color: var(--p-primary-color);
}

.url-chip-path {
  color: var(--p-text-muted-color);
}
</style>
