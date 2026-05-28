<template>
  <section
    v-if="entries.length > 0"
    class="agents-group"
  >
    <h3 class="group-title">{{ title }} ({{ entries.length }})</h3>
    <ul class="agents-list">
      <li
        v-for="entry in entries"
        :key="`${keyPrefix}:${entry.name}`"
        class="agent-row"
        :class="{ 'agent-row-selected': currentAgentName === entry.name }"
      >
        <div class="agent-line">
          <span class="agent-name">{{ entry.name }}</span>
          <small
            v-if="!entry.canonical"
            class="warn-tag"
            title="File ends with .md (not .agent.md)"
          >
            .md
          </small>
          <span
            v-if="currentAgentName === entry.name"
            class="agent-current-chip"
            :title="`This agent is selected for the active session`"
          >
            Selected
          </span>
        </div>
        <div
          class="agent-path"
          :title="entry.path"
        >
          {{ entry.path }}
        </div>
        <div class="agent-actions">
          <Button
            v-if="currentAgentName === entry.name"
            size="small"
            severity="secondary"
            :loading="agentBusyName === '__deselect__'"
            :disabled="!activeSession || !!agentBusyName"
            label="Deselect"
            :aria-label="`Deselect agent ${entry.name}`"
            @click="$emit('deselect')"
          />
          <Button
            v-else
            size="small"
            :loading="agentBusyName === entry.name"
            :disabled="!activeSession || !!agentBusyName"
            label="Select"
            :aria-label="`Select agent ${entry.name}`"
            @click="$emit('select', entry.name)"
          />
          <Button
            size="small"
            text
            icon="pi pi-pencil"
            :disabled="!activeSession"
            :aria-label="`Edit ${entry.name}`"
            @click="$emit('edit', entry)"
          />
          <Button
            size="small"
            text
            icon="pi pi-external-link"
            :aria-label="`Reveal ${entry.name} in file manager`"
            @click="$emit('reveal', entry.path)"
          />
          <Button
            size="small"
            severity="danger"
            text
            icon="pi pi-trash"
            :disabled="!activeSession"
            :aria-label="`Delete ${entry.name}`"
            @click="$emit('delete', entry)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import Button from 'primevue/button';
import type { AgentFileEntry } from '@/ipc/types';

defineProps<{
  title: string;
  keyPrefix: string;
  entries: AgentFileEntry[];
  currentAgentName: string | null;
  agentBusyName: string | null;
  activeSession: boolean;
}>();

defineEmits<{
  (e: 'select' | 'reveal', payload: string): void;
  (e: 'deselect'): void;
  (e: 'edit' | 'delete', entry: AgentFileEntry): void;
}>();
</script>
