<script setup lang="ts">
/// Per-permission-kind "Allow for session" rule editor.
///
/// Mounts inside PendingRequestCard when the user expands the
/// "Allow for session…" section. Builds a `PermissionApprovalRule`
/// (matching the SDK's `PermissionDecisionApproveForSessionApproval`
/// union) from request-derived defaults, then emits it for the
/// caller to ship via `respondToPending`.
///
/// Kinds we handle today:
///   shell        -> commands  { commandIdentifiers: [first-token | full] }
///   read         -> read      (blanket)
///   write        -> write     (blanket)
///   memory       -> memory    (blanket)
///   custom-tool  -> custom-tool { toolName }
///   mcp          -> mcp       { serverName, toolName | null }
///   mcp-sampling -> mcp-sampling { serverName }
///   url          -> no `approval` field; uses top-level `domain` string
///   hook         -> no concrete rule; sends blanket approve-for-session
///
/// The output is intentionally one of two shapes:
///   { approval } for tool/mcp/memory/read/write/commands
///   { domain }   for url
/// PendingRequestCard merges either object into the `respondToPending`
/// call's `response`.

import { computed, ref } from "vue";
import RadioButton from "primevue/radiobutton";
import InputText from "primevue/inputtext";
import type {
  PermissionApprovalRule,
  PermissionRequestData,
} from "../ipc/types";

const props = defineProps<{
  request: PermissionRequestData;
}>();

const emit = defineEmits<{
  (e: "submit", payload: { approval?: PermissionApprovalRule; domain?: string }): void;
  (e: "cancel"): void;
}>();

const raw = computed<Record<string, unknown>>(() => props.request.raw ?? {});

