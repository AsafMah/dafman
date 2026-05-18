<script setup lang="ts">
// Dev playground — opened as a normal dockview body panel via the
// activity-bar wrench. Gated behind `import.meta.env.DEV` in main.ts
// so prod builds tree-shake the module away.
//
// Lets you see every ChatItem kind side-by-side, fire toasts, and
// inject synthetic session events without a real SDK turn. Uses the
// surrounding App.vue's <Toast> service so we don't need our own
// here.

import { computed, reactive, ref } from "vue";
import Button from "primevue/button";
import ChatWindow from "../components/ChatWindow.vue";
import type { SessionEventPayload } from "../ipc/types";
import { useToastStore } from "../stores/toastStore";

const toastStore = useToastStore();

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
  {
    label: "Tool call: shell (success)",
    events: [
      { eventType: "assistant.turn_start", data: { turnId: "t-tool" } },
      {
        eventType: "tool.execution_start",
        data: {
          toolCallId: "call-shell-1",
          toolName: "shell",
          arguments: { command: "ls -la" },
        },
      },
      {
        eventType: "tool.execution_progress",
        data: { toolCallId: "call-shell-1", progressMessage: "Spawning shell…" },
      },
      {
        eventType: "tool.execution_partial_result",
        data: { toolCallId: "call-shell-1", partialOutput: "total 24\n" },
      },
      {
        eventType: "tool.execution_partial_result",
        data: {
          toolCallId: "call-shell-1",
          partialOutput: "drwxr-xr-x  2 user user 4096 May 17 16:00 src\n",
        },
      },
      {
        eventType: "tool.execution_complete",
        data: {
          toolCallId: "call-shell-1",
          success: true,
          result: {
            content: "ok",
            detailedContent:
              "total 24\ndrwxr-xr-x  2 user user 4096 May 17 16:00 src\n-rw-r--r--  1 user user  234 May 17 15:58 README.md\n",
          },
        },
      },
      { eventType: "assistant.turn_end", data: { turnId: "t-tool" } },
    ],
  },
  {
    label: "Tool call: write (failure)",
    events: [
      {
        eventType: "tool.execution_start",
        data: {
          toolCallId: "call-write-1",
          toolName: "write",
          arguments: { path: "/etc/hosts", content: "127.0.0.1 evil.example\n" },
        },
      },
      {
        eventType: "tool.execution_complete",
        data: {
          toolCallId: "call-write-1",
          success: false,
          error: { code: "EACCES", message: "permission denied: /etc/hosts" },
        },
      },
    ],
  },
  {
    label: "Tool call: MCP (github · search_issues)",
    events: [
      {
        eventType: "tool.execution_start",
        data: {
          toolCallId: "call-mcp-1",
          toolName: "github_search_issues",
          mcpServerName: "github",
          mcpToolName: "search_issues",
          arguments: { query: "is:open is:issue assignee:@me" },
        },
        agentId: "sub-agent-7",
      },
      {
        eventType: "tool.execution_complete",
        data: {
          toolCallId: "call-mcp-1",
          success: true,
          result: { content: "Found 3 issues.", detailedContent: "- #42 fix flake\n- #51 docs\n- #58 perf\n" },
        },
        agentId: "sub-agent-7",
      },
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

/// Self-contained echo: the playground chat is not connected to the SDK.
/// `ChatWindow` already appends the user's message locally; here we
/// synthesize an assistant turn that echoes the text back so the
/// reducer, streaming animation, and idle handling all exercise without
/// needing a real session. `sleep` lets you observe the streaming feel.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function echoSend(text: string): Promise<void> {
  const turnId = `echo-${Date.now()}`;
  const messageId = `echo-msg-${Date.now()}`;
  const push = (e: ScriptEvent) =>
    events.push({ ...e, sessionId: PLAYGROUND_SESSION_ID });

  push({ eventType: "assistant.turn_start", data: { turnId } });
  push({ eventType: "assistant.message_start", data: { messageId } });

  const reply = `echo: ${text}`;
  // Stream a few characters at a time so the streaming-delta animation
  // is observable in the playground.
  const chunkSize = 4;
  for (let i = 0; i < reply.length; i += chunkSize) {
    push({
      eventType: "assistant.message_delta",
      data: { messageId, deltaContent: reply.slice(i, i + chunkSize) },
    });
    await sleep(35);
  }

  push({ eventType: "assistant.turn_end", data: { turnId } });
  push({ eventType: "session.idle", data: {} });
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
</script>

<template>
  <div class="playground">
    <header class="playground-header">
      <div class="playground-title">
        <h1>Dev Playground</h1>
      </div>
      <p class="muted">
        Dev-only surface for exercising chat components in isolation. Close the tab to reset.
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
          reasoning-visibility-override="default"
          default-send-mode="steer"
          :send-handler="echoSend"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.playground {
  /* Fills the dockview panel — width: 100%; height: 100% so the
   * playground scrolls within the panel rather than the page. */
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  /* Theme-aware background — color-mix with --p-content-background so
   * it shifts cleanly between light + dark mode. */
  background: color-mix(in srgb, var(--p-text-color) 4%, var(--p-content-background));
  color: var(--p-text-color);
  box-sizing: border-box;
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
  /* Don't collapse — the inner chat-wrapper has a fixed height that
   * needs to flow normally inside this column. */
  flex: 0 0 auto;
}

.panel h2 {
  margin: 0;
  font-size: 1rem;
  color: var(--p-text-color);
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
  /* Theme-aware code-block background — auto-flips with theme. */
  background: color-mix(in srgb, var(--p-text-color) 8%, var(--p-content-background));
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
  /* Big enough to feel like a real chat surface. The panel itself
   * scrolls (overflow-y: auto), so we can be generous. */
  height: max(600px, 60vh);
}
</style>
