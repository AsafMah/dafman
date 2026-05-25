# Code Quality Audit

> **Date:** 2026-05-25 (refreshed after directory restructure + path aliases)
> **Codebase:** ~33,000 lines of TypeScript + Vue across `src/` and `src-bun/`
> **Tools used:** ESLint (strictTypeChecked), jscpd (copy-paste detection), manual review, IDE diagnostics

---


## 1  File Size Distribution

Files above **800 lines** are strong candidates for splitting.

| Lines | File                                              | Notes                            |
| ----: | ------------------------------------------------- | -------------------------------- |
| 2,954 | `src/components/session/SessionDetailsPanel.vue`  | Largest file — 6+ UI sections    |
| 2,233 | `src-bun/app/chat/sessions.ts`                    | Backend session god-object       |
| 1,635 | `src/dev/Playground.vue`                          | Dev-only, not shipped            |
| 1,466 | `src/stores/chat/sessionsStore.ts`                | Store body is 866+ lines         |
| 1,398 | `src/components/chat/MessageComposer.vue`         | Lexical editor + toolbar         |
| 1,319 | `src/components/chat/ChatWindow.vue`              | Message list + scroll            |
| 1,239 | `src-bun/rpc.ts`                                  | IPC handler registry             |
| 1,145 | `src/stores/shell/layoutStore.ts`                 | Dockview orchestration           |
| 1,058 | `src/components/session/SessionsManager.vue`      | Sidebar session list             |
|   991 | `src/components/settings/SettingsPanel.vue`       | Settings UI                      |
|   921 | `src/components/session/SessionHeaderControls.vue`| Header bar controls              |
|   904 | `src/ipc/types.ts`                                | Shared type defs (expected big)  |
|   760 | `src/components/terminal/TerminalPanel.vue`       | Terminal container               |
|   721 | `src/components/library/LibraryAgentsTab.vue`     | Agent library UI                 |
|   712 | `src/components/permissions/PendingRequestCard.vue`| Permission card                 |
|   689 | `src-bun/test-server.ts`                          | Dev test server                  |
|   669 | `src/App.vue`                                     | Root component                   |
|   653 | `src-bun/index.ts`                                | Main process entry               |
|   631 | `src/lib/chatEvents.ts`                           | Chat event reducer               |
|   614 | `src/components/library/McpServerForm.vue`        | MCP server form                  |
|   605 | `src-bun/app/client/fakeClient.ts`                | Fake SDK client                  |
|   575 | `src/components/permissions/ToolDetails.vue`      | Tool detail view                 |
|   545 | `src/components/shared/FilePicker.vue`            | File picker component            |
|   540 | `src/components/shell/CommandPalette.vue`         | Command palette                  |
|   528 | `src/components/library/LibraryMcpTab.vue`        | MCP library tab                  |
|   522 | `src/lib/registerBuiltinCommands.ts`              | Builtin command registry         |
|   521 | `src/components/observability/LogViewer.vue`      | Log viewer                       |


---


## 2  ESLint — Strict TypeScript Analysis

**Config:** `strictTypeChecked` + `eslint-plugin-vue/flat/recommended` + complexity + `@stylistic/eslint-plugin`

**Current: 0 errors, 300 warnings**

### 2.1  Issues by Rule

