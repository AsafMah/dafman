<script setup lang="ts">
/// Glob results: newline-separated list of file paths.
///
/// Sort and render as a clean list of PathChips. Surfaces the count
/// prominently so you can immediately see "this matched 200 files"
/// without scrolling.

import { computed } from 'vue';
import PathChip from './PathChip.vue';

const props = defineProps<{
  output: string;
}>();

const paths = computed<string[]>(() => {
  return props.output
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .sort();
});
</script>

<template>
  <div
    v-if="paths.length > 0"
    class="glob-results"
  >
    <p class="glob-summary">{{ paths.length }} file{{ paths.length === 1 ? '' : 's' }} matched</p>
    <ul class="glob-list">
      <li
        v-for="p in paths"
        :key="p"
        class="glob-item"
      >
        <PathChip
          :path="p"
          icon="file"
        />
      </li>
    </ul>
  </div>
  <p
    v-else
    class="glob-empty"
  >
    No matches.
  </p>
</template>

<style scoped>
.glob-results {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-self: stretch;
}

.glob-summary {
  margin: 0;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
}

.glob-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.glob-item {
  padding: 0.05rem 0;
}

.glob-empty {
  margin: 0;
  font-style: italic;
  color: var(--p-text-muted-color);
}
</style>
