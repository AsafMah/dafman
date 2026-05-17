<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Popover from "primevue/popover";
import Select from "primevue/select";
import Tag from "primevue/tag";
import MessageComposer from "./MessageComposer.vue";
import MessageContent from "./MessageContent.vue";
import ToolCallBlock from "./ToolCallBlock.vue";
import {
  appendSystemMessage,
  appendUserMessage,
  defaultAmbient,
  processEvents,
  type ChatAmbient,
  type ChatItem,
  type IdCounter,
} from "../lib/chatEvents";
import type {
  ModelSummary,
  ReasoningVisibility,
  SessionEventPayload,
  SessionMode,
} from "../ipc/types";
import { useModelsStore } from "../stores/modelsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import ReasoningBlock from "./ReasoningBlock.vue";

// NOTE: `ToggleSwitch` import + `approveAllChoice` computed are intentionally
// kept absent until a real permission UX lands. The SDK's
// `permissions.setApproveAll` toggle is wired through the store
// (`setSessionApproveAll`) but our local `onPermissionRequest: approveAll`
// handler in `src-bun/app/sessions.ts` short-circuits every request, so
// surfacing a UI switch today would be misleading. Prop + store state are
// retained so the toggle row can be re-added in the popover when the
// per-session handler stops hard-approving.

const props = defineProps<{
  sessionId: string;
  accent: string;
  events: SessionEventPayload[];
  model: string | null;
  reasoningEffort: string | null;
  mode: SessionMode | null;
  approveAll: boolean;
  /// Optional override for the send action. When provided, ChatWindow
  /// calls this instead of `sessionsStore.sendMessage`. Used by the dev
  /// playground to keep the chat self-contained (echo-only, no SDK).
  sendHandler?: (text: string) => Promise<void> | void;
  /// Hide the in-header close (X) button. Set when a parent container
  /// (e.g. the dockview tab bar) owns panel removal.
  hideClose?: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const modelsStore = useModelsStore();
const toasts = useToastStore();
const { settings } = storeToRefs(settingsStore);
const { models } = storeToRefs(modelsStore);

onMounted(() => {
  modelsStore.load().catch(() => {
    /* toast already shown */
  });
});

const items = ref<ChatItem[]>([]);
const ambient = ref<ChatAmbient>(defaultAmbient());
const messagesEl = ref<HTMLElement | null>(null);
const tileEl = ref<HTMLElement | null>(null);
/// Live `--tile-height` so the composer can cap itself at a percentage of
/// the chat tile's height even though the tile lives inside a flex/grid
/// layout with no fixed height.
let tileResizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (typeof ResizeObserver === "undefined" || !tileEl.value) return;
  const el = tileEl.value;
  const update = () => {
    el.style.setProperty("--tile-height", `${el.clientHeight}px`);
  };
  update();
  tileResizeObserver = new ResizeObserver(update);
  tileResizeObserver.observe(el);
});

onBeforeUnmount(() => {
  tileResizeObserver?.disconnect();
  tileResizeObserver = null;
});
/// Fallback "thinking" flag used until we observe a turn boundary; after
/// the first `assistant.turn_start` we trust `ambient.turnActive` exclusively.
const isSendingFallback = ref(false);
const idCounter: IdCounter = { next: 1 };
let processedEvents = 0;

const isSending = computed(() =>
  ambient.value.sawTurnBoundary ? ambient.value.turnActive : isSendingFallback.value,
);

const sessionOverride = ref<ReasoningVisibility | "default">("default");

const reasoningVisibility = computed<ReasoningVisibility>(() =>
  sessionOverride.value === "default"
    ? settings.value.appearance.reasoningVisibility
    : sessionOverride.value,
);

const reasoningOptions: { label: string; value: ReasoningVisibility | "default" }[] = [
  { label: "Default", value: "default" },
  { label: "Hidden", value: "hidden" },
  { label: "Compact", value: "compact" },
  { label: "Expanded", value: "expanded" },
];

const selectedModel = computed<ModelSummary | undefined>(() =>
  props.model ? models.value.find((m) => m.id === props.model) : undefined,
);

const modelOptions = computed(() =>
  models.value.map((m) => ({ label: m.name, value: m.id })),
);

const effortOptions = computed(() =>
  (selectedModel.value?.supportedReasoningEfforts ?? []).map((effort) => ({
    label: effort,
    value: effort,
  })),
);

