<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, toRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import MessageComposer from '@/components/chat/MessageComposer.vue';
import MessageContent from '@/components/chat/MessageContent.vue';
import UserMessageBody from '@/components/chat/UserMessageBody.vue';
import MessageActions from '@/components/chat/MessageActions.vue';
import MessageEditor from '@/components/chat/MessageEditor.vue';
import SessionHeaderControls from '@/components/session/SessionHeaderControls.vue';
import ToolCallBlock from '@/components/chat/ToolCallBlock.vue';
import SubagentBlock from '@/components/chat/SubagentBlock.vue';
import PendingRequestCard from '@/components/permissions/PendingRequestCard.vue';
import CommandResultCard from '@/components/chat/CommandResultCard.vue';
import type { ChatItem } from '@/lib/chatEvents';
import type {
  CommandResultRecord,
  ReasoningVisibility,
  SendMessageAttachment,
  SessionEventPayload,
} from '@/ipc/types';
import { useSessionsStore, type DefaultSendMode } from '@/stores/chat/sessionsStore';
import { useSessionsListStore } from '@/stores/chat/sessionsListStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useToastStore } from '@/stores/app/toastStore';
import { useCommandTerminal } from '@/composables/useCommandTerminal';
import { useChatScroll } from '@/composables/useChatScroll';
import { useChatSubmit } from '@/composables/useChatSubmit';
import { useChatTimelineState } from '@/composables/useChatTimelineState';
import { useMessageActions } from '@/composables/useMessageActions';
import ReasoningBlock from '@/components/chat/ReasoningBlock.vue';
import { styleFor } from '@/lib/notificationStyles';
import { on as busOn } from '@/lib/bus';

// Per-session header controls (model, effort, options gear, rename,
// compact, reset) live in `SessionHeaderControls.vue`, hosted by
// dockview's right header-actions slot via `ChatTabActions.vue`. This
// component is just transcript + composer.

const props = defineProps<{
  sessionId: string;
  accent: string;
  events: SessionEventPayload[];
  /// Monotonic count of events trimmed from the FRONT of `events`
  /// since the session record was created. Required so we can compute
  /// absolute progress (`droppedEventCount + events.length`) and
  /// survive ring-buffer trims without re-processing or missing
  /// events. Defaults to 0 (caller untouched by trims).
  droppedEventCount?: number;
  /// Per-session override for reasoning visibility (`"default"` =
  /// inherit from app settings). Sourced from `SessionRecord` so the
  /// controls (rendered in the dockview tab strip) can mutate it from
  /// outside this component.
  reasoningVisibilityOverride: ReasoningVisibility | 'default';
  /// Per-session default mode for the composer's primary send action.
  /// "steer" maps to SDK `mode: "immediate"`; "queue" to `"enqueue"`.
  defaultSendMode: 'steer' | 'queue';
  commandsRun?: number;
  /// Optional override for the send action. When provided, ChatWindow
  /// calls this instead of `sessionsStore.sendMessage`. Used by the dev
  /// playground to keep the chat self-contained (echo-only, no SDK).
  sendHandler?: (text: string) => Promise<void> | void;
}>();

const sessionsStore = useSessionsStore();
const sessionsListStore = useSessionsListStore();
const layoutStore = useLayoutStore();
const settingsStore = useSettingsStore();
const toasts = useToastStore();
const { settings } = storeToRefs(settingsStore);

const messagesEl = ref<HTMLElement | null>(null);
const tileEl = ref<HTMLElement | null>(null);
const composerRef = ref<{
  focus: () => void;
  appendText?: (text: string) => void;
  addAttachment?: (attachment: SendMessageAttachment) => void;
  exitCommandMode?: () => void;
  enterCommandMode?: () => void;
} | null>(null);

const sessionIdRef = computed(() => props.sessionId);

const { scrollToBottom } = useChatScroll(messagesEl, tileEl);