| Count | Rule                                           | What It Means                                  |
| ----: | ---------------------------------------------- | ---------------------------------------------- |
|   120 | `no-unnecessary-condition`                     | Dead branches, always-true/false checks        |
|    63 | `restrict-template-expressions`                | Unsafe types in template literals              |
|    14 | `vue/component-definition-name-casing`         | Component name casing mismatch                 |
|    13 | `complexity`                                   | Cyclomatic complexity above 15                 |
|    11 | `no-redundant-type-constituents`               | Union/intersection with redundant members      |
|    10 | `prefer-nullish-coalescing`                    | `||` where `??` is safer                       |
|     9 | `unified-signatures`                           | Overloads that can be a single signature       |
|     9 | `no-unsafe-assignment`                         | Assignments from `any`-typed values            |
|     9 | `no-non-null-assertion`                        | `!` instead of proper null checks              |
|     6 | `no-duplicate-imports`                         | Same module imported twice                     |
|     6 | `vue/one-component-per-file`                   | Multiple components in one SFC                 |
|     5 | `vue/require-default-prop`                     | Props without defaults                         |
|     5 | `max-lines-per-function`                       | Function body > 200 lines                      |
|     3 | `use-unknown-in-catch-callback-variable`       | `catch(e)` without `unknown` type              |
|     3 | `no-unused-vars`                               | Unused variables                               |
|     3 | `no-dynamic-delete`                            | `delete obj[key]` on dynamic key               |
|     2 | `no-unsafe-return`                             | Returning `any`-typed values                   |
|     2 | `no-unsafe-argument`                           | `any` passed to typed parameter                |
|     2 | `no-misused-promises`                          | Promise used in non-async context              |
|     1 | `no-unnecessary-type-assertion`                | Redundant `as` casts                           |
|     1 | `no-invalid-void-type`                         | `void` used outside return type                |
|     1 | `max-depth`                                    | Nesting > 4 levels deep                        |
|     1 | `no-unsafe-call`                               | Calling an `any`-typed value                   |
|     1 | `no-unsafe-member-access`                      | Property access on `any`                       |

### 2.2  Files with Most Warnings

| Count | File                                               |
| ----: | -------------------------------------------------- |
|    27 | `src/components/session/SessionDetailsPanel.vue`   |
|    17 | `src/components/terminal/TerminalPanel.vue`        |
|    16 | `src/main.ts`                                      |
|    13 | `src/App.vue`                                      |
|    11 | `src/components/settings/SettingsPanel.vue`        |
|    11 | `src/stores/chat/sessionsStore.ts`                 |
|    10 | `src/components/chat/ChatWindow.vue`               |
|    10 | `src/components/session/SessionsManager.vue`       |
|     7 | `src/lib/chatEvents/notificationHandlers.ts`       |
|     7 | `src/lib/modelTree.ts`                             |
|     6 | `src/components/chat/SubagentBlock.vue`            |
|     6 | `src/components/observability/JobsPanel.vue`       |
|     6 | `src/components/shared/JsonSchemaField.vue`        |
|     6 | `src/stores/terminal/terminalStore.ts`             |
|     5 | `src/components/chat/MessageComposer.vue`          |
|     5 | `src/components/observability/LogViewer.vue`       |
|     5 | `src/ipc/wsBridge.ts`                              |
|     5 | `src/lexical/plugins.ts`                           |
|     5 | `src/lib/chatEvents.ts`                            |

### 2.3  Complexity Violations (Cyclomatic > 15)

| CC | File                                                     | Function              |
| -: | -------------------------------------------------------- | --------------------- |
| 60 | `src/stores/chat/sessionsStore.ts`                       | `applyToRecord`       |
| 40 | `src/components/shared/JsonSchemaForm.vue`               | `validateNode`        |
| 33 | `src/lib/chatEvents.ts`                                  | `processEvents`       |
| 32 | `src-bun/app/chat/sessions.ts`                           | `normalizeTask`       |
| 29 | `src/stores/shell/layoutStore.ts`                        | `openEdgePanel`       |
| 28 | `src/components/permissions/ToolDetails.vue`             | (arrow fn)            |
| 25 | `src-bun/app/chat/sessions.ts`                           | `summarizePermission` |
| 24 | `src-bun/app/chat/sessions.ts`                           | `forward`             |
| 24 | `src/lib/chatEvents/messageHandlers.ts`                  | `user.message`        |
| 23 | `src/components/session/SessionDetailsPanel.vue`         | `loadUsage`           |
| 22 | `src-bun/app/chat/pendingRequests.ts`                    | (handler)             |
| 20 | `src-bun/app/config/settings.ts`                         | (handler)             |
| 19 | `src/lib/chatEvents/messageHandlers.ts`                  | (handler)             |
| 19 | `src/stores/chat/sessionsStore.ts`                       | (handler)             |
| 18 | `src-bun/app/chat/sessions.ts`                           | (handler)             |
| 18 | `src-bun/app/observability/stderrFilter.ts`              | (filter)              |
| 18 | `src/stores/chat/sessionsStore.ts`                       | (handler)             |
| 17 | `src/components/library/McpServerForm.vue`               | (form logic)          |
| 17 | `src/lexical/plugins.ts`                                 | (plugin)              |
| 16 | `src-bun/app/chat/sessions.ts`                           | (handler)             |
| 16 | `src/components/terminal/TerminalPanel.vue`              | (handler)             |

