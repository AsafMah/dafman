<script setup lang="ts">
/// Phase 19c — Sub-agent inline block.
///
/// Renders a sub-agent (fleet member or delegated task agent) as a
/// collapsible nested card in the parent chat transcript. The
/// reducer routes events with envelope `agentId` matching this
/// sub-agent's id into `props.items[]`; we render those nested
/// items recursively.
///
/// Scope: nested items only contain visual events — assistant /
/// reasoning / tool / system. The reducer guarantees no
/// pendingRequest / forkNotice / user / sub-sub-agent items end
/// up here (those stay top-level).

import { computed, ref } from 'vue';
import Button from 'primevue/button';
import MessageContent from './MessageContent.vue';
import ReasoningBlock from './ReasoningBlock.vue';
import ToolCallBlock from './ToolCallBlock.vue';
import type { ChatItem } from '../lib/chatEvents';
import type { ReasoningVisibility } from '../ipc/types';

const props = defineProps<{
  agentId: string;
  agentName: string;
  displayName: string;
  description: string;
  status: 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
  items: ChatItem[];
  reasoningVisibility: ReasoningVisibility;
}>();

/// Default expanded while running, collapsed once completed/failed
/// (the user opens it to inspect after the fact). User override
/// wins — once they toggle, we stop honoring the auto-default.
const userToggled = ref(false);
const userExpanded = ref(true);
const expanded = computed(() => {
  if (userToggled.value) return userExpanded.value;

  return props.status === 'running';
});

function toggle() {
  userToggled.value = true;
  userExpanded.value = !expanded.value;
}

/// Format elapsed: `startedAt`→`completedAt` or `startedAt`→now.
const elapsedLabel = computed(() => {
  if (!props.startedAt) return '';

  const start = Date.parse(props.startedAt);

  if (!Number.isFinite(start)) return '';

  const end = props.completedAt ? Date.parse(props.completedAt) : Date.now();

  if (!Number.isFinite(end)) return '';

  const ms = end - start;

  if (ms < 1000) return `${ms}ms`;

  const s = Math.round(ms / 1000);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);
  const rem = s % 60;

  if (m < 60) return `${m}m ${rem}s`;

  const h = Math.floor(m / 60);

  return `${h}h ${m % 60}m`;
});
</script>

<template>
  <article
    class="subagent-block"
    :class="`status-${status}`"
    :aria-label="`Sub-agent ${displayName}, ${status}`"
  >
    <header class="subagent-header">
      <Button
        text
        size="small"
        :icon="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
        :aria-expanded="expanded"
        :aria-label="`Toggle sub-agent ${displayName}`"
        class="subagent-toggle"
        @click="toggle"
      />
      <i
        class="pi pi-users subagent-icon"
        aria-hidden="true"
      />
      <span
        class="subagent-name"
        :title="agentName"
        >{{ displayName }}</span
      >
      <span
        class="subagent-status-pill"
        :title="status"
        >{{ status }}</span
      >
      <span
        v-if="elapsedLabel"
        class="subagent-elapsed"
        >{{ elapsedLabel }}</span
      >
    </header>
    <p
      v-if="description"
      class="subagent-desc"
    >
      {{ description }}
    </p>
    <p
      v-if="status === 'failed' && error"
      class="subagent-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      v-if="expanded"
      class="subagent-body"
    >
      <div
        v-if="items.length === 0"
        class="subagent-empty"
      >
        <span v-if="status === 'running'">Working…</span>
        <span v-else>(no visible activity)</span>
      </div>
      <template
        v-for="item in items"
        :key="item.id"
      >
        <div
          v-if="item.kind === 'reasoning'"
          class="message-shell"
        >
          <ReasoningBlock
            :text="item.text"
            :visibility="reasoningVisibility"
            :opaque="item.opaque === true"
          />
        </div>
        <div
          v-else-if="item.kind === 'tool'"
          class="message-shell"
        >
          <ToolCallBlock
            :tool-name="item.toolName"
            :tool-call-id="item.toolCallId"
            :mcp-server-name="item.mcpServerName"
            :mcp-tool-name="item.mcpToolName"
            :args="item.args"
            :status="item.status"
            :progress-message="item.progressMessage"
            :partial-output="item.partialOutput"
            :result-content="item.resultContent"
            :error-message="item.errorMessage"
            :error-code="item.errorCode"
            :agent-id="item.agentId"
          />
        </div>
        <article
          v-else-if="item.kind === 'assistant' && item.text !== ''"
          class="message-card assistant"
        >
          <MessageContent
            :text="item.text"
            label="Sub-agent message"
          />
        </article>
        <article
          v-else-if="item.kind === 'system'"
          class="message-card system"
          :class="`severity-${item.severity}`"
        >
          <p class="message-body">{{ item.text }}</p>
        </article>
        <!-- user / pendingRequest / forkNotice / subagent items are
             never routed into a sub-agent's nested buffer by the
             reducer; no branches needed. -->
      </template>
    </div>
  </article>
</template>

<style scoped>
.subagent-block {
  border: 1px solid color-mix(in srgb, var(--p-primary-color) 30%, transparent);
  border-radius: var(--p-border-radius-md);
  background: color-mix(in srgb, var(--p-primary-color) 4%, var(--p-content-background));
  padding: 0.5rem 0.6rem;
  margin: 0.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.subagent-block.status-completed {
  border-color: color-mix(in srgb, var(--p-green-500, #22c55e) 30%, transparent);
  background: color-mix(in srgb, var(--p-green-500, #22c55e) 4%, var(--p-content-background));
}

.subagent-block.status-failed {
  border-color: color-mix(in srgb, var(--p-red-500, #ef4444) 30%, transparent);
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 6%, var(--p-content-background));
}

.subagent-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.subagent-toggle {
  flex-shrink: 0;
}

.subagent-icon {
  color: var(--p-primary-color);
}

.subagent-name {
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subagent-status-pill {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.6rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
  color: var(--p-primary-color);
  flex-shrink: 0;
}

.status-completed .subagent-status-pill {
  background: color-mix(in srgb, var(--p-green-500, #22c55e) 18%, transparent);
  color: var(--p-green-500, #22c55e);
}

.status-failed .subagent-status-pill {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 18%, transparent);
  color: var(--p-red-500, #ef4444);
}

.subagent-elapsed {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.subagent-desc {
  margin: 0;
  padding: 0 0 0 1.6rem;
  font-size: 0.8rem;
  color: var(--p-text-secondary-color);
}

.subagent-error {
  margin: 0;
  padding: 0.3rem 0.5rem;
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 10%, transparent);
  color: var(--p-red-500, #ef4444);
  border-radius: 0.2rem;
  font-size: 0.75rem;
  word-break: break-word;
}

.subagent-body {
  padding-left: 1rem;
  border-left: 2px solid color-mix(in srgb, var(--p-primary-color) 20%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.status-completed .subagent-body {
  border-left-color: color-mix(in srgb, var(--p-green-500, #22c55e) 20%, transparent);
}

.status-failed .subagent-body {
  border-left-color: color-mix(in srgb, var(--p-red-500, #ef4444) 20%, transparent);
}

.subagent-empty {
  color: var(--p-text-muted-color);
  font-style: italic;
  font-size: 0.85rem;
}

.message-shell {
  display: flex;
  flex-direction: column;
}

.message-card {
  padding: 0.5rem 0.6rem;
  border-radius: var(--p-border-radius-sm);
  background: var(--p-content-background);
  border: 1px solid var(--p-surface-border);
}

.message-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
