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
// Built on shared primitives in `./details/*` so ToolDetails (the
// tool-execution counterpart) can reuse the same visual language.

import { computed } from 'vue';
import type { PermissionRequestData } from '../../ipc/types';
import { renderMarkdown } from '../../lib/markdown';
import PathChip from './details/PathChip.vue';
import CommandBlock from './details/CommandBlock.vue';
import UrlChip from './details/UrlChip.vue';
import ToolChip from './details/ToolChip.vue';

const props = defineProps<{ request: PermissionRequestData }>();

const raw = computed<Record<string, unknown>>(() => props.request.raw ?? {});

function pickStr(...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw.value[k];

    if (typeof v === 'string' && v.length > 0) return v;
  }

  return null;
}

function pickObj(...keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const v = raw.value[k];

    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }

  return null;
}

// Per-kind field probes ---------------------------------------------
const shellCommand = computed(() => pickStr('command', 'cmd'));
const shellCwd = computed(() => pickStr('cwd', 'workingDirectory'));

const filePath = computed(() => pickStr('path', 'filePath', 'fileName'));
const contentPreview = computed(() => pickStr('contentPreview', 'content', 'preview'));
const writeExtension = computed(() => {
  const p = filePath.value;

  if (!p) return '';

  const m = /\.([a-z0-9]+)$/i.exec(p);

  return m ? m[1].toLowerCase() : '';
});

const urlString = computed(() => pickStr('url'));

const mcpServerName = computed(() => pickStr('serverName', 'mcpServerName'));
const toolName = computed(() => pickStr('toolName', 'mcpToolName', 'tool'));
const toolArgs = computed(() => pickObj('arguments', 'args', 'params'));
const toolArgsJson = computed(() => {
  const args = toolArgs.value;

  if (!args) return '';

  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return '';
  }
});

const memoryContent = computed(() => pickStr('content', 'text', 'memory'));
const hookName = computed(() => pickStr('hookName', 'name', 'hook'));

/// Human-readable reason the agent provided. Present on read / write
/// / url permission requests per the SDK shape. Surfaced above the
/// per-kind chip so the user sees *why* before *what*.
const intention = computed(() => pickStr('intention'));

// Raw fallback ------------------------------------------------------
const rawJsonHtml = computed(() => {
  try {
    const j = JSON.stringify(raw.value, null, 2);

    return renderMarkdown('```json\n' + j + '\n```');
  } catch {
    return '';
  }
});

const hasFocusedView = computed(() => {
  switch (props.request.kind) {
    case 'shell':
      return shellCommand.value !== null;
    case 'write':
    case 'read':
      return filePath.value !== null;
    case 'url':
      return urlString.value !== null;
    case 'mcp':
      return mcpServerName.value !== null || toolName.value !== null;
    case 'custom-tool':
      return toolName.value !== null;
    case 'memory':
      return memoryContent.value !== null;
    case 'hook':
      return hookName.value !== null;
    default:
      return false;
  }
});
</script>

<template>
  <div class="perm-details">
    <p
      v-if="intention"
      class="perm-intention"
    >
      {{ intention }}
    </p>
    <!-- shell -->
    <template v-if="request.kind === 'shell' && hasFocusedView">
      <CommandBlock
        :code="shellCommand!"
        lang="bash"
      />
      <div
        v-if="shellCwd"
        class="perm-meta"
      >
        <span class="perm-meta-label">in</span>
        <PathChip
          :path="shellCwd"
          icon="folder"
        />
      </div>
    </template>

    <!-- write -->
    <template v-else-if="request.kind === 'write' && hasFocusedView">
      <PathChip
        :path="filePath!"
        icon="file-edit"
      />
      <details
        v-if="contentPreview"
        class="perm-preview"
      >
        <summary>Preview content</summary>
        <CommandBlock
          :code="contentPreview"
          :lang="writeExtension || 'text'"
        />
      </details>
    </template>

    <!-- read -->
    <template v-else-if="request.kind === 'read' && hasFocusedView">
      <PathChip
        :path="filePath!"
        icon="eye"
        badge="read-only"
      />
    </template>

    <!-- url -->
    <template v-else-if="request.kind === 'url' && hasFocusedView">
      <UrlChip :url="urlString!" />
    </template>

    <!-- mcp -->
    <template v-else-if="request.kind === 'mcp' && hasFocusedView">
      <ToolChip
        :server="mcpServerName ?? undefined"
        :tool="toolName ?? undefined"
      />
      <details
        v-if="toolArgsJson"
        class="perm-preview"
      >
        <summary>Arguments</summary>
        <CommandBlock
          :code="toolArgsJson"
          lang="json"
        />
      </details>
    </template>

    <!-- custom-tool -->
    <template v-else-if="request.kind === 'custom-tool' && hasFocusedView">
      <ToolChip
        :tool="toolName ?? undefined"
        icon="bolt"
      />
      <details
        v-if="toolArgsJson"
        class="perm-preview"
      >
        <summary>Arguments</summary>
        <CommandBlock
          :code="toolArgsJson"
          lang="json"
        />
      </details>
    </template>

    <!-- memory -->
    <template v-else-if="request.kind === 'memory' && hasFocusedView">
      <div class="perm-meta">
        <i
          class="pi pi-bookmark perm-meta-icon"
          aria-hidden="true"
        />
        <span class="perm-meta-label">save memory</span>
      </div>
      <CommandBlock
        :code="memoryContent!"
        lang="text"
      />
    </template>

    <!-- hook -->
    <template v-else-if="request.kind === 'hook' && hasFocusedView">
      <ToolChip
        :tool="hookName ?? undefined"
        icon="link"
      />
    </template>

    <!-- fallback: raw JSON when no focused view available -->
    <details
      v-else
      class="perm-preview"
      open
    >
      <summary>Request payload</summary>
      <div
        class="perm-preview-body"
        v-html="rawJsonHtml"
      />
    </details>

    <!-- "Show raw" toggle for completeness whenever we DID render a
         focused view. Lets the user inspect anything we didn't surface. -->
    <details
      v-if="hasFocusedView"
      class="perm-preview perm-raw-toggle"
    >
      <summary>Show raw</summary>
      <div
        class="perm-preview-body"
        v-html="rawJsonHtml"
      />
    </details>
  </div>
</template>

<style scoped>
.perm-details {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.4rem;
}

.perm-intention {
  margin: 0;
  font-size: 0.85rem;
  color: var(--p-text-color);
  line-height: 1.4;
}

.perm-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.perm-meta-icon {
  color: var(--p-text-muted-color);
}

.perm-meta-label {
  color: var(--p-text-muted-color);
}

.perm-preview {
  margin: 0;
  font-size: 0.85rem;
  align-self: stretch;
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