const {
  items,
  ambient,
  idCounter,
  isSending,
  appendOptimisticUser,
  appendSystemError,
  resetForReplay,
} = useChatTimelineState({
  events: toRef(props, 'events'),
  droppedEventCount: toRef(props, 'droppedEventCount'),
  sessionId: sessionIdRef,
  toasts,
  scrollToBottom,
});

const {
  commandTerminalId,
  commandResults,
  commandResultOrder,
  onRequestCommandTerminal,
  openFullSessionTerminal,
  addCommandResultAttachment,
  cancelCommandResult,
  initCommandResults,
} = useCommandTerminal(sessionIdRef, idCounter, { composerRef });

/// External "focus my composer" requests arrive from the Sessions
/// sidebar (clicking an already-open session row). Filter by sessionId
/// so the event only acts on the matching tile.
const busSubscriptions: Array<() => void> = [];

onMounted(() => {
  busSubscriptions.push(
    busOn('focus-composer', ({ sessionId }) => {
      if (sessionId !== props.sessionId) return;

      void scrollToBottom().then(() => composerRef.value?.focus());
    }),
    busOn('open-command-terminal', ({ sessionId }) => {
      if (sessionId !== props.sessionId) return;

      composerRef.value?.enterCommandMode?.();
    }),
    busOn('close-command-terminal', ({ sessionId }) => {
      if (sessionId !== props.sessionId) return;

      composerRef.value?.exitCommandMode?.();
    }),
    busOn('scroll-to-bottom', ({ sessionId }) => {
      if (sessionId !== props.sessionId) return;

      void scrollToBottom();
    }),
  );
  initCommandResults();
  // A reveal intent may already be parked for us (Jobs panel "Go to
  // session" on a freshly-opened panel — the request landed before we
  // mounted). Consume it now that the DOM exists.
  void consumePendingReveal();
});

onBeforeUnmount(() => {
  for (const off of busSubscriptions.splice(0)) off();
});

function rafTick(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/// Reveal a parked navigation intent (issue #16). With a `toolCallId`,
/// scroll the spawning tool-call card into view and flash it; without
/// one (autopilot jobs), fall back to the bottom. The transcript node
/// may not be rendered the instant we're asked (a freshly-opened panel
/// is still painting its v-for), so we retry across a bounded number of
/// frames before giving up and scrolling to the bottom.
async function revealTarget(target: { toolCallId?: string }): Promise<void> {
  if (!target.toolCallId) {
    await scrollToBottom();

    return;
  }

  const selector = `[data-tool-call-id="${CSS.escape(target.toolCallId)}"]`;
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await nextTick();
    await rafTick();

    const el = messagesEl.value?.querySelector<HTMLElement>(selector);

    if (el) {
      el.scrollIntoView({ block: 'center' });
      flashReveal(el);

      return;
    }
  }

  // Target never rendered (collapsed/trimmed history or id mismatch) —
  // land the user on the live work instead of stranding them at the top.
  await scrollToBottom();
}

function flashReveal(el: HTMLElement): void {
  el.classList.remove('reveal-flash');
  // Force reflow so re-adding the class restarts the animation.
  void el.offsetWidth;
  el.classList.add('reveal-flash');
  window.setTimeout(() => el.classList.remove('reveal-flash'), 1600);
}

async function consumePendingReveal(): Promise<void> {
  const target = layoutStore.consumeReveal(props.sessionId);

  if (!target) return;

  await revealTarget(target);
}

/// Already-open panel: a reveal request arrives after we've mounted.
/// Non-immediate so we don't double-fire with the onMounted consume.
watch(
  () => layoutStore.pendingReveal[props.sessionId],
  (target) => {
    if (!target) return;

    void consumePendingReveal();
  },
);

/// "Agent is working right now" indicator for the in-chat card. Reads
/// the session record's authoritative `isThinking` flag (driven by
/// assistant.turn_start / turn_end / session.idle in sessionsStore),
/// falls back to the local `isSending` heuristic when we haven't seen
/// a turn boundary yet (older SDKs / non-streaming models that never
/// emit `assistant.turn_start`). Used for the in-chat spinner card
/// — the tab + sidebar dot read `record.isThinking` directly.
const recordIsThinking = computed(() => {
  const r = sessionsStore.getSession(props.sessionId);

  if (!r) return false;

  if (r.sawTurnBoundary) return r.isThinking;

  return isSending.value;
});

