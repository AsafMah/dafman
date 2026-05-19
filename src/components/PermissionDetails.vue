<script setup lang="ts">
// Bespoke per-kind permission detail blocks.
//
// The SDK's typed `PermissionRequest` is sparse (`kind` + optional
// `toolCallId`), but the runtime payload carries the actually-useful
// fields per kind: `command` for shell, `path` for write/read,
// `url` for url, `serverName`+`toolName` for mcp, etc. The bun side
// captures the full runtime shape into `request.raw` and we probe
// common field names here for a focused per-kind UI.
//
// Layouts:
//   - shell — fenced bash code block + optional cwd chip
//   - write — file path chip + optional content preview (highlighted
//     by extension if present)
//   - read  — file path chip + read-only badge
//   - url   — URL pill with domain emphasized
//   - mcp / custom-tool — server + tool name chips + JSON args
//   - memory — content block
//   - hook  — hook name chip + any extra fields
//   - fallback — single "Show raw" `<details>` with formatted JSON
//
// Field probing is defensive: if a known field is missing we fall
// back to the raw block. Unknown kinds always show raw.

import { computed } from "vue";
import type { PermissionRequestData } from "../ipc/types";
import { renderMarkdown } from "../lib/markdown";

const props = defineProps<{ request: PermissionRequestData }>();

const raw = computed<Record<string, unknown>>(() => props.request.raw ?? {});

