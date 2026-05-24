# Dafman — Architecture

> Snapshot of the live codebase as of 2026-05-21. When this file disagrees with
> a `plans/*.prompt.md` doc, this file wins for "how it is today"; the plan
> wins for "where we're going". Update both when reality changes.

## 1. Big picture

```
┌──────────────────────────── Electrobun window ──────────────────────────────┐
│                                                                             │
│  ┌─────────────┐    sessionEvent (fan-out)    ┌───────────────────────────┐ │
│  │             │ ◄─────────────────────────── │                           │ │
│  │  Bun main   │                              │  WebView2 / WKWebView /   │ │
│  │  process    │       invokeCommand          │  GTK webkit (Vue 3 SPA)   │ │
│  │             │ ──────────────────────────►  │                           │ │
│  └─────────────┘                              └───────────────────────────┘ │
│         │                                                                   │
│         ▼                                                                   │
│  @github/copilot SDK  ──spawns──►  @github/copilot-${platform}-${arch}      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                              Copilot model API
```

- **Single language, single runtime.** TypeScript everywhere; Bun on the main
  process; Vue 3 in the webview. No Rust, no Cargo, no Node-in-prod.
- **One CLI process** (the prebuilt Copilot binary). The SDK spawns it once
  via the `@github/copilot` SDK's `Client`, then multiplexes sessions over
  JSON-RPC.
- **One typed IPC surface** (`src-bun/rpc.ts`). The renderer never reaches into
  Electrobun globals directly; everything funnels through `src/ipc/invoke.ts`
  + a typed `CommandMap`.

## 2. Top-level layout

```
dafman/
├── ARCHITECTURE.md           ← you are here (current reality)
├── AGENTS.md                 ← agent contract: anti-laziness rules, dev commands, conventions
├── STATUS.md                 ← live progress board (updated per milestone)
├── DEVLOG.md                 ← append-only running log (updated per session)
├── README.md                 ← user-facing intro + getting started
├── CHANGELOG.md              ← release notes (Keep a Changelog)
├── CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md
│
├── plans/                    ← design docs (future direction)
│   ├── plan-overview.prompt.md           ← index
│   ├── plan-frontend-shell.prompt.md     ← current dockview/Vue shell
│   ├── plan-roadmap.prompt.md            ← milestones M0–M7
│   ├── plan-messagingAndUx.prompt.md     ← chat UX
│   ├── plan-toolsAndPermissions.prompt.md
│   ├── plan-sdkAndExternalSurfaces.prompt.md
│   ├── plan-platformFeatures.prompt.md   ← projects, accounts, skills, MCP, automations
│   ├── plan-observability.prompt.md
│   ├── plan-testingStrategy.prompt.md
│   └── plan-architecture.prompt.md       ← legacy Tauri layout (historical)
│
├── src/                      ← Vue 3 renderer (webview)
├── src-bun/                  ← Bun main process
├── tools/                    ← Bun plugins (Vue SFC test loader, dist prep)
├── e2e/                      ← Playwright renderer smoke tests
├── public/                   ← static assets (favicon, brand SVG)
├── electrobun.config.ts      ← Electrobun bundle config
└── package.json              ← single source of truth for scripts + deps
```

## 3. Main process (`src-bun/`)

### Modules

```
src-bun/
├── index.ts                ← Electrobun bootstrap; registers RPC handlers
├── rpc.ts                  ← typed RPC schema (single source of truth)
└── app/                    ← framework-agnostic domain modules
    ├── client.ts             ← Copilot SDK client lifecycle, platform binary resolution
    ├── sessions.ts           ← SessionRegistry: create/resume/list/delete, event forwarding,
    │                           per-session pending-handler map, approveAll state, skills,
    │                           usage metrics
    ├── settings.ts           ← versioned JSON store (current: v8), migrate(),
    │                           Workspaces MRU
    ├── models.ts             ← listModels() with capabilities
    ├── tools.ts              ← (currently minimal) — SDK passthrough
    ├── fileSearch.ts         ← workspace file ripgrep-style search (for @file mentions)
    ├── directoryBrowser.ts   ← path autocomplete for the workspace input
    ├── stderrFilter.ts       ← drops known noise from the CLI subprocess
    ├── errors.ts             ← AppError discriminated union + rpcGuard wrapper
    ├── redact.ts             ← shape-only redaction for sensitive/content fields
    ├── diagnostics.ts        ← bundle export (logs + recent.json + settings + README)
    └── logging.ts            ← JSON-lines daily-rotated log + live subscribers + ring buffer
```

### Hard rules

