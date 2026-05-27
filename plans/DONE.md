# DONE — everything Dafman ships today

> One file. Every shipped capability, organized by topic.
> No chronology. No "phase" numbering. Just receipts.
>
> When you ship something new: move it from `TODO.md` to here.
> When you change architecture or invariants: also update
> [`ARCHITECTURE.md`](../ARCHITECTURE.md).
>
> Last refreshed 2026-05-27 (Groups v3.1 close).

Legend:

- ✅ shipped — exercised in code
- 🟦 partial — core shipped, sub-feature gap tracked in TODO.md

---

## Foundations

| Capability | Status | Receipt |
|---|---|---|
| Electrobun + Bun + TypeScript stack (no Rust/Tauri) | ✅ | repo root; only `src-bun/` |
| `@github/copilot` SDK pinned (`1.0.54`) | ✅ | `package.json` |
| Single Copilot Client lifecycle | ✅ | `src/stores/app/clientStore.ts` |
| Multi-session create / resume / disconnect / delete | ✅ | `src-bun/app/sessions.ts` |
| `SessionRegistry.shutdownAll()` on SIGTERM/SIGINT | ✅ | `src-bun/app/sessions.ts`; `src-bun/index.ts` |
| Settings file + migration (v14 schema) | ✅ | `src/stores/app/settingsStore.ts` |
| Settings round-trip preserves v3 layout fields | ✅ | `src-bun/app/config/settings.ts:coerceLayout` (`c97b0a5`) |
| Dark mode + PrimeVue Aura | ✅ | `src/style.css` |
| Boot splash + phased startup | ✅ | `src/components/shell/BootSplash.vue` + `bootStore` |
| Brand favicon | ✅ | `public/dafman.svg` |
| Dev playground (`?dev` or status-bar wrench) | ✅ | `src/components/dev/Playground.vue` |
| `window.__DAFMAN_TEST__` test bridge | ✅ | `src/lib/testBridge.ts` |
| `bun run inspect` introspection CLI | ✅ | `tools/inspect.ts` (2026-05-26) |

## Shell & layout

| Capability | Status | Receipt |
|---|---|---|
| Dockview body as primary layout primitive | ✅ | `src/components/shell/AppLayout.vue` |
| **Groups v3** (nested DockviewVue per workspace group) | ✅ | `src/stores/shell/groupsStore.ts` + `src/components/shell/GroupPanel.vue` |
| Group right-click menu (rename / color / close) | ✅ | `src/components/shell/GroupTab.vue` (`5dbf2b3`) |
| Inline group rename (dblclick) | ✅ | `GroupTab.vue` (`5dbf2b3`) |
| Group color picker (Popover + PrimeVue `ColorPicker`) | ✅ | `GroupTab.vue` (`5a066f3`) |
| "Move session to group" submenu (ChatTab) | ✅ | `src/components/chat/ChatTab.vue` (`5dbf2b3`) |
| Cross-group drag via `onUnhandledDragOverEvent` | ✅ | `GroupPanel.vue` (`5dbf2b3`) |
| `+` button next to outer tabs (left-actions container) | ✅ | `AppLayout.vue` (`89cacc2`) |
| 300 ms debounced layout persist | ✅ | `src/lib/persistScheduler.ts` |
| Cache-first layout composition (`composePersistLayout`) | ✅ | `src/lib/composePersistLayout.ts` |
| `awaitInnerApi()` for safe inner-dockview operations | ✅ | `groupsStore.ts` (`4e27d43`) |
| Workspace MRU + native folder picker | ✅ | `pickFolder` RPC |
| Activity bar v2 (sidebar + status bar) | ✅ | `src/components/shell/ActivityBar.vue` + `StatusBar.vue` |
| Sessions Manager edge panel | ✅ | `src/components/session/SessionsManager.vue` |
| Per-session settings rail (`SessionDetailsPanel`) | ✅ | `src/components/session/SessionDetailsPanel.vue` |
| Per-session accent color | ✅ | `src/lib/color.ts` |

## Messaging & UX

