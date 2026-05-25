<script setup lang="ts">
// Dev playground — opened as a normal dockview body panel via the
// activity-bar wrench. Gated behind `import.meta.env.DEV` in main.ts
// so prod builds tree-shake the module away.
//
// Lets you see every ChatItem kind side-by-side, fire toasts, and
// inject synthetic session events without a real SDK turn. Uses the
// surrounding App.vue's <Toast> service so we don't need our own
// here.

import { computed, reactive, ref } from 'vue';
import Button from 'primevue/button';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import ChatWindow from '../components/chat/ChatWindow.vue';
import type {
  ElicitationRequestData,
  PermissionRequestData,
  SessionEventPayload,
  UserInputRequestData,
} from '../ipc/types';
import { accentForIndex } from '../lib/color';
import { useSessionsStore, type SessionRecord } from '../stores/chat/sessionsStore';
import { useToastStore } from '../stores/app/toastStore';
import { toErrorMessage } from '../lib/errorMessage';

const toastStore = useToastStore();
const sessionsStore = useSessionsStore();

type ScriptEvent = Omit<SessionEventPayload, 'sessionId'>;
type Script = { label: string; events: ScriptEvent[] };
/// Grouping label drives which tab a script lives under. Keep flat
/// so the running scripts array stays a single source of truth.
type ScriptGroup = 'session' | 'tools' | 'callouts' | 'markdown';

/// Maps a script label prefix or substring to its tab group. Defined
/// here (not on each Script object) so the SCRIPTS array stays terse;
/// new scripts just need to use one of the documented label prefixes.
function groupForLabel(label: string): ScriptGroup {
  if (label.startsWith('Tool: ') || label.startsWith('Tools: ')) return 'tools';
  if (label.startsWith('Markdown')) return 'markdown';
  if (
    label.includes('callout') ||
    label.includes('failure') ||
    label.includes('Truncation') ||
    label.includes('error') ||
    label.includes('Error') ||
    label.includes('Compaction')
  ) {
    return 'callouts';
  }
  return 'session';
}

