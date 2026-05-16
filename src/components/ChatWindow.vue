<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { accentForSession } from "../lib/color";
import type { SessionEventPayload } from "../ipc/types";
import { useSessionsStore } from "../stores/sessionsStore";
import { useToastStore } from "../stores/toastStore";
import Avatar from "primevue/avatar";
import Button from "primevue/button";
import InputGroup from "primevue/inputgroup";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";

type ChatMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  text: string;
  messageId?: string;
};

const props = defineProps<{
  sessionId: string;
  events: SessionEventPayload[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const draft = ref("");
const messages = ref<ChatMessage[]>([]);
const messagesEl = ref<HTMLElement | null>(null);
const isSending = ref(false);
let nextId = 1;
let processedEvents = 0;

const canSend = computed(
  () => draft.value.trim().length > 0 && !isSending.value,
);

const accentColor = computed(() => accentForSession(props.sessionId));

async function scrollToBottom() {
  await nextTick();
  const el = messagesEl.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

function findOrCreateAssistantMessage(messageId: string): ChatMessage {
  let msg = messages.value.find(
    (m) => m.role === "assistant" && m.messageId === messageId,
  );
  if (!msg) {
    msg = {
      id: nextId++,
      role: "assistant",
      text: "",
      messageId,
    };
    messages.value.push(msg);
  }
  return msg;
}

function handleEvent(payload: SessionEventPayload) {
  const { eventType, data } = payload;

  switch (eventType) {
    case "assistant.message_start": {
      const messageId = String(data.messageId ?? "");
      if (messageId) {
        findOrCreateAssistantMessage(messageId);
        scrollToBottom();
      }
      break;
    }
    case "assistant.message_delta": {
      const messageId = String(data.messageId ?? "");
      const delta = String(data.deltaContent ?? "");
      if (messageId) {
        const msg = findOrCreateAssistantMessage(messageId);
        msg.text += delta;
        scrollToBottom();
      }
      break;
    }
    case "assistant.message": {
      const messageId = String(data.messageId ?? "");
      const content = String(data.content ?? "");
      if (messageId) {
        const msg = findOrCreateAssistantMessage(messageId);
        msg.text = content;
        scrollToBottom();
      }
      break;
    }
    case "session.idle": {
      isSending.value = false;
      break;
    }
    case "session.error": {
      const message = String(data.message ?? "Unknown session error");
      messages.value.push({
        id: nextId++,
        role: "system",
        text: `Session error: ${message}`,
      });
      isSending.value = false;
      scrollToBottom();
      break;
    }
    default:
      break;
  }
}

watch(
  () => props.events.length,
  (len) => {
    while (processedEvents < len) {
      const payload = props.events[processedEvents];
      processedEvents++;
      if (payload) {
        handleEvent(payload);
      }
    }
  },
  { immediate: true },
);

watch(
  () => props.sessionId,
  () => {
    messages.value = [];
    isSending.value = false;
    draft.value = "";
    processedEvents = props.events.length;
  },
);

const sessionsStore = useSessionsStore();
const toasts = useToastStore();

async function sendMessage() {
  const text = draft.value.trim();
  if (!text || isSending.value) {
    return;
  }

  messages.value.push({ id: nextId++, role: "user", text });
  draft.value = "";
  isSending.value = true;
  await scrollToBottom();

  try {
    await sessionsStore.sendMessage(props.sessionId, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    messages.value.push({
      id: nextId++,
      role: "system",
      text: `Error: ${message}`,
    });
    toasts.error("Failed to send message", message);
    isSending.value = false;
    await scrollToBottom();
  }
}
</script>

<template>
  <section
    class="chat-tile"
    :style="{ '--accent': accentColor }"
  >
    <header class="chat-header">
      <div class="chat-title">
        <Avatar
          label="AI"
          shape="circle"
          size="small"
          :style="{ background: accentColor, color: 'white' }"
        />
        <Tag :value="props.sessionId" severity="secondary" />
      </div>
      <Button
        icon="pi pi-times"
        text
        rounded
        aria-label="Close session"
        @click="emit('close')"
      />
    </header>

    <div ref="messagesEl" class="chat-messages">
      <p v-if="messages.length === 0" class="empty-message">
        Start typing below to send a message.
      </p>

      <div
        v-for="message in messages"
        :key="message.id"
        class="message-row"
        :class="message.role"
      >
        <Avatar
          :label="message.role === 'user' ? 'U' : message.role === 'assistant' ? 'A' : '!'"
          shape="circle"
          size="small"
        />
        <div class="message-bubble">{{ message.text || "..." }}</div>
      </div>

      <div
        v-if="isSending && !messages.some((m) => m.role === 'assistant' && m.text === '')"
        class="message-row assistant"
      >
        <Avatar label="A" shape="circle" size="small" />
        <div class="message-bubble typing">
          <i class="pi pi-spin pi-spinner" /> Thinking...
        </div>
      </div>
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

.chat-messages {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
}

.empty-message {
  margin: 0;
  color: var(--p-text-muted-color);
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.message-row.assistant {
  flex-direction: row-reverse;
}

.message-bubble {
  max-width: min(80%, 28rem);
  padding: 0.5rem 0.65rem;
  border-radius: var(--p-border-radius-lg);
  color: var(--p-text-color);
  background: var(--p-content-hover-background, var(--p-content-background));
  border: 1px solid var(--p-content-border-color);
  white-space: pre-wrap;
  word-break: break-word;
}

.message-row.assistant .message-bubble {
  color: white;
  background: var(--accent);
  border-color: var(--accent);
}

.message-row.system .message-bubble {
  color: var(--p-text-color);
  background: var(--p-content-background);
  border-color: var(--p-red-500, #ef4444);
}

.chat-composer {
  flex: 0 0 auto;
  padding: 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
}
</style>