const modelChoice = computed<string | null>({
  get: () => props.model,
  set: (value) => {
    if (!value) return;
    const fresh = models.value.find((m) => m.id === value);
    const effort = fresh?.supportsReasoningEffort
      ? props.reasoningEffort ?? fresh.defaultReasoningEffort ?? null
      : null;
    void sessionsStore.setSessionModel(props.sessionId, value, effort);
  },
});

const effortChoice = computed<string | null>({
  get: () => props.reasoningEffort,
  set: (value) => {
    if (!props.model || !value) return;
    void sessionsStore.setSessionModel(props.sessionId, props.model, value);
  },
});

const modeOptions: { label: string; value: SessionMode }[] = [
  { label: "Interactive", value: "interactive" },
  { label: "Plan", value: "plan" },
  { label: "Autopilot", value: "autopilot" },
];

const modeChoice = computed<SessionMode | null>({
  get: () => props.mode,
  set: (value) => {
    if (!value || value === props.mode) return;
    void sessionsStore.setSessionMode(props.sessionId, value);
  },
});

const nameDraft = ref<string>("");
const optionsMenu = ref<InstanceType<typeof Popover> | null>(null);

function toggleOptions(event: Event) {
  optionsMenu.value?.toggle(event);
}

function onRenameSubmit() {
  const trimmed = nameDraft.value.trim();
  if (!trimmed) return;
  // Reflect the trimmed value in the input so the user sees the same
  // string we sent, and so the `ambient.title` watcher can resync on
  // the next backend echo (it skips while `nameDraft` is non-empty,
  // but the trimmed echo will match what's shown).
  nameDraft.value = trimmed;
  void sessionsStore.setSessionName(props.sessionId, trimmed);
}

function onCompactNow() {
  void sessionsStore.compactSessionHistory(props.sessionId);
}

function onResetApprovals() {
  void sessionsStore.resetSessionApprovals(props.sessionId);
}

const accentColor = computed(() => props.accent);

async function scrollToBottom() {
  await nextTick();
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  () => props.events.length,
  (len) => {
    if (processedEvents >= len) return;
    const fresh = props.events.slice(processedEvents);
    processedEvents = len;
    const result = processEvents(items.value, ambient.value, fresh, idCounter);
    items.value = result.items;
    ambient.value = result.ambient;
    if (result.idle || result.error) isSendingFallback.value = false;
    for (const t of result.toasts) {
      switch (t.severity) {
        case "success":
          toasts.success(t.summary, t.detail);
          break;
        case "warn":
          toasts.warn(t.summary, t.detail);
          break;
        case "error":
          toasts.error(t.summary, t.detail);
          break;
        default:
          toasts.info(t.summary, t.detail);
      }
    }
    if (result.error) {
      const lastSystem = [...result.items]
        .reverse()
        .find((i) => i.kind === "system" && i.severity === "error");
      if (lastSystem && lastSystem.kind === "system") {
        toasts.error("Session error", lastSystem.text);
      }
    }
    scrollToBottom();
  },
  { immediate: true },
);

watch(
  () => props.sessionId,
  () => {
    items.value = [];
    ambient.value = defaultAmbient();
    isSendingFallback.value = false;
    sessionOverride.value = "default";
    nameDraft.value = "";
    processedEvents = props.events.length;
  },
);

// Keep the rename draft in sync with the session title coming from events.
watch(
  () => ambient.value.title,
  (title) => {
    if (title && !nameDraft.value) nameDraft.value = title;
  },
);