const SCRIPTS: Script[] = [
  {
    label: 'Title change',
    events: [{ eventType: 'session.title_changed', data: { title: 'Refactor playground' } }],
  },
  {
    label: 'Model change',
    events: [
      {
        eventType: 'session.model_change',
        data: {
          previousModel: 'claude-sonnet-4.5',
          newModel: 'gpt-5.5',
          previousReasoningEffort: 'medium',
          reasoningEffort: 'high',
        },
      },
    ],
  },
  {
    label: 'Usage info',
    events: [
      {
        eventType: 'session.usage_info',
        data: { currentTokens: 12340, tokenLimit: 200000 },
      },
    ],
  },
  {
    label: 'User -> reasoning -> assistant (full turn)',
    events: [
      { eventType: 'assistant.turn_start', data: { turnId: 't1' } },
      { eventType: 'assistant.intent', data: { intent: 'Drafting the reply' } },
      {
        eventType: 'assistant.reasoning_delta',
        data: { reasoningId: 'r1', deltaContent: 'Let me think about this carefully. ' },
      },
      {
        eventType: 'assistant.reasoning_delta',
        data: { reasoningId: 'r1', deltaContent: 'First I need to consider the context.' },
      },
      {
        eventType: 'assistant.reasoning',
        data: {
          reasoningId: 'r1',
          content:
            'Let me think about this carefully. First I need to consider the context, then formulate a clear answer.',
        },
      },
      { eventType: 'assistant.message_start', data: { messageId: 'm1' } },
      {
        eventType: 'assistant.message_delta',
        data: { messageId: 'm1', deltaContent: 'Hello! ' },
      },
      {
        eventType: 'assistant.message_delta',
        data: {
          messageId: 'm1',
          deltaContent: 'Here is your reply with **markdown** support coming soon.',
        },
      },
      { eventType: 'assistant.turn_end', data: { turnId: 't1' } },
      { eventType: 'session.idle', data: {} },
    ],
  },
  {
    label: 'Info callout',
    events: [
      {
        eventType: 'session.info',
        data: {
          infoType: 'mcp',
          message: "MCP server 'github' connected",
          tip: 'Use /mcp list to inspect available tools',
        },
      },
    ],
  },
  {
    label: 'Warning callout',
    events: [
      {
        eventType: 'session.warning',
        data: { warningType: 'context_window', message: 'Approaching context limit (90%)' },
      },
    ],
  },
  {
    label: 'Model call failure',
    events: [
      {
        eventType: 'model.call_failure',
        data: {
          errorMessage: 'Rate limit exceeded',
          statusCode: 429,
          source: 'user-initiated',
          model: 'gpt-5.5',
        },
      },
    ],
  },
  {
    label: 'Truncation',
    events: [
      {
        eventType: 'session.truncation',
        data: {
          messagesRemovedDuringTruncation: 12,
          performedBy: 'BasicTruncator',
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
    label: 'Session error',
    events: [{ eventType: 'session.error', data: { message: 'Upstream connection reset' } }],
  },
  {
    label: 'Tool: shell (success)',
    events: [
      { eventType: 'assistant.turn_start', data: { turnId: 't-tool' } },
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-shell-1',
          toolName: 'shell',
          arguments: { command: 'ls -la' },
        },
      },
      {
        eventType: 'tool.execution_progress',
        data: { toolCallId: 'call-shell-1', progressMessage: 'Spawning shell…' },
      },
      {
        eventType: 'tool.execution_partial_result',
        data: { toolCallId: 'call-shell-1', partialOutput: 'total 24\n' },
      },
      {
        eventType: 'tool.execution_partial_result',
        data: {
          toolCallId: 'call-shell-1',
          partialOutput: 'drwxr-xr-x  2 user user 4096 May 17 16:00 src\n',
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-shell-1',
          success: true,
          result: {
            content: 'ok',
            detailedContent:
              'total 24\ndrwxr-xr-x  2 user user 4096 May 17 16:00 src\n-rw-r--r--  1 user user  234 May 17 15:58 README.md\n',
          },
        },
      },
      { eventType: 'assistant.turn_end', data: { turnId: 't-tool' } },
    ],
  },
  {
    label: 'Tool: write (failure)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-write-1',
          toolName: 'write',
          arguments: { path: '/etc/hosts', content: '127.0.0.1 evil.example\n' },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-write-1',
          success: false,
          error: { code: 'EACCES', message: 'permission denied: /etc/hosts' },
        },
      },
    ],
  },
  {
    label: 'Tool: MCP (github · search_issues)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-mcp-1',
          toolName: 'github_search_issues',
          mcpServerName: 'github',
          mcpToolName: 'search_issues',
          arguments: { query: 'is:open is:issue assignee:@me' },
        },
        agentId: 'sub-agent-7',
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-mcp-1',
          success: true,
          result: {
            content: 'Found 3 issues.',
            detailedContent: '- #42 fix flake\n- #51 docs\n- #58 perf\n',
          },
        },
        agentId: 'sub-agent-7',
      },
    ],
  },
  {
    label: 'Tool: MCP (structured JSON result)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-mcp-struct-1',
          toolName: 'github_get_issue',
          mcpServerName: 'github',
          mcpToolName: 'get_issue',
          arguments: { owner: 'AsafMah', repo: 'dafman', number: 42 },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-mcp-struct-1',
          success: true,
          result: {
            content: JSON.stringify(
              {
                number: 42,
                title: 'fix(chat): scrollback regression',
                state: 'open',
                assignees: ['asafmah', 'octocat'],
                labels: ['bug', 'regression', 'p1'],
                comments: 7,
                createdAt: '2026-05-12T10:14:00Z',
                metrics: { reactions: { thumbsUp: 4, heart: 1 }, watchers: 12 },
                body: 'Tracking down a scroll jump that occurs when streaming a long\nresponse. Repro is in the comments.',
              },
              null,
              2,
            ),
          },
        },
      },
    ],
  },
  // ----- Additional tool variants -----------------------------------
  {
    label: 'Tool: read (file contents)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-read-1',
          toolName: 'read',
          arguments: { path: 'src/main.ts' },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-read-1',
          success: true,
          result: {
            content: 'ok',
            detailedContent:
              "import { createApp } from 'vue';\nimport { createPinia } from 'pinia';\nimport App from './App.vue';\n\nconst app = createApp(App);\napp.use(createPinia());\napp.mount('#app');\n",
          },
        },
      },
    ],
  },
  {
    label: 'Tool: edit (str_replace)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-edit-1',
          toolName: 'edit',
          arguments: {
            path: 'src/lib/markdown.ts',
            oldText:
              'const md = new MarkdownIt({\n  html: false,\n  linkify: true,\n  breaks: false,\n});\n\nexport function renderMarkdown(text: string) {\n  return md.render(text);\n}',
            newText:
              'const md = new MarkdownIt({\n  html: true,\n  linkify: true,\n  breaks: true,\n  typographer: true,\n});\n\nexport function renderMarkdown(text: string) {\n  const html = md.render(text);\n  return DOMPurify.sanitize(html);\n}',
          },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-edit-1',
          success: true,
          result: { content: 'Replaced 1 occurrence in src/lib/markdown.ts' },
        },
      },
    ],
  },
  {
    label: 'Tool: apply_patch (multi-file diff)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-patch-1',
          toolName: 'apply_patch',
          arguments: {
            input:
              '*** Begin Patch\n' +
              '*** Update File: src/App.vue\n' +
              '@@\n' +
              ' <script setup lang="ts">\n' +
              '-const isDark = false;\n' +
              '+const isDark = true;\n' +
              ' const accent = computed(() => accentFor(sessionId));\n' +
              '*** Add File: src/lib/theme.ts\n' +
              '+export function isDarkMode(): boolean {\n' +
              '+  return window.matchMedia("(prefers-color-scheme: dark)").matches;\n' +
              '+}\n' +
              '*** Update File: src/main.ts\n' +
              '@@\n' +
              '-app.mount("#app");\n' +
              '+app.use(PrimeVue).mount("#app");\n' +
              '*** Delete File: src/lib/legacyTheme.ts\n' +
              '*** End Patch\n',
          },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-patch-1',
          success: true,
          result: { content: 'Patched 4 files' },
        },
      },
    ],
  },
  {
    label: 'Tool: grep (matches)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-grep-1',
          toolName: 'grep',
          arguments: { pattern: 'useSessionsStore', path: 'src/' },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-grep-1',
          success: true,
          result: {
            content:
              'src/App.vue:12: const sessionsStore = useSessionsStore();\n' +
              'src/components/ChatTab.vue:34: const sessionsStore = useSessionsStore();\n' +
              'src/components/ChatTab.vue:88:   const events = useSessionsStore().events;\n' +
              'src/components/SessionsManager.vue:21: const sessionsStore = useSessionsStore();\n' +
              'src/dev/Playground.vue:144: const sessionsStore = useSessionsStore();\n' +
              'src/stores/layoutStore.ts:67: const sessionsStore = useSessionsStore();\n',
          },
        },
      },
    ],
  },
  {
    label: 'Tool: glob (file pattern)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-glob-1',
          toolName: 'glob',
          arguments: { pattern: 'src/**/*.test.ts' },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-glob-1',
          success: true,
          result: {
            content:
              'src/lib/__tests__/chatEvents.test.ts\n' +
              'src/lib/__tests__/markdown.test.ts\n' +
              'src/lib/__tests__/diff.test.ts\n' +
              'src/lib/__tests__/palette.test.ts\n' +
              'src/stores/__tests__/sessionsStore.restore.test.ts\n' +
              'src/stores/__tests__/layoutStore.addPanel.test.ts\n' +
              'src/components/__tests__/CommandPalette.test.ts\n' +
              'src/components/__tests__/JsonSchemaForm.test.ts\n' +
              'src/components/__tests__/JsonValueView.test.ts',
          },
        },
      },
    ],
  },
  {
    label: 'Tool: view (file with range)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-view-1',
          toolName: 'view',
          arguments: { path: 'package.json', view_range: [1, 15] },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-view-1',
          success: true,
          result: {
            content:
              '{\n  "name": "dafman",\n  "version": "0.1.0",\n  "type": "module",\n  "scripts": {\n    "dev": "electrobun dev --watch",\n    "build": "vite build && electrobun build"\n  }\n}',
          },
        },
      },
    ],
  },
  {
    label: 'Tool: fetch (HTTP JSON)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-fetch-1',
          toolName: 'fetch',
          arguments: { url: 'https://api.github.com/repos/AsafMah/dafman' },
        },
      },
      {
        eventType: 'tool.execution_progress',
        data: { toolCallId: 'call-fetch-1', progressMessage: 'GET 200 OK' },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-fetch-1',
          success: true,
          result: {
            content:
              '{\n  "name": "dafman",\n  "full_name": "AsafMah/dafman",\n  "stargazers_count": 0,\n  "language": "TypeScript",\n  "open_issues": 3\n}',
          },
        },
      },
    ],
  },
  {
    label: 'Tool: todo_write (task list)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-todo-1',
          toolName: 'todo_write',
          arguments: {
            todos: [
              { id: '1', title: 'Wire ToolDetails', status: 'in_progress' },
              { id: '2', title: 'JSON Schema form renderer', status: 'pending' },
              { id: '3', title: 'Result viewer', status: 'pending' },
            ],
          },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: { toolCallId: 'call-todo-1', success: true, result: { content: 'Saved 3 todos' } },
      },
    ],
  },
  {
    label: 'Tool: shell (large output, streaming)',
    events: [
      { eventType: 'assistant.turn_start', data: { turnId: 't-shell-big' } },
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-shell-big',
          toolName: 'shell',
          arguments: { command: "find . -name '*.ts' | head -50" },
        },
      },
      ...Array.from({ length: 12 }, (_, i) => ({
        eventType: 'tool.execution_partial_result',
        data: {
          toolCallId: 'call-shell-big',
          partialOutput: `./src/file-${i + 1}.ts\n`,
        },
      })),
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-shell-big',
          success: true,
          result: { content: '12 files listed' },
        },
      },
      { eventType: 'assistant.turn_end', data: { turnId: 't-shell-big' } },
    ],
  },
  {
    label: 'Tool: shell (error exit)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-shell-fail',
          toolName: 'shell',
          arguments: { command: 'cat /nonexistent.txt' },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-shell-fail',
          success: false,
          error: { code: 'ENOENT', message: 'cat: /nonexistent.txt: No such file or directory' },
        },
      },
    ],
  },
  {
    label: 'Tools: 2 concurrent (grep + read)',
    events: [
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'concur-grep',
          toolName: 'grep',
          arguments: { pattern: 'TODO', path: 'src/' },
        },
      },
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'concur-read',
          toolName: 'read',
          arguments: { path: 'README.md' },
        },
      },
      {
        eventType: 'tool.execution_partial_result',
        data: { toolCallId: 'concur-read', partialOutput: '# dafman\n\n' },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'concur-grep',
          success: true,
          result: { content: 'src/App.vue:42: // TODO: rename\nsrc/lib/x.ts:9: // TODO: fix' },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'concur-read',
          success: true,
          result: {
            content:
              '# dafman\n\nDesktop replacement for the Copilot CLI.\n\n## Setup\n\nbun install && bun run dev\n',
          },
        },
      },
    ],
  },
  // ----- Markdown / callouts ----------------------------------------
  {
    label: 'Markdown: feature showcase',
    events: [
      { eventType: 'assistant.message_start', data: { messageId: 'm-md' } },
      {
        eventType: 'assistant.message',
        data: {
          messageId: 'm-md',
          content: [
            '# Markdown feature showcase',
            '',
            'Inline **bold**, _italic_, ~~strikethrough~~, ==highlight==, `inline code`,',
            'math like $E = mc^2$, and an autolinked URL: https://github.com/AsafMah/dafman.',
            '',
            '## Lists',
            '- bullet one',
            '- bullet two',
            '  - nested',
            '1. ordered',
            '2. second',
            '',
            '## Task list',
            '- [x] ship inline pending card',
            '- [x] bespoke permission details',
            '- [ ] tool execution details',
            '- [ ] JSON schema form',
            '',
            '## Table',
            '| Kind | Status | Notes |',
            '| --- | --- | --- |',
            '| shell | ✅ | command + cwd chip |',
            '| write | ✅ | path + preview |',
            '| mcp | ⏳ | server + tool chips |',
            '',
            '## Code',
            '```ts',
            'function greet(name: string): string {',
            '  return `Hello, ${name}!`;',
            '}',
            '```',
            '',
            '## Math (block)',
            '$$\\int_a^b f(x)\\,dx = F(b) - F(a)$$',
            '',
            '## Footnotes',
            'Statement with a footnote.[^1]',
            '',
            '[^1]: Footnote body. Backref clickable.',
            '',
            '## Definition list',
            'Term 1',
            ': First definition.',
            '',
            'Term 2',
            ': Second definition with `code`.',
            '',
            '## Emoji',
            ':smile: :rocket: :bug:',
            '',
            '## Collapsible',
            '<details><summary>Click to expand</summary>',
            '',
            'Hidden content with **markdown** inside.',
            '</details>',
            '',
            '## Inline tags',
            'Press <kbd>Ctrl</kbd>+<kbd>K</kbd> for the command palette.',
            'Use H<sub>2</sub>O and x<sup>2</sup>. Inline <mark>highlight</mark>.',
            '',
            '## Quote',
            '> Markdown should render every common extension, not just headings and lists.',
            '',
            '---',
            '',
            'End of showcase.',
          ].join('\n'),
        },
      },
    ],
  },
  {
    label: 'Compaction notice',
    events: [
      {
        eventType: 'session.compaction',
        data: {
          performedBy: 'auto',
          messagesRemoved: 18,
          tokensFreed: 4200,
        },
      },
    ],
  },
  {
    label: 'System: info message',
    events: [
      {
        eventType: 'session.info',
        data: { infoType: 'tip', message: 'Tip: Ctrl+K opens the command palette.' },
      },
    ],
  },
  {
    label: 'System: warning message',
    events: [
      {
        eventType: 'session.warning',
        data: { warningType: 'context_window', message: 'Approaching context limit (90%).' },
      },
    ],
  },
  {
    label: 'Full turn with permission + tool (real flow)',
    events: [
      { eventType: 'assistant.turn_start', data: { turnId: 't-flow' } },
      {
        eventType: 'assistant.intent',
        data: { intent: 'Checking project structure' },
      },
      {
        eventType: 'tool.user_requested',
        data: {
          toolCallId: 'call-flow-1',
          toolName: 'shell',
          arguments: { command: 'ls -la src' },
        },
      },
      {
        eventType: 'tool.execution_start',
        data: {
          toolCallId: 'call-flow-1',
          toolName: 'shell',
          arguments: { command: 'ls -la src' },
        },
      },
      {
        eventType: 'tool.execution_complete',
        data: {
          toolCallId: 'call-flow-1',
          success: true,
          result: {
            content: 'components/ dev/ ipc/ lexical/ lib/ stores/ App.vue main.ts style.css',
          },
        },
      },
      { eventType: 'assistant.message_start', data: { messageId: 'm-flow' } },
      {
        eventType: 'assistant.message',
        data: {
          messageId: 'm-flow',
          content:
            'Your `src/` has the expected layout: `components/`, `stores/`, `lib/`, `ipc/`, `lexical/`, plus the entry files. Want me to dig into any of them?',
        },
      },
      { eventType: 'assistant.turn_end', data: { turnId: 't-flow' } },
      { eventType: 'session.idle', data: {} },
    ],
  },
];

