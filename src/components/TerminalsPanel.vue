<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import ToggleSwitch from "primevue/toggleswitch";
import { useLayoutStore } from "../stores/layoutStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useToastStore } from "../stores/toastStore";
import type { TerminalAddonPrefs } from "../ipc/types";

const terminalStore = useTerminalStore();
const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const settingsStore = useSettingsStore();
const toasts = useToastStore();

const shell = ref("");
const args = ref("");
const cwd = ref("");

const terminalPrefs = computed(() => settingsStore.settings.terminal);
const addonLabels: Array<{ key: keyof TerminalAddonPrefs; label: string }> = [
  { key: "search", label: "Search" },
  { key: "webLinks", label: "Web links" },
  { key: "clipboard", label: "Clipboard" },
  { key: "unicode11", label: "Unicode 11" },
  { key: "webFonts", label: "Web fonts" },
  { key: "progress", label: "Progress" },
  { key: "ligatures", label: "Ligatures" },
  { key: "image", label: "Images" },
  { key: "unicodeGraphemes", label: "Graphemes" },
  { key: "webgl", label: "WebGL" },
  { key: "serialize", label: "Serialize" },
];

const terminals = computed(() =>
  [...terminalStore.terminals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

const activeSession = computed(() =>
  sessionsStore.sessions.find((session) => session.id === layoutStore.activeSessionId),
);

function splitArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function createTerminal(useSessionCwd = false): Promise<void> {
  try {
    const sessionCwd = useSessionCwd ? activeSession.value?.workingDirectory ?? undefined : undefined;
    const summary = await terminalStore.createTerminal({
      cols: 80,
      rows: 24,
      ...(shell.value.trim() ? { shell: shell.value.trim() } : {}),
      ...(args.value.trim() ? { args: splitArgs(args.value) } : {}),
      ...(cwd.value.trim() || sessionCwd ? { cwd: cwd.value.trim() || sessionCwd } : {}),
      ...(useSessionCwd && activeSession.value ? { sessionId: activeSession.value.id } : {}),
      title: shell.value.trim() || (useSessionCwd ? "Session Terminal" : "Terminal"),
    });
    layoutStore.addTerminalPanel(summary.id, summary.title);
  } catch (err) {
    toasts.error("Failed to create terminal", err instanceof Error ? err.message : String(err));
  }
}

function openTerminal(id: string, title: string): void {
  layoutStore.addTerminalPanel(id, title);
}

function setFontFamily(value: string): void {
  void settingsStore.setTerminalPrefs({ fontFamily: value.trim() || terminalPrefs.value.fontFamily });
}

function setFontSize(value: number | null | undefined): void {
  if (typeof value !== "number") return;
  void settingsStore.setTerminalPrefs({ fontSize: value });
}

function setScrollback(value: number | null | undefined): void {
  if (typeof value !== "number") return;
  void settingsStore.setTerminalPrefs({ scrollback: value });
}

function setBackground(value: string): void {
  void settingsStore.setTerminalPrefs({ theme: { background: value.trim() || terminalPrefs.value.theme.background } });
}

function setForeground(value: string): void {
  void settingsStore.setTerminalPrefs({ theme: { foreground: value.trim() || terminalPrefs.value.theme.foreground } });
}

function setAddon(key: keyof TerminalAddonPrefs, value: boolean): void {
  void settingsStore.setTerminalPrefs({ addons: { [key]: value } as Partial<TerminalAddonPrefs> });
}
</script>

<template>
  <section class="terminals-panel">
    <header class="terminals-header">
      <div>
        <h2>Terminals</h2>
        <p>{{ terminals.length }} terminal{{ terminals.length === 1 ? "" : "s" }}</p>
      </div>
      <Button
        icon="pi pi-refresh"
        text
        rounded
        size="small"
        aria-label="Refresh terminals"
        @click="terminalStore.refresh"
      />
    </header>

    <section class="terminal-create">
      <h3>New terminal</h3>
      <label class="field">
        <span>Command</span>
        <InputText v-model="shell" size="small" placeholder="Platform default" />
      </label>
      <label class="field">
        <span>Args</span>
        <InputText v-model="args" size="small" placeholder="-NoLogo" />
      </label>
      <label class="field">
        <span>CWD</span>
        <InputText v-model="cwd" size="small" placeholder="Current app directory" />
      </label>
      <div class="create-actions">
        <Button label="New" icon="pi pi-plus" size="small" @click="createTerminal(false)" />
        <Button
          label="From session"
          icon="pi pi-folder-open"
          size="small"
          severity="secondary"
          :disabled="!activeSession"
          @click="createTerminal(true)"
        />
      </div>
    </section>

    <section class="terminal-create">
      <h3>Display + addons</h3>
      <label class="field">
        <span>Font family</span>
        <InputText
          :model-value="terminalPrefs.fontFamily"
          size="small"
          @update:model-value="(value) => setFontFamily(String(value))"
        />
      </label>
      <div class="settings-grid">
        <label class="field">
          <span>Font size</span>
          <InputNumber
            :model-value="terminalPrefs.fontSize"
            size="small"
            :min="8"
            :max="32"
            @update:model-value="setFontSize"
          />
        </label>
        <label class="field">
          <span>Scrollback</span>
          <InputNumber
            :model-value="terminalPrefs.scrollback"
            size="small"
            :min="1000"
            :max="100000"
            @update:model-value="setScrollback"
          />
        </label>
      </div>
      <div class="settings-grid">
        <label class="field">
          <span>Background</span>
          <InputText
            :model-value="terminalPrefs.theme.background"
            size="small"
            @update:model-value="(value) => setBackground(String(value))"
          />
        </label>
        <label class="field">
          <span>Foreground</span>
          <InputText
            :model-value="terminalPrefs.theme.foreground"
            size="small"
            @update:model-value="(value) => setForeground(String(value))"
          />
        </label>
      </div>
      <div class="addon-grid">
        <label v-for="addon in addonLabels" :key="addon.key" class="addon-toggle">
          <ToggleSwitch
            :model-value="terminalPrefs.addons[addon.key]"
            @update:model-value="(value) => setAddon(addon.key, value)"
          />
          <span>{{ addon.label }}</span>
        </label>
      </div>
      <p class="empty">Changes apply to newly opened terminal panels.</p>
    </section>

    <ul class="terminal-list">
      <li v-for="terminal in terminals" :key="terminal.id" class="terminal-row">
        <div class="terminal-main">
          <i class="pi pi-window-maximize" aria-hidden="true" />
          <div class="terminal-text">
            <strong>{{ terminal.title }}</strong>
            <span>{{ terminal.shell }} {{ terminal.args.join(" ") }}</span>
            <small>{{ terminal.cwd }}</small>
          </div>
          <span class="terminal-status" :class="`status-${terminal.status}`">{{ terminal.status }}</span>
        </div>
        <div class="terminal-actions">
          <Button
            label="Open"
            icon="pi pi-external-link"
            size="small"
            text
            @click="openTerminal(terminal.id, terminal.title)"
          />
          <Button
            v-if="terminal.status === 'running'"
            label="Kill"
            icon="pi pi-times"
            size="small"
            text
            severity="danger"
            @click="terminalStore.killTerminal(terminal.id)"
          />
        </div>
      </li>
    </ul>

    <p v-if="terminals.length === 0" class="empty">No terminals yet.</p>
  </section>
</template>

<style scoped>
.terminals-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
  min-width: 0;
  padding: 0.75rem;
  overflow-y: auto;
  color: var(--p-text-color);
  container-type: inline-size;
}

.terminals-header,
.terminal-main,
.create-actions,
.terminal-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.terminals-header {
  justify-content: space-between;
  border-bottom: 1px solid var(--p-surface-border);
  padding-bottom: 0.55rem;
}

.terminals-header h2,
.terminal-create h3 {
  margin: 0;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.terminals-header p,
.empty {
  margin: 0.15rem 0 0;
  color: var(--p-text-muted-color);
  font-size: 0.76rem;
}

.terminal-create {
  display: grid;
  gap: 0.45rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  padding: 0.6rem;
  background: color-mix(in srgb, var(--p-primary-color) 5%, transparent);
}

.field {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.field span {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.addon-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.55rem;
}

.addon-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  font-size: 0.78rem;
}

.create-actions,
.terminal-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.terminal-list {
  display: grid;
  gap: 0.45rem;
  list-style: none;
  padding: 0;
  margin: 0;
}

.terminal-row {
  display: grid;
  gap: 0.35rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  padding: 0.55rem;
  background: var(--p-content-background);
}

.terminal-main {
  min-width: 0;
}

.terminal-main > .pi {
  flex: 0 0 auto;
  color: var(--p-primary-color);
}

.terminal-text {
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  gap: 0.05rem;
}

.terminal-text strong,
.terminal-text span,
.terminal-text small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-text span,
.terminal-text small {
  color: var(--p-text-muted-color);
  font-size: 0.72rem;
}

.terminal-status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 0.1rem 0.4rem;
  font-size: 0.68rem;
  color: var(--p-text-muted-color);
  background: color-mix(in srgb, var(--p-text-muted-color) 14%, transparent);
}

.terminal-status.status-running {
  color: var(--p-green-500);
  background: color-mix(in srgb, var(--p-green-500) 15%, transparent);
}

@container (max-width: 22rem) {
  .terminal-main {
    align-items: flex-start;
  }

  .terminal-actions :deep(.p-button-label),
  .create-actions :deep(.p-button-label) {
    display: none;
  }
}
</style>
