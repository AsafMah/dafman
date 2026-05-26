<script setup lang="ts">
// Bespoke per-tool execution detail blocks. The tool counterpart of
// `PermissionDetails.vue`. Renders args + (when present) result for
// every renderer the registry knows about; unknown tools fall
// through to JSON args + fenced result via CommandBlock.
//
// Routing: we switch on the resolved tool name from the renderer
// registry — same source of truth as the collapsed header summary.
// Each layout is a thin composition of `details/*` primitives.

import { computed } from 'vue';
import PathChip from '@/components/details/PathChip.vue';
import CommandBlock from '@/components/details/CommandBlock.vue';
import UrlChip from '@/components/details/UrlChip.vue';
import ToolChip from '@/components/details/ToolChip.vue';
import DiffEditor from '@/components/details/DiffEditor.vue';
import ApplyPatchView from '@/components/details/ApplyPatchView.vue';
import GrepResults from '@/components/details/GrepResults.vue';
import GlobResults from '@/components/details/GlobResults.vue';
import JsonValueView from '@/components/shared/JsonValueView.vue';
import ArgumentsPreview from '@/components/shared/ArgumentsPreview.vue';

const props = defineProps<{
  toolName: string;
  args?: Record<string, unknown>;
  mcpServerName?: string;
  mcpToolName?: string;
  /// Final result content. Absent while the tool is mid-execution
  /// (the parent ToolCallBlock still renders the args block but
  /// hides the result branch until completion).
  resultContent?: string;
  /// Streamed partial output (e.g. shell stdout). Same gating as
  /// `resultContent`: shown while present, replaced by the final
  /// result when it arrives.
  partialOutput?: string;
}>();

// Normalised kind — covers aliases so the template only has to care
// about a small set. Mirrors the alias entries in toolRenderers.ts.
const kind = computed<
  | 'shell'
  | 'read'
  | 'write'
  | 'edit'
  | 'apply_patch'
  | 'grep'
  | 'glob'
  | 'view'
  | 'fetch'
  | 'todo_write'
  | 'mcp'
  | 'generic'
>(() => {
  if (props.mcpServerName) return 'mcp';

  switch (props.toolName) {
    case 'shell':
    case 'bash':
    case 'execute':
      return 'shell';
    case 'read':
    case 'read_file':
    case 'readFile':
      return 'read';
    case 'write':
    case 'write_file':
    case 'writeFile':
    case 'create':
      return 'write';
    case 'edit':
    case 'str_replace_editor':
    case 'str_replace':
      return 'edit';
    case 'apply_patch':
    case 'applyPatch':
    case 'patch':
      return 'apply_patch';
    case 'grep':
    case 'search':
      return 'grep';
    case 'glob':
      return 'glob';
    case 'view':
      return 'view';
    case 'fetch':
    case 'web_fetch':
    case 'webFetch':
      return 'fetch';
    case 'todo_write':
    case 'todoWrite':
    case 'todos':
      return 'todo_write';
    default:
      return 'generic';
  }
});

// Args probes — defensive on `unknown` shape.
function s(...keys: string[]): string {
  const a = props.args;

  if (!a) return '';

  for (const k of keys) {
    const v = a[k];

    if (typeof v === 'string' && v.length > 0) return v;
  }

  return '';
}

const shellCommand = computed(() => s('command', 'cmd'));
const shellCwd = computed(() => s('cwd', 'workingDirectory'));

const filePath = computed(() => s('path', 'filePath', 'fileName', 'file_path'));

const editOld = computed(() => s('oldText', 'old_str', 'old'));
const editNew = computed(() => s('newText', 'new_str', 'new'));

const patchInput = computed(() => s('input', 'patch', 'diff'));

const grepPattern = computed(() => s('pattern'));
const grepPath = computed(() => s('path', 'dir', 'directory'));

const globPattern = computed(() => s('pattern', 'glob'));

const viewRange = computed<[number, number] | null>(() => {
  const r = props.args?.view_range;

  if (Array.isArray(r) && r.length === 2 && r.every((v) => typeof v === 'number')) {
    return [r[0], r[1]];
  }

  return null;
});

const fetchUrl = computed(() => s('url'));

const todoItems = computed<Array<{ id?: unknown; title?: unknown; status?: unknown }>>(() => {
  const t = props.args?.todos;

  return Array.isArray(t) ? (t as Array<{ id?: unknown; title?: unknown; status?: unknown }>) : [];
});