const reasoningVisibility = computed<ReasoningVisibility>(() =>
  props.reasoningVisibilityOverride === 'default'
    ? settings.value.appearance.reasoningVisibility
    : props.reasoningVisibilityOverride,
);

const accentColor = computed(() => props.accent);
const timelineItems = computed(() => {
  const out: Array<ChatItem | { kind: 'commandResult'; id: number; record: CommandResultRecord }> =
    [...items.value];

  for (const record of commandResults.value) {
    out.push({
      kind: 'commandResult',
      id: commandResultOrder.value[record.id] ?? Number.MAX_SAFE_INTEGER,
      record,
    });
  }

  return out.sort((a, b) => a.id - b.id);
});

/// Submission handler. The composer always submits a payload —
/// `mode: "default"` (Ctrl+Enter, primary button), `mode: "queue"`
/// (Alt+Enter — force queue regardless of default), or
/// `mode: "interrupt"` (Ctrl+Shift+Enter / dropdown). We resolve
/// `"default"` against the session's `defaultSendMode` inside
/// `useChatSubmit` so the downstream sessionsStore action only sees
/// concrete SendMode values.
const { sendMessage } = useChatSubmit({
  getSessionId: () => props.sessionId,
  getDefaultSendMode: () => props.defaultSendMode,
  getSendHandler: () => props.sendHandler,
  appendOptimisticUser,
  appendSystemError,
  scrollToBottom,
  toasts,
  transport: {
    sendMessage: (sessionId, text, mode, attachments) =>
      sessionsStore.sendMessage(sessionId, text, mode, attachments),
  },
});

function onUpdateDefaultMode(next: DefaultSendMode) {
  sessionsStore.setDefaultSendMode(props.sessionId, next);
}

/// Inline edit mode for user messages: when set, the matching user
/// bubble is replaced by a MessageEditor in place. Reset on save,
/// fork-and-save, or cancel. Keyed by ChatItem.id (counter-derived).
const editingItemId = ref<number | null>(null);

const {
  onMessageEdit,
  onMessageQuote,
  onEditorSave,
  onEditorSaveFork,
  onEditorCancel,
  onMessageRetry,
  onMessageFork,
  onForkNoticeClick,
  itemIndexById,
} = useMessageActions({
  sessionId: sessionIdRef,
  items,
  composerRef,
  editingItemId,
  resetForReplay,
  scrollToBottom,
  toasts,
  sessionsStore,
  sessionsListStore,
  layoutStore,
});

const pendingHead = computed(() => ambient.value.pendingRequests[0] ?? null);
/// Type-aware styling for the pending-request banner. Pulls the
/// color + icon + label from the shared `notificationStyles` so the
/// banner matches the dot color on the tab + sidebar. Reads the
/// queue head: if more than one request is pending, the banner
/// surfaces the oldest; additional requests are reflected in the
/// global modal's queue count.
const pendingStyle = computed(() => {
  const req = pendingHead.value;

  if (!req) return null;

  return styleFor(req.kind);
});

/// Session command summary. File details moved to the right rail where
/// the paths are actually useful and expandable.
const commandsRun = computed(() => {
  if (typeof props.commandsRun === 'number') return props.commandsRun;

  let total = 0;

  for (const it of items.value) {
    if (it.kind !== 'tool') continue;

    const name = it.toolName.toLowerCase();

    if (name === 'shell' || name === 'bash' || name === 'exec' || name === 'execute') {
      total++;
    }
  }

  return total;
});
</script>