async function sendMessage(text: string) {
  if (!text || isSending.value) return;

  items.value = appendUserMessage(items.value, text, idCounter);
  isSendingFallback.value = true;
  await scrollToBottom();

  try {
    if (props.sendHandler) {
      await props.sendHandler(text);
    } else {
      await sessionsStore.sendMessage(props.sessionId, text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    items.value = appendSystemMessage(
      items.value,
      `Error: ${message}`,
      idCounter,
    );
    toasts.error("Failed to send message", message);
    isSendingFallback.value = false;
    await scrollToBottom();
  }
}
</script>

<template>
  <section ref="tileEl" class="chat-tile" :style="{ '--accent': accentColor }">
    <header class="chat-header">
      <div class="chat-title">
        <Tag :value="ambient.title || props.sessionId" severity="secondary" />
        <span v-if="ambient.model" class="model-badge" :title="ambient.model">
          {{ ambient.model }}
        </span>
      </div>
      <div class="chat-header-actions">
        <label class="control" :for="`model-${props.sessionId}`">
          <span class="control-label">Model</span>
          <Select
            :input-id="`model-${props.sessionId}`"
            v-model="modelChoice"
            :options="modelOptions"
            option-label="label"
            option-value="value"
            size="small"
            placeholder="Default"
            :disabled="models.length === 0"
            aria-label="Model for this session"
          />
        </label>
        <label
          v-if="selectedModel?.supportsReasoningEffort"
          class="control"
          :for="`effort-${props.sessionId}`"
        >
          <span class="control-label">Effort</span>
          <Select
            :input-id="`effort-${props.sessionId}`"
            v-model="effortChoice"
            :options="effortOptions"
            option-label="label"
            option-value="value"
            size="small"
            placeholder="Default"
            aria-label="Reasoning effort for this session"
          />
        </label>
        <Button
          icon="pi pi-cog"
          text
          rounded
          aria-label="Session options"
          aria-haspopup="true"
          @click="toggleOptions"
        />
        <Popover ref="optionsMenu">
          <div class="session-options">
            <label class="option-row" :for="`mode-${props.sessionId}`">
              <span class="option-label">Run mode</span>
              <Select
                :input-id="`mode-${props.sessionId}`"
                v-model="modeChoice"
                :options="modeOptions"
                option-label="label"
                option-value="value"
                size="small"
                placeholder="Loading..."
                :disabled="!props.mode"
                aria-label="Agent run mode"
              />
            </label>
            <label class="option-row" :for="`reasoning-${props.sessionId}`">
              <span class="option-label">Reasoning view</span>
              <Select
                :input-id="`reasoning-${props.sessionId}`"
                v-model="sessionOverride"
                :options="reasoningOptions"
                option-label="label"
                option-value="value"
                size="small"
                aria-label="Reasoning visibility for this session"
              />
            </label>
            <div class="option-row option-row-stack">
              <label
                class="option-label"
                :for="`name-${props.sessionId}`"
              >
                Session name
              </label>
              <form class="rename-form" @submit.prevent="onRenameSubmit">
                <InputText
                  :id="`name-${props.sessionId}`"
                  v-model="nameDraft"
                  size="small"
                  placeholder="Untitled"
                />
                <Button
                  type="submit"
                  label="Save"
                  size="small"
                  :disabled="!nameDraft.trim()"
                />
              </form>
            </div>
            <div class="option-actions">
              <Button
                icon="pi pi-compress"
                label="Compact history"
                size="small"
                severity="secondary"
                @click="onCompactNow"
              />
              <Button
                icon="pi pi-refresh"
                label="Reset approvals"
                size="small"
                severity="secondary"
                @click="onResetApprovals"
              />
            </div>
          </div>
        </Popover>
        <Button
          v-if="!props.hideClose"
          icon="pi pi-times"
          text
          rounded
          aria-label="Close session"
          @click="emit('close')"
        />
      </div>
    </header>

    <div ref="messagesEl" class="chat-messages">
      <p v-if="items.length === 0" class="empty-message">
        Start typing below to send a message.
      </p>

      <template v-for="item in items" :key="item.id">
        <ReasoningBlock
          v-if="item.kind === 'reasoning'"
          :text="item.text"
          :visibility="reasoningVisibility"
        />
        <ToolCallBlock
          v-else-if="item.kind === 'tool'"
          :tool-name="item.toolName"
          :tool-call-id="item.toolCallId"
          :mcp-server-name="item.mcpServerName"
          :mcp-tool-name="item.mcpToolName"
          :args="item.args"
          :status="item.status"
          :progress-message="item.progressMessage"
          :partial-output="item.partialOutput"
          :result-content="item.resultContent"
          :error-message="item.errorMessage"
          :error-code="item.errorCode"
          :agent-id="item.agentId"
        />
        <article
          v-else
          class="message-card"
          :class="[
            item.kind,
            item.kind === 'system' ? `severity-${item.severity}` : '',
          ]"
        >
          <header class="role-label">
            {{
              item.kind === "user"
                ? "You"
                : item.kind === "assistant"
                  ? "Assistant"
                  : item.kind === "system" && item.severity === "warn"
                    ? "Warning"
                    : item.kind === "system" && item.severity === "error"
                      ? "Error"
                      : "Info"
            }}
          </header>
          <MessageContent
            v-if="item.kind === 'assistant' || item.kind === 'user'"
            :text="item.text || '...'"
            :label="item.kind === 'assistant' ? 'Assistant message' : 'Your message'"
          />
          <p v-else class="message-body">{{ item.text || "..." }}</p>
        </article>
      </template>

      <article
        v-if="isSending && !items.some((m) => m.kind === 'assistant' && m.text === '')"
        class="message-card assistant pending"
      >
        <header class="role-label">Assistant</header>
        <p class="message-body">
          <i class="pi pi-spin pi-spinner" />
          {{ ambient.intent || "Thinking..." }}
        </p>
      </article>
    </div>

    <footer v-if="ambient.usage" class="chat-usage">
      <span class="usage-pill" :title="`${ambient.usage.currentTokens} / ${ambient.usage.tokenLimit} tokens`">
        {{ ambient.usage.currentTokens.toLocaleString() }} /
        {{ ambient.usage.tokenLimit.toLocaleString() }} tokens
      </span>
    </footer>

    <form class="chat-composer" @submit.prevent>
      <MessageComposer :disabled="isSending" @submit="sendMessage" />
    </form>
  </section>
</template>

<style scoped>
.chat-tile {
  width: 100%;
  /* `height: 100%` so the tile fills its container in any layout: it
   * still works as a grid item (`.session-grid` stretches grid items by
   * default) and now also works when mounted inside a plain block
   * container like the dev playground's `.chat-frame`. */
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-top: 3px solid var(--accent);
  border-radius: var(--p-border-radius-xl);
}

.chat-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.chat-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1 1 14rem;
}