### 2.4  Oversized Functions (> 200 lines)

| Lines | File                                                | Function                    |
| ----: | --------------------------------------------------- | --------------------------- |
|   866 | `src/stores/chat/sessionsStore.ts`                  | Entire store body           |
|   598 | `src/stores/shell/layoutStore.ts`                   | Entire store body           |
|   379 | `src/lib/registerBuiltinCommands.ts`                | `registerBuiltinCommands()` |
|   251 | `src/stores/terminal/terminalStore.ts`              | Entire store body           |
|   240 | `src/stores/observability/jobsStore.ts`             | Entire store body           |


---


## 3  Copy-Paste Detection (jscpd)

**16 clones detected** (down from 23 — extracted listener registry, mode options, revealPath)

Duplication rate: **1.05%** tokens, **1.13%** lines

### 3.1  Cross-File Clones

| Tokens | Lines | Source A                 | Source B                     | What's Duplicated               |
| -----: | ----: | ------------------------ | ---------------------------- | ------------------------------- |
|    346 |    36 | `ChatTab.vue`            | `SidebarTab.vue`             | Panel lifecycle (title, active) |

### 3.2  Intra-File Clones

| Tokens | Lines | File                    | What's Duplicated                    |
| -----: | ----: | ----------------------- | ------------------------------------ |
|    217 |    41 | `LibraryAgentsTab.vue`  | User vs project agent sections       |
|    147 |    10 | `layoutSanitize.ts`     | Panel sanitize logic                 |


---


## 4  Runtime Safety Issues

Found by manual review and IDE diagnostics.

### 4.1  Type Safety

| Severity | File                                         | Line(s)  | Issue                                                |
| -------- | -------------------------------------------- | -------- | ---------------------------------------------------- |
| HIGH     | `src/ipc/wsBridge.ts`                        | 123, 141 | `payload as never` dispatch + `socket!` non-null     |
| MEDIUM   | `src/stores/chat/sessionsStore.ts`           | 310+     | Repeated `payload.data as {...}` casts in reducer    |
| MEDIUM   | `src-bun/app/chat/sessions.ts`               | 341      | `request as unknown as Record<string, unknown>`      |
| MEDIUM   | `src-bun/app/chat/sessions.ts`               | 717, 790 | `opts.reasoningEffort as ReasoningEffort`             |
| LOW      | `src/components/terminal/TerminalPanel.vue`  | 30, 225  | `as { compact? }`, `as HTMLInputElement`             |
| LOW      | `src/ipc/rendererLog.ts`                     | 58       | `console[method]` reassigned via `as unknown as`     |

### 4.2  Missing Error Handling

| Severity | File                                         | Line(s) | Issue                                                 |
| -------- | -------------------------------------------- | ------- | ----------------------------------------------------- |
| MEDIUM   | `src/components/terminal/TerminalPanel.vue`  | 327     | `invokeCommand('openUrl')` — no `.catch()`            |
| MEDIUM   | `src/App.vue`                                | 228     | `dafman:focus-session` listener never removed (HMR)   |
| MEDIUM   | `src-bun/app/terminal/terminalRegistry.ts`   | 311     | `flushTimer` never cleared on kill/exit               |

### 4.3  Performance

| Severity | File                                    | Line(s)  | Issue                                                  |
| -------- | --------------------------------------- | -------- | ------------------------------------------------------ |
| MEDIUM   | `src/components/chat/ChatWindow.vue`    | 237-249  | `timelineItems` rebuilds + sorts array every update    |
| MEDIUM   | `src/App.vue`                           | 73       | Double cast `as unknown as` on dockview group          |

### 4.4  Backend Specific