| Capability | Status | Receipt |
|---|---|---|
| Streaming chat (rAF-coalesced) | ✅ | `src/lib/chatEvents.ts` |
| Reasoning visibility (hidden / compact / expanded) | ✅ | per-session + global pref |
| Reasoning on `assistant.message` (not delta events) | ✅ | `src/lib/chatEvents/messageHandlers.ts` |
| Per-session model + reasoning-effort picker | ✅ | `src/components/session/SessionHeaderControls.vue` |
| Tool-call rendering (per-tool components) | ✅ | `src/components/chat/ToolCallBlock.vue` |
| Nested sub-agent rendering | ✅ | `src/components/chat/SubagentBlock.vue` |
| Composer toolbar (WYSIWYG buttons) | ✅ | `src/composables/composerFormat.ts` |
| Steering / message queueing / interrupt (Ctrl+Enter) | ✅ | composer `SplitButton` + `queueSend` |
| Message actions (copy / quote / retry / edit / fork) | ✅ | `src/components/chat/MessageActions.vue` |
| `@file` / `@folder` picker | ✅ | `MentionPlugin.vue` + `FilePicker.vue` |
| File / image attachments (Lexical DecoratorNode) | ✅ | `src/lexical/AttachmentNode.ts` |
| Slash commands (local) | ✅ | `SlashCommandPlugin.vue` + `sessionCommands.ts` |
| Per-session gear popover | ✅ | `SessionHeaderControls.vue` |
| Bounded `record.events` ring buffer (5000) | ✅ | `sessionsStore.ts` |
| Markdown rendering (`markdown-it` + Prism + DOMPurify + KaTeX) | ✅ | `src/lib/markdown.ts` |
| Mermaid diagrams (opt-in, lazy) | ✅ | `src/components/chat/MermaidBlock.vue` |
| Code blocks via CodeMirror 6 | ✅ | `src/components/chat/CodeEditor.vue` |
| Terminal integration (PTY + per-session pane) | ✅ | `src/components/terminal/` (Bun.spawn + Terminal) |
| Long jobs registry (background tasks rail) | ✅ | `src/stores/observability/jobsStore.ts` + `JobsPanel.vue` |
| OS notifications (turn-end + waiting-input) | ✅ | `notificationsStore` |
| Command palette (Ctrl+K) | ✅ | `vue-command-palette` integration |
| Inline sub-menus in command palette (parent → expandable children) | ✅ | `src/components/shell/CommandPalette.vue` + `Command.children` in `commandRegistry.ts` |
| Auto-expand parent on search-match | ✅ | `CommandPalette.vue:shouldExpand` |
| All toggleable settings reachable from palette | ✅ | `registerBuiltinCommands.ts` (streaming, mermaid, notifications.turnEnd / .waitingForInput, defaultApproveAll, reasoningVisibility, defaultModel, defaultReasoningEffort, defaultWorkspace — every boolean today is wired by name; future schema additions get a same-PR `Toggle X` command, not a fragile auto-discovery hook) |
| Active session controls in palette | ✅ | `registerBuiltinCommands.ts` (session.model parent, session.mode parent, session.approveAll toggle, session.reasoningOverride parent, session.pinAsDefaults) |

## Tools & permissions

| Capability | Status | Receipt |
|---|---|---|
| Permission UX with rule editor (per-kind shapes) | ✅ | `src/components/permissions/PermissionRuleEditor.vue` |
| Permission audit log (JSONL) | ✅ | `<userData>/audit/permissions.jsonl` + `urls.jsonl` |
| Audit Activity tab in Diagnostics | ✅ | `src/components/observability/AuditPanel.vue` |
| URL elicitation + `openUrl` RPC (allow-listed) | ✅ | `src-bun/app/observability/audit.ts` |
| Per-session tool allow/exclude UI (tri-state) | ✅ | `src/components/library/LibraryToolsTab.vue` |
| Permissions Settings tab | ✅ | DEVLOG 2026-05-25 (Phase 22c) |
| Diff viewer (view-only) | 🟦 | `src/components/details/ApplyPatchView.vue` + `DiffEditor.vue` |

## SDK surface

| Capability | Status | Receipt |
|---|---|---|
| Skills enable/disable per session | ✅ | gear popover |
| Library panel (single edge panel with tabs) | ✅ | `src/components/library/LibraryPanel.vue` |
| Library → Skills tab | ✅ | `LibrarySkillsTab.vue` (read-only) |
| Library → MCP servers tab (list + enable/disable) | 🟦 | `LibraryMcpTab.vue` (no install flow) |
| Library → Instructions tab | ✅ | `LibraryInstructionsTab.vue` (read-only) |
| Library → Custom agents tab | ✅ | `LibraryAgentsTab.vue` |
| Library → Tools tab | ✅ | `LibraryToolsTab.vue` |
| MCP OAuth toast | ✅ | Phase 22a (DEVLOG 2026-05-25) |
| Agent picker (per-session) | ✅ | gear popover |
| `getQuota` exposed in SessionDetails | 🟦 | rendered numerically; no usage graph |
| `/fork` session | ✅ | `useMessageActions.ts` (composer fork button) |

