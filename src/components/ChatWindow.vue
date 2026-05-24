<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import MessageComposer from "./MessageComposer.vue";
import MessageContent from "./MessageContent.vue";
import UserMessageBody from "./UserMessageBody.vue";
import MessageActions from "./MessageActions.vue";
import MessageEditor from "./MessageEditor.vue";
import SessionHeaderControls from "./SessionHeaderControls.vue";
import ToolCallBlock from "./ToolCallBlock.vue";
import SubagentBlock from "./SubagentBlock.vue";
import PendingRequestCard from "./PendingRequestCard.vue";
import CommandResultCard from "./CommandResultCard.vue";
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
  CommandResultRecord,
  ReasoningVisibility,
  SendMessageAttachment,
  SessionEventPayload,
} from "../ipc/types";
import { useSessionsStore, type DefaultSendMode } from "../stores/sessionsStore";
import { useSessionsListStore } from "../stores/sessionsListStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useCommandResultsStore } from "../stores/commandResultsStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useToastStore } from "../stores/toastStore";
import ReasoningBlock from "./ReasoningBlock.vue";
import type { ComposerSubmitPayload } from "../lexical/plugins";
import { styleFor } from "../lib/notificationStyles";
import { cleanTerminalCommandOutput } from "../lib/ansi";

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
  reasoningVisibilityOverride: ReasoningVisibility | "default";
  /// Per-session default mode for the composer's primary send action.
  /// "steer" maps to SDK `mode: "immediate"`; "queue" to `"enqueue"`.
  defaultSendMode: "steer" | "queue";
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
const commandResultsStore = useCommandResultsStore();
const terminalStore = useTerminalStore();
const toasts = useToastStore();
const { settings } = storeToRefs(settingsStore);

const items = ref<ChatItem[]>([]);
const ambient = ref<ChatAmbient>(defaultAmbient());
const messagesEl = ref<HTMLElement | null>(null);
const tileEl = ref<HTMLElement | null>(null);
const composerRef = ref<{
  focus: () => void;
  addAttachment?: (attachment: SendMessageAttachment) => void;
  exitCommandMode?: () => void;
  enterCommandMode?: () => void;
} | null>(null);
const commandTerminalId = ref<string>("");
const autoAttachedCommandIds = new Set<string>();
const capturedTerminalCommandIds = new Set<string>();
const commandModeOpenedAt = ref<number>(0);
const commandResultOrder = ref<Record<string, number>>({});

/// External "focus my composer" requests arrive as a window event
/// from the Sessions sidebar (clicking an already-open session row).
/// Filter by sessionId so the event only acts on the matching tile.
function onExternalFocusRequest(e: Event) {
  const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
  if (!detail || detail.sessionId !== props.sessionId) return;
  void scrollToBottom().then(() => composerRef.value?.focus());
}

function onExternalCommandTerminalRequest(e: Event) {
  const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
  if (!detail || detail.sessionId !== props.sessionId) return;
  void composerRef.value?.enterCommandMode?.();
}

function onExternalCloseCommandTerminalRequest(e: Event) {
  const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
  if (!detail || detail.sessionId !== props.sessionId) return;
  composerRef.value?.exitCommandMode?.();
}

function onExternalScrollToBottom(e: Event) {
  const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
  if (!detail || detail.sessionId !== props.sessionId) return;
  void scrollToBottom();
}

onMounted(() => {
  window.addEventListener("dafman:focus-composer", onExternalFocusRequest);
  window.addEventListener("dafman:open-command-terminal", onExternalCommandTerminalRequest);
  window.addEventListener("dafman:close-command-terminal", onExternalCloseCommandTerminalRequest);
  window.addEventListener("dafman:scroll-to-bottom", onExternalScrollToBottom);
  void commandResultsStore.refresh(props.sessionId)
    .then(() => {
      for (const record of commandResultsStore.recordsBySession[props.sessionId] ?? []) {
        autoAttachedCommandIds.add(record.id);
      }
    })
    .catch(() => {
      /* non-critical persisted command history */
    });
});