| Severity | File                                       | Line(s)    | Issue                                              |
| -------- | ------------------------------------------ | ---------- | -------------------------------------------------- |
| HIGH     | `src-bun/app/chat/sessions.ts`             | (entire)   | 2,233-line god object — CRUD+events+agents+MCP     |
| MEDIUM   | `src-bun/app/library/mcpRegistry.ts`       | 59-73      | Duplicated RPC wrapper (addConfig/updateConfig)    |
| MEDIUM   | `src-bun/app/client/fakeClient.ts`         | 287-290    | Raw `Error` throws (inconsistent with AppError)    |
| LOW      | `src-bun/app/client/client.ts`             | 21-24, 116 | Duplicate test seams (`setClientForTest` × 2)      |


---


## 5  Structural Issues

### 5.1  God Objects (top priority for splitting)

| File                                              | Lines | Problem                                                  |
| ------------------------------------------------- | ----: | -------------------------------------------------------- |
| `SessionDetailsPanel.vue`                         | 2,954 | 6+ distinct UI sections in one SFC                       |
| `sessions.ts`                                     | 2,233 | CRUD + events + agents + tasks + MCP + skills + commands |
| `sessionsStore.ts`                                | 1,466 | `applyToRecord` alone has CC 60                          |
| `MessageComposer.vue`                             | 1,398 | Lexical editor + toolbar + attachments + slash commands  |
| `ChatWindow.vue`                                  | 1,319 | Message list + scroll + auto-scroll + selection          |
| `layoutStore.ts`                                  | 1,145 | Dockview + edge panels + session tracking                |

### 5.2  Cross-Boundary Duplication

- **Settings type shape** defined twice: `src/stores/app/settingsStore.ts` + `src-bun/app/config/settings.ts` — 36 lines identical
- **ChatTab / SidebarTab** — 36 lines / 346 tokens of identical panel lifecycle logic → needs `usePanelLifecycle` composable


---


## 6  What's Been Done ✅

- [x] **Code style:** gts + Prettier adopted, spacious padding lines
- [x] **ESLint:** 715 issues → 300 warnings (0 errors)
- [x] **Shared utilities:** `createListenerRegistry`, `revealPath`, `MODE_OPTIONS`, `shellUtils`
- [x] **Directory restructure:** stores (6 folders), components (9 folders), backend (8 folders)
- [x] **Path aliases:** `@/` configured for all renderer imports (129 files)
- [x] **Dependencies:** removed unused, added unlisted transitive deps


---


## 7  Priority Cleanup Plan

### Phase 3 — Split God Objects (next)

- [ ] `SessionDetailsPanel.vue` (2,954 lines) → 6 sub-components
- [ ] `sessions.ts` (2,233 lines) → `sessionCrud.ts` + `sessionEvents.ts` + `sessionAgents.ts`
- [ ] `sessionsStore.ts` (1,466 lines) → extract `applyToRecord` into `sessionReducer.ts`
- [ ] `ChatWindow.vue` (1,319 lines) → extract scroll manager composable
- [ ] `MessageComposer.vue` (1,398 lines) → extract toolbar, attachment logic
- [ ] `registerBuiltinCommands.ts` → split by command group
- [ ] `layoutStore.ts` (1,145 lines) → separate edge panel logic

### Phase 4 — Fix Warnings (300 total)

- [ ] 120 `no-unnecessary-condition` — remove dead branches
- [ ] 63 `restrict-template-expressions` — add type narrowing
- [ ] 14 `vue/component-definition-name-casing` — standardize
- [ ] 13 `complexity` — reduce CC on 21 functions above 15
- [ ] 10 `prefer-nullish-coalescing` — `||` → `??`
- [ ] 9 `no-non-null-assertion` — replace `!` with guards
- [ ] 9 `no-unsafe-assignment` — add proper typing
- [ ] Remaining ~62 warnings across 14 rules

### Phase 5 — Runtime Safety

- [ ] Type IPC bridge payloads — eliminate `as unknown as` in wsBridge
- [ ] Add runtime validation for WS bridge messages
- [ ] Fix event listener leak in `App.vue`
- [ ] Add `.catch()` to unguarded IPC calls
- [ ] Clear `flushTimer` on terminal kill/exit
- [ ] Deduplicate `addConfig`/`updateConfig` in mcpRegistry

### Phase 6 — Additional Cleanup

- [ ] ChatTab/SidebarTab → `usePanelLifecycle` composable
- [ ] Settings type → shared file imported by both sides
- [ ] Remove/mark unused exports
- [ ] Add import sorting plugin
