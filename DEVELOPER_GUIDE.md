# Dafman — Developer Guide

> Everything you need to understand the codebase and build features yourself.
> Last updated: 2026-05-25.

---

## Table of Contents

1. [What is Dafman?](#1-what-is-dafman)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Getting Started](#4-getting-started)
5. [How the App Boots](#5-how-the-app-boots)
6. [IPC — How Renderer Talks to Bun](#6-ipc--how-renderer-talks-to-bun)
7. [Stores (Pinia)](#7-stores-pinia)
8. [The Dockview Layout System](#8-the-dockview-layout-system)
9. [Session Lifecycle](#9-session-lifecycle)
10. [The Composer (Lexical)](#10-the-composer-lexical)
11. [Chat Event Processing](#11-chat-event-processing)
12. [SDK Integration](#12-sdk-integration)
13. [Testing](#13-testing)
14. [How-To Recipes](#14-how-to-recipes)
15. [Common Pitfalls](#15-common-pitfalls)
16. [File Reference](#16-file-reference)

---

## 1. What is Dafman?

Dafman is a desktop UI for the GitHub Copilot CLI. It's a native app built with
[Electrobun](https://docs.electrobunny.ai/electrobun/) (Bun + native webview)
and a Vue 3 frontend.

Features: streaming chat with multiple sessions, visible reasoning and tool
calls, permission gates with rule editor, inline file/image attachments,
command palette, dark mode, terminal integration, MCP server management,
skills/agents discovery.

**One language everywhere:** TypeScript + Bun. No Rust, no Cargo, no Electron.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Native shell | Electrobun (Bun-powered, native webview) |
| Main process runtime | Bun |
| AI backend | `@github/copilot` SDK → spawns a prebuilt Copilot CLI binary |
| Frontend framework | Vue 3 (`<script setup lang="ts">`) |
| State management | Pinia |
| Layout engine | dockview-vue (panels, tabs, edge groups) |
| Rich text editor | Lexical (composer input) |
| UI components | PrimeVue (Aura theme, emerald primary) |
| Code display | CodeMirror 6 (editor), Prism (syntax highlighting) |
| Markdown | markdown-it + plugins (math, texmath, mermaid) + DOMPurify |
| Terminal | xterm.js + Bun native PTY |
| Build tool | Vite (renderer), Bun.build (main process) |
| Testing | bun test + Playwright (smoke) |

---

## 3. Project Structure

```
dafman/
├── src/                    ← Vue 3 renderer (runs in webview)
│   ├── main.ts               ← App bootstrap: Vue + Pinia + PrimeVue + dockview CSS + IPC bridge
│   ├── App.vue               ← Root shell: ActivityBar + DockviewVue + boot + layout restore
│   ├── style.css             ← Global styles (uses var(--p-*) PrimeVue tokens)
│   ├── components/           ← All Vue SFCs (30+)
│   │   └── details/          ← Tool detail renderers (diff, grep, glob, path, url chips)
│   ├── stores/               ← Pinia stores (14)
│   ├── lib/                  ← Pure helpers (no Vue runtime dependency)
│   │   └── chatEvents/       ← Per-event-family reducers
│   ├── ipc/                  ← Typed IPC bridge (renderer → bun)
│   └── lexical/              ← Lexical editor setup, custom nodes, plugins, Prism grammars
│
├── src-bun/                ← Bun main process
│   ├── index.ts              ← Electrobun bootstrap + RPC handler registration
│   ├── rpc.ts                ← RPC schema (THE type source of truth)
│   └── app/                  ← Framework-agnostic domain modules (testable without Electrobun)
│       ├── client.ts           ← Copilot SDK client lifecycle
│       ├── sessions.ts         ← SessionRegistry: CRUD, event forwarding, permissions
│       ├── settings.ts         ← Versioned JSON settings store
│       ├── tools.ts            ← SDK tool passthrough
│       ├── errors.ts           ← AppError union + rpcGuard wrapper
│       ├── logging.ts          ← JSON-lines daily-rotated log
│       ├── fileSearch.ts       ← Workspace file search for @-mentions
│       ├── terminalRegistry.ts ← PTY terminal management
│       └── ...                 ← (mcpRegistry, skillsRegistry, audit, diagnostics, etc.)
│
├── tools/                  ← Build plugins
│   ├── bun-vue-loader.ts     ← Makes .vue files importable in bun test
│   ├── check-bun-entry.ts    ← Validates main process entry reachability
│   └── prep-dist.ts          ← Creates dist/ stub for Electrobun dev watch
│
├── e2e/                    ← Playwright tests
│   ├── smoke.pwtest.ts       ← Smoke: boots prod + HMR bundles, checks no console errors
│   └── full/                 ← Full E2E harness (per-test Bun subprocess bridge)
│
├── plans/                  ← Design docs (future direction)
├── public/                 ← Static assets (favicon, SVGs)
├── electrobun.config.ts    ← Native app config (app id, Bun version pin, view copies)
├── vite.config.ts          ← Vite config (Vue plugin, port 5173)
├── tsconfig.json           ← Renderer TypeScript config
├── tsconfig.bun.json       ← Main process TypeScript config
├── bunfig.toml             ← Bun test config (preloads Vue SFC loader)
└── package.json            ← All scripts + dependencies
```

### Key docs

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | Current reality — module map, invariants, SDK gotchas |
| `STATUS.md` | What's done, what's in progress |
| `DEVLOG.md` | Running session log with investigation notes |
| `AGENTS.md` | Rules for AI agents working on the repo |
| `problems.md` | Open bugs and future ideas |
| `plans/*.prompt.md` | Design specs for upcoming features |

---

## 4. Getting Started

```bash
# Install dependencies
bun install

# Start the app in dev mode
bun run dev

# Start with frontend hot-module-replacement
bun run dev:hmr

# Run the full validation gate
bun run check    # lint → test → vite build → electrobun build → smoke
```

### All scripts

| Script | What it does |
|--------|-------------|
| `bun run dev` | Start Electrobun app in dev mode |
| `bun run dev:hmr` | Same but with Vite HMR for the renderer |
| `bun run build` | Production build (Vite + Electrobun) |
| `bun run lint` | Type-check with vue-tsc |
| `bun run lint:bun` | Validates main process entry reachability |
| `bun test` | Run all unit tests |
| `bun test --watch` | Watch mode |
| `bun test --coverage` | Coverage report |
| `bun run smoke` | Playwright smoke tests (prod + HMR) |
| `bun run check` | Full gate: lint + test + build + smoke |

---

## 5. How the App Boots

### Sequence

```
1. Bun starts (electrobun.config.ts → src-bun/index.ts)
   ├── initLogger()                    → JSON-lines log
   ├── installStderrFilter()           → drops CLI subprocess noise
   ├── SettingsService.loadOrDefault() → reads/migrates settings.json
   ├── defineRPC<DafmanRPC>({ bun })   → registers ~50 RPC handlers
   └── Opens Electrobun window → loads Vite-built HTML

2. Renderer starts (src/main.ts)
   ├── Import prismExtraLanguages      → register Prism grammars (MUST be first)
   ├── createApp(App)                  → Vue 3 + Pinia + PrimeVue + dockview CSS
   ├── setRpcBridge(pickBridge())      → wire IPC (Electrobun or WebSocket for tests)
   ├── Register global components      → chat, library, settings, terminal, etc.
   └── mount("#app")

3. App.vue onMounted
   ├── bootStore.startBoot()
   ├── settingsStore.load()             → fetch settings from bun
   ├── clientStore.createClient()       → bun spawns the Copilot CLI binary
   ├── Restore layout from settings.layout.dockview
   │   ├── Extract panel IDs → sessionsStore.restoreSession(id) for each
   │   ├── Prune panels that fail to restore
   │   └── layoutStore.restore(prunedLayout)
   ├── Subscribe to dockview change events → scheduleLayoutSave()
   ├── registerBuiltinCommands()
   └── bootStore.setReady()
```

### Key concept: Boot phases

The `bootStore` tracks phases: `loading-settings` → `creating-client` →
`resuming` → `ready` (or `error`). The `<BootSplash>` overlay shows during
non-ready phases. A 6-second watchdog forces `ready` if boot hangs.

---

## 6. IPC — How Renderer Talks to Bun

### Architecture

```
┌─────────────────┐              ┌─────────────────┐
│  Vue renderer    │  RPC call   │  Bun main        │
│                  │ ──────────► │                  │
│  invokeCommand() │             │  RPC handler     │
│  (src/ipc/       │ ◄────────── │  (src-bun/       │
│   invoke.ts)     │  result     │   rpc.ts)        │
└─────────────────┘              └─────────────────┘
        ▲                              │
        │    push messages             │
        └────── sessionEvent ──────────┘
                pendingRequest
                logEvent
```

### How to call the backend

```typescript
import { invokeCommand } from "@/ipc/invoke";

// Type-safe — CommandMap defines input/output for every command
const sessions = await invokeCommand("listSessions", undefined);
const name = await invokeCommand("getSessionName", { sessionId });
await invokeCommand("sendMessage", { sessionId, text, attachments });
```

### How to listen for backend events

```typescript
import { onSessionEvent, onPendingRequest } from "@/ipc/invoke";

// Session events (assistant messages, tool calls, reasoning, etc.)
const unsub = onSessionEvent((event: SessionEventPayload) => {
  // event.sessionId tells you which session
  // event.type tells you what happened (e.g. "assistant.message_delta")
});

// Permission/input requests from the SDK
const unsub2 = onPendingRequest((req: PendingRequestPayload) => {
  // Show UI for permission approval
});
```

### Adding a new IPC command

1. **Define the type** in `src-bun/rpc.ts` — add to the `DafmanRPC` schema:
   ```typescript
   myNewCommand: {
     args: { someInput: string };
     result: { someOutput: number };
   };
   ```

2. **Mirror the type** in `src/ipc/types.ts` — add to `CommandMap`:
   ```typescript
   myNewCommand: {
     args: { someInput: string };
     result: { someOutput: number };
   };
   ```

3. **Implement the handler** in `src-bun/index.ts` (or delegate to an `app/` module):
   ```typescript
   myNewCommand: rpcGuard(async (args) => {
     return { someOutput: 42 };
   }),
   ```

4. **Add a wire-shape snapshot** in `src-bun/__tests__/wire-contract.test.ts`.

5. **Call it** from the renderer:
   ```typescript
   const result = await invokeCommand("myNewCommand", { someInput: "hello" });
   ```

### Error handling

- Backend handlers are wrapped with `rpcGuard` (from `src-bun/app/errors.ts`)
- Errors serialize as `AppErrorPayload` discriminated union: `ClientNotStarted | SessionNotFound | Settings | Sdk | Io`
- The renderer's `invokeCommand` decodes them into `AppError` instances
- **Never throw raw `Error` from RPC handlers** — always use `rpcGuard`

---

## 7. Stores (Pinia)

All state lives in Pinia stores. Components are "dumb" — they read from stores
and call store actions.

| Store | File | What it owns |
|-------|------|-------------|
| **bootStore** | `stores/bootStore.ts` | Boot phase tracking |
| **clientStore** | `stores/clientStore.ts` | SDK client lifecycle (create, status) |
| **sessionsStore** | `stores/sessionsStore.ts` | Active session records: events, model, mode, title, pending requests, event ring buffer |
| **sessionsListStore** | `stores/sessionsListStore.ts` | CLI-side session catalog (for the Sessions Manager panel) |
| **layoutStore** | `stores/layoutStore.ts` | DockviewApi wrapper: addPanel, removePanel, openEdgePanel, snapshot, restore, activeSessionId |
| **settingsStore** | `stores/settingsStore.ts` | Persisted settings.json + workspaces MRU + layout persistence |
| **modelsStore** | `stores/modelsStore.ts` | Available models list + reasoning effort capabilities |
| **commandRegistry** | `stores/commandRegistry.ts` | Command palette command registration |
| **toastStore** | `stores/toastStore.ts` | PrimeVue toast bridge |
| **notificationsStore** | `stores/notificationsStore.ts` | OS notification gating |
| **jobsStore** | `stores/jobsStore.ts` | Long-running jobs/tasks UI |
| **logStore** | `stores/logStore.ts` | Live log tail + display filter |
| **terminalStore** | `stores/terminalStore.ts` | Terminal panel state |
| **auditStore** | `stores/auditStore.ts` | Audit log state |
| **commandResultsStore** | `stores/commandResultsStore.ts` | Shell command results |

### Key pattern: SessionRecord

```typescript
// In sessionsStore — this is THE runtime source of truth per session
interface SessionRecord {
  sessionId: string;
  events: SessionEventPayload[];    // ring-buffered (max 5000)
  droppedEventCount: number;        // tracks how many were trimmed
  model: string;
  mode: string;                     // "interactive" | "plan" | "autopilot"
  title: string;
  workingDirectory: string;
  approveAll: boolean;
  pendingRequests: PendingRequestPayload[];
  // ... more fields
}
```

**Important:** Always push events through `sessionsStore.appendEvent()` — never
push directly to `record.events`. This is what enforces the ring buffer cap.

---

## 8. The Dockview Layout System

### What is dockview?

[Dockview](https://dockview.dev/) is a layout engine that provides VS Code-style
panels, tabs, splits, and edge groups. We use `dockview-vue` for Vue integration.

### How it's set up

- **One single `<DockviewVue>`** in `App.vue` — the entire window body.
- **Body panels** = chat sessions, playground (dev). Each session gets its own tab.
- **Edge panels** = sidebars. Left: Sessions Manager, Library. Right: Session Details. Bottom: Log Viewer.
- **ActivityBar** = the thin left rail with icon buttons that toggle edge panels.

### Panel lifecycle

```
User creates a session
  → sessionsStore.createSession(workDir)
  → IPC: invokeCommand("createSession", { workDir })
  → Bun creates SDK session, returns sessionId
  → layoutStore.addPanel({ id: sessionId, component: "chat", ... })
  → Dockview renders ChatPanel.vue in a new tab
```

### Panel id = session id

This is a critical invariant. When you call `addPanel`, the `id` MUST be the
session ID. This is how we extract session IDs from persisted layout JSON:

```typescript
const sessionIds = extractChatPanelIds(layout);
// → reads Object.keys(layout.panels) and filters to chat panels
```

### Adding a new panel type

1. **Create the component** (e.g., `src/components/MyPanel.vue`)
2. **Register it globally** in `src/main.ts`:
   ```typescript
   app.component("myPanel", MyPanel);
   ```
3. **Open it** via layoutStore:
   ```typescript
   // As a body panel (appears in the tab strip):
   layoutStore.addPanel({
     id: "my-unique-id",
     component: "myPanel",
     title: "My Panel",
     params: { /* passed to the component */ },
   });

   // As an edge panel (sidebar):
   layoutStore.openEdgePanel("left", {
     id: "my-sidebar",
     component: "myPanel",
     title: "My Sidebar",
   });
   ```

### Edge panels (sidebars)

Edge panels are dockview's native sidebar system. They live outside the main
body grid but inside the same DockviewVue instance.

Positions: `"left"`, `"right"`, `"bottom"`.

The `layoutStore.openEdgePanel()` method handles creation + toggle visibility.

### Layout persistence

- `scheduleLayoutSave()` in App.vue debounces (300ms) and calls
  `settingsStore.persistLayout(dockview.api)` on every layout change
- Persisted as `settings.layout.dockview` — an opaque JSON blob from
  `api.toJSON()`
- On restore: `api.fromJSON(layout)` rebuilds all panels from the JSON

### Layout JSON structure

```json
{
  "grid": {
    "root": { "type": "branch", "data": [...], "size": 1200 },
    "width": 1920,
    "height": 1080,
    "orientation": "HORIZONTAL"
  },
  "panels": {
    "session-abc-123": {
      "id": "session-abc-123",
      "contentComponent": "chat",
      "tabComponent": "chatTab",
      "params": { "sessionId": "session-abc-123" },
      "title": "My Chat"
    }
  },
  "activeGroup": "group-1",
  "edgeGroups": {
    "left": {
      "size": 300,
      "visible": true,
      "group": { "views": ["sessionsManager"], "activeView": "sessionsManager" }
    },
    "right": { "size": 350, "visible": false, "group": { ... } }
  }
}
```

### Layout sanitization

`src/lib/layoutSanitize.ts` provides pure functions for surgery on persisted
layout JSON:

- `stripPanelFromLayout(layout, panelId)` — remove a panel that failed to restore
- `extractChatPanelIds(layout)` — get session IDs from the layout
- `enforcePersistedEdgeMinimums(layout)` — prevent zero-width sidebars
- `stripLegacyDetailsPanels(layout)` — remove old singleton panels
- `collapseEmptyEdgeGroups(layout)` — clean up empty edge groups

---

## 9. Session Lifecycle

### Creating a session

```
User clicks "+" or sends first message
  → sessionsStore creates a SessionRecord (local)
  → invokeCommand("createSession", { workDir, model })
  → Bun: SessionRegistry.create()
    → SDK: client.createSession({ ... })
    → Wire up event listeners (assistant.message, tool.*, etc.)
    → Start forwarding events to renderer via webview.send("sessionEvent", ...)
  → layoutStore.addPanel() → chat tab appears
```

### Session events flow

```
Copilot CLI binary
  → SDK session.on("assistant.message_delta", data)
  → SessionRegistry event handler
  → webview.send("sessionEvent", { sessionId, type, data })
  → Renderer: onSessionEvent callback
  → sessionsStore.appendEvent(sessionId, event)
  → ChatWindow.vue watches events → processEvents() reducer → ChatItem[]
  → Vue reactivity renders messages
```

### Resuming a session

When the app restarts, persisted layout contains panel IDs = session IDs.
For each:

```
sessionsStore.restoreSession(sessionId)
  → invokeCommand("resumeSession", { sessionId })
  → Bun: SessionRegistry.resume(sessionId)
    → SDK: client.resumeSession(sessionId)
    → session.getEvents() → forward each as sessionEvent
    → Re-subscribe to live events
```

### Deleting a session

```
User clicks delete in Sessions Manager
  → invokeCommand("deleteSession", { sessionId })
  → Bun: SessionRegistry.delete(sessionId) → SDK session gone
  → layoutStore.removePanel(sessionId) → tab closes
  → sessionsStore removes the SessionRecord
```

---

## 10. The Composer (Lexical)

The chat input is a Lexical rich-text editor, not a plain `<textarea>`.

### Files

| File | Purpose |
|------|---------|
| `lexical/theme.ts` | CSS class mappings for Lexical node types |
| `lexical/nodes.ts` | Registered node types (heading, list, code, **AttachmentNode**) |
| `lexical/plugins.ts` | Editor behaviors: submit-on-enter, markdown shortcuts, typing diagnostics |
| `lexical/AttachmentNode.ts` | DecoratorNode for inline file/blob pills |
| `lexical/prismExtraLanguages.ts` | Prism grammars in strict dependency order |
| `lexical/lexical.css` | Editor + read-only message styles |

### How sending works

```
User presses Enter (or clicks Send)
  → SubmitOnEnter plugin fires
  → consumeComposerText(editor) walks the Lexical tree:
    - Extracts plain text
    - Collects AttachmentNode data as attachments[]
    - Clears the editor
  → invokeCommand("sendMessage", { sessionId, text, attachments })
  → Bun forwards to SDK session.send()
```

### Attachment pills

- `AttachmentNode` is a **DecoratorNode** (not TextNode — TextNode subclasses
  infinite-loop in Lexical)
- Each pill carries its file path/content in the node's data fields
- `consumeComposerText()` reads them in document order

### @-mention picker

`MentionPlugin.vue` — typing `@` opens a fuzzy file search powered by
`invokeCommand("searchWorkspaceFiles", ...)` which runs ripgrep on the backend.

### Slash commands

`SlashCommandPlugin.vue` — typing `/` opens a command picker. Slash commands
are local-only (no token waste); only SDK-recognized commands are forwarded.

### ⚠️ Prism grammar order matters

`prismExtraLanguages.ts` registers grammars in strict dependency tiers:

```
Tier 1: markup, clike        (no deps)
Tier 2: markup-templating, css, c, javascript  (depend on tier 1)
Tier 3: cpp, typescript, jsx  (depend on tier 2)
Tier 4: tsx                   (depends on jsx + typescript)
```

Prism component files access prerequisite grammars at module-eval time.
Wrong order = runtime crash. This has caused regressions twice.

---

## 11. Chat Event Processing

The reducer in `src/lib/chatEvents.ts` transforms raw SDK events into
renderable `ChatItem[]`.

### The reducer

```typescript
processEvents(items, ambient, payloads, counter, options)
  → { items: ChatItem[], ambient, toasts, idle, error }
```

- **items**: accumulated chat items (messages, tool calls, reasoning blocks)
- **ambient**: ambient state that persists across events (current turn, message ID)
- **payloads**: new events to process
- **counter**: tracks absolute position (handles ring buffer drops)

### Event families (in `src/lib/chatEvents/`)

| Handler file | Events handled |
|-------------|---------------|
| `messageHandlers.ts` | `assistant.message_start/delta/end`, `assistant.message`, `user.message` |
| `reasoningHandlers.ts` | `assistant.reasoning_delta`, `assistant.reasoning` |
| `toolHandlers.ts` | `tool.user_requested`, `tool.execution_start/partial_result/progress/complete` |
| `turnHandlers.ts` | `assistant.turn_start/end`, `assistant.intent` |
| `sessionMetaHandlers.ts` | `session.title_changed`, `session.model_change`, `session.usage` |
| `notificationHandlers.ts` | `permission.*`, `user_input.*`, `elicitation.*` |
| `lifecycleHandlers.ts` | `session.idle`, `session.error` |
| `calloutHandlers.ts` | `session.info/warning`, `system.notification`, `truncation`, etc. |

### ChatItem types

```typescript
type ChatItem =
  | { kind: "user"; text: string; attachments: Attachment[] }
  | { kind: "assistant"; text: string; messageId: string }
  | { kind: "reasoning"; text: string; opaque?: string }
  | { kind: "tool-call"; toolName: string; args: unknown; result?: unknown }
  | { kind: "callout"; level: "info" | "warning"; text: string }
  // ... more variants
```

---

## 12. SDK Integration

### How Copilot connects

```
src-bun/app/client.ts
  → Resolves the prebuilt binary: @github/copilot-${platform}-${arch}
    (NOT the JS entrypoint — that needs Node ≥ 24)
  → Creates SDK Client with { cliPath: binaryPath }
  → Client spawns the Copilot CLI binary as a subprocess
  → Communication over JSON-RPC stdio
```

### Sessions

```typescript
// Create
const session = await client.createSession({
  workingDirectory: "/path",
  model: "claude-sonnet-4",
  onPermissionRequest: handler,  // REQUIRED — deny-by-default
  // ... event listeners
});

// Send a message
await session.send({ text: "hello", attachments: [...] });

// Resume an existing session
const session = await client.resumeSession(sessionId);
```

### SDK gotchas (already burned once — don't repeat)

1. **CLI binary, not JS entrypoint.** The JS entrypoint needs Node ≥ 24.
   We use the prebuilt platform binary via `cliPath`.

2. **Permissions are deny-by-default.** Without `onPermissionRequest`, every
   tool call silently fails. You MUST handle permissions.

3. **`session.on()` does NOT replay history.** After resume, call
   `session.getEvents()` and replay each event through the standard emit path.

4. **Reasoning is on `assistant.message`, not `assistant.reasoning*`.** The
   `reasoningText`, `reasoningOpaque`, and `encryptedContent` fields come on
   the `assistant.message` event data. The `assistant.reasoning_delta` /
   `assistant.reasoning` events exist in the schema but the CLI never emits them
   directly (except for sub-agent reasoning).

5. **Tool registry knobs:**
   - Add custom tools: `SessionConfig.tools` (use `defineTool` for Zod inference)
   - Restrict tools: `availableTools` (allowlist, wins) or `excludedTools` (denylist)
   - Override built-in: set `overridesBuiltInTool: true` on a Tool with the same name
   - Skip permission: `skipPermission: true` bypasses the deny-by-default gate
   - Intercept: `onPreToolUse` / `onPostToolUse` hooks

6. **Vue reactive proxies + Electrobun bridge.** Deep-clone payloads
   (`JSON.parse(JSON.stringify(...))`) before `invokeCommand` if they
   come from `reactive()` state.

---

## 13. Testing

### Test locations

| What | Runner | Where |
|------|--------|-------|
| Bun-side domain modules | `bun test` | `src-bun/__tests__/` |
| IPC wire-shape snapshots | `bun test` | `src-bun/__tests__/wire-contract.test.ts` |
| Pure renderer helpers | `bun test` | `src/lib/__tests__/` |
| Vue SFCs | `bun test` + Vue loader | next to source: `src/**/__tests__/` |
| Lexical custom nodes | `bun test` (real editor) | `src/lexical/__tests__/` |
| Renderer smoke | Playwright + chromium | `e2e/smoke.pwtest.ts` |
| Full E2E | Playwright + Bun subprocess | `e2e/full/flows/` |

### How Vue SFCs work in tests

The `tools/bun-vue-loader.ts` plugin is preloaded via `bunfig.toml`. It
compiles `.vue` files on-the-fly so `bun test` can import them. Tests use
`@testing-library/vue` + `happy-dom`.

### Running tests

```bash
bun test                     # all tests
bun test src/lib/__tests__/  # specific directory
bun test --watch             # watch mode
bun run smoke                # Playwright smoke (boots prod + HMR bundles)
bun run check                # full gate
```

### Writing a test

```typescript
// src/lib/__tests__/myHelper.test.ts
import { describe, test, expect } from "bun:test";
import { myHelper } from "../myHelper";

describe("myHelper", () => {
  test("does the thing", () => {
    expect(myHelper("input")).toBe("expected");
  });
});
```

### Testing a Vue component

```typescript
import { describe, test, expect } from "bun:test";
import { render, screen } from "@testing-library/vue";
import MyComponent from "../MyComponent.vue";

describe("MyComponent", () => {
  test("renders title", () => {
    render(MyComponent, { props: { title: "Hello" } });
    expect(screen.getByText("Hello")).toBeTruthy();
  });
});
```

### ⚠️ Testing gaps

- `bun run check` (lint + test + build + smoke) is **necessary but not
  sufficient** for UI changes
- Smoke tests only verify the bundle boots without console errors
- **Real dockview operations** (layout restore, panel add/remove, edge groups)
  are NOT covered by automated tests
- You MUST `bun run dev` and manually verify any UI-touching change

---

## 14. How-To Recipes

### Add a new chat panel feature (e.g., show something in the chat)

1. Add a new `ChatItem` kind in the reducer (`src/lib/chatEvents/`)
2. Handle the SDK event type → produce the new ChatItem
3. Render it in `ChatWindow.vue` (or create a new block component)
4. Test the reducer in `src/lib/__tests__/`

### Add a new edge panel (sidebar)

1. Create `src/components/MyPanel.vue`
2. Register globally in `src/main.ts`: `app.component("myPanel", MyPanel)`
3. Add an ActivityBar item in `App.vue` (the `activityItems` array)
4. The ActivityBar click handler calls `layoutStore.openEdgePanel("left", { ... })`

### Add a new setting

1. Add the field to the settings type in `src-bun/app/settings.ts`
2. Bump the settings version and add a migration in `migrate()`
3. Mirror the type in `src/ipc/types.ts`
4. Use it in the renderer via `settingsStore.settings.myNewSetting`
5. Add UI in `SettingsPanel.vue`

### Add a command to the command palette

See `src/lib/registerBuiltinCommands.ts`:

```typescript
registry.register({
  id: "my-command",
  label: "My Cool Command",
  icon: "pi pi-star",
  action: () => {
    // do something
  },
});
```

Commands registered with `register()` return a disposer for cleanup.

### Add a new tool detail renderer

1. Create a component in `src/components/details/`
2. Register it in `src/lib/toolRenderers.ts`:
   ```typescript
   registerToolRenderer("my_tool_name", {
     summary: (args) => "one-line summary",
     component: () => import("@/components/details/MyToolDetail.vue"),
   });
   ```
3. `ToolDetails.vue` will automatically use it when that tool name appears.

### Add a backend module

1. Create `src-bun/app/myModule.ts` — keep it framework-agnostic (no
   `electrobun/bun` imports)
2. Write tests in `src-bun/__tests__/myModule.test.ts`
3. Wire it into RPC handlers in `src-bun/index.ts`

---

## 15. Common Pitfalls

### Don't import `electrobun/bun` in `src-bun/app/`

Only `src-bun/index.ts` may import Electrobun. Everything in `app/` is
framework-agnostic so `bun test` can exercise it directly.

### Don't use raw `electrobun.rpc.request()` in components

Always go through `invokeCommand()` in `src/ipc/invoke.ts`. The typed
`CommandMap` is the contract.

### Don't hardcode hex colors

Use `var(--p-*)` PrimeVue design tokens. The only exception is per-session
accent colors from `src/lib/color.ts`.

### Don't push events directly to `record.events`

Always use `sessionsStore.appendEvent()`. It enforces the ring buffer cap
(MAX_EVENTS_PER_SESSION = 5000).

### Dockview panel props are re-wrapped after update()

On initial mount: `{ params, api, containerApi, tabLocation }`.
After any `update()`: `{ params: { params, api, containerApi } }`.
Your component must normalize both shapes.

### Lexical DecoratorNode handlers

Must capture data into local vars before attaching listeners. Reading
`this.__field` later throws because Lexical wraps the node in a read-only
proxy after `createDOM`.

### Prism grammar import order

Must follow dependency tiers. See `src/lexical/prismExtraLanguages.ts`.
Wrong order = runtime crash in production. This has broken the app twice.

### Vue reactive proxies don't survive the Electrobun bridge

Deep-clone before `invokeCommand`:
```typescript
const plain = JSON.parse(JSON.stringify(reactiveObj));
await invokeCommand("myCommand", plain);
```

---

## 16. File Reference

### Core architecture files

| File | Lines | What it does |
|------|-------|-------------|
| `src/main.ts` | ~155 | App entry: Vue + Pinia + PrimeVue + IPC bridge + global component registration |
| `src/App.vue` | ~630 | Root shell: ActivityBar + DockviewVue + boot flow + layout restore/save |
| `src-bun/index.ts` | ~350 | Electrobun bootstrap + all RPC handler registrations |
| `src-bun/rpc.ts` | ~200 | RPC type schema — THE type source of truth |
| `src/ipc/types.ts` | ~250 | Renderer-side type mirror of rpc.ts |
| `src/ipc/invoke.ts` | ~150 | Typed `invokeCommand` + event listeners |

### Stores

| File | What it owns |
|------|-------------|
| `stores/sessionsStore.ts` | Per-session runtime state (events, model, mode, title, pending requests) |
| `stores/layoutStore.ts` | DockviewApi: panel CRUD, edge panels, snapshot/restore, active session |
| `stores/settingsStore.ts` | Persisted settings, workspaces MRU, layout persistence |
| `stores/clientStore.ts` | SDK client lifecycle |
| `stores/bootStore.ts` | Boot phase tracking |
| `stores/commandRegistry.ts` | Command palette contributions |

### Backend domain modules

| File | What it does |
|------|-------------|
| `app/client.ts` | SDK client lifecycle, platform binary resolution |
| `app/sessions.ts` | SessionRegistry: CRUD, event forwarding, permissions, title polling |
| `app/settings.ts` | Versioned JSON store with migrations |
| `app/errors.ts` | AppError discriminated union + rpcGuard |
| `app/logging.ts` | JSON-lines daily-rotated log + live subscribers |
| `app/fileSearch.ts` | Workspace file search via ripgrep |
| `app/terminalRegistry.ts` | PTY terminal management |
| `app/mcpRegistry.ts` | MCP server config/enable/disable |
| `app/skillsRegistry.ts` | Skill discovery and global disable list |
| `app/audit.ts` | Audit log write/read/subscribe |

### Key UI components

| Component | What it renders |
|-----------|----------------|
| `ChatWindow.vue` | One chat session: scrollable message list + composer |
| `MessageComposer.vue` | Lexical editor: inline pills, @-mentions, slash commands, send |
| `MessageContent.vue` | Read-only markdown message (markdown-it + Prism + DOMPurify) |
| `ToolCallBlock.vue` | Tool invocation card with expandable details |
| `PendingRequestCard.vue` | Permission / input / elicitation approval card |
| `ActivityBar.vue` | Left rail with panel toggle icons |
| `SessionsManager.vue` | Left-edge session catalog (resume/delete) |
| `SessionDetailsPanel.vue` | Right-edge per-session settings (model, mode, skills, tools, etc.) |
| `CommandPalette.vue` | Cmd/Ctrl+K overlay |
| `SettingsPanel.vue` | App settings (theme, streaming, notifications) |
| `LibraryPanel.vue` | Global config: MCP servers, skills, tools, agents, instructions |

---

## Appendix: Key Decisions & Why

| Decision | Rationale |
|----------|-----------|
| Single DockviewVue instance | Multiple instances caused v1 groups failure. One instance = one layout tree = simpler persistence. |
| Panel id = session id | Lets us extract session state from layout JSON without a separate mapping. |
| SessionRecord as source of truth | Dockview JSON is opaque UI shape only. All session state lives in Pinia. |
| Prebuilt Copilot binary (not JS) | The JS entrypoint needs Node ≥ 24. Bun can't run it. The prebuilt binary works everywhere. |
| DecoratorNode for attachments | TextNode subclass + setMode('token') infinite-loops in Lexical. DecoratorNode is the correct base. |
| Ring-buffered events (5000 cap) | Prevents memory blowup on long sessions. Consumers track absolute position. |
| rpcGuard for all handlers | Electrobun only serializes thrown Error instances. Non-Error throws cause promises to never settle. |
| Prism grammar tier ordering | Prism components access prerequisite grammars at eval time. Wrong order = crash. |

---

*This guide should give you everything you need to navigate, understand, and
extend dafman. For design direction, see `plans/*.prompt.md`. For current
progress, see `STATUS.md`. For investigation notes, see `DEVLOG.md`.*