onBeforeUnmount(() => {
  window.removeEventListener("dafman:focus-composer", onExternalFocusRequest);
  window.removeEventListener("dafman:open-command-terminal", onExternalCommandTerminalRequest);
  window.removeEventListener("dafman:close-command-terminal", onExternalCloseCommandTerminalRequest);
  window.removeEventListener("dafman:scroll-to-bottom", onExternalScrollToBottom);
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
/// Absolute position in the session's event stream that we've already
/// reduced into `items`. Computed as `droppedEventCount + events.length`
/// AFTER the reducer pass, so the next flush picks up only events
/// that arrived since. Survives the store's ring-buffer trim (which
/// bumps droppedEventCount and shifts `events`) without re-processing
/// or skipping anything.
let processedAbsolute = 0;

const isSending = computed(() =>
  ambient.value.sawTurnBoundary ? ambient.value.turnActive : isSendingFallback.value,
);

/// "Agent is working right now" indicator for the in-chat card. Reads
/// the session record's authoritative `isThinking` flag (driven by
/// assistant.turn_start / turn_end / session.idle in sessionsStore),
/// falls back to the local `isSending` heuristic when we haven't seen
/// a turn boundary yet (older SDKs / non-streaming models that never
/// emit `assistant.turn_start`). Used for the in-chat spinner card
/// — the tab + sidebar dot read `record.isThinking` directly.
const recordIsThinking = computed(() => {
  const r = sessionsStore.sessions.find((s) => s.id === props.sessionId);
  if (!r) return false;
  if (r.sawTurnBoundary) return r.isThinking;
  return isSending.value;
});

const reasoningVisibility = computed<ReasoningVisibility>(() =>
  props.reasoningVisibilityOverride === "default"
    ? settings.value.appearance.reasoningVisibility
    : props.reasoningVisibilityOverride,
);

const accentColor = computed(() => props.accent);
const commandResults = computed(() => commandResultsStore.recordsBySession[props.sessionId] ?? []);
const timelineItems = computed(() => {
  const out: Array<ChatItem | { kind: "commandResult"; id: number; record: CommandResultRecord }> = [
    ...items.value,
  ];
  for (const record of commandResults.value) {
    out.push({
      kind: "commandResult",
      id: commandResultOrder.value[record.id] ?? Number.MAX_SAFE_INTEGER,
      record,
    });
  }
  return out.sort((a, b) => a.id - b.id);
});

async function scrollToBottom() {
  await nextTick();
  if (typeof requestAnimationFrame !== "undefined") {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

let isFirstBatch = true;

/// rAF-coalesced flush. Each event arrives as its own IPC frame —
/// during session hydration that's 30-80+ frames in quick succession.
/// Without coalescing we'd run processEvents O(N²) times (N=length on
/// each push) and remount the whole CM6/Lexical tree per chunk. By
/// gating the work behind requestAnimationFrame we collapse all
/// events that landed in the same frame into a single reducer pass.
let pendingFlush: number | null = null;
function scheduleFlush(): void {
  if (pendingFlush !== null) return;
  if (typeof requestAnimationFrame === "undefined") {
    // Test environments (jsdom etc.) — flush synchronously so the
    // existing chatEvents tests don't have to wait for a frame.
    flush();
    return;
  }
  pendingFlush = requestAnimationFrame(() => {
    pendingFlush = null;
    flush();
  });
}

function flush(): void {
  const dropped = props.droppedEventCount ?? 0;
  const target = dropped + props.events.length;
  if (processedAbsolute >= target) return;
  // Slice index inside the (possibly trimmed) events array. clamped
  // to 0 in case the ring buffer trimmed events we hadn't processed
  // yet — those are lost, but the cap is high enough that this only
  // happens for surfaces that mount very late in a long session.
  const startIdx = Math.max(0, processedAbsolute - dropped);
  const fresh = props.events.slice(startIdx);
  processedAbsolute = target;
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
  if (result.error && live) {
    const lastSystem = [...result.items]
      .reverse()
      .find((i) => i.kind === "system" && i.severity === "error");
    if (lastSystem && lastSystem.kind === "system") {
      toasts.error("Session error", lastSystem.text);
    }
  }
  scrollToBottom();
}

watch(
  // Watch the absolute target (dropped + length). Trimming the ring
  // buffer leaves `events.length` unchanged but bumps
  // droppedEventCount — without including it here we'd miss the
  // flush for events that arrive once the buffer is at its cap.
  () => (props.droppedEventCount ?? 0) + props.events.length,
  () => scheduleFlush(),
  { immediate: true },
);

onBeforeUnmount(() => {
  if (pendingFlush !== null && typeof cancelAnimationFrame !== "undefined") {
    cancelAnimationFrame(pendingFlush);
    pendingFlush = null;
  }
});

watch(
  () => props.sessionId,
  () => {
    items.value = [];
    ambient.value = defaultAmbient();
    isSendingFallback.value = false;
    processedAbsolute = (props.droppedEventCount ?? 0) + props.events.length;
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
async function sendMessage(
  payload: ComposerSubmitPayload & {
    attachments?: import("../ipc/types").SendMessageAttachment[];
  },
) {
  if (!payload.text) return;
  const concreteMode =
    payload.mode === "default" ? props.defaultSendMode : payload.mode;

  items.value = appendUserMessage(items.value, payload.text, idCounter, payload.attachments);
  isSendingFallback.value = true;
  await scrollToBottom();

  try {
    if (props.sendHandler) {
      await props.sendHandler(payload.text);
    } else {
      await sessionsStore.sendMessage(
        props.sessionId,
        payload.text,
        concreteMode,
        payload.attachments,
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

async function ensureCommandTerminal(): Promise<string | null> {
  if (commandTerminalId.value) return commandTerminalId.value;
  try {
    const terminal = await terminalStore.getOrCreateSessionTerminal(props.sessionId);
    commandTerminalId.value = terminal.id;
    layoutStore.closePanel(`terminal-${terminal.id}`);
    return terminal.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toasts.error("Failed to open session terminal", message);
    return null;
  }
}

async function onRequestCommandTerminal(): Promise<void> {
  commandModeOpenedAt.value = Date.now();
  await ensureCommandTerminal();
  await nextTick();
  if (commandTerminalId.value) {
    window.dispatchEvent(new CustomEvent("dafman:focus-terminal", {
      detail: { terminalId: commandTerminalId.value },
    }));
  }
}

async function openFullSessionTerminal(): Promise<void> {
  const terminalId = await ensureCommandTerminal();
  if (!terminalId) return;
  composerRef.value?.exitCommandMode?.();
  const terminal = terminalStore.terminals.find((t) => t.id === terminalId);
  layoutStore.addTerminalPanel(terminalId, terminal?.title ?? "Session Shell");
}

function addCommandResultAttachment(record: CommandResultRecord): void {
  composerRef.value?.addAttachment?.({
    type: "commandResult",
    result: record,
    displayName: `command-result-${record.id.slice(0, 8)}.md`,
  });
}

async function cancelCommandResult(record: CommandResultRecord): Promise<void> {
  await commandResultsStore.cancel(props.sessionId, record.id);
}

watch(commandResults, (records) => {
  for (const record of records) {
    if (commandResultOrder.value[record.id] === undefined) {
      commandResultOrder.value = {
        ...commandResultOrder.value,
        [record.id]: idCounter.next++,
      };
    }
    if (record.status === "running" || autoAttachedCommandIds.has(record.id)) continue;
    autoAttachedCommandIds.add(record.id);
    addCommandResultAttachment(record);
  }
});

watch(
  () => commandTerminalId.value ? terminalStore.commands[commandTerminalId.value] ?? [] : [],
  (commands) => {
    for (const command of commands) {
      if (!command.command || capturedTerminalCommandIds.has(command.id)) continue;
      if (new Date(command.startedAt).getTime() < commandModeOpenedAt.value) continue;
      capturedTerminalCommandIds.add(command.id);
      const now = new Date().toISOString();
      const output = cleanTerminalCommandOutput(command.output ?? "");
      commandResultsStore.addLocal({
        id: command.id,
        sessionId: props.sessionId,
        command: command.command,
        cwd: command.cwd ?? "",
        shell: "session terminal",
        status: command.exitCode === 0 ? "completed" : "failed",
        stdout: output,
        stderr: "",
        truncated: false,
        createdAt: command.startedAt,
        completedAt: command.endedAt ?? now,
        exitCode: command.exitCode ?? null,
      });
      composerRef.value?.exitCommandMode?.();
    }
  },
  { deep: true },
);

/// Inline edit mode for user messages: when set, the matching user
/// bubble is replaced by a MessageEditor in place. Reset on save,
/// fork-and-save, or cancel. Keyed by ChatItem.id (counter-derived).
const editingItemId = ref<number | null>(null);

function onMessageEdit(itemId: number) {
  editingItemId.value = itemId;
}

function onMessageQuote(quotedText: string) {
  const composer = composerRef.value as
    | { appendText?: (v: string) => void; focus: () => void }
    | null;
  composer?.appendText?.(quotedText);
}

/// Save the edit in place: truncate at the user message's eventId
/// and re-send the new text in the SAME session.
async function onEditorSave(eventId: string, newText: string): Promise<void> {
  editingItemId.value = null;
  if (!eventId) {
    toasts.warn("Can't save edit", "Missing server anchor for this message.");
    return;
  }
  try {
    await sessionsStore.editUserMessage(props.sessionId, eventId, newText);
    items.value = [];
    ambient.value = defaultAmbient();
    processedAbsolute = 0;
    isFirstBatch = true;
    isSendingFallback.value = true;
    await scrollToBottom();
  } catch {
    // Toast surfaced by the store action.
  }
}

/// Save & fork: open a brand-new session forked at the user
/// message's eventId, send the edited text there. Original session
/// is left intact. The new session opens as a new dockview panel.
async function onEditorSaveFork(eventId: string, newText: string): Promise<void> {
  editingItemId.value = null;
  if (!eventId) {
    toasts.warn("Can't fork", "Missing server anchor for this message.");
    return;
  }
  try {
    const newId = await sessionsStore.forkAndSend(
      props.sessionId,
      eventId,
      newText,
    );
    layoutStore.addPanel(newId);
    layoutStore.activatePanel(newId);
  } catch {
    // Toast surfaced by the store action.
  }
}

function onEditorCancel(): void {
  editingItemId.value = null;
}

async function onMessageRetry(assistantItemIndex: number) {
  // Walk backwards to find the most recent user item BEFORE this
  // assistant block. That's the anchor we truncate to + the text
  // we resend.
  for (let i = assistantItemIndex - 1; i >= 0; i--) {
    const it = items.value[i];
    if (it && it.kind === "user" && it.eventId) {
      try {
        await sessionsStore.retryFromEvent(props.sessionId, it.eventId, it.text);
      } catch {
        // Toast already shown by the store action.
      }
      return;
    }
  }
  toasts.warn(
    "Can't retry from here",
    "No preceding user message with a server-acknowledged anchor.",
  );
}

/// Resolve the right fork anchor for the item at `itemIndex`.
///
/// "Fork from this assistant message" → branch at the user message
/// that triggered this assistant turn. The SDK's `toEventId` is
/// exclusive, so we'd otherwise land mid-turn (turn_start without
/// turn_end → permanent loading spinner). Anchoring at the user
/// message gives a clean state from the same conversation lead-up
/// and lets the user re-prompt.
///
/// For user messages we just use their own eventId.
function resolveForkAnchor(itemIndex: number): string | undefined {
  const item = items.value[itemIndex];
  if (!item) return undefined;
  if (item.kind === "user" && item.eventId) return item.eventId;
  for (let i = itemIndex; i >= 0; i--) {
    const it = items.value[i];
    if (it && it.kind === "user" && it.eventId) return it.eventId;
  }
  return undefined;
}

async function onMessageFork(itemIndex: number) {
  const anchor = resolveForkAnchor(itemIndex);
  if (!anchor) {
    toasts.warn(
      "Can't fork from here",
      "Need a preceding user message with a server-acknowledged anchor.",
    );
    return;
  }
  try {
    const newId = await sessionsStore.forkSession(props.sessionId, anchor);
    layoutStore.addPanel(newId);
    layoutStore.activatePanel(newId);
  } catch {
    // Toast already shown by the store action.
  }
}

/// Fork-notice chip clicked → resolve the referenced session by
/// name (best-effort) and surface it. Three-tier lookup:
/// 1. Already-loaded sessions (sessionsStore) → activate the panel.
/// 2. Catalog (sessionsListStore) → restore + add panel + activate.
///    Refreshes the catalog first if it hasn't loaded yet, since
///    forks done before this app started won't be in the cache.
/// 3. Nothing matched → toast hint to open via the sidebar.
async function onForkNoticeClick(referenceName: string) {
  const loaded = sessionsStore.findSessionByName(referenceName);
  if (loaded) {
    if (!layoutStore.isPanelOpen(loaded.id)) {
      layoutStore.addPanel(loaded.id);
    }
    layoutStore.activatePanel(loaded.id);
    return;
  }

  if (!sessionsListStore.hasLoaded) {
    await sessionsListStore.refresh();
  }
  const catalogHit = sessionsListStore.findByName(referenceName);
  if (catalogHit) {
    try {
      const restored = await sessionsStore.restoreSession(catalogHit.sessionId);
      const id = restored?.id ?? catalogHit.sessionId;
      if (!layoutStore.isPanelOpen(id)) {
        layoutStore.addPanel(id);
      }
      layoutStore.activatePanel(id);
    } catch {
      // restoreSession surfaces its own toast on failure.
    }
    return;
  }

  toasts.warn(
    "Couldn't find that session",
    `No session matches "${referenceName}". Open it from the sessions sidebar.`,
  );
}

/// Session command summary. File details moved to the right rail where
/// the paths are actually useful and expandable.
const commandsRun = computed(() => {
  if (typeof props.commandsRun === "number") return props.commandsRun;
  let total = 0;
  for (const it of items.value) {
    if (it.kind !== "tool") continue;
    const name = it.toolName.toLowerCase();
    if (
      name === "shell" ||
      name === "bash" ||
      name === "exec" ||
      name === "execute"
    ) {
      total++;
    }
  }
  return total;
});

function itemIndexById(itemId: number): number {
  return items.value.findIndex((item) => item.id === itemId);
}

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
</script>

<template>
  <section ref="tileEl" class="chat-tile" :style="{ '--accent': accentColor }">
    <div ref="messagesEl" class="chat-messages">
      <p v-if="items.length === 0" class="empty-message">
        Start typing below to send a message.
      </p>

      <template v-for="item in timelineItems" :key="`${item.kind}-${item.id}`">
        <CommandResultCard
          v-if="item.kind === 'commandResult'"
          :record="item.record"
          @add="addCommandResultAttachment"
          @cancel="cancelCommandResult"
        />
        <div v-else-if="item.kind === 'reasoning' && reasoningVisibility !== 'hidden'" class="message-shell">
          <ReasoningBlock
            :text="item.text"
            :visibility="reasoningVisibility"
            :opaque="item.kind === 'reasoning' && item.opaque === true"
          />
          <MessageActions
            v-if="reasoningVisibility !== 'hidden'"
            kind="reasoning"
            :text="item.text"
            :event-id="item.eventId"
            @quote="onMessageQuote"
            @fork="onMessageFork(itemIndexById(item.id))"
          />
        </div>
        <div v-else-if="item.kind === 'tool'" class="message-shell">
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
          <i class="pi pi-share-alt" aria-hidden="true" />
          <span class="fork-notice-label">
            {{ item.direction === "from" ? "Forked from" : "Forked into" }}
          </span>
          <span class="fork-notice-target">{{ item.referenceName }}</span>
          <i class="pi pi-arrow-right" aria-hidden="true" />
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
            v-if="
               item.kind === 'user' &&
              editingItemId === item.id
            "
            :original-text="item.text"
            :can-fork="Boolean('eventId' in item && item.eventId)"
            @save="(text) => onEditorSave(('eventId' in item && item.eventId) ? item.eventId : '', text)"
            @save-and-fork="(text) => onEditorSaveFork(('eventId' in item && item.eventId) ? item.eventId : '', text)"
            @cancel="onEditorCancel"
          />
          <template v-else>
            <article
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
              <p v-else class="message-body">{{ item.text }}</p>
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
          {{ ambient.intent || "Thinking…" }}
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
        <i class="pi pi-window-maximize" aria-hidden="true" />
        {{ commandsRun }} command{{ commandsRun === 1 ? "" : "s" }}
      </span>
      <span
        v-if="ambient.usage && ambient.usage.tokenLimit > 0"
        class="artifact-pill usage-pill"
        :title="`${ambient.usage.currentTokens.toLocaleString()} / ${ambient.usage.tokenLimit.toLocaleString()} tokens`"
      >
        <i class="pi pi-chart-bar" aria-hidden="true" />
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
            · {{ ambient.pendingRequests.length }} pending</template>
        </span>
        <span class="pending-banner-message">{{ pendingHead.message }}</span>
      </div>
    </div>

    <form class="chat-composer" @submit.prevent>
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
          <SessionHeaderControls :session-id="props.sessionId" area="composer-left" />
        </template>
        <template #session-right-controls>
          <SessionHeaderControls :session-id="props.sessionId" area="composer-right" />
        </template>
      </MessageComposer>
    </form>
  </section>
</template>

<style scoped>
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
  transition: background 0.12s ease, border-color 0.12s ease;
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
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
  background: color-mix(in srgb, var(--banner-color, var(--p-primary-color)) 14%, var(--p-content-background));
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