// All scripted events AND pending-request injections share the
// synthetic session record below so the inline PendingRequestCard
// can be exercised end-to-end without a real SDK / bun handler.
// `respondToPending(sessionId = PLAYGROUND_PENDING_SESSION_ID)` is
// short-circuited inside the store (skips the RPC) but still
// mutates this record's `events` array, so the reducer in the
// playground's ChatWindow removes the card on response.
const PLAYGROUND_PENDING_SESSION_ID = 'playground-pending';

function ensurePlaygroundSession(): SessionRecord {
  const existing = sessionsStore.sessions.find((s) => s.id === PLAYGROUND_PENDING_SESSION_ID);
  if (existing) return existing;
  const fresh: SessionRecord = reactive({
    id: PLAYGROUND_PENDING_SESSION_ID,
    accent: accentForIndex(99),
    events: [],
    droppedEventCount: 0,
    model: null,
    reasoningEffort: null,
    title: 'Playground',
    mode: null,
    approveAll: false,
    reasoningVisibilityOverride: 'default' as const,
    workingDirectory: null,
    defaultSendMode: 'steer' as const,
    pendingRequests: [],
    unseenTurns: 0,
    isThinking: false,
    sawTurnBoundary: false,
    currentAgent: null,
    tasksRefreshCounter: 0,
    planRefreshCounter: 0,
    touchedFiles: [],
    commandsRun: 0,
    _toastedOauthRequests: new Set<string>(),
    _artifactToolCallIds: new Set<string>(),
  });
  sessionsStore.sessions.push(fresh);
  return fresh;
}