- **Domain modules under `app/` do not import `electrobun/bun`.** Only
  `src-bun/index.ts` may. This keeps `bun test` able to exercise the domain
  modules without spinning up Electrobun.
- **Every RPC handler is wrapped with `rpcGuard`** so unknown failures
  serialize as `AppErrorPayload` and the renderer never sees a raw `Error`.
  **Wire encoding:** `rpcGuard` throws `new Error("AppErrorPayload:" +
  JSON.stringify(payload))` — a *real* Error instance, because Electrobun's
  bridge (see `node_modules/electrobun/dist/api/shared/rpc.ts:398`) only
  serializes thrown Error instances. Non-Error throws get re-thrown as
  unhandled rejections on the worker side and the renderer's request
  promise NEVER settles. The renderer's `invokeCommand` decodes the
  `AppErrorPayload:` prefix back into a typed `AppError`.
- **No background tasks without a cancellation/unsubscribe handle.** The
  `SessionRegistry` keeps `unsubscribe` callbacks per entry and calls them
  on disconnect / shutdown.
- **All logs structured** (`log.info("msg", { key })`). The JSON-lines layout
  is part of the wire contract for the future in-app log viewer.

### Lifecycle

```
bun.start
  └─ initLogger()                            // src-bun/app/logging.ts
  └─ installStderrFilter()                   // drops node-pty conpty noise on Windows
  └─ SettingsService.loadOrDefault()         // reads & migrates settings.json
  └─ defineRPC<DafmanRPC>({ bun: {...} })    // registers ~30 handlers
  └─ Electrobun window open
       └─ renderer boots, calls createClient
            └─ SDK spawns @github/copilot-${platform}-${arch}
            └─ deny-by-default permission model installed
            └─ existing sessions resumed via session.getMessages()
```

## 4. Renderer (`src/`)

### Module layout

```
src/
├── App.vue                       ← shell: <DockviewVue> body + ActivityBar rail + global modals
├── main.ts                       ← createApp + Pinia + PrimeVue + dockview CSS
├── style.css                     ← global token-anchored styles
├── components/                   ← Vue SFCs (30+; see "Component map" below)
├── stores/                       ← Pinia stores (11)
├── lib/                          ← pure helpers (no Vue runtime)
│   ├── chatEvents.ts               ← reducer: SessionEventPayload[] → ChatItem[]
│   ├── chatEvents/                 ← per-event-family handlers (messages, reasoning, tools, …)
│   ├── markdown.ts                 ← markdown-it + Prism + DOMPurify pipeline
│   ├── color.ts                    ← accentForIndex (per-session palette)
│   ├── toolRenderers.ts            ← per-tool summary + language hint registry
│   ├── sessionCommands.ts          ← local slash commands (/cd, /reset, …)
│   ├── notificationStyles.ts       ← styleFor() — kind-to-color
│   ├── openAttachment.ts           ← shared file/blob viewer
│   ├── registerBuiltinCommands.ts  ← command palette seed
│   └── markdown helpers
├── ipc/
│   ├── types.ts                    ← CommandMap + payload types (mirrors src-bun/rpc.ts)
│   ├── invoke.ts                   ← typed invokeCommand + onSessionEvent
│   ├── electrobunBridge.ts         ← adapter to Electrobun's rpc.request
│   └── rendererLog.ts              ← renderer → bun log forwarder
├── lexical/                      ← composer editor stack
│   ├── theme.ts                    ← Lexical-class → CSS-class map
│   ├── plugins.ts                  ← EditableSync, RegisterMarkdownShortcuts, SubmitOnEnter,
│   │                                 TypingDiagnostic, consumeComposerText
│   ├── nodes.ts                    ← markdownNodes (HeadingNode, ListNode, …, AttachmentNode)
│   ├── AttachmentNode.ts           ← DecoratorNode for inline file/blob pills
│   ├── prismExtraLanguages.ts      ← grammars loaded in tier order (markup+clike first, …)
│   └── lexical.css                 ← editor + read-only message styles
└── dev/
    └── Playground.vue              ← DEV-only synthetic event harness, echo chat
```

### Stores (Pinia)

