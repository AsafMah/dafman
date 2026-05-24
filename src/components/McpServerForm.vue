<script setup lang="ts">
/// Phase 19a — MCP server add/edit form.
///
/// Two modes:
/// - **Structured** (default): transport switch + per-field inputs
///   (command/args/env for local; url/headers/oauth* for http).
///   This is the safest path — fewer chances to ship invalid JSON.
/// - **JSON**: a textarea with the same payload serialized. Toggle
///   round-trips: structured → JSON copies current fields out;
///   JSON → structured parses + repopulates. Invalid JSON keeps the
///   editor open with an error hint.
///
/// Emits `submit` with `{ name, config }` (config is the SDK
/// `McpServerConfig` opaque shape) and `cancel` for the close action.

import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import SelectButton from "primevue/selectbutton";
import ToggleSwitch from "primevue/toggleswitch";
import { toErrorMessage } from "../lib/errorMessage";

type McpConfig = Record<string, unknown>;
type Transport = "local" | "http";
type Mode = "structured" | "json";
type EnvEntry = { key: string; value: string };
type HeaderEntry = { key: string; value: string };

const props = defineProps<{
  initialName?: string;
  initialConfig?: McpConfig;
  nameLocked?: boolean;
}>();

const emit = defineEmits<{
  submit: [payload: { name: string; config: McpConfig }];
  cancel: [];
}>();

// ---------- shared name field ----------
const name = ref<string>(props.initialName ?? "");

// ---------- mode toggle ----------
const mode = ref<Mode>("structured");
const modeOptions = [
  { label: "Form", value: "structured" },
  { label: "JSON", value: "json" },
] as const;

// ---------- structured fields ----------
const transport = ref<Transport>("local");
const transportOptions = [
  { label: "Local (stdio)", value: "local" },
  { label: "HTTP", value: "http" },
] as const;
// Local
const command = ref("");
const argsText = ref("");
const envEntries = ref<EnvEntry[]>([]);
// Http
const url = ref("");
const headers = ref<HeaderEntry[]>([]);
const oauthClientId = ref("");
const oauthPublicClient = ref(false);
const oauthGrantType = ref<string>("");

// ---------- json mode ----------
const jsonDraft = ref<string>("");
const jsonError = ref<string | null>(null);

