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

import { computed, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import { invokeCommand } from "../ipc/invoke";
import type { ReasoningVisibility, ThemeChoice } from "../ipc/types";

const settingsStore = useSettingsStore();
const { settings, isSaving } = storeToRefs(settingsStore);

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