const playgroundRecord = ensurePlaygroundSession();
const events = playgroundRecord.events;
/// Bumped to force ChatWindow to remount on Clear. ChatWindow's
/// internal reducer tracks `processedEvents` separately from the
/// underlying array, so a `length = 0` mutation is invisible to it
/// (the watcher guards against re-processing). Real sessions never
/// shrink the events array, so this is a dev-only escape hatch.
const chatKey = ref(0);

function run(script: Script) {
  for (const e of script.events) events.push({ ...e, sessionId: PLAYGROUND_PENDING_SESSION_ID });
}

function clearChat() {
  events.length = 0;
  chatKey.value++;
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
  const push = (e: ScriptEvent) => events.push({ ...e, sessionId: PLAYGROUND_PENDING_SESSION_ID });

  push({ eventType: 'assistant.turn_start', data: { turnId } });
  push({ eventType: 'assistant.message_start', data: { messageId } });

  const reply = `echo: ${text}`;
  // Stream a few characters at a time so the streaming-delta animation
  // is observable in the playground.
  const chunkSize = 4;
  for (let i = 0; i < reply.length; i += chunkSize) {
    push({
      eventType: 'assistant.message_delta',
      data: { messageId, deltaContent: reply.slice(i, i + chunkSize) },
    });
    await sleep(35);
  }

  push({ eventType: 'assistant.turn_end', data: { turnId } });
  push({ eventType: 'session.idle', data: {} });
}

