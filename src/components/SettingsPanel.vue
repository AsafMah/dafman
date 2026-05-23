<script setup lang="ts">
// Settings — left edge-group panel.
//
// Replaces the old SettingsDialog modal: settings is now a persistent
// sidebar like Sessions. Collapsible sections instead of tabs so the
// whole catalog is browsable at a glance and a future search field
// can filter across all of them at once.
//
// New settings categories slot in as additional <section> blocks; the
// existing collapsedGroups reactive map keys them by id.

import { computed, onMounted, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import ToggleSwitch from "primevue/toggleswitch";
import { useNotificationsStore } from "../stores/notificationsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import { invokeCommand } from "../ipc/invoke";
import type { ModelSummary, ReasoningVisibility, ThemeChoice } from "../ipc/types";
import { useModelsStore } from "../stores/modelsStore";

const settingsStore = useSettingsStore();
const modelsStore = useModelsStore();
const notificationsStore = useNotificationsStore();
const { settings, isSaving } = storeToRefs(settingsStore);
const { models } = storeToRefs(modelsStore);

onMounted(() => {
  void modelsStore.load().catch(() => {
    /* toast already shown by the store */
  });
});

const themeOptions: { label: string; value: ThemeChoice }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const reasoningOptions: { label: string; value: ReasoningVisibility }[] = [
  { label: "Hidden", value: "hidden" },
  { label: "Compact", value: "compact" },
  { label: "Expanded", value: "expanded" },
];

const terminalProfileOptions = [
  { label: "Platform default", value: "platform-default" },
  { label: "PowerShell 7 / pwsh", value: "pwsh" },
  { label: "Windows PowerShell", value: "powershell" },
  { label: "Command Prompt", value: "cmd" },
  { label: "Unix shell ($SHELL)", value: "unix-shell" },
];

const defaultModelOptions = computed<Array<ModelSummary | { id: ""; name: string }>>(
  () => [{ id: "", name: "CLI default" }, ...models.value],
);

const defaultModel = computed<string>({
  get: () => settings.value.appearance.defaultModelId ?? "",
  set: (value) => {
    const model = models.value.find((m) => m.id === value);
    const effort = model?.supportsReasoningEffort
      ? settings.value.appearance.defaultReasoningEffort ?? model.defaultReasoningEffort
      : null;
    void settingsStore.setDefaultModel(value, effort);
  },
});

const selectedDefaultModel = computed(() =>
  models.value.find((m) => m.id === defaultModel.value),
);

const defaultReasoningOptions = computed(() => [
  { label: "Model default", value: null as string | null },
  ...(selectedDefaultModel.value?.supportedReasoningEfforts ?? []).map((effort) => ({
    label: effort,
    value: effort,
  })),
]);

const defaultReasoning = computed<string | null>({
  get: () => settings.value.appearance.defaultReasoningEffort ?? null,
  set: (value) => {
    void settingsStore.setDefaultModel(defaultModel.value, value);
  },
});

const defaultTerminalProfile = computed<string>({
  get: () => settings.value.terminal?.defaultProfileId ?? "platform-default",
  set: (value) => {
    void settingsStore.setDefaultTerminalProfile(value);
  },
});

const theme = computed<ThemeChoice>({
  get: () => settings.value.appearance.theme,
  set: (value) => {
    void settingsStore.setTheme(value);
  },
});

const reasoningVisibility = computed<ReasoningVisibility>({
  get: () => settings.value.appearance.reasoningVisibility,
  set: (value) => {
    void settingsStore.setReasoningVisibility(value);
  },
});

const streaming = computed<boolean>({
  get: () => settings.value.appearance.streaming,
  set: (value) => {
    void settingsStore.setStreaming(value);
  },
});

const enableMermaid = computed<boolean>({
  get: () => settings.value.appearance.enableMermaid,
  set: (value) => {
    void settingsStore.setEnableMermaid(value);
  },
});

// ---------- Notifications ----------

/// Two booleans bound to settings.notifications.{turnEnd,waitingForInput}.
/// Setter routes through settingsStore.setNotifications so the
/// changes persist immediately.
const notifyTurnEnd = computed<boolean>({
  get: () => settings.value.notifications?.turnEnd ?? false,
  set: (value) => {
    void settingsStore.setNotifications({ turnEnd: value });
    // If the user just turned ON a notification and the browser
    // doesn't have permission yet, kick off the prompt so they
    // don't enable a no-op toggle. Skipped when turning OFF.
    if (value && notificationsStore.permission === "default") {
      void notificationsStore.requestPermission();
    }
  },
});

const notifyWaitingForInput = computed<boolean>({
  get: () => settings.value.notifications?.waitingForInput ?? true,
  set: (value) => {
    void settingsStore.setNotifications({ waitingForInput: value });
    if (value && notificationsStore.permission === "default") {
      void notificationsStore.requestPermission();
    }
  },
});

const notificationPermissionLabel = computed(() => {
  switch (notificationsStore.permission) {
    case "granted":
      return "Granted";
    case "denied":
      return "Denied — enable in your OS / browser settings.";
    case "default":
      return "Not yet asked — toggle a notification on to grant.";
    case "unsupported":
    default:
      return "Not supported in this WebView.";
  }
});

async function askPermission() {
  await notificationsStore.requestPermission();
}

async function openLogFolder() {
  const toasts = useToastStore();
  try {
    const ok = await invokeCommand("openLogFolder", {});
    if (!ok) toasts.warn("Log folder not available yet");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toasts.error("Couldn't open log folder", message);
  }
}

/// Default-workspace draft kept separate from the persisted value so
/// the user can type freely without firing an RPC on every keystroke.
/// Committed on blur / Enter. Synced from the store whenever the
/// canonical value changes (e.g. the startup backfill landed).
const defaultWorkspaceDraft = ref<string>(
  settings.value.workspaces.defaultWorkspace ?? "",
);
watch(
  () => settings.value.workspaces.defaultWorkspace,
  (next) => {
    if (next !== defaultWorkspaceDraft.value) {
      defaultWorkspaceDraft.value = next ?? "";
    }
  },
);

async function commitDefaultWorkspace() {
  const next = defaultWorkspaceDraft.value.trim();
  if (next === settings.value.workspaces.defaultWorkspace) return;
  await settingsStore.setDefaultWorkspace(next);
}

const isPickingDefault = ref(false);
async function pickDefaultWorkspace() {
  if (isPickingDefault.value) return;
  isPickingDefault.value = true;
  try {
    const picked = await invokeCommand("pickFolder", {
      startingFolder: defaultWorkspaceDraft.value.trim() || undefined,
    });
    if (picked) {
      defaultWorkspaceDraft.value = picked;
      await settingsStore.setDefaultWorkspace(picked);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useToastStore().error("Couldn't pick folder", message);
  } finally {
    isPickingDefault.value = false;
  }
}

async function revealDefaultWorkspace() {
  const path = defaultWorkspaceDraft.value.trim();
  if (!path) return;
  try {
    await invokeCommand("revealPath", { path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useToastStore().error("Couldn't reveal folder", message);
  }
}

/// 22c: Bound to settings.permissions.defaultApproveAll.
/// Drives the global default for new-session approve-all.
const defaultApproveAll = computed<boolean>({
  get: () => settings.value.permissions?.defaultApproveAll ?? false,
  set: (value) => {
    void settingsStore.setDefaultApproveAll(value);
  },
});

/// Collapse state per section id. In-memory only — defaults to all
/// expanded so a fresh open shows every option, matching how a
/// search UI will eventually surface them.
const collapsed = reactive<Record<string, boolean>>({});
function toggle(id: string) {
  collapsed[id] = !collapsed[id];
}
</script>

<template>
  <div class="settings-panel">
    <!-- Appearance -->
    <section class="settings-group">
      <button
        type="button"
        class="group-header"
        :aria-expanded="!collapsed.appearance"
        @click="toggle('appearance')"
      >
        <i
          class="pi group-chevron"
          :class="
            collapsed.appearance ? 'pi-chevron-right' : 'pi-chevron-down'
          "
          aria-hidden="true"
        />
        <i class="pi pi-palette group-icon" aria-hidden="true" />
        <span class="group-label">Appearance</span>
      </button>

      <div v-show="!collapsed.appearance" class="group-body">
        <label class="field" for="theme-select">
          <span class="field-label">Theme</span>
          <Select
            id="theme-select"
            v-model="theme"
            :options="themeOptions"
            option-label="label"
            option-value="value"
            size="small"
            filter
            class="field-control"
          />
        </label>

        <label class="field" for="reasoning-select">
          <span class="field-label">Reasoning visibility</span>
          <Select
            id="reasoning-select"
            v-model="reasoningVisibility"
            :options="reasoningOptions"
            option-label="label"
            option-value="value"
            size="small"
            filter
            class="field-control"
          />
          <p class="field-hint">
            Default for new chats. Each session can override this from its header.
          </p>
        </label>
        <label class="field" for="default-model-select">
          <span class="field-label">Default model</span>
          <Select
            id="default-model-select"
            v-model="defaultModel"
            :options="defaultModelOptions"
            option-label="name"
            option-value="id"
            size="small"
            filter
            class="field-control"
          />
          <p class="field-hint">
            Used for newly-created sessions. Existing sessions keep their current model.
          </p>
        </label>
        <label
          v-if="selectedDefaultModel?.supportsReasoningEffort"
          class="field"
          for="default-reasoning-select"
        >
          <span class="field-label">Default reasoning effort</span>
          <Select
            id="default-reasoning-select"
            v-model="defaultReasoning"
            :options="defaultReasoningOptions"
            option-label="label"
            option-value="value"
            size="small"
            class="field-control"
          />
        </label>
        <div class="field field-inline">
          <label class="field-inline-label">
            <ToggleSwitch v-model="streaming" />
            <span>Stream assistant replies</span>
          </label>
          <p class="field-hint">
            Off (default): the agent's reply appears in one chunk per
            turn. On: text streams in word-by-word (livelier, but can
            jitter under heavy load). Takes effect on the
            <strong>next</strong> session you create.
          </p>
        </div>
        <div class="field field-inline">
          <label class="field-inline-label">
            <ToggleSwitch v-model="enableMermaid" />
            <span>Render mermaid diagrams</span>
          </label>
          <p class="field-hint">
            Off (default): <code>```mermaid</code> fences render as
            plain code blocks. On: lazy-loads the mermaid library on
            first use and renders the diagram inline. Adds ~800 KB to
            the chunk fetched when you first open a chat with a
            diagram.
          </p>
        </div>
      </div>
    </section>

    <!-- Workspaces -->
    <section class="settings-group">
      <button
        type="button"
        class="group-header"
        :aria-expanded="!collapsed.workspaces"
        @click="toggle('workspaces')"
      >
        <i
          class="pi group-chevron"
          :class="
            collapsed.workspaces ? 'pi-chevron-right' : 'pi-chevron-down'
          "
          aria-hidden="true"
        />
        <i class="pi pi-folder group-icon" aria-hidden="true" />
        <span class="group-label">Workspaces</span>
      </button>

      <div v-show="!collapsed.workspaces" class="group-body">
        <div class="field">
          <span class="field-label" id="default-workspace-label">
            Default workspace
          </span>
          <div class="field-control workspace-row">
            <InputText
              v-model="defaultWorkspaceDraft"
              aria-labelledby="default-workspace-label"
              placeholder="No default"
              size="small"
              @blur="commitDefaultWorkspace"
              @keydown.enter.prevent="commitDefaultWorkspace"
            />
            <Button
              icon="pi pi-folder-open"
              severity="secondary"
              size="small"
              aria-label="Pick default workspace folder"
              :loading="isPickingDefault"
              @click="pickDefaultWorkspace"
            />
            <Button
              v-if="defaultWorkspaceDraft"
              icon="pi pi-external-link"
              severity="secondary"
              size="small"
              aria-label="Reveal default workspace folder"
              @click="revealDefaultWorkspace"
            />
          </div>
          <p class="field-hint">
            Used to pre-fill the path for new sessions. Defaults to
            <code>~/dafman</code> (created on first launch).
          </p>
        </div>
      </div>
    </section>

    <!-- Terminal -->
    <section class="settings-group">
      <button
        type="button"
        class="group-header"
        :aria-expanded="!collapsed.terminal"
        @click="toggle('terminal')"
      >
        <i
          class="pi group-chevron"
          :class="collapsed.terminal ? 'pi-chevron-right' : 'pi-chevron-down'"
          aria-hidden="true"
        />
        <i class="pi pi-window-maximize group-icon" aria-hidden="true" />
        <span class="group-label">Terminal</span>
      </button>
      <div v-show="!collapsed.terminal" class="group-body">
        <label class="field" for="terminal-profile-select">
          <span class="field-label">Default terminal profile</span>
          <Select
            id="terminal-profile-select"
            v-model="defaultTerminalProfile"
            :options="terminalProfileOptions"
            option-label="label"
            option-value="value"
            size="small"
            class="field-control"
          />
          <p class="field-hint">
            Used for new terminal panes. Full profile editing is planned for a later slice.
          </p>
        </label>
      </div>
    </section>

    <!-- Notifications -->
    <section class="settings-group">
      <button
        type="button"
        class="group-header"
        :aria-expanded="!collapsed.notifications"
        @click="toggle('notifications')"
      >
        <i
          class="pi group-chevron"
          :class="
            collapsed.notifications ? 'pi-chevron-right' : 'pi-chevron-down'
          "
          aria-hidden="true"
        />
        <i class="pi pi-bell group-icon" aria-hidden="true" />
        <span class="group-label">Notifications</span>
      </button>

      <div v-show="!collapsed.notifications" class="group-body">
        <div class="field field-inline">
          <label class="field-inline-label">
            <ToggleSwitch v-model="notifyWaitingForInput" />
            <span>Waiting for input</span>
          </label>
          <p class="field-hint">
            OS notification when a tool needs permission or a session
            asks for input, and you're not on its panel.
          </p>
        </div>
        <div class="field field-inline">
          <label class="field-inline-label">
            <ToggleSwitch v-model="notifyTurnEnd" />
            <span>Turn complete</span>
          </label>
          <p class="field-hint">
            OS notification on every <code>assistant.turn_end</code> for
            a background session. Off by default — can be noisy.
          </p>
        </div>
        <div class="field">
          <p class="field-hint">
            Browser permission: <strong>{{ notificationPermissionLabel }}</strong>
          </p>
          <Button
            v-if="notificationsStore.permission === 'default'"
            label="Request permission"
            icon="pi pi-shield"
            severity="secondary"
            size="small"
            @click="askPermission"
          />
        </div>
      </div>
    </section>

    <!-- Permissions (Phase 22c) -->
    <section class="settings-group">
      <button
        type="button"
        class="group-header"
        :aria-expanded="!collapsed.permissions"
        @click="toggle('permissions')"
      >
        <i
          class="pi group-chevron"
          :class="
            collapsed.permissions ? 'pi-chevron-right' : 'pi-chevron-down'
          "
          aria-hidden="true"
        />
        <i class="pi pi-shield group-icon" aria-hidden="true" />
        <span class="group-label">Permissions</span>
      </button>

      <div v-show="!collapsed.permissions" class="group-body">
        <div class="field field-inline">
          <label class="field-inline-label">
            <ToggleSwitch v-model="defaultApproveAll" />
            <span>Default to approve all for new sessions</span>
          </label>
          <p class="field-hint">
            When ON, brand-new sessions automatically approve every
            privileged tool call (file write, shell, network, etc.)
            without prompting. Off by default — explicit user choice.
            The per-session toggle in the session rail continues to
            drive runtime state; this only sets the starting value.
          </p>
        </div>
        <div class="field">
          <p class="field-hint">
            To reset remembered approvals for an open session, use
            "Reset approvals" in the session's right-rail Session
            section.
          </p>
        </div>
      </div>
    </section>

    <!-- Diagnostics -->
    <section class="settings-group">
      <button
        type="button"
        class="group-header"
        :aria-expanded="!collapsed.diagnostics"
        @click="toggle('diagnostics')"
      >
        <i
          class="pi group-chevron"
          :class="
            collapsed.diagnostics ? 'pi-chevron-right' : 'pi-chevron-down'
          "
          aria-hidden="true"
        />
        <i class="pi pi-info-circle group-icon" aria-hidden="true" />
        <span class="group-label">Diagnostics</span>
      </button>

      <div v-show="!collapsed.diagnostics" class="group-body">
        <div class="field">
          <Button
            label="Open log folder"
            icon="pi pi-folder-open"
            severity="secondary"
            size="small"
            class="field-control"
            @click="openLogFolder"
          />
          <p class="field-hint">
            Daily JSON log. Set <code>DAFMAN_LOG=debug</code> to capture full event payloads.
          </p>
        </div>
      </div>
    </section>

    <!-- About -->
    <section class="settings-group">
      <button
        type="button"
        class="group-header"
        :aria-expanded="!collapsed.about"
        @click="toggle('about')"
      >
        <i
          class="pi group-chevron"
          :class="collapsed.about ? 'pi-chevron-right' : 'pi-chevron-down'"
          aria-hidden="true"
        />
        <i class="pi pi-tag group-icon" aria-hidden="true" />
        <span class="group-label">About</span>
      </button>

      <div v-show="!collapsed.about" class="group-body">
        <p class="field-hint">
          Schema version <strong>{{ settings.version }}</strong> — stored under
          <code>userData/settings.json</code>.
        </p>
      </div>
    </section>

    <p v-if="isSaving" class="saving-state">Saving…</p>
  </div>
</template>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--p-content-background);
  color: var(--p-text-color);
  overflow-y: auto;
  padding: 0.25rem 0 0.5rem;
}

.settings-group {
  border-bottom: 1px solid color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  color: var(--p-text-color);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

.group-header:hover {
  background: color-mix(in srgb, var(--p-text-color) 5%, transparent);
}

.group-header:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}

.group-chevron {
  font-size: 0.65rem;
  width: 0.75rem;
  text-align: center;
  flex: 0 0 auto;
  color: var(--p-text-muted-color);
}

.group-icon {
  font-size: 0.8rem;
  flex: 0 0 auto;
  color: var(--p-text-muted-color);
}

.group-label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-body {
  padding: 0.3rem 0.6rem 0.6rem 1.95rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-inline {
  gap: 0.4rem;
}

.field-inline-label {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.9rem;
  color: var(--p-text-color);
  cursor: pointer;
}

.field-label {
  font-size: 0.78rem;
  color: var(--p-text-color);
}

.field-control {
  width: 100%;
  max-width: 100%;
}

/* Default-workspace row: input + pick + reveal buttons inline. */
.workspace-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.workspace-row :deep(.p-inputtext) {
  flex: 1 1 auto;
  min-width: 0;
}

/* PrimeVue Select fills its container — let it shrink with the
 * sidebar instead of demanding a fixed minimum width. */
.field-control :deep(.p-select) {
  width: 100%;
}

.field-hint {
  margin: 0;
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  line-height: 1.4;
}

.field-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  padding: 0.02em 0.3em;
  border-radius: 3px;
  background: color-mix(in srgb, var(--p-text-color) 10%, transparent);
}

.saving-state {
  margin: 0;
  padding: 0.4rem 0.6rem;
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
}
</style>