<template>
  <section
    ref="tileEl"
    class="chat-tile"
    :style="{ '--accent': accentColor }"
  >
    <div
      ref="messagesEl"
      class="chat-messages"
    >
      <p
        v-if="items.length === 0"
        class="empty-message"
      >
        Start typing below to send a message.
      </p>

      <template
        v-for="item in timelineItems"
        :key="`${item.kind}-${item.id}`"
      >
        <CommandResultCard
          v-if="item.kind === 'commandResult'"
          :record="item.record"
          @add="addCommandResultAttachment"
          @cancel="cancelCommandResult"
        />
        <div
          v-else-if="item.kind === 'reasoning' && reasoningVisibility !== 'hidden'"
          class="message-shell"
        >
          <ReasoningBlock
            :text="item.text"
            :visibility="reasoningVisibility"
            :opaque="item.kind === 'reasoning' && item.opaque === true"
          />
          <MessageActions
            kind="reasoning"
            :text="item.text"
            :event-id="item.eventId"
            @quote="onMessageQuote"
            @fork="onMessageFork(itemIndexById(item.id))"
          />
        </div>
        <div
          v-else-if="item.kind === 'tool'"
          class="message-shell"
          :data-tool-call-id="item.toolCallId"
        >
          <ToolCallBlock
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
          <MessageActions
            kind="tool"
            :event-id="item.eventId"
            :tool-args-text="item.args ? JSON.stringify(item.args, null, 2) : ''"
            :tool-result-text="item.resultContent || item.partialOutput || ''"
            @fork="onMessageFork(itemIndexById(item.id))"
          />
        </div>
        <SubagentBlock
          v-else-if="item.kind === 'subagent'"
          :agent-id="item.agentId"
          :agent-name="item.agentName"
          :display-name="item.displayName"
          :description="item.description"
          :status="item.status"
          :started-at="item.startedAt"
          :completed-at="item.completedAt"
          :error="item.error"
          :items="item.items"
          :reasoning-visibility="reasoningVisibility"
        />
        <PendingRequestCard
          v-else-if="item.kind === 'pendingRequest'"
          :session-id="props.sessionId"
          :request-id="item.requestId"
          :pending-kind="item.pendingKind"
          :message="item.message"
          :request="item.request"
        />
        <button
          v-else-if="item.kind === 'forkNotice'"
          type="button"
          class="fork-notice"
          :class="`dir-${item.direction}`"
          :title="
            item.direction === 'from'
              ? `Open the parent session: ${item.referenceName}`
              : `Open the forked session: ${item.referenceName}`
          "
          @click="onForkNoticeClick(item.referenceName)"
        >
          <i
            class="pi pi-share-alt"
            aria-hidden="true"
          />
          <span class="fork-notice-label">
            {{ item.direction === 'from' ? 'Forked from' : 'Forked into' }}
          </span>
          <span class="fork-notice-target">{{ item.referenceName }}</span>
          <i
            class="pi pi-arrow-right"
            aria-hidden="true"
          />
        </button>
        <!-- Skip empty assistant items entirely. The model emits
             `assistant.message_start` (creating an empty item) before
             every turn; when the turn goes straight to a tool call
             without text, the empty card used to render as "..." right
             before the tool block. The pending spinner below already
             covers the "waiting for response" state.
             pendingRequest items are handled by PendingRequestCard
             above, so by the time we reach this branch the type is
             narrowed to user / assistant / system. -->
        <div
          v-else-if="item.kind !== 'reasoning' && !(item.kind === 'assistant' && item.text === '')"
          class="message-shell"
        >
          <!-- Inline editor swap. Only user messages support editing; -->
          <!-- canFork is true iff the item has a server-acknowledged   -->
          <!-- eventId we can pin the fork to.                          -->
          <MessageEditor
            v-if="item.kind === 'user' && editingItemId === item.id"
            :original-text="item.text"
            :can-fork="Boolean('eventId' in item && item.eventId)"
            @save="
              (text) => onEditorSave('eventId' in item && item.eventId ? item.eventId : '', text)
            "
            @save-and-fork="
              (text) =>
                onEditorSaveFork('eventId' in item && item.eventId ? item.eventId : '', text)
            "
            @cancel="onEditorCancel"
          />
          <template v-else>
            <article
              class="message-card"
              :class="[item.kind, item.kind === 'system' ? `severity-${item.severity}` : '']"
            >
              <header class="role-label">
                {{
                  item.kind === 'user'
                    ? 'You'
                    : item.kind === 'assistant'
                      ? 'Assistant'
                      : item.kind === 'system' && item.severity === 'warn'
                        ? 'Warning'
                        : item.kind === 'system' && item.severity === 'error'
                          ? 'Error'
                          : 'Info'
                }}
              </header>
              <UserMessageBody
                v-if="item.kind === 'user'"
                :text="item.text"
                label="Your message"
                :attachments="item.attachments"
              />
              <MessageContent
                v-else-if="item.kind === 'assistant'"
                :text="item.text"
                label="Assistant message"
              />
              <p
                v-else
                class="message-body"
              >
                {{ item.text }}
              </p>
            </article>
            <MessageActions
              :kind="item.kind"
              :text="item.text"
              :event-id="'eventId' in item ? item.eventId : undefined"
              @quote="onMessageQuote"
              @edit="onMessageEdit(item.id)"
              @retry="onMessageRetry(itemIndexById(item.id))"
              @fork="onMessageFork(itemIndexById(item.id))"
            />
          </template>
        </div>
      </template>

      <!-- Mid-turn indicator inside the chat. Visible whenever the
           record reports `isThinking` (driven by assistant.turn_start
           / turn_end / session.idle in sessionsStore). Previously
           this card only showed before the FIRST delta — which made
           it disappear forever once any assistant text arrived,
           even though the agent often keeps working through tool
           calls + reasoning + more messages.
           Now: appears at the bottom of the message list during the
           ENTIRE mid-turn period, AFTER all the items so the user
           sees "currently working" without losing prior context. -->
      <article
        v-if="recordIsThinking"
        class="message-card assistant pending"
      >
        <header class="role-label">Assistant</header>
        <p class="message-body">
          <i class="pi pi-spin pi-spinner thinking-spinner" />
          {{ ambient.intent || 'Thinking…' }}
        </p>
      </article>
    </div>

    <footer
      v-if="ambient.usage || commandsRun"
      class="chat-artifacts"
    >
      <span
        v-if="commandsRun > 0"
        class="artifact-pill"
        :title="`${commandsRun} shell command(s) executed this session`"
      >
        <i
          class="pi pi-window-maximize"
          aria-hidden="true"
        />
        {{ commandsRun }} command{{ commandsRun === 1 ? '' : 's' }}
      </span>
      <span
        v-if="ambient.usage && ambient.usage.tokenLimit > 0"
        class="artifact-pill usage-pill"
        :title="`${ambient.usage.currentTokens.toLocaleString()} / ${ambient.usage.tokenLimit.toLocaleString()} tokens`"
      >
        <i
          class="pi pi-chart-bar"
          aria-hidden="true"
        />
        {{ ambient.usage.currentTokens.toLocaleString() }} /
        {{ ambient.usage.tokenLimit.toLocaleString() }}
      </span>
    </footer>

    <!-- Pending-request banner. Visible whenever the SDK is blocked
         on user input (permission / user_input / elicitation). Reads
         from `ambient.pendingRequest` (set by the reducer's
         notification handlers); style (color + icon + label) comes
         from `notificationStyles.ts` so the banner's tint matches
         the dot on the tab + sidebar. The actual accept/deny UI is
         a follow-up ticket — for now we just surface the state so
         the user knows what's blocking and from where. -->
    <div
      v-if="pendingHead && pendingStyle"
      class="pending-banner"
      role="status"
      :style="{ '--banner-color': pendingStyle.color }"
    >
      <i
        class="pi pending-banner-icon"
        :class="`pi-${pendingStyle.iconSuffix}`"
        aria-hidden="true"
      />
      <div class="pending-banner-body">
        <span class="pending-banner-kind">
          {{ pendingStyle.label
          }}<template v-if="ambient.pendingRequests.length > 1">
            · {{ ambient.pendingRequests.length }} pending</template
          >
        </span>
        <span class="pending-banner-message">{{ pendingHead.message }}</span>
      </div>
    </div>

    <form
      class="chat-composer"
      @submit.prevent
    >
      <MessageComposer
        ref="composerRef"
        :default-mode="props.defaultSendMode"
        :session-id="props.sendHandler ? undefined : props.sessionId"
        :command-terminal-id="commandTerminalId"
        @submit="sendMessage"
        @request-command-terminal="onRequestCommandTerminal"
        @open-full-terminal="openFullSessionTerminal"
        @update:default-mode="onUpdateDefaultMode"
      >
        <template #session-left-controls>
          <SessionHeaderControls
            :session-id="props.sessionId"
            area="composer-left"
          />
        </template>
        <template #session-right-controls>
          <SessionHeaderControls
            :session-id="props.sessionId"
            area="composer-right"
          />
        </template>
      </MessageComposer>
    </form>
  </section>
