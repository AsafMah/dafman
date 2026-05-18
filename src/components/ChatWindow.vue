<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
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
  ReasoningVisibility,
  SessionEventPayload,
} from "../ipc/types";
import { useSessionsStore } from "../stores/sessionsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import ReasoningBlock from "./ReasoningBlock.vue";

// Per-session header controls (model, effort, options gear, rename,
// compact, reset) live in `SessionHeaderControls.vue`, hosted by
// dockview's right header-actions slot via `ChatTabActions.vue`. This
// component is just transcript + composer.

const props = defineProps<{
  sessionId: string;
  accent: string;
  events: SessionEventPayload[];
  /// Per-session override for reasoning visibility (`"default"` =
  /// inherit from app settings). Sourced from `SessionRecord` so the
  /// controls (rendered in the dockview tab strip) can mutate it from
  /// outside this component.
  reasoningVisibilityOverride: ReasoningVisibility | "default";
  /// Optional override for the send action. When provided, ChatWindow
  /// calls this instead of `sessionsStore.sendMessage`. Used by the dev
  /// playground to keep the chat self-contained (echo-only, no SDK).
  sendHandler?: (text: string) => Promise<void> | void;
}>();

const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const toasts = useToastStore();
const { settings } = storeToRefs(settingsStore);

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

const reasoningVisibility = computed<ReasoningVisibility>(() =>
  props.reasoningVisibilityOverride === "default"
    ? settings.value.appearance.reasoningVisibility
    : props.reasoningVisibilityOverride,
);

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
    processedEvents = props.events.length;
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
  /* Soft accent wash on the panel background — visible enough that the
   * session "owns" its area but light enough that text contrast is
   * unaffected. Composes over `--p-content-background` so we stay
   * correct on both themes. The heavier accent rail on the left makes
   * the per-session identity prominent now that the chat header is gone
   * (model + options live on the dockview tab strip via
   * `ChatTabActions`). */
  background:
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--accent) 7%, var(--p-content-background)) 0,
      var(--p-content-background) 220px
    );
  /* Tile sits flush against the dockview tab strip: drop the top border
   * + top corner radius so we don't visually double up the strip's own
   * bottom border. The 4 px left rail remains the dominant accent
   * signal. */
  border: 1px solid var(--p-content-border-color);
  border-top: none;
  border-left: 4px solid var(--accent);
  border-radius: 0 0 var(--p-border-radius-xl) var(--p-border-radius-xl);
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
  background: var(--p-content-background);
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
  border-left: 3px solid transparent;
}

.message-card.user {
  /* Tint user messages with a faint accent too, so the session colour
   * runs end-to-end through the transcript. */
  background: color-mix(in srgb, var(--accent) 8%, var(--p-content-background));
  border-left-color: color-mix(in srgb, var(--accent) 65%, transparent);
}

.message-card.assistant {
  background: color-mix(in srgb, var(--accent) 18%, var(--p-content-background));
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
