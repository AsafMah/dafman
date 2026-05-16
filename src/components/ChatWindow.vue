<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import InputGroup from "primevue/inputgroup";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Tag from "primevue/tag";
import { accentForSession } from "../lib/color";
import {
  appendSystemMessage,
  appendUserMessage,
  processEvents,
  type ChatItem,
  type IdCounter,
} from "../lib/chatEvents";
import type { ReasoningVisibility, SessionEventPayload } from "../ipc/types";
import { useSessionsStore } from "../stores/sessionsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import ReasoningBlock from "./ReasoningBlock.vue";

const props = defineProps<{
  sessionId: string;
  events: SessionEventPayload[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const toasts = useToastStore();
const { settings } = storeToRefs(settingsStore);

const draft = ref("");
const items = ref<ChatItem[]>([]);
const messagesEl = ref<HTMLElement | null>(null);
const isSending = ref(false);
const idCounter: IdCounter = { next: 1 };
let processedEvents = 0;

const sessionOverride = ref<ReasoningVisibility | null>(null);

const reasoningVisibility = computed<ReasoningVisibility>(
  () => sessionOverride.value ?? settings.value.appearance.reasoningVisibility,
);

const reasoningOptions: { label: string; value: ReasoningVisibility | null }[] = [
  { label: "Default", value: null },
  { label: "Hidden", value: "hidden" },
  { label: "Compact", value: "compact" },
  { label: "Expanded", value: "expanded" },
];

const canSend = computed(
  () => draft.value.trim().length > 0 && !isSending.value,
);

const accentColor = computed(() => accentForSession(props.sessionId));

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
    const { items: next, idle, error } = processEvents(
      items.value,
      fresh,
      idCounter,
    );
    items.value = next;
    if (idle || error) isSending.value = false;
    if (error) {
      const lastSystem = [...next].reverse().find((i) => i.kind === "system");
      if (lastSystem) toasts.error("Session error", lastSystem.text);
    }
    scrollToBottom();
  },
  { immediate: true },
);

watch(
  () => props.sessionId,
  () => {
    items.value = [];
    isSending.value = false;
    draft.value = "";
    sessionOverride.value = null;
    processedEvents = props.events.length;
  },
);

async function sendMessage() {
  const text = draft.value.trim();
  if (!text || isSending.value) return;

  items.value = appendUserMessage(items.value, text, idCounter);
  draft.value = "";
  isSending.value = true;
  await scrollToBottom();

  try {
    await sessionsStore.sendMessage(props.sessionId, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    items.value = appendSystemMessage(
      items.value,
      `Error: ${message}`,
      idCounter,
    );
    toasts.error("Failed to send message", message);
    isSending.value = false;
    await scrollToBottom();
  }
}
</script>

<template>
  <section class="chat-tile" :style="{ '--accent': accentColor }">
    <header class="chat-header">
      <div class="chat-title">
        <Tag :value="props.sessionId" severity="secondary" />
      </div>
      <div class="chat-header-actions">
        <Select
          v-model="sessionOverride"
          :options="reasoningOptions"
          option-label="label"
          option-value="value"
          size="small"
          aria-label="Reasoning visibility for this session"
        />
        <Button
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
        <article v-else class="message-card" :class="item.kind">
          <header class="role-label">
            {{ item.kind === "user" ? "You" : item.kind === "assistant" ? "Assistant" : "System" }}
          </header>
          <p class="message-body">{{ item.text || "..." }}</p>
        </article>
      </template>

      <article
        v-if="isSending && !items.some((m) => m.kind === 'assistant' && m.text === '')"
        class="message-card assistant pending"
      >
        <header class="role-label">Assistant</header>
        <p class="message-body">
          <i class="pi pi-spin pi-spinner" /> Thinking...
        </p>
      </article>
    </div>

    <form class="chat-composer" @submit.prevent="sendMessage">
      <InputGroup>
        <InputText
          v-model="draft"
          placeholder="Write your message..."
          :disabled="isSending"
        />
        <Button type="submit" icon="pi pi-send" :disabled="!canSend" />
      </InputGroup>
    </form>
  </section>
</template>

<style scoped>
.chat-tile {
  min-height: 0;
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
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.chat-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.chat-header-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
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
  background: var(--p-surface-100, var(--p-content-background));
  border-left: 3px solid transparent;
}

:global(.app-dark) .message-card {
  background: var(--p-surface-800, var(--p-content-background));
}

.message-card.user {
  background: var(--p-content-background);
  border-left-color: var(--p-surface-400, #cbd5e1);
}

.message-card.assistant {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-left-color: var(--accent);
}

.message-card.system {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 8%, transparent);
  border-left-color: var(--p-red-500, #ef4444);
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
  padding: 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
}
</style>