</template>

<style scoped>
/* Brief highlight when "Go to session" (Jobs panel) reveals the
   tool-call card that spawned a background job (issue #16). Uses a
   box-shadow + background pulse so it doesn't shift layout. The flash
   class is toggled imperatively in `flashReveal`; the .message-shell
   div carries the scoped attribute so a plain scoped selector matches. */
.message-shell.reveal-flash {
  animation: reveal-flash 1.6s ease-out;
  border-radius: 8px;
}

@keyframes reveal-flash {
  0% {
    background: color-mix(in srgb, var(--p-primary-500) 22%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-500) 45%, transparent);
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 3px transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .message-shell.reveal-flash {
    animation-duration: 0.01ms;
  }
}

.fork-notice {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  margin: 0.1rem 0;
  padding: 0.25rem 0.6rem;
  font-size: 0.78rem;
  font-family: inherit;
  background: color-mix(in srgb, var(--p-primary-500) 10%, transparent);
  color: var(--p-primary-600, var(--p-primary-500));
  border: 1px solid color-mix(in srgb, var(--p-primary-500) 35%, transparent);
  border-radius: 999px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}

.fork-notice:hover {
  background: color-mix(in srgb, var(--p-primary-500) 18%, transparent);
  border-color: var(--p-primary-500);
}

