<script setup lang="ts">
/// Phase 19a — Library → MCP tab.
///
/// Configured + Discovered server lists. Add via dialog.
/// Per-row enable/disable (global allowlist), edit, remove,
/// sign-in (for http transports with oauth). Discovered servers
/// not yet in the configured list get an "Enable" shortcut that
/// calls `addMcpConfig` + `enableMcpServers`.

import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import Dialog from 'primevue/dialog';
import { invokeCommand } from '../ipc/invoke';
import { useToastStore } from '../stores/toastStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useLayoutStore } from '../stores/layoutStore';
import McpServerForm from './McpServerForm.vue';
import { toErrorMessage } from '../lib/errorMessage';

type McpConfig = Record<string, unknown>;
type ConfiguredEntry = {
  name: string;
  config: McpConfig;
  /// Local vs http transport. Falls back to "local" when the SDK
  /// config blob doesn't include a type discriminator (some shapes
  /// only set `command` for local and `url` for http).
  transport: 'local' | 'http';
  hasOauth: boolean;
};
type DiscoveredEntry = {
  name: string;
  type?: string;
  source: string;
  enabled: boolean;
};

const toasts = useToastStore();
const sessionsStore = useSessionsStore();

const configured = ref<ConfiguredEntry[]>([]);
const discovered = ref<DiscoveredEntry[]>([]);
const loaded = ref(false);
const error = ref<string | null>(null);

const knownNames = computed(() => new Set(configured.value.map((e) => e.name)));
const newlyDiscovered = computed(() =>
  discovered.value.filter((d) => !knownNames.value.has(d.name)),
);

function classifyTransport(config: McpConfig): {
  transport: 'local' | 'http';
  hasOauth: boolean;
} {
  const type = typeof config.type === 'string' ? config.type : null;

  if (type === 'http' || type === 'sse') {
    return {
      transport: 'http',
      hasOauth: Boolean(config.oauthClientId) || Boolean(config.oauthGrantType),
    };
  }

  if (type === 'local' || type === 'stdio') {
    return { transport: 'local', hasOauth: false };
  }

  // No explicit type — infer from shape. `url` field implies http.
  if (typeof config.url === 'string') {
    return {
      transport: 'http',
      hasOauth: Boolean(config.oauthClientId) || Boolean(config.oauthGrantType),
    };
  }

  return { transport: 'local', hasOauth: false };
}

async function loadAll() {
  error.value = null;
  loaded.value = false;

  try {
    // Pass the active session's workingDirectory (or any open
    // session's, falling back to none) so the SDK's discovery picks
    // up workspace-level `.mcp.json` files. Without this, servers
    // configured per-workspace (e.g. the github MCP a session has
    // already auto-connected to) would NOT show up in the Library
    // — the SDK's mcp.discover defaults to user-config only.
    const activeId = useLayoutStore().activeSessionId;
    const active = sessionsStore.getSession(activeId);
    const wd =
      active?.workingDirectory ||
      sessionsStore.sessions.find((s) => s.workingDirectory)?.workingDirectory ||
      '';
    // Also query the active session's live MCP list — it includes
    // servers that the SDK auto-discovered AND connected to, which
    // mcp.discover (server-scoped) may miss for plugin-supplied
    // configs that only register against a live session.
    const sessionMcpsPromise = activeId
      ? invokeCommand('listSessionMcpServers', { sessionId: activeId }).catch(
          () => [] as Array<{ name: string }>,
        )
      : Promise.resolve([] as Array<{ name: string }>);
    const [configs, disc, sessionMcps] = await Promise.all([
      invokeCommand('listMcpConfigs', {}),
      invokeCommand('discoverMcpServers', wd ? { workingDirectory: wd } : {}),
      sessionMcpsPromise,
    ]);

    configured.value = Object.entries(configs).map(([name, config]) => {
      const c = classifyTransport(config);

      return { name, config, ...c };
    });
    // Merge session-side MCP names into the Discovered list. A live
    // session's mcp.list can include servers that the server-scoped
    // mcp.discover misses (e.g. plugin-supplied configs that only
    // resolve against a real session). Tag them as discovered with
    // source="session" so the user knows where they came from.
    const merged = new Map<string, DiscoveredEntry>();

    for (const d of disc) merged.set(d.name, { ...d });

    for (const s of sessionMcps) {
      if (merged.has(s.name)) continue;

      merged.set(s.name, {
        name: s.name,
        source: 'session',
        enabled: true,
      });
    }

    discovered.value = [...merged.values()];
    loaded.value = true;
  } catch (err) {
    error.value = toErrorMessage(err);
    loaded.value = true;
  }
}