| Store              | Owns                                                                              |
|--------------------|-----------------------------------------------------------------------------------|
| `bootStore`        | startup phase (`loading-settings`, `creating-client`, `resuming`, `ready`, `error`) |
| `clientStore`      | singleton SDK client lifecycle (`createClient` + status)                          |
| `logStore`         | live log tail + display filter + bun-level mutation                                |
| `sessionsStore`    | `SessionRecord[]` — events, model, mode, title, working dir, pending requests, FIFO callback queue, ring-buffer cap |
| `sessionsListStore`| CLI-side session catalog (for the Sessions Manager edge panel)                    |
| `modelsStore`      | `listModels()` cache + reasoning effort capabilities                              |
| `settingsStore`    | versioned settings.json + workspaces MRU + persistLayout()                        |
| `layoutStore`      | DockviewApi: `addPanel`, `openEdgePanel`, `snapshot`, `restore`, `activeSessionId` |
| `toastStore`       | PrimeVue toast bridge                                                             |
| `notificationsStore` | OS notification gating + permission state                                       |
| `commandRegistry`  | Cmd/Ctrl+K palette contributions (`register` returns a disposer)                  |

### Component map

| Component                  | Purpose                                                          |
|----------------------------|------------------------------------------------------------------|
| `App.vue`                  | Shell: ActivityBar + DockviewVue + global PendingRequestCard host |
| `ActivityBar.vue`          | Left rail: brand mark + panel toggles (Sessions, Library, Settings, Diagnostics) + dev wrench |
| `ChatPanel.vue`            | Dockview "chat" panel component (resolves wrapped params)         |
| `ChatWindow.vue`           | One chat session: scroll list + composer; runs `processEvents`   |
| `ChatTab.vue` / `ChatTabActions.vue` / `SidebarTab.vue` | Dockview tab renderers + indicators |
| `MessageComposer.vue`      | Lexical-backed composer: inline pills, mentions, slash commands, send |
| `MessageContent.vue`       | Read-only message render (markdown-it + Prism + DOMPurify, mermaid lazy) |
| `MessageEditor.vue` / `MessageEditorBody.vue` | Edit-in-place editor for user messages          |
| `MessageActions.vue`       | Hover toolbar: copy/quote/retry/edit/fork                        |
| `UserMessageBody.vue`      | User-message renderer with inline attachment pills                |
| `ReasoningBlock.vue`       | Compact/expanded reasoning bubble (with opaque placeholder)       |
| `ToolCallBlock.vue` / `ToolDetails.vue` | Tool invocation card + per-tool detail blocks       |
| `PendingRequestCard.vue`   | Inline permission / userInput / elicitation card                  |
| `PermissionDetails.vue`    | Per-kind permission summary (shell command, file path, URL chip)  |
| `PermissionRuleEditor.vue` | "Allow for session" rule editor (commands/read/write/mcp/url)     |
| `JsonSchemaForm.vue` / `JsonSchemaField.vue` / `JsonValueView.vue` | Elicitation form-mode renderer |
| `CommandPalette.vue`       | Cmd/Ctrl+K overlay (`vue-command-palette` based)                  |
| `SettingsPanel.vue`        | Settings edge panel (theme, streaming, mermaid, notifications, default workspace) |
| `SessionsManager.vue`      | Left-edge CLI session catalog grouped by workspace (resume/delete) |
| `SessionDetailsPanel.vue`  | Right-edge **singleton** per-session settings rail (name, mode, reasoning, workspace, approve-all, skills, tools, MCP servers, plan, usage, quota, fork) — binds to `layoutStore.activeSessionId` |
| `LibraryPanel.vue`         | Left-edge "Library" panel hosting global/cross-session config (Phase 19) |
| `LibraryMcpTab.vue` / `McpServerForm.vue` | Configured + Discovered MCP servers; structured ↔ JSON add/edit dialog |
| `LibrarySkillsTab.vue`     | Skills grouped by source (builtin / project / personal-copilot) with global enable/disable |
| `SessionHeaderControls.vue`| Tab-strip workspace chip + model + effort + reasoning + cog toggle for the rail |
| `ModeButtonGroup.vue`      | Run mode (interactive / plan / autopilot) button group            |
| `MentionPlugin.vue` / `SlashCommandPlugin.vue` | Typeahead pickers inside the composer         |
| `MermaidBlock.vue`         | Lazy mermaid renderer (opt-in via Settings)                       |
| `CodeEditor.vue`           | CodeMirror 6 wrapper for code-fenced segments                     |
| `BootSplash.vue`           | Boot-phase status overlay (with 6s watchdog forcing ready)        |
| `LogViewer.vue`            | Live log tail with level + display filter + search + diagnostics export |
| `Watermark.vue`            | Empty-state body watermark                                        |

### Hard rules

- **Dockview is the layout primitive.** New persistent surfaces (sidebars,
  status bars, log viewer, picker) are dockview **edge groups** via
  `layoutStore.openEdgePanel(...)`. The slim ActivityBar rail holds global
  toggles, not functional UI.
- **Panel id = session id.** Always `addPanel({ id: sessionId, … })`. This is
  the contract that lets us extract session ids from a serialized layout.
