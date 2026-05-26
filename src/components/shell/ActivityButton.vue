<script setup lang="ts">
/// Single icon button in the ActivityBar rail. Extracted in
/// Phase E.7 — the rail rendered the same `<button>` markup twice,
/// once per stack (top + bottom), with identical class / icon /
/// badge / aria wiring. Now both stacks loop `<ActivityButton>`.

import type { ActivityItem } from '@/components/shell/ActivityBar.vue';

defineProps<{
  item: ActivityItem;
  /// `true` when `item.kind === 'panel'` AND its panel is currently
  /// open in dockview. Drives `is-active` + `aria-pressed`. Resolved
  /// by the parent (which owns the layoutStore subscription).
  active: boolean;
}>();

const emit = defineEmits<{
  activate: [item: ActivityItem];
}>();
</script>

<template>
  <button
    type="button"
    class="activity-button"
    :class="{ 'is-active': item.kind === 'panel' && active }"
    :title="item.title"
    :aria-label="item.title"
    :aria-pressed="item.kind === 'panel' ? active : undefined"
    @click="emit('activate', item)"
  >
    <i
      class="pi activity-icon"
      :class="item.icon"
      aria-hidden="true"
    />
    <span
      v-if="item.badge"
      class="activity-badge"
      >{{ item.badge }}</span
    >
  </button>
</template>
