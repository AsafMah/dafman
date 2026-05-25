<script setup lang="ts">
// Dockview watermark — rendered when no panels are open. Registered
// globally in `main.ts` as `"watermark"` and pointed to by
// `<DockviewVue watermark-component="watermark">`. Must be a real
// component (not a slot template) because dockview-vue's
// `findComponent(name)` walks `instance.components[name]`, not slots.

import { useClientStore } from '../stores/clientStore';
import { storeToRefs } from 'pinia';

const clientStore = useClientStore();
const { ready } = storeToRefs(clientStore);
</script>

<template>
  <div class="watermark">
    <template v-if="!ready">Starting Copilot client...</template>
    <template v-else> Click <strong>&nbsp;New Session&nbsp;</strong> to start chatting. </template>
  </div>
</template>

<style scoped>
.watermark {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  color: var(--p-text-muted-color);
  padding: 1rem;
  text-align: center;
  background: var(--p-content-background);
}
</style>