- **SessionRecord is the runtime source of truth.** Per-session state lives in
  the Pinia store; the dockview JSON is opaque UI shape only.
- **No raw `electrobun.rpc.request(...)` in components.** Always wrap through
  `src/ipc/invoke.ts`; the typed `CommandMap` is the source of truth.
- **No hardcoded hex colors.** Use `var(--p-*)` PrimeVue tokens. Per-session
  accents (`accentForSession` in `src/lib/color.ts`) are the only exception.

## 5. Wire contract (IPC)

### RPC surface (renderer → bun)

Categorized by function. All defined in `src-bun/rpc.ts`, mirrored in
`src/ipc/types.ts`, snapshotted in `src-bun/__tests__/wire-contract.test.ts`.

**Lifecycle / session**
`createClient`, `createSession`, `disconnectSession`, `resumeSession`,
`listSessions`, `deleteSession`, `forkSession`

**Composer & sending**
`sendMessage`, `abortSession`, `searchWorkspaceFiles` (for `@file` mentions)

**Per-session config**
`setSessionModel`, `getSessionMode`, `setSessionMode`,
`getSessionName`, `setSessionName`, `setSessionWorkingDirectory`,
`compactSessionHistory`, `truncateSessionHistory`,
`setSessionApproveAll`, `resetSessionApprovals`,
`listSessionSkills`, `setSessionSkillEnabled`, `getSessionUsageMetrics`

**Permissions / elicitation**
`respondToRequest` — single response RPC for all three pending-callback
channels (permission / userInput / elicitation). Permission decisions can
include a `PermissionApprovalRule` (commands / read / write / mcp / mcp-sampling /
memory / custom-tool) or a `domain` for url permissions.

**Models**
`listModels`

**Settings & paths**
`getSettings`, `updateSettings`, `getLogDir`, `openLogFolder`,
`pickFolder`, `browseDirectory`, `revealPath`, `openUrl`

**Diagnostics**
`rendererLog` — renderer mirrors `console.error` into the bun JSON log.
`getLogState`, `setLogLevel`, `exportDiagnostics` — back the in-app log
viewer (`LogViewer.vue`) and the diagnostics bundle export.

### Webview messages (bun → renderer)

- `sessionEvent` — fan-out for every SDK event. Carries optional envelope
  `agentId` / `eventId` / `timestamp` lifted from the SDK event for sub-agent
  attribution.
- `pendingRequest` — pushed when an SDK callback fires (permission /
  userInput / elicitation). Renderer enqueues on the session's FIFO queue.
- `logEvent` — fanned out by `subscribeLogs()` for every emitted log record
  (irrespective of the configured level). The in-app log viewer subscribes
  and applies its own display filter.

### Reducer (`src/lib/chatEvents.ts`)

Pure function `processEvents(items, ambient, payloads, counter, options) →
{ items, ambient, toasts, idle, error }`. Split into per-family handlers
under `src/lib/chatEvents/`:

| Family            | Handles                                                                |
|-------------------|------------------------------------------------------------------------|
| `messageHandlers` | `assistant.message_start/_delta/_end`, `assistant.message`, `user.message`. **Lifts `reasoningText`/`reasoningOpaque`/`encryptedContent` from `assistant.message.data` into a synthesised reasoning ChatItem** (see DEVLOG entry for the investigation). |
| `reasoningHandlers` | `assistant.reasoning_delta`, `assistant.reasoning` (sub-agent surface) |
| `toolHandlers`    | `tool.user_requested`, `tool.execution_start/_partial_result/_progress/_complete` |
| `turnHandlers`    | `assistant.turn_start/_end`, `assistant.intent`                        |
| `sessionMetaHandlers` | `session.title_changed`, `session.model_change`, `session.usage`   |
| `notificationHandlers` | `permission.requested/_completed`, `user_input.requested/_completed`, `elicitation.requested/_completed`, `dafman.pending_request/_response` |
| `lifecycleHandlers` | `session.idle`, `session.error`                                      |
| `calloutHandlers` | `session.info`, `session.warning`, `system.notification`, `truncation`, `compaction`, `model.call_failure`, `fork` notices |

A split-invariant test pins that no two families claim the same event type
and that every documented SDK event is either handled or explicitly ignored.

## 6. Lifecycle invariants

### Session state — bounded events buffer

`record.events` is the per-session SDK-event log. Capped at
`MAX_EVENTS_PER_SESSION` (5000) via a ring trim — once the array exceeds the
cap, oldest events are spliced off the front and `record.droppedEventCount`
bumps by the same amount.

