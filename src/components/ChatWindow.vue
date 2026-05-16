<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import Avatar from "primevue/avatar";
import Button from "primevue/button";
import InputGroup from "primevue/inputgroup";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";

type ChatMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  text: string;
};

const { sessionId } = defineProps<{
  sessionId: string;
}>();

const draft = ref("");
const messages = ref<ChatMessage[]>([]);
const messagesEl = ref<HTMLElement | null>(null);
const isSending = ref(false);
let nextId = 1;

const canSend = computed(
  () => draft.value.trim().length > 0 && !isSending.value,
);

async function scrollToBottom() {
  await nextTick();
  const el = messagesEl.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

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
    const reply = await invoke<string>("send_message", {
      sessionId,
      text,
    });
    messages.value.push({
      id: nextId++,
      role: "assistant",
      text: reply || "(no response)",
    });
  } catch (error) {
    messages.value.push({
      id: nextId++,
      role: "system",
      text: `Error: ${String(error)}`,
    });
  } finally {
    isSending.value = false;
    await scrollToBottom();
  }
}
</script>

<template>
  <section class="chat-tile">
    <header class="chat-header">
      <div class="chat-title">
        <Avatar label="AI" shape="circle" size="small" />
        <span>Assistant Chat</span>
      </div>
      <Tag :value="sessionId" severity="secondary" />
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
        <div class="message-bubble">{{ message.text }}</div>
      </div>

      <div v-if="isSending" class="message-row assistant">
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
  flex: 1 1 0;
  min-height: 0;
  margin: 1rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-xl);
}

.chat-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.chat-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.chat-messages {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.empty-message {
  margin: 0;
  color: var(--p-text-muted-color);
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.message-row.assistant {
  flex-direction: row-reverse;
}

.message-bubble {
  max-width: min(72%, 40rem);
  padding: 0.625rem 0.75rem;
  border-radius: var(--p-border-radius-lg);
  color: var(--p-text-color);
  background: var(--p-content-hover-background, var(--p-content-background));
  border: 1px solid var(--p-content-border-color);
  white-space: pre-wrap;
}

.message-row.assistant .message-bubble {
  color: var(--p-primary-contrast-color);
  background: var(--p-primary-color);
  border-color: var(--p-primary-color);
}

.message-row.system .message-bubble {
  color: var(--p-text-color);
  background: var(--p-content-background);
  border-color: var(--p-red-500, #ef4444);
}

.chat-composer {
  flex: 0 0 auto;
  padding: 0.75rem;
  border-top: 1px solid var(--p-content-border-color);
}
</style>