const customEventJson = ref('{"eventType":"assistant.intent","data":{"intent":"Custom intent"}}');
const customError = ref<string | null>(null);

function pushCustom() {
  customError.value = null;
  try {
    const parsed = JSON.parse(customEventJson.value) as Partial<SessionEventPayload>;
    if (!parsed.eventType) throw new Error('missing eventType');
    events.push({
      sessionId: PLAYGROUND_PENDING_SESSION_ID,
      eventType: parsed.eventType,
      data: parsed.data ?? {},
    });
  } catch (err) {
    customError.value = toErrorMessage(err);
  }
}

/// Stress test: synthesise a large number of assistant turns so we
/// can observe how the ring-buffer trim + reducer hold up. Synchronous
/// push so the events fire in a single tick — the reducer runs in a
/// rAF coalescer, so the UI freeze is brief but real.
function pushManyEvents(count: number): void {
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const turnId = `stress-${i}`;
    const messageId = `stress-msg-${i}`;
    events.push({
      sessionId: PLAYGROUND_PENDING_SESSION_ID,
      eventType: 'assistant.turn_start',
      data: { turnId },
    });
    events.push({
      sessionId: PLAYGROUND_PENDING_SESSION_ID,
      eventType: 'assistant.message',
      data: { messageId, content: `stress message ${i}` },
    });
    events.push({
      sessionId: PLAYGROUND_PENDING_SESSION_ID,
      eventType: 'assistant.turn_end',
      data: { turnId },
    });
  }
  const ms = performance.now() - start;
  toastStore.info(`Pushed ${count * 3} events`, `${ms.toFixed(0)} ms enqueue`);
}

const toastSeverities = ['info', 'success', 'warn', 'error'] as const;
function fireToast(severity: (typeof toastSeverities)[number]) {
  toastStore[severity](
    `${severity.toUpperCase()} toast`,
    `Fired at ${new Date().toLocaleTimeString()}`,
  );
}