// View tool result: the SDK may return a unified diff instead of plain
// file content. Strip the diff header + hunk markers and show just the
// content lines (without leading +/- space).
const viewContent = computed(() => {
  const raw = liveResult.value;

  if (!raw) return '';

  // Detect unified diff format
  if (/^diff --git /m.test(raw) || /^---\s+a\//m.test(raw)) {
    const lines = raw.split('\n');
    const content: string[] = [];
    let inHunk = false;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        inHunk = true;
        continue;
      }

      if (!inHunk) continue;

      // Skip removed lines (leading -)
      if (line.startsWith('-')) continue;

      // Added or context lines: strip leading + or space
      if (line.startsWith('+')) content.push(line.slice(1));
      else content.push(line.startsWith(' ') ? line.slice(1) : line);
    }

    return content.join('\n');
  }

  return raw;
});

// Language inference for results
const fileExtension = computed(() => {
  const p = filePath.value;

  if (!p) return '';

  const m = /\.([a-z0-9]+)$/i.exec(p);

  return m ? m[1].toLowerCase() : '';
});

const argsJson = computed(() => {
  if (!props.args) return '';

  try {
    return JSON.stringify(props.args, null, 2);
  } catch {
    return '';
  }
});

// Result content — prefer partialOutput while streaming, resultContent
// when complete. Always returned as a string for CommandBlock.
const liveResult = computed(() => {
  if (props.resultContent && props.resultContent.length > 0) return props.resultContent;

  if (props.partialOutput && props.partialOutput.length > 0) return props.partialOutput;

  return '';
});
const hasResult = computed(() => liveResult.value.length > 0);

// Try parsing the result as JSON. When it shapes up as an object or
// array, we render through JsonValueView; primitives or non-JSON
// strings keep the CommandBlock path. Streaming partials are often
// truncated JSON, so failure is expected and silent.
const parsedResult = computed<unknown>(() => {
  if (!hasResult.value) return undefined;

  const trimmed = liveResult.value.trim();

  if (trimmed.length === 0) return undefined;

  const firstChar = trimmed[0];

  if (firstChar !== '{' && firstChar !== '[') return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
});
const isStructuredResult = computed(() => {
  const v = parsedResult.value;

  return v !== undefined && v !== null && (Array.isArray(v) || typeof v === 'object');
});
</script>

