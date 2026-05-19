<script setup lang="ts">
// File-path chip with leading icon + read-only badge support. Used
// by both PermissionDetails (write/read kinds) and ToolDetails
// (read/write/edit/view/grep target paths). Path is monospace and
// breaks on any character — long paths wrap rather than overflow.

defineProps<{
  path: string;
  /// Icon glyph suffix (without the `pi-` prefix). Defaults match
  /// common reads ('eye') / writes ('file-edit') / generic ('file').
  icon?: string;
  /// Optional small badge shown next to the path (e.g. "read-only").
  badge?: string;
}>();
</script>

<template>
  <span class="path-chip">
    <i :class="`pi pi-${icon ?? 'file'} path-chip-icon`" aria-hidden="true" />
    <code class="path-chip-text">{{ path }}</code>
    <span v-if="badge" class="path-chip-badge">{{ badge }}</span>
  </span>
</template>

<style scoped>
.path-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.1rem 0.45rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-size: 0.82rem;
  max-width: 100%;
}

.path-chip-icon {
  color: var(--p-text-muted-color);
  flex: 0 0 auto;
}

.path-chip-text {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  word-break: break-all;
  min-width: 0;
}

.path-chip-badge {
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-text-muted-color) 18%, transparent);
  color: var(--p-text-muted-color);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
