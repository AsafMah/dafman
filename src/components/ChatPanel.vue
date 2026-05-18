<script setup lang="ts">
// Dockview panel component for chat sessions. Registered globally in
// `main.ts` as `"chat"` so `findComponent` can resolve it when the
// dockview-core `createComponent("chat")` callback fires. Templates
// inside `<DockviewVue>` are dropped — dockview-vue's render fn returns
// just a wrapper `<div>` — so panel content must live in named
// components, not slots.

import { computed } from "vue";
import { useSessionsStore } from "../stores/sessionsStore";
import ChatWindow from "./ChatWindow.vue";

const props = defineProps<{
  /// Dockview hands us `{ params, api, containerApi, tabLocation }`
  /// as props; we only use `params` (the object passed at
  /// `addPanel({ params })`).
  params: { sessionId?: string };
}>();

const sessionsStore = useSessionsStore();

const sessionId = computed(() => props.params?.sessionId ?? "");
const record = computed(() =>
  sessionsStore.sessions.find((s) => s.id === sessionId.value),
);
</script>

<template>
  <ChatWindow
    v-if="record"
    :key="record.id"
    :session-id="record.id"
    :accent="record.accent"
    :events="record.events"
    :model="record.model"
    :reasoning-effort="record.reasoningEffort"
    :mode="record.mode"
    :approve-all="record.approveAll"
    :hide-close="true"
  />
  <p v-else class="missing-pane">
    Session {{ sessionId }} not loaded.
  </p>
</template>

<style scoped>
.missing-pane {
  margin: 0;
  padding: 1rem;
  color: var(--p-text-muted-color);
}
</style>
