<script setup lang="ts">
/// Phase 19a — Library → MCP tab.
///
/// Configured + Discovered server lists. Add via dialog.
/// Per-row enable/disable (global allowlist), edit, remove,
/// sign-in (for http transports with oauth). Discovered servers
/// not yet in the configured list get an "Enable" shortcut that
/// calls `addMcpConfig` + `enableMcpServers`.

import { onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import Dialog from 'primevue/dialog';
import { useToastStore } from '@/stores/app/toastStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import McpServerForm from '@/components/library/McpServerForm.vue';
import {
  useMcpLibrary,
  type ConfiguredEntry,
  type DiscoveredEntry,
  type McpConfig,
} from '@/composables/library/useMcpLibrary';

const toasts = useToastStore();
const { activeSessionId } = storeToRefs(useLayoutStore());

const {
  configured,
  discovered,
  loaded,
  error,
  newlyDiscovered,
  loadAll,
  setEnabled,
  isEnabled,
  removeConfig,
  upsertConfig,
  signIn,
} = useMcpLibrary();

async function toggleEnable(entry: ConfiguredEntry) {
  // `discovered.enabled` is the source of truth for the global
  // allowlist (set/cleared by enable/disable RPCs). Mirror locally.
  const discoveredHit = discovered.value.find((d) => d.name === entry.name);
  const currentlyEnabled = discoveredHit ? discoveredHit.enabled : true;

  await setEnabled(entry.name, !currentlyEnabled);
}

async function removeEntry(entry: ConfiguredEntry) {
  if (!confirm(`Remove MCP server "${entry.name}"?`)) return;

  if (await removeConfig(entry.name)) {
    toasts.success('MCP server removed', entry.name);
  }
}

// ---------- Add / edit dialog ----------
const dialogOpen = ref(false);
const dialogMode = ref<'add' | 'edit'>('add');
const dialogInitialName = ref<string>('');
const dialogInitialConfig = ref<McpConfig>({});

function openAddDialog() {
  dialogMode.value = 'add';
  dialogInitialName.value = '';
  dialogInitialConfig.value = {};
  dialogOpen.value = true;
}

function openEditDialog(entry: ConfiguredEntry) {
  dialogMode.value = 'edit';
  dialogInitialName.value = entry.name;
  dialogInitialConfig.value = JSON.parse(JSON.stringify(entry.config));
  dialogOpen.value = true;
}

async function onDialogSubmit(payload: { name: string; config: McpConfig }) {
  if (await upsertConfig(dialogMode.value, payload)) {
    toasts.success(
      dialogMode.value === 'edit' ? 'MCP server updated' : 'MCP server added',
      payload.name,
    );
    dialogOpen.value = false;
  }
}

// ---------- Discovered enable / disable ----------
async function setDiscoveredEnabled(entry: DiscoveredEntry, enabled: boolean) {
  const result = await setEnabled(entry.name, enabled);

  if (result !== null) {
    toasts.success(enabled ? 'MCP server enabled' : 'MCP server disabled', entry.name);
  }
}

// ---------- OAuth sign-in ----------
async function onSignIn(entry: ConfiguredEntry) {
  const { state } = await signIn(entry.name);

  if (state === 'no-session') {
    toasts.warn(
      'No session to authenticate',
      'Create a session first; the OAuth flow runs through any active session.',
    );
  } else if (state === 'started') {
    toasts.info(
      'OAuth started',
      'Complete sign-in in your browser; the SDK will reconnect automatically.',
    );
  } else if (state === 'already-signed-in') {
    toasts.success('Already signed in', entry.name);
  }
}

onMounted(() => {
  void loadAll();
});
/// Auto-reload when the user switches to a different session — MCP
/// config uses session's workingDirectory to surface project-scoped
/// discovered servers. Mirror LibraryInstructionsTab pattern. Per #51.
watch(activeSessionId, () => {
  void loadAll();
});
</script>

<template>
  <div class="mcp-tab">
    <div class="tab-actions">
      <Button
        icon="pi pi-plus"
        label="Add"
        size="small"
        @click="openAddDialog"
      />
      <Button
        icon="pi pi-refresh"
        size="small"
        severity="secondary"
        text
        title="Refresh"
        :aria-label="'Refresh'"
        @click="loadAll"
      />
    </div>
    <div
      v-if="!loaded"
      class="empty-hint"
    >
      Loading…
    </div>
    <div
      v-else-if="error"
      class="empty-hint error"
    >
      {{ error }}
    </div>
    <template v-else>
      <section class="mcp-section">
        <h3 class="mcp-section-title">Configured</h3>
        <div
          v-if="configured.length === 0"
          class="empty-hint"
        >
          No MCP servers configured.
        </div>
        <ul
          v-else
          class="mcp-list"
        >
          <li
            v-for="entry in configured"
            :key="entry.name"
            class="mcp-row"
          >
            <div class="mcp-row-head">
              <span class="mcp-name">{{ entry.name }}</span>
              <span class="mcp-tag">{{ entry.transport }}</span>
            </div>
            <div class="mcp-row-actions">
              <ToggleSwitch
                :model-value="isEnabled(entry.name)"
                :aria-label="`Enable MCP server ${entry.name}`"
                @update:model-value="() => toggleEnable(entry)"
              />
              <Button
                v-if="entry.transport === 'http' && entry.hasOauth"
                icon="pi pi-sign-in"
                label="Sign in"
                size="small"
                severity="secondary"
                text
                @click="onSignIn(entry)"
              />
              <Button
                icon="pi pi-pencil"
                size="small"
                severity="secondary"
                text
                :title="`Edit ${entry.name}`"
                :aria-label="`Edit ${entry.name}`"
                @click="openEditDialog(entry)"
              />
              <Button
                icon="pi pi-trash"
                size="small"
                severity="secondary"
                text
                :title="`Remove ${entry.name}`"
                :aria-label="`Remove ${entry.name}`"
                @click="removeEntry(entry)"
              />
            </div>
          </li>
        </ul>
      </section>

      <section
        v-if="newlyDiscovered.length > 0"
        class="mcp-section"
      >
        <h3 class="mcp-section-title">Discovered</h3>
        <ul class="mcp-list">
          <li
            v-for="entry in newlyDiscovered"
            :key="entry.name"
            class="mcp-row"
          >
            <div class="mcp-row-head">
              <span class="mcp-name">{{ entry.name }}</span>
              <span class="mcp-tag">{{ entry.source }}</span>
            </div>
            <div class="mcp-row-actions">
              <ToggleSwitch
                :model-value="entry.enabled"
                :aria-label="`Enable discovered MCP server ${entry.name}`"
                @update:model-value="(enabled: boolean) => setDiscoveredEnabled(entry, enabled)"
              />
            </div>
          </li>
        </ul>
      </section>
    </template>

    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="dialogMode === 'edit' ? `Edit ${dialogInitialName}` : 'Add MCP server'"
      :style="{ width: 'min(560px, 92vw)' }"
    >
      <McpServerForm
        :initial-name="dialogInitialName"
        :initial-config="dialogInitialConfig"
        :name-locked="dialogMode === 'edit'"
        @submit="onDialogSubmit"
        @cancel="dialogOpen = false"
      />
    </Dialog>
  </div>
</template>

<style scoped>
.mcp-tab {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}

.tab-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding-bottom: 0.3rem;
}

.tab-actions :deep(.p-button) {
  flex-shrink: 0;
}

.mcp-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.mcp-section-title {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.mcp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.mcp-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  min-width: 0;
}

.mcp-row-head {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}

.mcp-name {
  font-size: 0.82rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 auto;
}

.mcp-tag {
  font-size: 0.62rem;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
  background: var(--p-content-hover-background);
  padding: 0.1rem 0.35rem;
  border-radius: var(--p-border-radius-sm);
  flex-shrink: 0;
}

.mcp-row-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.empty-hint {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  padding: 0.4rem 0;
}

.empty-hint.error {
  color: var(--p-message-error-color);
}
</style>