// ----- Pending-request injection ----------------------------------
//
// Pushes synthetic `dafman.pending_request` events into the
// playground record's `events` array — the same channel the
// production sessionsStore uses when bun's `pendingRequest` push
// arrives. The reducer then creates an inline card item; clicking
// a card button calls `sessionsStore.respondToPending(sessionId =
// PLAYGROUND_PENDING_SESSION_ID)` which is short-circuited by the
// store (skips the RPC, just mutates the record), so the response
// pushes a `dafman.pending_response` back into the same events
// array and the reducer removes the card. End-to-end, no bun
// handler involved.

let pendingRequestCounter = 0;

function nextRequestId(): string {
  pendingRequestCounter += 1;
  return `playground-${pendingRequestCounter}-${Date.now()}`;
}

function injectPending(
  kind: 'permission' | 'userInput' | 'elicitation',
  request: PermissionRequestData | UserInputRequestData | ElicitationRequestData,
): void {
  const requestId = nextRequestId();
  events.push({
    sessionId: PLAYGROUND_PENDING_SESSION_ID,
    eventType: 'dafman.pending_request',
    data: {
      sessionId: PLAYGROUND_PENDING_SESSION_ID,
      requestId,
      kind,
      request,
    },
  });
}

function injectPermission(
  kind: PermissionRequestData['kind'],
  summary: string,
  raw: Record<string, unknown>,
) {
  injectPending('permission', { kind, summary, raw });
}

function injectUserInput(request: UserInputRequestData) {
  injectPending('userInput', request);
}

function injectElicitation(request: ElicitationRequestData) {
  injectPending('elicitation', request);
}

function clearPlaygroundQueue() {
  // Clear by responding-cancel via the store so the reducer pushes
  // pending_response events; that keeps the local events array in
  // sync without us hand-removing entries by index.
  const queue = [...playgroundRecord.pendingRequests];
  for (const p of queue) {
    const base = {
      sessionId: PLAYGROUND_PENDING_SESSION_ID,
      requestId: p.requestId,
    };
    if (p.kind === 'permission') {
      void sessionsStore.respondToPending({
        ...base,
        response: { kind: 'permission', decision: 'reject' },
      });
    } else if (p.kind === 'userInput') {
      void sessionsStore.respondToPending({
        ...base,
        response: { kind: 'userInput', answer: '', wasFreeform: false },
      });
    } else {
      void sessionsStore.respondToPending({
        ...base,
        response: { kind: 'elicitation', action: 'cancel' },
      });
    }
  }
}

function injectShellPermission() {
  injectPermission('shell', 'Run a shell command', {
    command: 'rm -rf /tmp/cache && echo done',
    cwd: '/home/user',
  });
}

function injectWritePermission() {
  injectPermission('write', 'Modify src/components/NewWidget.vue', {
    path: 'src/components/NewWidget.vue',
    contentPreview:
      '<template>\n  <div class="widget">\n    <h2>{{ title }}</h2>\n  </div>\n</template>\n\n<' +
      'script setup lang="ts">\nconst title = \'New widget\';\n</' +
      'script>\n',
  });
}

function injectReadPermission() {
  injectPermission('read', 'Read package.json', { path: 'package.json' });
}

function injectUrlPermission() {
  injectPermission('url', 'Open https://api.github.com/...', {
    url: 'https://api.github.com/repos/AsafMah/dafman/issues?state=open&assignee=me',
  });
}

function injectMcpPermission() {
  injectPermission('mcp', 'Call github / create_issue', {
    serverName: 'github',
    toolName: 'create_issue',
    arguments: {
      repo: 'AsafMah/dafman',
      title: 'Bug: thing broken',
      body: 'Steps to reproduce...',
    },
  });
}

function injectMemoryPermission() {
  injectPermission('memory', 'Save to memory', {
    content:
      'User prefers TypeScript with strict mode and 2-space indentation. Composer should default to plain text mode on Linux.',
  });
}

function injectUserInputFreeform() {
  injectUserInput({
    question: 'What should I name the new component?',
    allowFreeform: true,
  });
}

function injectUserInputChoices() {
  injectUserInput({
    question: 'Which testing framework should I use?',
    choices: ['Vitest', 'Bun test', 'Mocha', 'Jest'],
    allowFreeform: false,
  });
}

function injectUserInputChoicesPlusFreeform() {
  injectUserInput({
    question: 'Pick a deployment target (or type a custom name).',
    choices: ['staging', 'production', 'preview'],
    allowFreeform: true,
  });
}

function injectElicitationUrl() {
  injectElicitation({
    message: 'Authenticate with GitHub to continue.',
    mode: 'url',
    elicitationSource: 'mcp/github',
    url: 'https://github.com/login/oauth/authorize?client_id=demo',
  });
}

