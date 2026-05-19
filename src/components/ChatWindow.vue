<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import MessageComposer from "./MessageComposer.vue";
import MessageContent from "./MessageContent.vue";
import ModeButtonGroup from "./ModeButtonGroup.vue";
import SessionHeaderControls from "./SessionHeaderControls.vue";
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
import { useSessionsStore, type DefaultSendMode } from "../stores/sessionsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import ReasoningBlock from "./ReasoningBlock.vue";
import type { ComposerSubmitPayload } from "../lexical/plugins";

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
  /// Per-session default mode for the composer's primary send action.
  /// "steer" maps to SDK `mode: "immediate"`; "queue" to `"enqueue"`.
  defaultSendMode: "steer" | "queue";
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
const composerRef = ref<{ focus: () => void } | null>(null);

/// External "focus my composer" requests arrive as a window event
/// from the Sessions sidebar (clicking an already-open session row).
/// Filter by sessionId so the event only acts on the matching tile.
function onExternalFocusRequest(e: Event) {
  const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
  if (!detail || detail.sessionId !== props.sessionId) return;
  composerRef.value?.focus();
}

onMounted(() => {
  window.addEventListener("dafman:focus-composer", onExternalFocusRequest);
});

onBeforeUnmount(() => {
  window.removeEventListener("dafman:focus-composer", onExternalFocusRequest);
});
/// Live `--tile-height` so the composer can cap itself at a percentage of
/// the chat tile's height even though the tile lives inside a flex/grid
/// layout with no fixed height. Resize events fire hundreds of times per
/// second during a drag; coalesce to one CSS write per frame via rAF so
/// style recalcs stay bounded.
let tileResizeObserver: ResizeObserver | null = null;
let tileResizeRaf: number | null = null;

onMounted(() => {
  if (typeof ResizeObserver === "undefined" || !tileEl.value) return;
  const el = tileEl.value;
  const update = () => {
    tileResizeRaf = null;
    el.style.setProperty("--tile-height", `${el.clientHeight}px`);
  };
  const schedule = () => {
    if (tileResizeRaf !== null) return;
    tileResizeRaf = requestAnimationFrame(update);
  };
  update();
  tileResizeObserver = new ResizeObserver(schedule);
  tileResizeObserver.observe(el);
});