<template>
  <div class="tool-details">
    <!-- shell -->
    <template v-if="kind === 'shell'">
      <CommandBlock
        v-if="shellCommand"
        :code="shellCommand"
        lang="bash"
      />
      <div
        v-if="shellCwd"
        class="tool-meta"
      >
        <span class="tool-meta-label">in</span>
        <PathChip
          :path="shellCwd"
          icon="folder"
        />
      </div>
      <CommandBlock
        v-if="hasResult"
        :code="liveResult"
        lang="bash"
      />
    </template>

    <!-- read -->
    <template v-else-if="kind === 'read'">
      <PathChip
        v-if="filePath"
        :path="filePath"
        icon="eye"
        badge="read"
      />
      <CommandBlock
        v-if="hasResult"
        :code="liveResult"
        :lang="fileExtension || 'text'"
        :filename="filePath"
      />
    </template>

    <!-- write -->
    <template v-else-if="kind === 'write'">
      <PathChip
        v-if="filePath"
        :path="filePath"
        icon="file-edit"
      />
      <CommandBlock
        v-if="hasResult"
        :code="liveResult"
        :lang="fileExtension || 'text'"
        :filename="filePath"
      />
    </template>

    <!-- edit / str_replace -->
    <template v-else-if="kind === 'edit'">
      <PathChip
        v-if="filePath"
        :path="filePath"
        icon="pencil"
      />
      <DiffEditor
        v-if="editOld !== undefined || editNew !== undefined"
        :old-text="editOld ?? ''"
        :new-text="editNew ?? ''"
        :filename="filePath"
      />
      <CommandBlock
        v-if="hasResult"
        :code="liveResult"
        lang="text"
      />
    </template>

    <!-- apply_patch -->
    <template v-else-if="kind === 'apply_patch'">
      <ApplyPatchView
        v-if="patchInput"
        :patch="patchInput"
      />
      <CommandBlock
        v-if="hasResult"
        :code="liveResult"
        lang="text"
      />
    </template>

    <!-- grep -->
    <template v-else-if="kind === 'grep'">
      <div class="tool-meta">
        <span class="tool-meta-label">pattern</span>
        <code class="tool-meta-code">{{ grepPattern }}</code>
        <template v-if="grepPath">
          <span class="tool-meta-label">in</span>
          <PathChip
            :path="grepPath"
            icon="folder"
          />
        </template>
      </div>
      <GrepResults
        v-if="hasResult"
        :output="liveResult"
        :pattern="grepPattern || undefined"
      />
    </template>

    <!-- glob -->
    <template v-else-if="kind === 'glob'">
      <div class="tool-meta">
        <span class="tool-meta-label">glob</span>
        <code class="tool-meta-code">{{ globPattern }}</code>
      </div>
      <GlobResults
        v-if="hasResult"
        :output="liveResult"
      />
    </template>

    <!-- view -->
    <template v-else-if="kind === 'view'">
      <div class="tool-meta">
        <PathChip
          v-if="filePath"
          :path="filePath"
          icon="eye"
        />
        <span
          v-if="viewRange"
          class="tool-meta-range"
        >
          lines {{ viewRange[0] }}–{{ viewRange[1] }}
        </span>
      </div>
      <CommandBlock
        v-if="viewContent"
        :code="viewContent"
        :lang="fileExtension || 'text'"
        :filename="filePath"
      />
    </template>

    <!-- fetch -->
    <template v-else-if="kind === 'fetch'">
      <UrlChip
        v-if="fetchUrl"
        :url="fetchUrl"
      />
      <JsonValueView
        v-if="isStructuredResult"
        :value="parsedResult"
      />
      <CommandBlock
        v-else-if="hasResult"
        :code="liveResult"
        lang="json"
      />
    </template>

    <!-- todo_write -->
    <template v-else-if="kind === 'todo_write'">
      <ol
        v-if="todoItems.length > 0"
        class="tool-todos"
      >
        <li
          v-for="(t, i) in todoItems"
          :key="String(t.id ?? i)"
          class="tool-todo"
          :class="`tool-todo-${String(t.status ?? 'pending')}`"
        >
          <span class="tool-todo-status">{{ String(t.status ?? 'pending') }}</span>
          <span class="tool-todo-title">{{ String(t.title ?? '(no title)') }}</span>
        </li>
      </ol>
      <CommandBlock
        v-if="hasResult"
        :code="liveResult"
        lang="text"
      />
    </template>

    <!-- mcp -->
    <template v-else-if="kind === 'mcp'">
      <ToolChip
        :server="mcpServerName"
        :tool="mcpToolName ?? toolName"
      />
      <ArgumentsPreview
        v-if="argsJson"
        :code="argsJson"
        details-class="tool-preview"
      />
      <JsonValueView
        v-if="isStructuredResult"
        :value="parsedResult"
      />
      <CommandBlock
        v-else-if="hasResult"
        :code="liveResult"
        lang="markdown"
      />
    </template>

    <!-- generic fallback: JSON args + JSON-aware result -->
    <template v-else>
      <ArgumentsPreview
        v-if="argsJson"
        :code="argsJson"
        details-class="tool-preview"
        :open="true"
      />
      <JsonValueView
        v-if="isStructuredResult"
        :value="parsedResult"
      />
      <CommandBlock
        v-else-if="hasResult"
        :code="liveResult"
        lang="text"
      />
    </template>
  </div>
</template>

<style scoped>
.tool-details {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.4rem;
}

.tool-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.tool-meta-label {
  color: var(--p-text-muted-color);
}

.tool-meta-code {
  padding: 0.1rem 0.4rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
}

.tool-meta-range {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
}

.tool-preview {
  margin: 0;
  font-size: 0.85rem;
  align-self: stretch;
}

.tool-preview summary {
  cursor: pointer;
  user-select: none;
  color: var(--p-text-muted-color);
  padding: 0.1rem 0;
}

.tool-todos {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
}

.tool-todo {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.25rem 0.5rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-size: 0.85rem;
}

.tool-todo-status {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-text-muted-color) 18%, transparent);
  color: var(--p-text-muted-color);
}

.tool-todo-done .tool-todo-status {
  background: color-mix(in srgb, var(--p-green-500, #10b981) 22%, transparent);
  color: var(--p-green-500, #10b981);
}

.tool-todo-in_progress .tool-todo-status {
  background: color-mix(in srgb, var(--p-primary-color) 22%, transparent);
  color: var(--p-primary-color);
}

.tool-todo-blocked .tool-todo-status {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 22%, transparent);
  color: var(--p-red-500, #ef4444);
}

.tool-todo-title {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