function injectElicitationForm() {
  injectElicitation({
    message: 'Configure the database connection.',
    mode: 'form',
    elicitationSource: 'mcp/database',
    requestedSchema: {
      type: 'object',
      description: 'Connection settings for the dev database.',
      properties: {
        host: {
          type: 'string',
          title: 'Host',
          description: 'Hostname or IP address.',
          default: 'localhost',
        },
        port: {
          type: 'integer',
          title: 'Port',
          minimum: 1,
          maximum: 65535,
          default: 5432,
        },
        engine: {
          type: 'string',
          title: 'Engine',
          enum: ['postgres', 'mysql', 'sqlite'],
          default: 'postgres',
        },
        useSsl: {
          type: 'boolean',
          title: 'Use SSL',
          description: 'Require TLS when connecting.',
          default: true,
        },
        credentials: {
          type: 'object',
          title: 'Credentials',
          required: ['username'],
          properties: {
            username: { type: 'string', title: 'Username' },
            password: { type: 'string', title: 'Password' },
          },
        },
      },
      required: ['host', 'port', 'engine'],
    },
  });
}

function injectElicitationFormRich() {
  injectElicitation({
    message: 'Pick deployment options.',
    mode: 'form',
    elicitationSource: 'mcp/deploy',
    requestedSchema: {
      type: 'object',
      properties: {
        environment: {
          type: 'string',
          title: 'Environment',
          oneOf: [
            { const: 'dev', title: 'Development' },
            { const: 'staging', title: 'Staging' },
            { const: 'prod', title: 'Production' },
          ],
          default: 'dev',
        },
        region: {
          type: 'string',
          title: 'Region',
          enum: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1', 'sa-east-1'],
        },
        tags: {
          type: 'array',
          title: 'Tags',
          description: 'Free-form labels for the deployment.',
          items: { type: 'string' },
        },
        contact: {
          type: 'string',
          title: 'On-call email',
          format: 'email',
        },
        notes: { type: 'string', title: 'Notes' },
      },
      required: ['environment', 'region'],
    },
  });
}

const eventCount = computed(() => events.length);

/// Scripts grouped by tab via `groupForLabel`. Computed so adding a
/// new SCRIPTS entry only requires picking a label that the
/// classifier maps to the right tab.
const scriptsByGroup = computed(() => {
  const map: Record<ScriptGroup, Script[]> = {
    session: [],
    tools: [],
    callouts: [],
    markdown: [],
  };
  for (const s of SCRIPTS) {
    map[groupForLabel(s.label)].push(s);
  }
  return map;
});

const activeTab = ref<
  'session' | 'tools' | 'pending' | 'markdown' | 'callouts' | 'toasts' | 'custom'
>('tools');

/// Quick theme preview toggle. Flips the `.app-dark` class directly
/// on `<html>` so we can preview both palettes without leaving the
/// dev panel. Initialized from whatever applyThemeClass set so the
/// toggle starts in sync with the user's chosen theme.
const isDarkPreview = ref(
  typeof document !== 'undefined' && document.documentElement.classList.contains('app-dark'),
);
function toggleDarkPreview() {
  isDarkPreview.value = !isDarkPreview.value;
  document.documentElement.classList.toggle('app-dark', isDarkPreview.value);
}
</script>

