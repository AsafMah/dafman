<script setup lang="ts">
// Dev-only playground -- gated behind `import.meta.env.DEV` in main.ts.
// Lets you see every ChatItem kind side-by-side, fire toasts, and inject
// synthetic session events without a real SDK turn. Tree-shaken out of
// production builds.
//
// Open with `?dev` in the URL during `bun run dev:hmr`.

import { computed, reactive, ref, watch } from "vue";
import Button from "primevue/button";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import type { ToastMessageOptions } from "primevue/toast";
import ChatWindow from "../components/ChatWindow.vue";
import type { SessionEventPayload } from "../ipc/types";
import { useToastStore } from "../stores/toastStore";

const toastStore = useToastStore();
const primeToast = useToast();

watch(
  () => toastStore.pending.length,
  (len) => {
    if (len === 0) return;
    for (const msg of toastStore.consume()) {
      primeToast.add({
        severity: msg.severity,
        summary: msg.summary,
        detail: msg.detail,
        life: msg.life,
      });
    }
  },
);

function closeToast({ message }: { message: ToastMessageOptions }) {
  primeToast.remove(message);
}

type ScriptEvent = Omit<SessionEventPayload, "sessionId">;
type Script = { label: string; events: ScriptEvent[] };

const SCRIPTS: Script[] = [
  {
    label: "Title change",
    events: [{ eventType: "session.title_changed", data: { title: "Refactor playground" } }],
  },
  {
    label: "Model change",
    events: [
      {
        eventType: "session.model_change",
        data: {
          previousModel: "claude-sonnet-4.5",
          newModel: "gpt-5.5",
          previousReasoningEffort: "medium",
          reasoningEffort: "high",
        },
      },
    ],
  },
  {
    label: "Usage info",
    events: [
      {
        eventType: "session.usage_info",
        data: { currentTokens: 12340, tokenLimit: 200000 },
      },
    ],
  },
  {
    label: "User -> reasoning -> assistant (full turn)",
    events: [
      { eventType: "assistant.turn_start", data: { turnId: "t1" } },
      { eventType: "assistant.intent", data: { intent: "Drafting the reply" } },
      {
        eventType: "assistant.reasoning_delta",
        data: { reasoningId: "r1", deltaContent: "Let me think about this carefully. " },
      },
      {
        eventType: "assistant.reasoning_delta",
        data: { reasoningId: "r1", deltaContent: "First I need to consider the context." },
      },
      {
        eventType: "assistant.reasoning",
        data: {
          reasoningId: "r1",
          content:
            "Let me think about this carefully. First I need to consider the context, then formulate a clear answer.",
        },
      },
      { eventType: "assistant.message_start", data: { messageId: "m1" } },
      {
        eventType: "assistant.message_delta",
        data: { messageId: "m1", deltaContent: "Hello! " },
      },
      {
        eventType: "assistant.message_delta",
        data: { messageId: "m1", deltaContent: "Here is your reply with **markdown** support coming soon." },
      },
      { eventType: "assistant.turn_end", data: { turnId: "t1" } },
      { eventType: "session.idle", data: {} },
    ],
  },
  {
    label: "Info callout",
    events: [
      {
        eventType: "session.info",
        data: {
          infoType: "mcp",
          message: "MCP server 'github' connected",
          tip: "Use /mcp list to inspect available tools",
        },
      },
    ],
  },
  {
    label: "Warning callout",
    events: [
      {
        eventType: "session.warning",
        data: { warningType: "context_window", message: "Approaching context limit (90%)" },
      },
    ],
  },
  {
    label: "Model call failure",
    events: [
      {
        eventType: "model.call_failure",
        data: {
          errorMessage: "Rate limit exceeded",
          statusCode: 429,
          source: "user-initiated",
          model: "gpt-5.5",
        },
      },
    ],
  },
  {
    label: "Truncation",
    events: [
      {
        eventType: "session.truncation",
        data: {
          messagesRemovedDuringTruncation: 12,
          performedBy: "BasicTruncator",
          postTruncationMessagesLength: 20,
          postTruncationTokensInMessages: 4000,
          preTruncationMessagesLength: 32,
          preTruncationTokensInMessages: 9000,
          tokenLimit: 8192,
          tokensRemovedDuringTruncation: 5000,
        },
      },
    ],
  },
  {
    label: "Session error",
    events: [
      { eventType: "session.error", data: { message: "Upstream connection reset" } },
    ],
  },
];

