<script setup lang="ts">
// Dockview panel component for chat sessions. Registered globally in
// `main.ts` as `"chat"` so `findComponent` can resolve it when the
// dockview-core `createComponent("chat")` callback fires. Templates
// inside `<DockviewVue>` are dropped — dockview-vue's render fn returns
// just a wrapper `<div>` — so panel content must live in named
// components, not slots.
//
// **Prop shape gotcha.** dockview-vue mounts panel components with
// `{ params, api, containerApi, tabLocation }` initially, then on any
// parameter `update()` it *re-wraps* everything inside a single
// `params` prop (so `props.params.params` is the user params,
// `props.params.api` is the panel api). The wrap happens before our
// component reads in practice, so we have to normalize both shapes.

import { computed, ref } from 'vue';
import Button from 'primevue/button';
import type { DockviewPanelApi } from 'dockview-core';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import ChatWindow from '@/components/chat/ChatWindow.vue';

type UserParams = { sessionId?: string };
type WrappedParams = {
  params?: UserParams;
  api?: DockviewPanelApi;
};
type IncomingParams = UserParams & WrappedParams;

const props = defineProps<{
  params: IncomingParams;
  api?: DockviewPanelApi;
}>();

const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();

/// Resolve the user-supplied params regardless of which shape dockview
/// is currently using.
const userParams = computed<UserParams>(() => {
  const p = props.params;

  if (p && typeof p === 'object' && 'params' in p && p.params) {
    return p.params;
  }

  return p ?? {};
});

const panelApi = computed<DockviewPanelApi | undefined>(() => props.api ?? props.params?.api);

const sessionId = computed(() => userParams.value.sessionId ?? panelApi.value?.id ?? '');

const record = computed(() => sessionsStore.getSession(sessionId.value));

const replacing = ref(false);

/// User clicked "Start new session here" on an orphan panel: spin up
/// a fresh session and drop it into this panel's group, then close
/// the orphan. Failures (e.g. client not ready) surface as toasts via
/// `sessionsStore.createSession`.
async function startReplacement() {
  if (replacing.value) return;

  replacing.value = true;

  try {
    const created = await sessionsStore.createSession();

    if (!created) return;

    const orphanId = sessionId.value;

    if (!orphanId) return;

    layoutStore.replaceMissingPanel(orphanId, created.id);
  } catch {
    /* toast already shown */
  } finally {
    replacing.value = false;
  }
}

function dismissPanel() {
  panelApi.value?.close();
}
</script>

<template>
  <ChatWindow
    v-if="record"
    :key="record.id"
    :session-id="record.id"
    :accent="record.accent"
    :events="record.events"
    :dropped-event-count="record.droppedEventCount"
    :commands-run="record.commandsRun"
    :reasoning-visibility-override="record.reasoningVisibilityOverride"
    :default-send-mode="record.defaultSendMode"
  />
  <div
    v-else
    class="missing-pane"
  >
    <i
      class="pi pi-inbox missing-icon"
      aria-hidden="true"
    />
    <h2 class="missing-title">Session no longer available</h2>
    <p class="missing-detail">
      <code>{{ sessionId.slice(0, 8) }}…</code> couldn't be resumed. It may have been deleted by the
      Copilot CLI or never finished saving.
    </p>
    <div class="missing-actions">
      <Button
        label="Start new session here"
        icon="pi pi-plus"
        :loading="replacing"
        @click="startReplacement"
      />
      <Button
        label="Close tab"
        severity="secondary"
        text
        @click="dismissPanel"
      />
    </div>
  </div>
</template>

<style scoped>
.missing-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem 1.5rem;
  text-align: center;
  color: var(--p-text-muted-color);
  background: var(--p-content-background);
}

.missing-icon {
  font-size: 2rem;
  color: var(--p-text-muted-color);
}

.missing-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.missing-detail {
  margin: 0;
  max-width: 32rem;
  font-size: 0.9rem;
  line-height: 1.4;
}

.missing-detail code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  padding: 0.05em 0.35em;
  border-radius: 4px;
  /* Theme-aware: mix text-color into the content background — auto-
   * flips between light + dark without relying on :global(.app-dark)
   * overrides (which don't compose reliably with Vue scoped CSS). */
  background: color-mix(in srgb, var(--p-text-color) 10%, transparent);
  color: var(--p-text-color);
}

.missing-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.5rem;
}
</style>
