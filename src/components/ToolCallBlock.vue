<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import type { ToolStatus } from "../lib/chatEvents";
import { getToolRenderer } from "../lib/toolRenderers";
import { fenced } from "../lib/markdown";
import MessageContent from "./MessageContent.vue";

const props = defineProps<{
  toolName: string;
  toolCallId: string;
  mcpServerName?: string;
  mcpToolName?: string;
  args?: Record<string, unknown>;
  status: ToolStatus;
  progressMessage?: string;
  partialOutput: string;
  resultContent?: string;
  errorMessage?: string;
  errorCode?: string;
  agentId?: string;
}>();

const expanded = ref(false);

const displayName = computed(() => {
  if (props.mcpServerName && props.mcpToolName) {
    return `${props.mcpServerName} · ${props.mcpToolName}`;
  }
  return props.toolName;
});

const statusSeverity = computed<"info" | "success" | "danger">(() => {
  switch (props.status) {
    case "running":
      return "info";
    case "success":
      return "success";
    case "error":
      return "danger";
  }
});

const statusLabel = computed(() => {
  switch (props.status) {
    case "running":
      return "Running";
    case "success":
      return "Done";
    case "error":
      return "Failed";
  }
});

/// Per-tool render hints (summary + languages). The renderer is
/// re-evaluated whenever args or result change so e.g. read_file can
/// pick its result language from the file extension once we see the
/// arguments.
const renderHints = computed(() =>
  getToolRenderer(props.toolName, props.mcpServerName)({
    args: props.args,
    result: props.resultContent,
    partialOutput: props.partialOutput,
    toolName: props.toolName,
    mcpServerName: props.mcpServerName,
    mcpToolName: props.mcpToolName,
  }),
);

/// Header preview. Renderer summary wins (e.g. `shell ls -la`); falls
/// back to the historical "first line of latest output" behaviour
/// when the tool has no registered renderer.
const previewLine = computed(() => {
  if (props.status === "error" && props.errorMessage) return props.errorMessage;
  if (renderHints.value.summary) return renderHints.value.summary;
  const source =
    props.resultContent ||
    props.progressMessage ||
    props.partialOutput ||
    "";
  if (!source) return "";
  const firstLine = source.split("\n", 1)[0] ?? "";
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
});

const argsPretty = computed(() => {
  if (!props.args) return "";
  try {
    return JSON.stringify(props.args, null, 2);
  } catch {
    return String(props.args);
  }
});

/// Args + result blocks render through `MessageContent` (Lexical's
/// prism-backed CodeNode) by wrapping the payload in a markdown fence.
/// `fenced` (lib/markdown) picks an outer fence longer than any inner
/// backtick run so tool output containing ``` can't close the block.

const argsBlock = computed(() =>
  fenced(argsPretty.value, renderHints.value.argsLanguage),
);
const partialBlock = computed(() =>
  fenced(props.partialOutput, renderHints.value.resultLanguage),
);
const resultBlock = computed(() =>
  fenced(props.resultContent ?? "", renderHints.value.resultLanguage),
);
</script>

<template>
  <div class="tool-card" :class="[`status-${props.status}`]">
    <button
      type="button"
      class="tool-header"
      :aria-expanded="expanded"
      :aria-label="`${expanded ? 'Collapse' : 'Expand'} tool call ${displayName}`"
      @click="expanded = !expanded"
    >
      <i class="pi pi-wrench tool-icon" aria-hidden="true" />
      <span class="tool-name">{{ displayName }}</span>
      <Tag :value="statusLabel" :severity="statusSeverity" />
      <span v-if="props.agentId" class="tool-meta" :title="`Sub-agent ${props.agentId}`">
        sub-agent
      </span>
      <span v-if="previewLine" class="tool-preview">{{ previewLine }}</span>
      <Button
        :icon="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
        text
        rounded
        size="small"
        class="tool-toggle"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        tabindex="-1"
      />
    </button>

    <div v-if="expanded" class="tool-body">
      <section v-if="argsPretty" class="tool-section">
        <header class="tool-section-label">Arguments</header>
        <MessageContent
          class="tool-block"
          :text="argsBlock"
          :label="`Arguments for ${displayName}`"
        />
      </section>

      <section v-if="props.progressMessage" class="tool-section">
        <header class="tool-section-label">Progress</header>
        <p class="tool-progress">{{ props.progressMessage }}</p>
      </section>

      <section v-if="props.partialOutput" class="tool-section">
        <header class="tool-section-label">Output</header>
        <MessageContent
          class="tool-block"
          :text="partialBlock"
          :label="`Partial output for ${displayName}`"
        />
      </section>

      <section v-if="props.resultContent" class="tool-section">
        <header class="tool-section-label">Result</header>
        <MessageContent
          class="tool-block"
          :text="resultBlock"
          :label="`Result for ${displayName}`"
        />
      </section>

      <section v-if="props.errorMessage" class="tool-section">
        <header class="tool-section-label">Error<span v-if="props.errorCode"> · {{ props.errorCode }}</span></header>
        <p class="tool-error">{{ props.errorMessage }}</p>
      </section>

      <p class="tool-id" :title="`tool call id: ${props.toolCallId}`">
        id: {{ props.toolCallId }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  border: 1px solid var(--p-content-border-color);
  border-left: 3px solid var(--p-text-muted-color);
  border-radius: var(--p-border-radius-md);
  background: var(--p-content-background);
  color: var(--p-text-color);
  font-size: 0.875rem;
}

.tool-card.status-running {
  border-left-color: var(--p-blue-500, #3b82f6);
}

.tool-card.status-success {
  border-left-color: var(--p-green-500, #22c55e);
}

.tool-card.status-error {
  border-left-color: var(--p-red-500, #ef4444);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.6rem;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tool-header:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
  border-radius: var(--p-border-radius-md);
}

.tool-icon {
  color: var(--p-text-muted-color);
}

.tool-name {
  font-family: var(--p-font-family-mono, monospace);
  font-weight: 600;
  flex: 0 0 auto;
  white-space: nowrap;
}

.tool-meta {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-sm);
}

.tool-preview {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--p-text-muted-color);
  font-family: var(--p-font-family-mono, monospace);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-toggle {
  flex: 0 0 auto;
  margin-left: auto;
}

.tool-body {
  padding: 0.25rem 0.6rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
}

.tool-section {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.tool-section-label {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.tool-block {
  margin: 0;
  padding: 0.4rem 0.5rem;
  background: color-mix(in srgb, var(--p-text-color) 6%, var(--p-content-background));
  border-radius: var(--p-border-radius-sm);
  font-size: 0.78rem;
  max-height: 24rem;
  overflow: auto;
}

/* MessageContent's content-editable is non-interactive but still
 * applies its own padding inside .lex-content; clear it so the tool
 * block's own padding controls spacing consistently. */
.tool-block :deep(.lex-content) {
  padding: 0;
}

.tool-progress,
.tool-error {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-error {
  color: var(--p-red-500, #ef4444);
}

.tool-id {
  margin: 0;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  font-family: var(--p-font-family-mono, monospace);
}
</style>
