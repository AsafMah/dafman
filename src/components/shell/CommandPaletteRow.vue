<script setup lang="ts">
/**
 * Inner content of a `<Command.Item>` row in CommandPalette.vue.
 *
 * Extracted to DRY three near-identical render blocks (parent rows,
 * child rows, ungrouped rows). The outer `<Command.Item>` stays in
 * the palette template because `vue-command-palette` registers items
 * by walking the slot subtree at mount; moving the wrapper INTO this
 * component would change the registration shape.
 *
 * Renders, in order: icon (or empty spacer) → parent breadcrumb
 * (children only) → label → hint → shortcut → submenu arrow
 * (parents only).
 *
 * `parentLabel` is set when this row is being rendered as a CHILD of
 * a parent command — the breadcrumb gives the user context for what
 * category the row belongs to, especially during search when the
 * parent row itself is hidden by the library's fuse filter (e.g.
 * typing "claude" hides "Switch Model" but the child "Claude Opus 4.7"
 * still needs to read as a model-switch action, not a floating row).
 */

import type { Command } from '@/stores/shell/commandRegistry';

defineProps<{
  cmd: Command;
  isParent?: boolean;
  expanded?: boolean;
  parentLabel?: string;
}>();
</script>

<template>
  <i
    v-if="cmd.icon"
    class="cmd-icon"
    :class="cmd.icon"
    aria-hidden="true"
  />
  <span
    v-else
    class="cmd-icon cmd-icon-empty"
  />
  <span
    v-if="parentLabel"
    class="cmd-breadcrumb"
    aria-hidden="true"
  >{{ parentLabel }}<span class="cmd-breadcrumb-sep">›</span></span>
  <span class="cmd-label">{{ cmd.label }}</span>
  <span
    v-if="cmd.hint"
    class="cmd-hint"
  >{{ cmd.hint }}</span>
  <span
    v-if="cmd.shortcut && cmd.shortcut.length > 0"
    class="cmd-shortcut"
    aria-label="Keyboard shortcut"
  >
    <kbd
      v-for="(k, idx) in cmd.shortcut"
      :key="idx"
    >{{ k }}</kbd>
  </span>
  <span
    v-if="isParent"
    class="cmd-submenu-arrow"
    :data-expanded="expanded ? 'true' : 'false'"
    aria-hidden="true"
  />
</template>

<style>
.cmd-breadcrumb {
  flex: 0 0 auto;
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 35%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmd-breadcrumb-sep {
  display: inline-block;
  opacity: 0.5;
  margin: 0 0.05rem;
}
</style>