function configFromStructured(): McpConfig {
  if (transport.value === "local") {
    const env: Record<string, string> = {};
    for (const e of envEntries.value) {
      const k = e.key.trim();
      if (!k) continue;
      env[k] = e.value;
    }
    const out: McpConfig = {
      type: "local",
      command: command.value.trim(),
      args: argsText.value
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (Object.keys(env).length > 0) out.env = env;
    return out;
  }
  // http
  const hdr: Record<string, string> = {};
  for (const h of headers.value) {
    const k = h.key.trim();
    if (!k) continue;
    hdr[k] = h.value;
  }
  const out: McpConfig = {
    type: "http",
    url: url.value.trim(),
  };
  if (Object.keys(hdr).length > 0) out.headers = hdr;
  if (oauthClientId.value.trim()) out.oauthClientId = oauthClientId.value.trim();
  if (oauthPublicClient.value) out.oauthPublicClient = true;
  if (oauthGrantType.value.trim()) out.oauthGrantType = oauthGrantType.value.trim();
  return out;
}

function structuredFromConfig(config: McpConfig): void {
  const type = typeof config.type === "string" ? (config.type as string) : null;
  const inferredTransport: Transport =
    type === "http" || type === "sse" || typeof config.url === "string"
      ? "http"
      : "local";
  transport.value = inferredTransport;
  if (inferredTransport === "local") {
    command.value = typeof config.command === "string" ? config.command : "";
    const a = config.args;
    argsText.value = Array.isArray(a) ? (a as unknown[]).map(String).join(" ") : "";
    const env = config.env;
    envEntries.value =
      env && typeof env === "object" && !Array.isArray(env)
        ? Object.entries(env as Record<string, unknown>).map(([key, value]) => ({
            key,
            value: String(value),
          }))
        : [];
    url.value = "";
    headers.value = [];
    oauthClientId.value = "";
    oauthPublicClient.value = false;
    oauthGrantType.value = "";
  } else {
    url.value = typeof config.url === "string" ? config.url : "";
    const h = config.headers;
    headers.value =
      h && typeof h === "object" && !Array.isArray(h)
        ? Object.entries(h as Record<string, unknown>).map(([key, value]) => ({
            key,
            value: String(value),
          }))
        : [];
    oauthClientId.value =
      typeof config.oauthClientId === "string" ? config.oauthClientId : "";
    oauthPublicClient.value = config.oauthPublicClient === true;
    oauthGrantType.value =
      typeof config.oauthGrantType === "string" ? config.oauthGrantType : "";
    command.value = "";
    argsText.value = "";
    envEntries.value = [];
  }
}

// Initialise from props.
if (props.initialConfig && Object.keys(props.initialConfig).length > 0) {
  structuredFromConfig(props.initialConfig);
}
watch(
  () => props.initialConfig,
  (next) => {
    if (next && Object.keys(next).length > 0) structuredFromConfig(next);
  },
);

function onModeChange(next: Mode) {
  if (!next || next === mode.value) return;
  if (next === "json") {
    // Serialize current structured payload.
    jsonDraft.value = JSON.stringify(configFromStructured(), null, 2);
    jsonError.value = null;
  } else {
    // Parse + repopulate, but only commit if it parses.
    try {
      const parsed = JSON.parse(jsonDraft.value) as McpConfig;
      structuredFromConfig(parsed);
      jsonError.value = null;
    } catch (err) {
      jsonError.value = toErrorMessage(err);
      return; // Stay in JSON mode until valid.
    }
  }
  mode.value = next;
}

function addEnvRow() {
  envEntries.value.push({ key: "", value: "" });
}
function removeEnvRow(i: number) {
  envEntries.value.splice(i, 1);
}
function addHeaderRow() {
  headers.value.push({ key: "", value: "" });
}
function removeHeaderRow(i: number) {
  headers.value.splice(i, 1);
}

const canSubmit = computed(() => {
  if (!name.value.trim()) return false;
  if (mode.value === "json") {
    try {
      JSON.parse(jsonDraft.value);
      return true;
    } catch {
      return false;
    }
  }
  if (transport.value === "local") return command.value.trim().length > 0;
  return url.value.trim().length > 0;
});

function onSubmit() {
  let config: McpConfig;
  if (mode.value === "json") {
    try {
      config = JSON.parse(jsonDraft.value) as McpConfig;
    } catch (err) {
      jsonError.value = toErrorMessage(err);
      return;
    }
  } else {
    config = configFromStructured();
  }
  emit("submit", { name: name.value.trim(), config });
}
</script>

<template>
  <form class="mcp-form" @submit.prevent="onSubmit">
    <div class="form-row">
      <label class="form-label" for="mcp-form-name">Name</label>
      <InputText
        id="mcp-form-name"
        v-model="name"
        :disabled="nameLocked"
        size="small"
        placeholder="my-mcp-server"
        class="form-input"
      />
    </div>

    <div class="form-row">
      <span class="form-label">Editor</span>
      <SelectButton
        :model-value="mode"
        :options="[...modeOptions]"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        @update:model-value="(v: Mode) => onModeChange(v)"
      />
    </div>

    <template v-if="mode === 'structured'">
      <div class="form-row">
        <span class="form-label">Transport</span>
        <SelectButton
          v-model="transport"
          :options="[...transportOptions]"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
        />
      </div>

      <template v-if="transport === 'local'">
        <div class="form-row">
          <label class="form-label" for="mcp-form-cmd">Command</label>
          <InputText
            id="mcp-form-cmd"
            v-model="command"
            size="small"
            placeholder="/usr/local/bin/my-server"
            class="form-input"
          />
        </div>
        <div class="form-row">
          <label class="form-label" for="mcp-form-args">Args</label>
          <InputText
            id="mcp-form-args"
            v-model="argsText"
            size="small"
            placeholder="--stdio --port 0"
            class="form-input"
          />
        </div>
        <div class="form-row form-row-stack">
          <div class="kv-header">
            <span class="form-label">Env</span>
            <Button
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              text
              label="Add"
              @click="addEnvRow"
            />
          </div>
          <div v-if="envEntries.length === 0" class="empty-hint">No env vars.</div>
          <div
            v-for="(entry, i) in envEntries"
            :key="`env-${i}`"
            class="kv-row"
          >
            <InputText v-model="entry.key" placeholder="KEY" size="small" class="kv-key" />
            <InputText v-model="entry.value" placeholder="value" size="small" class="kv-value" />
            <Button
              icon="pi pi-times"
              size="small"
              severity="secondary"
              text
              :aria-label="`Remove env ${entry.key || i + 1}`"
              @click="removeEnvRow(i)"
            />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="form-row">
          <label class="form-label" for="mcp-form-url">URL</label>
          <InputText
            id="mcp-form-url"
            v-model="url"
            size="small"
            placeholder="https://example.com/mcp"
            class="form-input"
          />
        </div>
        <div class="form-row form-row-stack">
          <div class="kv-header">
            <span class="form-label">Headers</span>
            <Button
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              text
              label="Add"
              @click="addHeaderRow"
            />
          </div>
          <div v-if="headers.length === 0" class="empty-hint">No headers.</div>
          <div
            v-for="(entry, i) in headers"
            :key="`hdr-${i}`"
            class="kv-row"
          >
            <InputText v-model="entry.key" placeholder="Header-Name" size="small" class="kv-key" />
            <InputText v-model="entry.value" placeholder="value" size="small" class="kv-value" />
            <Button
              icon="pi pi-times"
              size="small"
              severity="secondary"
              text
              :aria-label="`Remove header ${entry.key || i + 1}`"
              @click="removeHeaderRow(i)"
            />
          </div>
        </div>
        <div class="form-row">
          <label class="form-label" for="mcp-form-oauth-client-id">OAuth client ID</label>
          <InputText
            id="mcp-form-oauth-client-id"
            v-model="oauthClientId"
            size="small"
            placeholder="(optional)"
            class="form-input"
          />
        </div>
        <div class="form-row">
          <label class="form-label" for="mcp-form-oauth-grant">OAuth grant type</label>
          <InputText
            id="mcp-form-oauth-grant"
            v-model="oauthGrantType"
            size="small"
            placeholder="authorization_code"
            class="form-input"
          />
        </div>
        <div class="form-row form-row-toggle">
          <span class="form-label">Public client</span>
          <ToggleSwitch v-model="oauthPublicClient" />
        </div>
      </template>
    </template>

    <template v-else>
      <div class="form-row form-row-stack">
        <label class="form-label" for="mcp-form-json">Raw JSON</label>
        <textarea
          id="mcp-form-json"
          v-model="jsonDraft"
          class="json-editor"
          rows="12"
        ></textarea>
        <div v-if="jsonError" class="empty-hint error">{{ jsonError }}</div>
      </div>
    </template>

    <div class="form-actions">
      <Button label="Cancel" size="small" severity="secondary" text @click="emit('cancel')" />
      <Button
        type="submit"
        :label="nameLocked ? 'Save' : 'Add'"
        size="small"
        :disabled="!canSubmit"
      />
    </div>
  </form>
</template>

<style scoped>
.mcp-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.form-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 0.5rem;
  align-items: center;
  min-width: 0;
}

.form-row-stack {
  grid-template-columns: 1fr;
  align-items: stretch;
  gap: 0.3rem;
}

.form-row-toggle {
  justify-items: start;
  grid-template-columns: 110px auto;
}

.form-label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
}

.form-input {
  width: 100%;
  min-width: 0;
}

.form-input :deep(input) {
  width: 100%;
  min-width: 0;
}

.kv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.kv-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.35rem;
  align-items: center;
}

.kv-key,
.kv-value {
  width: 100%;
  min-width: 0;
}

.kv-key :deep(input),
.kv-value :deep(input) {
  width: 100%;
  min-width: 0;
}

.json-editor {
  width: 100%;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.78rem;
  padding: 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  background: var(--p-content-background);
  color: var(--p-text-color);
  resize: vertical;
  box-sizing: border-box;
}

.empty-hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.empty-hint.error {
  color: var(--p-message-error-color);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.3rem;
}
</style>