onBeforeUnmount(() => {
  tileResizeObserver?.disconnect();
  tileResizeObserver = null;
  if (tileResizeRaf !== null) {
    cancelAnimationFrame(tileResizeRaf);
    tileResizeRaf = null;
  }
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

let isFirstBatch = true;

watch(
  () => props.events.length,
  (len) => {
    if (processedEvents >= len) return;
    const fresh = props.events.slice(processedEvents);
    processedEvents = len;
    // The very first batch is replay (history hydrated from
    // `getMessages()` + any in-flight live events that already
    // arrived). Skip "Model changed" toasts during it — they're
    // already-happened changes, not actionable signal.
    const live = !isFirstBatch;
    isFirstBatch = false;
    const result = processEvents(items.value, ambient.value, fresh, idCounter, {
      live,
    });
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

/// Submission handler. The composer always submits a payload —
/// `mode: "default"` (Ctrl+Enter, primary button), `mode: "queue"`
/// (Alt+Enter — force queue regardless of default), or
/// `mode: "interrupt"` (Ctrl+Shift+Enter / dropdown). We resolve
/// `"default"` against the session's `defaultSendMode` here so the
/// downstream sessionsStore action only sees concrete SendMode values.
///
/// Removed the busy guard (`isSending.value`) — queuing/steering
/// while a turn is in flight is the whole point of this feature.
/// The optimistic user bubble still appears immediately; the SDK
/// reconciles it with the eventual `user.message` echo.
async function sendMessage(payload: ComposerSubmitPayload) {
  if (!payload.text) return;
  const concreteMode =
    payload.mode === "default" ? props.defaultSendMode : payload.mode;

  items.value = appendUserMessage(items.value, payload.text, idCounter);
  isSendingFallback.value = true;
  await scrollToBottom();

  try {
    if (props.sendHandler) {
      // Dev playground / tests don't care about modes; pass text only.
      await props.sendHandler(payload.text);
    } else {
      await sessionsStore.sendMessage(
        props.sessionId,
        payload.text,
        concreteMode,
      );
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

function onUpdateDefaultMode(next: DefaultSendMode) {
  sessionsStore.setDefaultSendMode(props.sessionId, next);
}
</script>

<template>
  <section ref="tileEl" class="chat-tile" :style="{ '--accent': accentColor }">
    <!-- Per-session controls (model, effort, options gear with run
         mode / reasoning view / rename / compact / reset) — moved back
         inside the chat tile because the dockview right-header-actions
         slot was cramped and ended up rendering empty in some layouts.
         The strip uses the same `SessionHeaderControls` component the
         tab strip previously hosted; layout is responsive via the
         container queries already in that component. -->
    <header class="chat-tile-header">
      <SessionHeaderControls :session-id="props.sessionId" />
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
        <!-- Skip empty assistant items entirely. The model emits
             `assistant.message_start` (creating an empty item) before
             every turn; when the turn goes straight to a tool call
             without text, the empty card used to render as "..." right
             before the tool block. The pending spinner below already
             covers the "waiting for response" state. -->
        <article
          v-else-if="!(item.kind === 'assistant' && item.text === '')"
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
            :text="item.text"
            :label="item.kind === 'assistant' ? 'Assistant message' : 'Your message'"
          />
          <p v-else class="message-body">{{ item.text }}</p>
        </article>
      </template>

      <article
        v-if="isSending && !items.some((m) => m.kind === 'assistant' && m.text !== '')"
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

    <!-- Pending-request banner. Visible whenever the SDK is blocked
         on user input (permission / user_input / elicitation). Reads
         from `ambient.pendingRequest` (set by the reducer's
         notification handlers); the actual accept/deny UI is a
         follow-up ticket — for now we just surface the state so the
         user knows what they need to action and from where. -->
    <div v-if="ambient.pendingRequest" class="pending-banner" role="status">
      <i class="pi pi-bell pending-banner-icon" aria-hidden="true" />
      <div class="pending-banner-body">
        <span class="pending-banner-kind">{{
          ambient.pendingRequest.type === "permission"
            ? "Permission requested"
            : ambient.pendingRequest.type === "userInput"
              ? "Input requested"
              : "Awaiting response"
        }}</span>
        <span class="pending-banner-message">{{ ambient.pendingRequest.message }}</span>
      </div>
    </div>

    <form class="chat-composer" @submit.prevent>
      <MessageComposer
        ref="composerRef"
        :default-mode="props.defaultSendMode"
        @submit="sendMessage"
        @update:default-mode="onUpdateDefaultMode"
      >
        <template #leading>
          <ModeButtonGroup :session-id="props.sessionId" />
        </template>
      </MessageComposer>
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

/* In-tile per-session header strip — hosts SessionHeaderControls
 * (model / effort selects, options gear). Aligns with the chat
 * messages padding so the content reads as one column. */
.chat-tile-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 2.25rem;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--p-text-color) 8%, transparent);
  /* SessionHeaderControls uses container queries to shrink its
   * children. Give it a container context here so it reacts to the
   * tile width, not the page width. */
  container-type: inline-size;
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
  /* User bubble gets a neutral rail (muted text colour) so user vs.
   * assistant are visibly distinct — the accent is reserved for the
   * assistant side. No background tint either. */
  border-left-color: var(--p-text-muted-color);
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

/* Pending-request banner: amber tint, sits between the message list
 * and the composer. Mirrors the inner-indicator dot's coloring so
 * the tab dot + banner read as the same signal. */
.pending-banner {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.85rem;
  margin: 0.5rem 0.5rem 0;
  border-radius: var(--p-border-radius-md);
  border: 1px solid color-mix(in srgb, var(--p-amber-500, #f59e0b) 40%, transparent);
  background: color-mix(in srgb, var(--p-amber-500, #f59e0b) 14%, var(--p-content-background));
  color: var(--p-text-color);
}

.pending-banner-icon {
  font-size: 1.05rem;
  color: var(--p-amber-500, #f59e0b);
}

.pending-banner-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pending-banner-kind {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--p-amber-500, #f59e0b);
}

.pending-banner-message {
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* MessageComposer brings its own border-top + padding via the global
 * `.lex-composer` styles in `src/lexical/lexical.css`; the form wrapper
 * just contributes layout placement here. The run-mode segmented control
 * (`ModeButtonGroup`) is passed in via MessageComposer's `#leading`
 * slot so it lives inside the same flex row — shared border-top, shared
 * padding, height-stretched alongside the input + send button. */
</style>