<template>
  <div class="playground">
    <header class="playground-header">
      <div class="playground-title">
        <h1>Dev Playground</h1>
        <Button
          :icon="isDarkPreview ? 'pi pi-sun' : 'pi pi-moon'"
          :label="isDarkPreview ? 'Light' : 'Dark'"
          size="small"
          severity="secondary"
          text
          rounded
          aria-label="Toggle dark preview"
          class="playground-theme-toggle"
          @click="toggleDarkPreview"
        />
      </div>
      <p class="muted">
        Dev-only surface for exercising chat components in isolation. Tabs hold the injection
        controls; the chat preview below renders the resulting state. Close the tab to reset.
      </p>
    </header>

    <Tabs
      v-model:value="activeTab"
      scrollable
      class="playground-tabs"
    >
      <TabList>
        <Tab value="tools">Tools</Tab>
        <Tab value="session">Session & turns</Tab>
        <Tab value="pending">Pending requests</Tab>
        <Tab value="markdown">Markdown</Tab>
        <Tab value="callouts">Callouts & errors</Tab>
        <Tab value="toasts">Toasts</Tab>
        <Tab value="custom">Custom event</Tab>
      </TabList>
      <TabPanels>
        <!-- Tools — per-renderer scripts -->
        <TabPanel value="tools">
          <div class="actions">
            <Button
              v-for="script in scriptsByGroup.tools"
              :key="script.label"
              :label="script.label"
              size="small"
              severity="secondary"
              @click="run(script)"
            />
          </div>
        </TabPanel>

        <!-- Session lifecycle / title / model / usage / full turn -->
        <TabPanel value="session">
          <div class="actions">
            <Button
              v-for="script in scriptsByGroup.session"
              :key="script.label"
              :label="script.label"
              size="small"
              severity="secondary"
              @click="run(script)"
            />
          </div>
        </TabPanel>

        <!-- Pending requests — the inline PendingRequestCard surface -->
        <TabPanel value="pending">
          <p class="muted small panel-blurb">
            Each button enqueues a fake SDK callback on the playground session. The card renders
            inline in the chat below; FIFO across all kinds. Responses short-circuit the RPC so you
            can iterate on the UI without a live bun handler.
          </p>
          <div class="actions">
            <Button
              label="Permission: shell"
              size="small"
              severity="secondary"
              @click="injectShellPermission"
            />
            <Button
              label="Permission: write"
              size="small"
              severity="secondary"
              @click="injectWritePermission"
            />
            <Button
              label="Permission: read"
              size="small"
              severity="secondary"
              @click="injectReadPermission"
            />
            <Button
              label="Permission: url"
              size="small"
              severity="secondary"
              @click="injectUrlPermission"
            />
            <Button
              label="Permission: mcp"
              size="small"
              severity="secondary"
              @click="injectMcpPermission"
            />
            <Button
              label="Permission: memory"
              size="small"
              severity="secondary"
              @click="injectMemoryPermission"
            />
          </div>
          <div class="actions">
            <Button
              label="User input: freeform"
              size="small"
              severity="secondary"
              @click="injectUserInputFreeform"
            />
            <Button
              label="User input: choices"
              size="small"
              severity="secondary"
              @click="injectUserInputChoices"
            />
            <Button
              label="User input: both"
              size="small"
              severity="secondary"
              @click="injectUserInputChoicesPlusFreeform"
            />
          </div>
          <div class="actions">
            <Button
              label="Elicitation: URL (OAuth)"
              size="small"
              severity="secondary"
              @click="injectElicitationUrl"
            />
            <Button
              label="Elicitation: form (database)"
              size="small"
              severity="secondary"
              @click="injectElicitationForm"
            />
            <Button
              label="Elicitation: form (deploy)"
              size="small"
              severity="secondary"
              @click="injectElicitationFormRich"
            />
            <Button
              label="Clear queue"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              @click="clearPlaygroundQueue"
            />
          </div>
        </TabPanel>

        <!-- Markdown showcase — exercises every plugin we ship -->
        <TabPanel value="markdown">
          <p class="muted small panel-blurb">
            One-click feature showcase covering headings, lists, tasks, tables, math, code,
            footnotes, definition lists, emoji, collapsible sections, kbd/sub/sup/mark, and quotes.
          </p>
          <div class="actions">
            <Button
              v-for="script in scriptsByGroup.markdown"
              :key="script.label"
              :label="script.label"
              size="small"
              severity="secondary"
              @click="run(script)"
            />
          </div>
        </TabPanel>

        <!-- Callouts: info / warning / error / model-failure / truncation / compaction -->
        <TabPanel value="callouts">
          <div class="actions">
            <Button
              v-for="script in scriptsByGroup.callouts"
              :key="script.label"
              :label="script.label"
              size="small"
              severity="secondary"
              @click="run(script)"
            />
          </div>
        </TabPanel>

        <!-- Toasts -->
        <TabPanel value="toasts">
          <p class="muted small panel-blurb">
            Fires through the global toast store — same surface real actions use.
          </p>
          <div class="actions">
            <Button
              v-for="sev in toastSeverities"
              :key="sev"
              :label="`Fire ${sev}`"
              :severity="
                sev === 'error'
                  ? 'danger'
                  : sev === 'warn'
                    ? 'warn'
                    : sev === 'success'
                      ? 'success'
                      : 'info'
              "
              size="small"
              @click="fireToast(sev)"
            />
          </div>
        </TabPanel>

        <!-- Custom event JSON editor -->
        <TabPanel value="custom">
          <p class="muted small panel-blurb">
            Push any SessionEventPayload through the reducer. `eventType` is required; everything
            else is your call.
          </p>
          <textarea
            v-model="customEventJson"
            rows="4"
            class="json-input"
          />
          <div class="actions">
            <Button
              label="Push event"
              icon="pi pi-send"
              size="small"
              @click="pushCustom"
            />
          </div>
          <p
            v-if="customError"
            class="error"
          >
            {{ customError }}
          </p>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <section class="panel chat-wrapper">
      <header class="chat-wrapper-header">
        <h2>Chat preview</h2>
        <span class="muted small">{{ eventCount }} events</span>
        <Button
          label="+1k events"
          icon="pi pi-bolt"
          size="small"
          severity="warn"
          @click="pushManyEvents(333)"
        />
        <Button
          label="+10k events"
          icon="pi pi-bolt"
          size="small"
          severity="warn"
          @click="pushManyEvents(3333)"
        />
        <Button
          label="Clear chat"
          icon="pi pi-trash"
          severity="danger"
          text
          size="small"
          @click="clearChat"
        />
      </header>
      <div class="chat-frame">
        <ChatWindow
          :key="chatKey"
          :session-id="PLAYGROUND_PENDING_SESSION_ID"
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

.playground-tabs {
  flex: 0 0 auto;
}

.playground-tabs :deep(.p-tabpanel) {
  padding: 0.75rem 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.panel-blurb {
  margin: 0;
}

.chat-wrapper-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.chat-wrapper-header h2 {
  flex: 0 0 auto;
}

.chat-wrapper-header .muted {
  flex: 1 1 auto;
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