function pickStr(...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw.value[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

// ---------- shell ----------
const shellCommand = computed(() => pickStr("fullCommandText", "command", "cmd") ?? "");

/// Split a shell command into the leading token (e.g. "git" from
/// "git status -s"). Used to suggest a command-prefix rule that
/// covers similar future invocations.
const shellFirstToken = computed(() => {
  const c = shellCommand.value.trim();
  if (!c) return "";
  const m = /^\s*([^\s|;&]+)/.exec(c);
  return m ? m[1]! : c;
});

type ShellChoice = "exact" | "first-token" | "custom";
const shellChoice = ref<ShellChoice>(shellFirstToken.value ? "first-token" : "exact");
const shellCustom = ref(shellCommand.value);

const shellRule = computed<PermissionApprovalRule | null>(() => {
  if (props.request.kind !== "shell" && props.request.kind !== "hook") return null;
  let id: string;
  if (shellChoice.value === "exact") id = shellCommand.value.trim();
  else if (shellChoice.value === "first-token") id = shellFirstToken.value;
  else id = shellCustom.value.trim();
  if (!id) return null;
  return { kind: "commands", commandIdentifiers: [id] };
});

// ---------- mcp ----------
const mcpServer = computed(() => pickStr("serverName", "mcpServerName") ?? "");
const mcpTool = computed(() => pickStr("toolName", "mcpToolName", "tool") ?? "");

type McpChoice = "this-tool" | "all-tools";
const mcpChoice = ref<McpChoice>(mcpTool.value ? "this-tool" : "all-tools");

const mcpRule = computed<PermissionApprovalRule | null>(() => {
  if (props.request.kind !== "mcp") return null;
  if (!mcpServer.value) return null;
  return mcpChoice.value === "this-tool" && mcpTool.value
    ? { kind: "mcp", serverName: mcpServer.value, toolName: mcpTool.value }
    : { kind: "mcp", serverName: mcpServer.value, toolName: null };
});

// ---------- custom-tool ----------
const customToolName = computed(() => pickStr("toolName", "tool") ?? "");
const customToolRule = computed<PermissionApprovalRule | null>(() => {
  if (props.request.kind !== "custom-tool") return null;
  if (!customToolName.value) return null;
  return { kind: "custom-tool", toolName: customToolName.value };
});

// ---------- url ----------
const urlString = computed(() => pickStr("url") ?? "");
const urlHost = computed(() => {
  try {
    return new URL(urlString.value).host;
  } catch {
    return "";
  }
});
const domainInput = ref(urlHost.value);

// ---------- assemble ----------
const submitPayload = computed<{ approval?: PermissionApprovalRule; domain?: string } | null>(() => {
  const k = props.request.kind;
  if (k === "shell") {
    const r = shellRule.value;
    return r ? { approval: r } : null;
  }
  if (k === "read") return { approval: { kind: "read" } };
  if (k === "write") return { approval: { kind: "write" } };
  if (k === "memory") return { approval: { kind: "memory" } };
  if (k === "mcp") {
    const r = mcpRule.value;
    return r ? { approval: r } : null;
  }
  if (k === "custom-tool") {
    const r = customToolRule.value;
    return r ? { approval: r } : null;
  }
  if (k === "url") {
    const d = domainInput.value.trim();
    return d ? { domain: d } : null;
  }
  // hook + anything we don't know -> blanket
  return {};
});

const canSubmit = computed(() => submitPayload.value !== null);

function submit() {
  const p = submitPayload.value;
  if (p) emit("submit", p);
}
</script>

<template>
  <div class="rule-editor">
    <!-- shell / commands list -->
    <template v-if="props.request.kind === 'shell'">
      <p class="rule-label">Allow which shell commands?</p>
      <div class="rule-choices">
        <label class="rule-choice">
          <RadioButton v-model="shellChoice" name="shell" input-id="shell-exact" value="exact" />
          <span>
            <strong>This exact command</strong>
            <code class="rule-mono">{{ shellCommand || '(empty)' }}</code>
          </span>
        </label>
        <label v-if="shellFirstToken" class="rule-choice">
          <RadioButton v-model="shellChoice" name="shell" input-id="shell-prefix" value="first-token" />
          <span>
            <strong>Anything starting with</strong>
            <code class="rule-mono">{{ shellFirstToken }}</code>
            <small class="rule-hint">e.g. {{ shellFirstToken }} status, {{ shellFirstToken }} diff …</small>
          </span>
        </label>
        <label class="rule-choice">
          <RadioButton v-model="shellChoice" name="shell" input-id="shell-custom" value="custom" />
          <span>
            <strong>Custom prefix</strong>
            <InputText
              v-model="shellCustom"
              size="small"
              class="rule-input"
              placeholder="e.g. bun test"
              @focus="shellChoice = 'custom'"
            />
          </span>
        </label>
      </div>
    </template>

    <!-- read / write / memory — blanket -->
    <template v-else-if="props.request.kind === 'read'">
      <p class="rule-label">
        Allow <strong>all file reads</strong> in this session?
      </p>
      <p class="rule-hint">No more read confirmations until you close this session.</p>
      <p class="rule-hint rule-hint-muted">
        Per-path glob rules aren't a Copilot SDK feature — read/write
        rules are session-wide. Reverse via the gear → Reset approvals.
      </p>
    </template>
    <template v-else-if="props.request.kind === 'write'">
      <p class="rule-label">
        Allow <strong>all file writes</strong> in this session?
      </p>
      <p class="rule-hint">
        Writes will be applied without further confirmation. Reverse via
        the session options gear (Reset approvals).
      </p>
      <p class="rule-hint rule-hint-muted">
        Per-path glob rules aren't a Copilot SDK feature — read/write
        rules are session-wide.
      </p>
    </template>
    <template v-else-if="props.request.kind === 'memory'">
      <p class="rule-label">
        Allow <strong>all memory operations</strong> in this session?
      </p>
    </template>

    <!-- mcp -->
    <template v-else-if="props.request.kind === 'mcp'">
      <p class="rule-label">Allow which MCP calls from {{ mcpServer || '(unknown)' }}?</p>
      <div class="rule-choices">
        <label v-if="mcpTool" class="rule-choice">
          <RadioButton v-model="mcpChoice" name="mcp" input-id="mcp-tool" value="this-tool" />
          <span>
            <strong>Just this tool:</strong>
            <code class="rule-mono">{{ mcpTool }}</code>
          </span>
        </label>
        <label class="rule-choice">
          <RadioButton v-model="mcpChoice" name="mcp" input-id="mcp-all" value="all-tools" />
          <span>
            <strong>All tools from {{ mcpServer || 'this server' }}</strong>
          </span>
        </label>
      </div>
    </template>

    <!-- custom-tool -->
    <template v-else-if="props.request.kind === 'custom-tool'">
      <p class="rule-label">
        Allow <strong>{{ customToolName || 'this tool' }}</strong> for the rest of this session?
      </p>
    </template>

    <!-- url -->
    <template v-else-if="props.request.kind === 'url'">
      <p class="rule-label">Allow URLs from which domain?</p>
      <div class="rule-domain-row">
        <InputText
          v-model="domainInput"
          size="small"
          class="rule-domain-input"
          placeholder="example.com"
        />
        <small class="rule-hint">Subdomains of this host will also be allowed.</small>
      </div>
    </template>

    <!-- hook / fallback -->
    <template v-else>
      <p class="rule-label">Allow further requests of this kind in this session?</p>
    </template>

    <div class="rule-actions">
      <button type="button" class="rule-btn-secondary" @click="emit('cancel')">
        Cancel
      </button>
      <button
        type="button"
        class="rule-btn-primary"
        :disabled="!canSubmit"
        @click="submit"
      >
        Allow for session
      </button>
    </div>
  </div>
</template>

<style scoped>
.rule-editor {
  margin-top: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: color-mix(in srgb, var(--p-text-color) 5%, var(--p-content-background));
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-md);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.rule-label {
  margin: 0;
  color: var(--p-text-color);
}

.rule-hint {
  display: block;
  margin: 0.15rem 0 0;
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
}

.rule-choices {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.rule-choice {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}

.rule-choice span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.rule-mono {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  padding: 0.05rem 0.35rem;
  border-radius: var(--p-border-radius-sm, 3px);
  font-size: 0.78rem;
  word-break: break-all;
}

.rule-input,
.rule-domain-input {
  margin-top: 0.2rem;
  width: 100%;
}

.rule-domain-row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.rule-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  padding-top: 0.25rem;
  border-top: 1px solid color-mix(in srgb, var(--p-content-border-color) 70%, transparent);
}

.rule-btn-secondary,
.rule-btn-primary {
  padding: 0.25rem 0.75rem;
  font-size: 0.8rem;
  border-radius: var(--p-border-radius-sm, 4px);
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
}

.rule-btn-secondary {
  background: transparent;
  color: var(--p-text-muted-color);
  border-color: var(--p-content-border-color);
}

.rule-btn-secondary:hover {
  color: var(--p-text-color);
  background: color-mix(in srgb, var(--p-text-color) 5%, transparent);
}

.rule-btn-primary {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, white);
}

.rule-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rule-btn-primary:not(:disabled):hover {
  background: color-mix(in srgb, var(--p-primary-color) 85%, black);
}
</style>