Consumers (`ChatWindow.flush`) track **absolute** progress via
`droppedEventCount + events.length`, not array indices, so a trim never
causes events to be re-processed or skipped. Push goes through the
`appendEvent` helper exported from `sessionsStore`; every push site —
including external callers like `lib/sessionCommands.ts` — must use it.

### Layout persistence

- Dockview state is persisted as opaque JSON inside `settings.layout.dockview`,
  debounced 300 ms.
- On startup, panel ids are extracted via `Object.keys(layout.panels)`, each
  is fed to `sessionsStore.restoreSession(id)`, and the (possibly pruned)
  layout is handed to `layoutStore.restore()` before subscribing to change
  events.

### Composer attachments

Inline `AttachmentNode`s (DecoratorNode) in Lexical carry the structured
attachment payload. `consumeComposerText(editor)` walks the root in document
order before clearing, returning `{ text, attachments[] }`. Position N in the
text ⇔ `attachments[N]` in the SDK payload.

### Reasoning

The CLI emits reasoning **on `assistant.message`** (not on
`assistant.reasoning*`). The `messageHandlers["assistant.message"]` reducer
harvests `data.reasoningText` (readable), `data.reasoningOpaque` (Anthropic
encrypted), and `data.encryptedContent` (OpenAI encrypted) into a reasoning
ChatItem keyed at `msg:${messageId}` placed before the assistant bubble.

## 7. Tests

| Surface                                      | Runner                  | Where                                          |
|----------------------------------------------|-------------------------|------------------------------------------------|
| Bun-side domain modules                      | `bun test`              | `src-bun/__tests__/`                            |
| IPC wire-shape snapshots                     | `bun test` (`toMatchSnapshot`) | `src-bun/__tests__/wire-contract.test.ts`     |
| Pure renderer reducers / helpers             | `bun test`              | `src/lib/__tests__/`                            |
| Vue SFCs                                     | `bun test` + `tools/bun-vue-loader.ts` (preloaded via `bunfig.toml`) | next to source         |
| Lexical custom nodes                         | `bun test` (real editor) | `src/lexical/__tests__/`                       |
| Renderer boot smoke (Playwright + chromium)  | `bun run smoke`         | `e2e/smoke.pwtest.ts` (prod + HMR runs)         |
| Real binary E2E                              | not yet wired           | (open — Tier-2 backlog)                         |

Total: **308 tests** as of writing. `bun run check` is the gate:
`lint → test → vite build → electrobun build → smoke:run`.

## 8. SDK gotchas (codified — already burned, don't re-burn)

1. **The bundled CLI JS entrypoint needs Node ≥ 24** (uses `node:sqlite`).
   `src-bun/app/client.ts` resolves the prebuilt
   `@github/copilot-${platform}-${arch}` binary and passes it via `cliPath`.
2. **SDK permissions are deny-by-default.** Without `onPermissionRequest`
   wired (or the `approveAll` shim), every tool call silently fails.
3. **`session.on()` does NOT replay history.** `SessionRegistry.resume()`
   calls `session.getMessages()` and forwards each event through the standard
   emit path so the reducer rebuilds the transcript.
4. **Reasoning is on `assistant.message`, not `assistant.reasoning*`.** Don't
   re-add a listener that drops the assistant-message reasoning fields.
5. **dockview-vue panel props are re-wrapped.** After any `update()` the
   panel component sees `{ params: { params, api, containerApi } }` instead
   of the initial `{ params, api, containerApi, tabLocation }`. Normalize both
   shapes.
6. **Vue reactive proxies don't reliably survive the Electrobun JSON bridge.**
   Deep-clone (`JSON.parse(JSON.stringify(...))`) before `invokeCommand` for
   payloads that come from `reactive()` state.
7. **Lexical `DecoratorNode` event handlers must capture data into local
   vars before attaching listeners.** Reading `this.__field` from a closure
   later throws because Lexical wraps the node in a read-only proxy after
   `createDOM`.

## 9. What's not here yet (link to plans)

The roadmap milestones (M3+) are tracked in `STATUS.md` (current state) and
`plans/plan-roadmap.prompt.md` (target state). Highest-value missing pieces:

- **In-app log viewer + diagnostics bundle export** (Observability M1 tail).
- **Projects model + multi-account auth** (M4).
- **MCP server registry UI** (M5).
- **Agents / Fleets UI** (M5).
- **Automations + scheduled prompts** (M6).
- **Monaco diff viewer for `fs.edit` results** (M7).
- **Headless browser tool** (M7).

See `plans/plan-roadmap.prompt.md` for the full taxonomy and definition-of-done
per milestone.