.chat-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}

.control {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.control :deep(.p-select) {
  max-width: 14rem;
}

.control-label {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.session-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 18rem;
}

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.option-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}

.option-label {
  font-size: 0.8rem;
  color: var(--p-text-color);
}

.option-row :deep(.p-select) {
  min-width: 9rem;
}

.rename-form {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.rename-form :deep(.p-inputtext) {
  flex: 1 1 auto;
  min-width: 0;
}

.option-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  padding-top: 0.25rem;
  border-top: 1px solid var(--p-content-border-color);
}

.session-id {
  /* unused since we hid the raw id; kept commented for quick reinstatement */
  display: none;
}

.chat-messages {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
}

.empty-message {
  margin: 0;
  color: var(--p-text-muted-color);
}

.message-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--p-border-radius-md);
  /* Default to content background so text-color contrast is always right;
     :global(.app-dark) selectors don't compose reliably with Vue's scoped
     style hashing, so we lean on the auto-switching content tokens
     instead. Per-role variants below add a subtle accent tint. */
  background: var(--p-content-background);
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
  border-left: 3px solid transparent;
}

.message-card.user {
  border-left-color: var(--p-surface-400, var(--p-text-muted-color));
}

.message-card.assistant {
  background: color-mix(in srgb, var(--accent) 14%, var(--p-content-background));
  border-left-color: var(--accent);
}

.message-card.system {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 12%, var(--p-content-background));
  border-left-color: var(--p-red-500, #ef4444);
}

.message-card.system.severity-info {
  background: color-mix(in srgb, var(--p-blue-500, #3b82f6) 10%, var(--p-content-background));
  border-left-color: var(--p-blue-500, #3b82f6);
}

.message-card.system.severity-warn {
  background: color-mix(in srgb, var(--p-amber-500, #f59e0b) 12%, var(--p-content-background));
  border-left-color: var(--p-amber-500, #f59e0b);
}

.message-card.system.severity-error {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 12%, var(--p-content-background));
  border-left-color: var(--p-red-500, #ef4444);
}

.model-badge {
  font-family: var(--p-font-family-mono, monospace);
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-sm);
  max-width: 18ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-usage {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  padding: 0.25rem 0.75rem 0;
}

.usage-pill {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
}

.role-label {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.message-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--p-text-color);
}

.chat-composer {
  flex: 0 0 auto;
}

/* MessageComposer brings its own border-top + padding via the global
 * `.lex-composer` styles in `src/lexical/lexical.css`; the form wrapper
 * just contributes layout placement here. */
</style>