/// After toggling at the config level (which only affects new
/// sessions), also push the change to every currently-open session
/// so the toggle takes effect immediately.
async function syncToggleToActiveSessions(serverName: string, enabled: boolean) {
  for (const session of sessionsStore.sessions) {
    try {
      await invokeCommand('setSessionMcpEnabled', {
        sessionId: session.id,
        serverName,
        enabled,
      });
    } catch {
      // Session may not have this server connected — ignore.
    }
  }
}

async function toggleEnable(entry: ConfiguredEntry) {
  // `discovered.enabled` is the source of truth for the global
  // allowlist (set/cleared by enable/disable RPCs). Mirror locally.
  const discoveredHit = discovered.value.find((d) => d.name === entry.name);
  const currentlyEnabled = discoveredHit ? discoveredHit.enabled : true;
  const next = !currentlyEnabled;

  try {
    if (next) {
      await invokeCommand('enableMcpServers', { names: [entry.name] });
    } else {
      await invokeCommand('disableMcpServers', { names: [entry.name] });
    }

    // Push the change to active sessions so it takes effect immediately
    // (config-level enable/disable only affects new sessions).
    await syncToggleToActiveSessions(entry.name, next);
    await loadAll();
  } catch (err) {
    toasts.error('Failed to toggle MCP server', toErrorMessage(err));
  }
}

function isEnabled(name: string): boolean {
  const hit = discovered.value.find((d) => d.name === name);

  // When the discover list doesn't include the configured server
  // (e.g. broken plugin), assume enabled — matches the SDK default
  // which auto-enables anything not in the disabled set.
  return hit ? hit.enabled : true;
}

async function removeEntry(entry: ConfiguredEntry) {
  if (!confirm(`Remove MCP server "${entry.name}"?`)) return;

  try {
    await invokeCommand('removeMcpConfig', { name: entry.name });
    configured.value = configured.value.filter((e) => e.name !== entry.name);
    toasts.success('MCP server removed', entry.name);
  } catch (err) {
    toasts.error('Failed to remove', toErrorMessage(err));
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
  try {
    if (dialogMode.value === 'edit') {
      await invokeCommand('updateMcpConfig', payload);
      toasts.success('MCP server updated', payload.name);
    } else {
      await invokeCommand('addMcpConfig', payload);
      toasts.success('MCP server added', payload.name);
    }

    dialogOpen.value = false;
    await loadAll();
  } catch (err) {
    toasts.error('Save failed', toErrorMessage(err));
  }
}

// ---------- Discovered enable / disable ----------
async function setDiscoveredEnabled(entry: DiscoveredEntry, enabled: boolean) {
  try {
    if (enabled) {
      await invokeCommand('enableMcpServers', { names: [entry.name] });
    } else {
      await invokeCommand('disableMcpServers', { names: [entry.name] });
    }

    // Push to active sessions so the toggle takes effect immediately.
    await syncToggleToActiveSessions(entry.name, enabled);
    await loadAll();
    toasts.success(enabled ? 'MCP server enabled' : 'MCP server disabled', entry.name);
  } catch (err) {
    toasts.error('MCP toggle failed', toErrorMessage(err));
  }
}

// ---------- OAuth sign-in ----------
async function signIn(entry: ConfiguredEntry) {
  const session = sessionsStore.sessions[0];

  if (!session) {
    toasts.warn(
      'No session to authenticate',
      'Create a session first; the OAuth flow runs through any active session.',
    );

    return;
  }

  try {
    const result = await invokeCommand('loginToMcpServer', {
      sessionId: session.id,
      serverName: entry.name,
    });

    if (result.authorizationUrl) {
      await invokeCommand('openUrl', { url: result.authorizationUrl });
      toasts.info(
        'OAuth started',
        'Complete sign-in in your browser; the SDK will reconnect automatically.',
      );
    } else {
      toasts.success('Already signed in', entry.name);
    }
  } catch (err) {
    toasts.error('Sign-in failed', toErrorMessage(err));
  }
}

onMounted(() => {
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
                @click="signIn(entry)"
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