function pickStr(...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw.value[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickObj(...keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const v = raw.value[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }
  return null;
}

// shell --------------------------------------------------------------
const shellCommand = computed(() => pickStr("command", "cmd"));
const shellCwd = computed(() => pickStr("cwd", "workingDirectory"));
const shellCommandHtml = computed(() => {
  const cmd = shellCommand.value;
  if (!cmd) return "";
  // Render through markdown-it as a bash code block so prism applies
  // syntax highlighting via the existing lex-token-* CSS.
  return renderMarkdown("```bash\n" + cmd + "\n```");
});

// write / read -------------------------------------------------------
const filePath = computed(() => pickStr("path", "filePath", "fileName"));
const contentPreview = computed(() =>
  pickStr("contentPreview", "content", "preview"),
);
const writeExtension = computed(() => {
  const p = filePath.value;
  if (!p) return "";
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? m[1]!.toLowerCase() : "";
});
const contentPreviewHtml = computed(() => {
  const text = contentPreview.value;
  if (!text) return "";
  const lang = writeExtension.value || "";
  // Cap preview to keep the card compact — the user can always
  // expand "Show raw" for the full diff.
  const capped = text.length > 2000
    ? text.slice(0, 2000) + "\n... (truncated)"
    : text;
  return renderMarkdown("```" + lang + "\n" + capped + "\n```");
});

// url ----------------------------------------------------------------
const urlString = computed(() => pickStr("url"));
const urlParts = computed(() => {
  const u = urlString.value;
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return {
      origin: `${parsed.protocol}//${parsed.host}`,
      path: parsed.pathname || "/",
      search: parsed.search,
      hash: parsed.hash,
    };
  } catch {
    return null;
  }
});

// mcp / custom-tool --------------------------------------------------
const mcpServerName = computed(() => pickStr("serverName", "mcpServerName"));
const toolName = computed(() => pickStr("toolName", "mcpToolName", "tool"));
const toolArgs = computed(() => pickObj("arguments", "args", "params"));
const toolArgsHtml = computed(() => {
  const args = toolArgs.value;
  if (!args) return "";
  let json: string;
  try {
    json = JSON.stringify(args, null, 2);
  } catch {
    return "";
  }
  return renderMarkdown("```json\n" + json + "\n```");
});

// memory -------------------------------------------------------------
const memoryContent = computed(() => pickStr("content", "text", "memory"));

// hook ---------------------------------------------------------------
const hookName = computed(() => pickStr("hookName", "name", "hook"));

// raw fallback -------------------------------------------------------
const rawJson = computed(() => {
  try {
    return JSON.stringify(raw.value, null, 2);
  } catch {
    return null;
  }
});
const rawJsonHtml = computed(() => {
  const j = rawJson.value;
  return j ? renderMarkdown("```json\n" + j + "\n```") : "";
});

// True when we successfully rendered a focused (non-fallback) view
// for this kind. Drives whether we show the bespoke block alone or
// fall through to the raw JSON.
const hasFocusedView = computed(() => {
  switch (props.request.kind) {
    case "shell":
      return shellCommand.value !== null;
    case "write":
    case "read":
      return filePath.value !== null;
    case "url":
      return urlString.value !== null;
    case "mcp":
      return mcpServerName.value !== null || toolName.value !== null;
    case "custom-tool":
      return toolName.value !== null;
    case "memory":
      return memoryContent.value !== null;
    case "hook":
      return hookName.value !== null;
  }
});
</script>

<template>
  <div class="perm-details">
    <!-- shell -->
    <template v-if="request.kind === 'shell' && hasFocusedView">
      <div class="perm-command" v-html="shellCommandHtml" />
      <div v-if="shellCwd" class="perm-meta">
        <span class="perm-meta-label">in</span>
        <code class="perm-meta-value">{{ shellCwd }}</code>
      </div>
    </template>

    <!-- write -->
    <template v-else-if="request.kind === 'write' && hasFocusedView">
      <div class="perm-meta">
        <i class="pi pi-file-edit perm-meta-icon" aria-hidden="true" />
        <code class="perm-meta-value perm-path">{{ filePath }}</code>
      </div>
      <details v-if="contentPreviewHtml" class="perm-preview">
        <summary>Preview content</summary>
        <div class="perm-preview-body" v-html="contentPreviewHtml" />
      </details>
    </template>

    <!-- read -->
    <template v-else-if="request.kind === 'read' && hasFocusedView">
      <div class="perm-meta">
        <i class="pi pi-eye perm-meta-icon" aria-hidden="true" />
        <code class="perm-meta-value perm-path">{{ filePath }}</code>
        <span class="perm-badge">read-only</span>
      </div>
    </template>

    <!-- url -->
    <template v-else-if="request.kind === 'url' && hasFocusedView">
      <div class="perm-url">
        <i class="pi pi-external-link perm-url-icon" aria-hidden="true" />
        <span v-if="urlParts" class="perm-url-parts">
          <span class="perm-url-origin">{{ urlParts.origin }}</span><span class="perm-url-path">{{ urlParts.path }}{{ urlParts.search }}{{ urlParts.hash }}</span>
        </span>
        <code v-else class="perm-url-raw">{{ urlString }}</code>
      </div>
    </template>

    <!-- mcp -->
    <template v-else-if="request.kind === 'mcp' && hasFocusedView">
      <div class="perm-meta">
        <span class="perm-badge">MCP</span>
        <span v-if="mcpServerName" class="perm-chip">{{ mcpServerName }}</span>
        <span v-if="toolName" class="perm-chip perm-chip-tool">/ {{ toolName }}</span>
      </div>
      <details v-if="toolArgsHtml" class="perm-preview">
        <summary>Arguments</summary>
        <div class="perm-preview-body" v-html="toolArgsHtml" />
      </details>
    </template>

    <!-- custom-tool -->
    <template v-else-if="request.kind === 'custom-tool' && hasFocusedView">
      <div class="perm-meta">
        <i class="pi pi-bolt perm-meta-icon" aria-hidden="true" />
        <span class="perm-chip">{{ toolName }}</span>
      </div>
      <details v-if="toolArgsHtml" class="perm-preview">
        <summary>Arguments</summary>
        <div class="perm-preview-body" v-html="toolArgsHtml" />
      </details>
    </template>

    <!-- memory -->
    <template v-else-if="request.kind === 'memory' && hasFocusedView">
      <div class="perm-meta">
        <i class="pi pi-bookmark perm-meta-icon" aria-hidden="true" />
        <span class="perm-meta-label">save memory</span>
      </div>
      <details class="perm-preview" open>
        <summary>Content</summary>
        <pre class="perm-meta-content">{{ memoryContent }}</pre>
      </details>
    </template>

    <!-- hook -->
    <template v-else-if="request.kind === 'hook' && hasFocusedView">
      <div class="perm-meta">
        <i class="pi pi-link perm-meta-icon" aria-hidden="true" />
        <span class="perm-chip">{{ hookName }}</span>
      </div>
    </template>

    <!-- fallback: raw JSON for unknown kinds OR when the focused
         view couldn't extract any fields. -->
    <details v-else class="perm-preview" open>
      <summary>Request payload</summary>
      <div class="perm-preview-body" v-html="rawJsonHtml" />
    </details>

    <!-- "Show raw" toggle for completeness, only when we DID render
         a focused view (the fallback above already shows raw). Lets
         the user inspect anything we didn't surface. -->
    <details v-if="hasFocusedView" class="perm-preview perm-raw-toggle">
      <summary>Show raw</summary>
      <div class="perm-preview-body" v-html="rawJsonHtml" />
    </details>
  </div>
</template>

<style scoped>
.perm-details {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.perm-command :deep(.lex-code) {
  margin: 0;
  font-size: 0.85rem;
}

.perm-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.perm-meta-icon {
  color: var(--p-text-muted-color);
}

.perm-meta-label {
  color: var(--p-text-muted-color);
}

.perm-meta-value {
  padding: 0.1rem 0.4rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
}

.perm-path {
  word-break: break-all;
}

.perm-meta-content {
  margin: 0.4rem 0 0;
  padding: 0.5rem 0.75rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-sm);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.8rem;
  max-height: 12rem;
  overflow: auto;
  white-space: pre-wrap;
}

.perm-badge {
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-text-muted-color) 18%, transparent);
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.perm-chip {
  padding: 0.1rem 0.5rem;
  border-radius: var(--p-border-radius-sm);
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-color);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
}

.perm-chip-tool {
  background: transparent;
  color: var(--p-text-color);
}

.perm-url {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  overflow: auto;
  font-size: 0.85rem;
}

.perm-url-icon {
  color: var(--p-text-muted-color);
  flex: 0 0 auto;
}

.perm-url-parts {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  word-break: break-all;
}

.perm-url-origin {
  font-weight: 600;
  color: var(--p-primary-color);
}

.perm-url-path {
  color: var(--p-text-muted-color);
}

.perm-url-raw {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  word-break: break-all;
}

.perm-preview {
  margin: 0;
  font-size: 0.85rem;
}

.perm-preview summary {
  cursor: pointer;
  user-select: none;
  color: var(--p-text-muted-color);
  padding: 0.1rem 0;
}

.perm-preview-body {
  margin-top: 0.3rem;
}

.perm-preview-body :deep(.lex-code) {
  margin: 0;
  font-size: 0.8rem;
  max-height: 14rem;
  overflow: auto;
}

.perm-raw-toggle summary {
  font-size: 0.75rem;
}
</style>