## Observability

| Capability | Status | Receipt |
|---|---|---|
| JSON-lines logger + daily rotation | ✅ | `src-bun/app/logging.ts` |
| Log redaction (12 snapshot tests) | ✅ | `src-bun/app/redact.ts` |
| In-app log viewer | ✅ | `src/components/observability/LogViewer.vue` |
| Runtime log-level toggle | ✅ | `setLogLevel` RPC + panel header |
| Diagnostics bundle export | ✅ | `src-bun/app/observability/exports.ts` |

## Testing & CI

| Capability | Status | Receipt |
|---|---|---|
| Tier-1 lint + `bun test` + smoke gate | ✅ | `bun run check` |
| Backend TS gate (`lint:tsc-bun` in `check`) | ✅ | `package.json` (2026-05-25) |
| Bun-side entry reachability check (`lint:bun`) | ✅ | `tools/check-bun-entry.ts` |
| Tier-2 electrobun build matrix (Linux/macOS/Windows) | ✅ | `.github/workflows/ci.yml` |
| Tier-3 real E2E (Playwright + bun + fake SDK) | ✅ | `bun run e2e` — 24 flows (20 baseline + 4 v3 restart-restore) |
| Tier-3 `harness.restart()` for restart-restore flows | ✅ | `e2e/full/harness/bunHarness.ts` (kills + respawns on new port, same userData) |
| `urlFor()` cross-restart bridge helper | ✅ | `e2e/full/harness/pageHarness.ts` |
| Layout restore E2E (2 groups + session, restart, reload) | ✅ | `e2e/full/flows/21-layout-restore.pwtest.ts` |
| Settings round-trip E2E (theme persists across restart) | ✅ | `e2e/full/flows/22-settings-roundtrip.pwtest.ts` |
| Groups v3 create + session-lands-in-active-group E2E | ✅ | `e2e/full/flows/23-groups-create.pwtest.ts` |
| Move session between groups + survive restart E2E | ✅ | `e2e/full/flows/24-groups-move-session.pwtest.ts` |
| `__DAFMAN_TEST__` hook auto-wires for ws-bridge URL too | ✅ | `src/main.ts` (was smoke-only; now also fires for `?testBridge=ws://...`) |
| Renderer smoke (prod + HMR) | ✅ | `e2e/smoke.pwtest.ts` |
| Smoke screenshot pattern | ✅ | `bun run smoke` |
| `tools/probe-*.ts` user-bug-repro pattern | 🟦 | `tools/probe-groups-bugs.ts` (canonical) |
| Real-DockviewComponent harness | 🟦 | used in `composePersistLayout` tests |

## Tech-debt fixes (already done)

These items lived in `_archive/plan-tech-debt.prompt.md`. All shipped.

- `PendingRequestQueue` extracted (`650acfb`)
- `McpRegistry` extracted (`83335c4`)
- `SkillsRegistry` extracted (`075bb09`)
- `SessionRegistry` correctness (`shutdownAll`, `earlyEventBuffer`, entry-deletion ordering, unsubscribe ordering, history replay) (`687d05b`)
- Type / UX / perf nits (T3, U1, U2, U3, U6, U7, U8) (`b7014dc`)
- Safe dep bumps + deferred dep bumps shipped (21d)

## Major themes (from former `plan-backlog-audit` §A)

| # | Theme | Receipt |
|---|---|---|
| A1 | Terminal integration | `src/components/terminal/` |
| A2 | App shell redesign (sidebar + status bar) | StatusBar.vue + activity-bar v2 |
| A3 | Groups — workspaces of layout state | Groups v3 (2026-05-27) |
| A5 | Long jobs registry | `jobsStore.ts` + `JobsPanel.vue` |
| A6 | Composer toolbar (WYSIWYG buttons) | `composerFormat.ts` |
| A8 | Library panel (5 tabs) | `LibraryPanel.vue` |
| A14 | Per-session settings as right-rail panel | `SessionDetailsPanel.vue` |

---

## Quick stats (2026-05-27)

- ✅ DONE: ~80 capabilities across 7 topic areas
- 🟦 PARTIAL (core shipped, sub-feature gap): ~8
- See [`TODO.md`](TODO.md) for everything not yet shipped