const PLAYGROUND_SESSION_ID = "playground";
const events = reactive<SessionEventPayload[]>([]);

function run(script: Script) {
  for (const e of script.events)
    events.push({ ...e, sessionId: PLAYGROUND_SESSION_ID });
}

function clearChat() {
  events.length = 0;
}

const customEventJson = ref('{"eventType":"assistant.intent","data":{"intent":"Custom intent"}}');
const customError = ref<string | null>(null);

function pushCustom() {
  customError.value = null;
  try {
    const parsed = JSON.parse(customEventJson.value) as Partial<SessionEventPayload>;
    if (!parsed.eventType) throw new Error("missing eventType");
    events.push({
      sessionId: PLAYGROUND_SESSION_ID,
      eventType: parsed.eventType,
      data: parsed.data ?? {},
    });
  } catch (err) {
    customError.value = err instanceof Error ? err.message : String(err);
  }
}

const toastSeverities = ["info", "success", "warn", "error"] as const;
function fireToast(severity: (typeof toastSeverities)[number]) {
  toastStore[severity](
    `${severity.toUpperCase()} toast`,
    `Fired at ${new Date().toLocaleTimeString()}`,
  );
}

const eventCount = computed(() => events.length);

function exitPlayground() {
  const url = new URL(window.location.href);
  url.searchParams.delete("dev");
  window.location.href = url.toString();
}
</script>

<template>
  <main class="playground">
    <Toast :on-click="closeToast" />
    <header class="playground-header">
      <div class="playground-title">
        <h1>Dev Playground</h1>
        <Button
          label="Back to app"
          icon="pi pi-arrow-left"
          size="small"
          severity="secondary"
          @click="exitPlayground"
        />
      </div>
      <p class="muted">
        Dev-only surface for exercising chat components in isolation. Reload to reset.
      </p>
    </header>

    <section class="panel">
      <h2>Scripted event sequences</h2>
      <div class="actions">
        <Button
          v-for="script in SCRIPTS"
          :key="script.label"
          :label="script.label"
          size="small"
          severity="secondary"
          @click="run(script)"
        />
        <Button label="Clear chat" icon="pi pi-trash" severity="danger" text size="small" @click="clearChat" />
      </div>
      <p class="muted small">Currently {{ eventCount }} events fed to the chat below.</p>
    </section>

    <section class="panel">
      <h2>Custom event</h2>
      <textarea v-model="customEventJson" rows="3" class="json-input" />
      <div class="actions">
        <Button label="Push event" icon="pi pi-send" size="small" @click="pushCustom" />
      </div>
      <p v-if="customError" class="error">{{ customError }}</p>
    </section>

    <section class="panel">
      <h2>Toast playground</h2>
      <div class="actions">
        <Button
          v-for="sev in toastSeverities"
          :key="sev"
          :label="`Fire ${sev}`"
          :severity="sev === 'error' ? 'danger' : sev === 'warn' ? 'warn' : sev === 'success' ? 'success' : 'info'"
          size="small"
          @click="fireToast(sev)"
        />
      </div>
    </section>

    <section class="panel chat-wrapper">
      <h2>Chat preview</h2>
      <div class="chat-frame">
        <ChatWindow
          session-id="playground-sess"
          accent="hsl(200, 80%, 52%)"
          :events="events"
          :model="null"
          :reasoning-effort="null"
          :mode="null"
          :approve-all="true"
          @close="clearChat"
        />
      </div>
    </section>
  </main>
</template>

<style scoped>
.playground {
  height: 100dvh;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: var(--p-surface-100, var(--p-content-background));
  color: var(--p-text-color);
}

.playground-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.playground-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.muted {
  color: var(--p-text-muted-color);
  margin: 0.25rem 0 0;
}

.small {
  font-size: 0.8rem;
}

.panel {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-md);
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.panel h2 {
  margin: 0;
  font-size: 1rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.json-input {
  font-family: var(--p-font-family-mono, monospace);
  font-size: 0.85rem;
  padding: 0.5rem;
  background: var(--p-surface-100, var(--p-content-background));
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-sm);
  resize: vertical;
}

.error {
  color: var(--p-red-500, #ef4444);
  margin: 0;
  font-size: 0.85rem;
}

.chat-wrapper .chat-frame {
  /* Big enough to feel like a real chat surface in dev. The page itself
   * scrolls, so we can be generous. Falls back to 600px on tiny windows. */
  height: max(600px, 75dvh);
}
</style>
