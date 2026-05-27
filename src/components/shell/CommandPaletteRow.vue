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
 * Renders, in order: icon (or empty spacer) → label → hint → shortcut
 * → submenu arrow (only when `isParent`).
 */

import type { Command } from '@/stores/shell/commandRegistry';

defineProps<{
  cmd: Command;
  isParent?: boolean;
  expanded?: boolean;
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
