# File/Directory Restructure Plan

## Scope
1. Group `src/stores/` (15 files) into domain folders — FIRST
2. Group `src/components/` (47 flat files) into feature folders
3. Group `src-bun/app/` (25 files) by domain
4. `src/lib/` reorg — separate follow-up pass
5. Split god objects — after structure stabilizes

## Execution Order (revised after critique)
Stores → Components → Backend → lib (later) → god objects (later)

Stores first because components import stores heavily; moving stores
first means component moves only need one round of import updates.

## Phase 1: Store Grouping

### `src/stores/chat/`
sessionsStore, sessionsListStore, commandResultsStore

### `src/stores/terminal/`
terminalStore

### `src/stores/shell/`
layoutStore, commandRegistry

### `src/stores/app/`
settingsStore, bootStore, clientStore, toastStore, notificationsStore

### `src/stores/library/`
modelsStore

### `src/stores/observability/`
auditStore, logStore, jobsStore

## Phase 2: Component Feature Folders

### `src/components/chat/`
ChatPanel, ChatWindow, ChatTab, ChatTabActions, MessageComposer,
MessageContent, MessageEditor, MessageEditorBody, MessageActions,
UserMessageBody, ReasoningBlock, SubagentBlock, ToolCallBlock,
CommandResultCard, ModeButtonGroup, MentionPlugin, SlashCommandPlugin

### `src/components/library/`
LibraryPanel, LibraryAgentsTab, LibraryInstructionsTab, LibraryMcpTab,
LibrarySkillsTab, LibraryToolsTab, McpServerForm

### `src/components/permissions/`
PendingRequestCard, PermissionDetails, PermissionRuleEditor

### `src/components/terminal/`
TerminalPanel, TerminalsPanel

### `src/components/session/`
SessionDetailsPanel, SessionHeaderControls, SessionsManager

### `src/components/settings/`
SettingsPanel

### `src/components/shell/`
ActivityBar, BootSplash, CommandPalette, SidebarTab, Watermark

### `src/components/shared/`
CodeEditor, FilePicker, JsonSchemaField, JsonSchemaForm, JsonValueView,
MermaidBlock

### `src/components/observability/`
JobsPanel, LogViewer

### `src/components/details/` (keep as-is)
ToolDetails stays here with the other detail renderers

## Phase 3: Backend Grouping (`src-bun/app/`)

### `src-bun/app/chat/`
sessions, pendingRequests

### `src-bun/app/client/`
client, copilotSdk

### `src-bun/app/library/`
agentFiles, instructions, mcpRegistry, skillsRegistry, tools

### `src-bun/app/terminal/`
terminalRegistry, commandResultRegistry, shellUtils

### `src-bun/app/config/`
settings, exports

### `src-bun/app/observability/`
audit, logging, diagnostics, stderrFilter

### `src-bun/app/filesystem/`
directoryBrowser, fileSearch

### `src-bun/app/shared/`
errors, errorMessage, redact

### Keep at `src-bun/app/` root
models (used by both client and library)

### Keep at `src-bun/` root
rpc.ts — wire contract, don't split during move
index.ts — Electrobun entry point
test-server.ts — E2E test helper

### Backend tests
Stay at `src-bun/__tests__/` per AGENTS.md convention

## Rules
- NO barrel (index.ts) files — explicit imports only
- Tests move with source (renderer only; backend stays)
- Snapshots regenerate after moves
- One commit per phase
- `bun run lint && bun test` after each phase

## Phase 4 (later): `src/lib/` reorg
- `lib/chat/` — chatEvents, exportConversation, sessionModeOptions
- `lib/terminal/` — terminalShellIntegration, ansi
- `lib/commands/` — palette, sessionCommands, registerBuiltinCommands, pathActions
- `lib/rendering/` — markdown, codeLanguage, diff, toolRenderers
- `lib/layout/` — layoutSanitize
- `lib/ui/` — color, theme, notificationStyles
- `lib/` root — errorMessage, modelTree, openAttachment

## Phase 5 (later): God Object Splits
- SessionDetailsPanel.vue (79K) → sub-components
- sessions.ts (74K) → lifecycle / events / message handling
- sessionsStore.ts (52K) → message state from session CRUD
- ChatWindow.vue (43K) → scroll/rendering
- rpc.ts (43K) → domain-specific handler files (with re-export barrel)
1. **Giant files** — 5 files over 1000 lines, SessionDetailsPanel is 2417 lines
2. **Duplicated patterns** — mode controls, IPC listener boilerplate, error handling, commandExists
3. **Inconsistent constants** — magic numbers in setTimeout calls, hardcoded strings
4. **TypeScript hacks** — 12 `as unknown as` casts in production code, unsafe payload narrowing
5. **Bloat** — dead fallback UI in ModeButtonGroup, test-server duplicates production handlers

---

## Phase 1: Split Giant Files (highest impact)

### 1a. Split `SessionDetailsPanel.vue` (2417 lines → ~6 smaller components)
- Extract: SkillsSection, McpSection, ToolsSection, PlanSection, UsageSection, QuotaSection
- Keep SessionDetailsPanel as a thin orchestrator

### 1b. Split `sessions.ts` (1939 lines → 3-4 modules)
- Extract: agent/task management, MCP/skills integration, command-result integration
- Keep core CRUD + event forwarding in sessions.ts

### 1c. Split `SessionHeaderControls.vue` (814 lines → smaller subcomponents)
- Extract: workspace controls, agent controls, terminal opener

### 1d. Split `sessionsStore.ts` (1308 lines → composables)
- Extract: pending request handling, event subscription, session creation/restore

## Phase 2: Eliminate Duplications

### 2a. Shared session-mode controls composable
- 3 components repeat mode/reasoning option lists → `useSessionModeOptions()`

### 2b. Shared `commandExists()` helper
- Duplicated in terminalRegistry.ts and commandResultRegistry.ts → `shellUtils.ts`

### 2c. Shared IPC listener registry
- 3 bridge files repeat listener/unsubscribe boilerplate → common emitter

### 2d. Shared `revealPath + toast` helper
- Duplicated in 2 components → `pathActions.ts`

## Phase 3: Constants & Magic Numbers

### 3a. Centralize timing constants
### 3b. Extract shared UI constants (edge panel sizes, debounce intervals)

## Phase 4: TypeScript Cleanup

### 4a. Type the Electrobun RPC bridge properly (eliminate `as unknown as`)
### 4b. Add runtime validation to WS bridge payloads
### 4c. Define explicit SDK response types

## Phase 5: Remove Bloat

### 5a. Remove dead Select fallback in ModeButtonGroup
### 5b. Reduce test-server / index.ts duplication

## Execution Order
1. Phase 2a + 2b + 2d (quick wins, ~30 min)
2. Phase 1a (split SessionDetailsPanel, ~45 min)
3. Phase 3a + 3b (constants, ~20 min)
4. Phase 5a (dead code, ~5 min)
5. Phase 1b (split sessions.ts, ~45 min)
6. Phase 4a (TS bridge typing, ~30 min)
7. Remaining phases as time allows