.fork-notice .pi {
  font-size: 0.78rem;
}

.fork-notice-label {
  font-weight: 500;
  opacity: 0.85;
}

.fork-notice-target {
  font-weight: 600;
}

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
  background: linear-gradient(
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

.chat-artifacts {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.25rem 0.75rem 0;
}

.artifact-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--p-surface-border);
}

.artifact-pill .pi {
  font-size: 0.7rem;
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

/* The mid-turn pending card spinner. PrimeIcons' default `pi-spin`
 * keyframes run on the main thread; under heavy Lexical reconciles
 * (every streaming delta re-mounts the message content) the spinner
 * visually freezes. Promote to its own compositor layer + use a
 * dedicated keyframe so the animation runs on the compositor thread
 * regardless of main-thread load. Same pattern as the BootSplash
 * spinner. */
.thinking-spinner {
  display: inline-block;
  will-change: transform;
  /* Override pi-spin's default rotation with one that runs from a
   * transform-only keyframe, which is what gets accelerated. */
  animation: thinking-spin 1s linear infinite !important;
}

@keyframes thinking-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.chat-composer {
  flex: 0 0 auto;
}

/* Pending-request banner: type-tinted (color comes from
 * `notificationStyles.ts` via the `--banner-color` inline custom
 * property). Matches the dot color on the tab + sidebar so the
 * banner reads as the same signal. Sits between the message list
 * and the composer. */
.pending-banner {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.85rem;
  margin: 0.5rem 0.5rem 0;
  border-radius: var(--p-border-radius-md);
  border: 1px solid color-mix(in srgb, var(--banner-color, var(--p-primary-color)) 40%, transparent);
  background: color-mix(
    in srgb,
    var(--banner-color, var(--p-primary-color)) 14%,
    var(--p-content-background)
  );
  color: var(--p-text-color);
}

.pending-banner-icon {
  font-size: 1.05rem;
  color: var(--banner-color, var(--p-primary-color));
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
  color: var(--banner-color, var(--p-primary-color));
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
