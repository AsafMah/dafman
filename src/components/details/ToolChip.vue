<script setup lang="ts">
// Compact tool-identity chip: server pill + slash + tool name.
// Used by PermissionDetails (mcp/custom-tool kinds) and ToolDetails
// (any tool — the args header). Either server or tool may be
// omitted; the chip auto-collapses.

defineProps<{
  /// MCP server name (optional). Renders as a colored pill.
  server?: string;
  /// Tool name. Renders monospace; no pill — keeps the focus on the
  /// server when both are present.
  tool?: string;
  /// Optional leading icon glyph (without `pi-` prefix). Set when
  /// the chip stands alone (no server) to identify what kind of
  /// tool it is — bolt for custom-tool, bookmark for memory, etc.
  icon?: string;
}>();
</script>

<template>
  <span class="tool-chip">
    <i
      v-if="icon"
      :class="`pi pi-${icon} tool-chip-icon`"
      aria-hidden="true"
    />
    <span
      v-if="server"
      class="tool-chip-server"
      >{{ server }}</span
    >
    <span
      v-if="server && tool"
      class="tool-chip-sep"
      >/</span
    >
    <span
      v-if="tool"
      class="tool-chip-tool"
      >{{ tool }}</span
    >
  </span>
</template>

<style scoped>
.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.5rem;
  border-radius: var(--p-border-radius-sm);
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
}

.tool-chip-icon {
  color: var(--p-primary-color);
  flex: 0 0 auto;
}

.tool-chip-server {
  color: var(--p-primary-color);
  font-weight: 600;
}

.tool-chip-sep {
  color: var(--p-text-muted-color);
}

.tool-chip-tool {
  color: var(--p-text-color);
}
</style>
