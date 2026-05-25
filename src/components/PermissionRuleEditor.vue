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

import { computed, ref } from 'vue';
import RadioButton from 'primevue/radiobutton';
import InputText from 'primevue/inputtext';
import type { PermissionApprovalRule, PermissionRequestData } from '../ipc/types';

const props = defineProps<{
  request: PermissionRequestData;
}>();

const emit = defineEmits<{
  (e: 'submit', payload: { approval?: PermissionApprovalRule; domain?: string }): void;
  (e: 'cancel'): void;
}>();

const raw = computed<Record<string, unknown>>(() => props.request.raw ?? {});

function pickStr(...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw.value[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// ---------- shell ----------
const shellCommand = computed(() => pickStr('fullCommandText', 'command', 'cmd') ?? '');

/// SDK-offered identifiers. The CLI pre-formats these to either
/// match a single exact command (`"git status"`) or a command-
/// prefix family (`"git:*"`). The matcher in the bundled CLI
/// (`aYr` in `@github/copilot/app.js`):
///   - argument === null → matches everything (we never send null)
///   - argument ends with `":*"` → matches exact prefix OR prefix + " "
///   - else → strict equality
///
/// So we MUST use the identifiers the SDK provides — fabricating
/// our own first-token (e.g. `"git"`) only matches literal `git`
/// and re-prompts on `git status`. This was the v1 bug behind the
/// MANUAL_TESTS report "command with same prefix required
/// re-approval".
const offeredIdentifiers = computed<string[]>(() => {
  const v = raw.value.commandIdentifiers;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
});

/// Pick the offered identifier the user likely wants to broaden:
/// prefer the one that ends with `:*` (so the rule covers
/// follow-up `git diff`, `git log`, …). Falls back to the first
/// offered identifier, or empty.
const broadIdentifier = computed<string>(() => {
  const offered = offeredIdentifiers.value;
  const wildcard = offered.find((id) => id.endsWith(':*'));
  return wildcard ?? offered[0] ?? '';
});

/// Human label for the broad-identifier suggestion. Strip the
/// trailing `:*` so the user sees `git` instead of `git:*`.
const broadIdentifierLabel = computed(() => broadIdentifier.value.replace(/:\*$/, ''));

type ShellChoice = 'exact' | 'broad' | 'custom';
const shellChoice = ref<ShellChoice>(broadIdentifier.value ? 'broad' : 'exact');
const shellCustom = ref(shellCommand.value);

const shellRule = computed<PermissionApprovalRule | null>(() => {
  if (props.request.kind !== 'shell' && props.request.kind !== 'hook') return null;
  let id: string;
  if (shellChoice.value === 'exact') id = shellCommand.value.trim();
  else if (shellChoice.value === 'broad') id = broadIdentifier.value;
  else {
    // Custom: the user typed a prefix string. Append `:*` if they
    // haven't already, so it actually broadens (per the CLI
    // matcher rules). Bare custom strings without `:*` would
    // only match literal equality.
    const c = shellCustom.value.trim();
    if (!c) id = '';
    else id = c.endsWith(':*') ? c : `${c}:*`;
  }
  if (!id) return null;
  return { kind: 'commands', commandIdentifiers: [id] };
});

// ---------- mcp ----------
const mcpServer = computed(() => pickStr('serverName', 'mcpServerName') ?? '');
const mcpTool = computed(() => pickStr('toolName', 'mcpToolName', 'tool') ?? '');

type McpChoice = 'this-tool' | 'all-tools';
const mcpChoice = ref<McpChoice>(mcpTool.value ? 'this-tool' : 'all-tools');

const mcpRule = computed<PermissionApprovalRule | null>(() => {
  if (props.request.kind !== 'mcp') return null;
  if (!mcpServer.value) return null;
  return mcpChoice.value === 'this-tool' && mcpTool.value
    ? { kind: 'mcp', serverName: mcpServer.value, toolName: mcpTool.value }
    : { kind: 'mcp', serverName: mcpServer.value, toolName: null };
});

// ---------- custom-tool ----------
const customToolName = computed(() => pickStr('toolName', 'tool') ?? '');
const customToolRule = computed<PermissionApprovalRule | null>(() => {
  if (props.request.kind !== 'custom-tool') return null;
  if (!customToolName.value) return null;
  return { kind: 'custom-tool', toolName: customToolName.value };
});

// ---------- url ----------
const urlString = computed(() => pickStr('url') ?? '');
const urlHost = computed(() => {
  try {
    return new URL(urlString.value).host;
  } catch {
    return '';
  }
});
const domainInput = ref(urlHost.value);

// ---------- assemble ----------
const submitPayload = computed<{ approval?: PermissionApprovalRule; domain?: string } | null>(
  () => {
    const k = props.request.kind;
    if (k === 'shell') {
      const r = shellRule.value;
      return r ? { approval: r } : null;
    }
    if (k === 'read') return { approval: { kind: 'read' } };
    if (k === 'write') return { approval: { kind: 'write' } };
    if (k === 'memory') return { approval: { kind: 'memory' } };
    if (k === 'mcp') {
      const r = mcpRule.value;
      return r ? { approval: r } : null;
    }
    if (k === 'custom-tool') {
      const r = customToolRule.value;
      return r ? { approval: r } : null;
    }
    if (k === 'url') {
      const d = domainInput.value.trim();
      return d ? { domain: d } : null;
    }
    // hook + anything we don't know -> blanket
    return {};
  },
);

const canSubmit = computed(() => submitPayload.value !== null);

function submit() {
  const p = submitPayload.value;
  if (p) emit('submit', p);
}
</script>

<template>
  <div class="rule-editor">
    <!-- shell / commands list -->
    <template v-if="props.request.kind === 'shell'">
      <p class="rule-label">Allow which shell commands?</p>
      <div class="rule-choices">
        <label class="rule-choice">
          <RadioButton
            v-model="shellChoice"
            name="shell"
            input-id="shell-exact"
            value="exact"
          />
          <span>
            <strong>This exact command</strong>
            <code class="rule-mono">{{ shellCommand || '(empty)' }}</code>
          </span>
        </label>
        <label
          v-if="broadIdentifier"
          class="rule-choice"
        >
          <RadioButton
            v-model="shellChoice"
            name="shell"
            input-id="shell-broad"
            value="broad"
          />
          <span>
            <strong>Anything starting with</strong>
            <code class="rule-mono">{{ broadIdentifierLabel }}</code>
            <small class="rule-hint"
              >e.g. {{ broadIdentifierLabel }} status, {{ broadIdentifierLabel }} diff …</small
            >
          </span>
        </label>
        <label class="rule-choice">
          <RadioButton
            v-model="shellChoice"
            name="shell"
            input-id="shell-custom"
            value="custom"
          />
          <span>
            <strong>Custom prefix</strong>
            <InputText
              v-model="shellCustom"
              size="small"
              class="rule-input"
              placeholder="e.g. bun test"
              @focus="shellChoice = 'custom'"
            />
            <small class="rule-hint">
              Matches anything starting with this prefix (we append <code>:*</code> automatically).
            </small>
          </span>
        </label>
      </div>
    </template>

    <!-- read / write / memory — blanket -->
    <template v-else-if="props.request.kind === 'read'">
      <p class="rule-label">Allow <strong>all file reads</strong> in this session?</p>
      <p class="rule-hint">No more read confirmations until you close this session.</p>
      <p class="rule-hint rule-hint-muted">
        Per-path glob rules aren't a Copilot SDK feature — read/write rules are session-wide.
        Reverse via the gear → Reset approvals.
      </p>
    </template>
    <template v-else-if="props.request.kind === 'write'">
      <p class="rule-label">Allow <strong>all file writes</strong> in this session?</p>
      <p class="rule-hint">
        Writes will be applied without further confirmation. Reverse via the session options gear
        (Reset approvals).
      </p>
      <p class="rule-hint rule-hint-muted">
        Per-path glob rules aren't a Copilot SDK feature — read/write rules are session-wide.
      </p>
    </template>
    <template v-else-if="props.request.kind === 'memory'">
      <p class="rule-label">Allow <strong>all memory operations</strong> in this session?</p>
    </template>

    <!-- mcp -->
    <template v-else-if="props.request.kind === 'mcp'">
      <p class="rule-label">Allow which MCP calls from {{ mcpServer || '(unknown)' }}?</p>
      <div class="rule-choices">
        <label
          v-if="mcpTool"
          class="rule-choice"
        >
          <RadioButton
            v-model="mcpChoice"
            name="mcp"
            input-id="mcp-tool"
            value="this-tool"
          />
          <span>
            <strong>Just this tool:</strong>
            <code class="rule-mono">{{ mcpTool }}</code>
          </span>
        </label>
        <label class="rule-choice">
          <RadioButton
            v-model="mcpChoice"
            name="mcp"
            input-id="mcp-all"
            value="all-tools"
          />
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
      <button
        type="button"
        class="rule-btn-secondary"
        @click="emit('cancel')"
      >
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
