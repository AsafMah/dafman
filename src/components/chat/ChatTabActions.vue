<script setup lang="ts">
// dockview-vue `rightHeaderActionsComponent` host: renders the chat
// session controls for whichever panel is currently active inside the
// group. dockview-vue subscribes to `group.model.onDidActivePanelChange`
// internally and re-fires `update()` on this component, so we just
// re-read `params.activePanel` reactively.
//
// Prop shape: dockview-vue wraps everything into a single `params` prop
// — `props.params.activePanel`, `props.params.group`, etc. See the
// stored memory "dockview-vue panel props" for the why.

import { computed } from 'vue';
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from 'dockview-core';
import SessionHeaderControls from '../session/SessionHeaderControls.vue';

interface HeaderActionsParams {
  group: DockviewGroupPanel;
  containerApi: DockviewApi;
  activePanel?: IDockviewPanel;
  panels?: IDockviewPanel[];
  isGroupActive?: boolean;
}

const props = defineProps<{ params: HeaderActionsParams }>();

/// Active panel's id — equals the session id by our convention
/// (`layoutStore.addPanel({ id: sessionId, … })`). Empty string means
/// "no panel" which renders nothing (e.g., during edge-group lifecycle
/// transitions, or for non-chat panels we may add later).
const activeSessionId = computed(() => props.params?.activePanel?.id ?? '');

/// We only render the chat controls for panels whose component is the
/// chat panel. Future non-chat panels (recent-sessions picker, log
/// viewer, permission queue, …) won't have this component name and
/// will just leave the header empty on the right.
const isChatPanel = computed(() => props.params?.activePanel?.api.component === 'chat');
</script>

<template>
  <SessionHeaderControls
    v-if="isChatPanel && activeSessionId"
    :session-id="activeSessionId"
  />
  <div
    v-else
    class="empty-actions"
    aria-hidden="true"
  />
</template>

<style scoped>
.empty-actions {
  width: 0;
  height: 0;
}
</style>
