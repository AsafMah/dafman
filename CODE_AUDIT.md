# Code Quality Audit

> **Date:** 2026-05-25
> **Codebase:** ~39,500 lines of TypeScript + Vue across `src/` and `src-bun/`
> **Tools used:** ESLint (strict TypeScript), jscpd (copy-paste detection), knip (dead code), IDE diagnostics

---


## 1  File Size Distribution

Thirty largest production files (excluding tests).
Files above **800 lines** are strong candidates for splitting.

| Lines | File                                        | Notes                            |
| ----: | ------------------------------------------- | -------------------------------- |
| 2,417 | `src/components/SessionDetailsPanel.vue`    | Largest file in codebase         |
| 1,939 | `src-bun/app/sessions.ts`                   | Backend session god-object       |
| 1,484 | `src/dev/Playground.vue`                    | Dev-only, not shipped            |
| 1,308 | `src/stores/sessionsStore.ts`               | Store body is 866 lines          |
| 1,190 | `src-bun/rpc.ts`                            | IPC handler registry             |
| 1,124 | `src/components/MessageComposer.vue`        | Lexical editor + toolbar         |
| 1,104 | `src/components/ChatWindow.vue`             | Message list + scroll            |
|   953 | `src/stores/layoutStore.ts`                 | Dockview orchestration           |
|   893 | `src/components/SessionsManager.vue`        | Sidebar session list             |
|   857 | `src/ipc/types.ts`                          | Shared type defs (expected big)  |
|   830 | `src/components/SettingsPanel.vue`           | Settings UI                      |
|   814 | `src/components/SessionHeaderControls.vue`  | Header bar controls              |
|   652 | `src-bun/index.ts`                          | Main process entry               |
|   642 | `src/components/PendingRequestCard.vue`     | Permission card                  |
|   595 | `src/components/TerminalPanel.vue`          | Terminal container               |
|   592 | `src/lib/chatEvents.ts`                     | Chat event reducer               |
|   592 | `src/components/LibraryAgentsTab.vue`       | Agent library UI                 |
|   591 | `src/App.vue`                               | Root component                   |
|   582 | `src-bun/test-server.ts`                    | Dev test server                  |
|   485 | `src-bun/app/fakeClient.ts`                 | Fake SDK client                  |


---


## 2  ESLint — Strict TypeScript Analysis

**Config:** `strictTypeChecked` + `eslint-plugin-vue/flat/recommended` + complexity rules.

**Total: 715 issues — 292 errors, 423 warnings**

### 2.1  Issues by Rule

| Count | Rule                                           | What It Means                                  |
| ----: | ---------------------------------------------- | ---------------------------------------------- |
|   132 | `no-unnecessary-condition`                     | Dead branches, always-true/false checks        |
|   118 | `no-undef`                                     | Undefined globals (Vue template macros mostly) |
|    85 | `require-await`                                | `async` functions that never `await`           |
|    81 | `restrict-template-expressions`                | Unsafe types in template literals              |
|    40 | `no-unnecessary-type-assertion`                | Redundant `as` casts that add nothing          |
|    25 | `no-non-null-assertion`                        | `!` instead of proper null checks              |
|    21 | `complexity`                                   | Cyclomatic complexity above 15                 |
|    20 | `no-unsafe-assignment`                         | Assignments from `any`-typed values            |
|    16 | `prefer-nullish-coalescing`                    | `||` where `??` is safer                       |
|    15 | `no-unsafe-call`                               | Calling an `any`-typed value                   |
|    14 | `no-unsafe-member-access`                      | Property access on `any`                       |
|    14 | `no-redundant-type-constituents`               | Union/intersection with redundant members      |
|    14 | `vue/component-definition-name-casing`         | Component name casing mismatch                 |
|     9 | `no-duplicate-imports`                          | Same module imported twice                     |
|     9 | `unified-signatures`                           | Overloads that can be a single signature       |
|     8 | `no-control-regex`                             | Control chars in regex (terminal handling)     |
|     8 | `vue/attributes-order`                         | Attribute order convention                     |
|     7 | `no-floating-promises`                         | Unhandled promise rejections                   |
|     6 | `vue/one-component-per-file`                   | Multiple components in one SFC                 |
|     5 | `no-unused-vars`                               | Unused variables                               |
|     5 | `vue/require-default-prop`                     | Props without defaults                         |
|     5 | `max-lines-per-function`                       | Function body > 200 lines                      |
|     4 | `use-unknown-in-catch-callback-variable`       | `catch(e)` without `unknown` type              |
|     4 | `no-unsafe-return`                             | Returning `any`-typed values                   |
|     4 | `no-misused-promises`                          | Promise used in non-async context              |
|     4 | `vue/return-in-computed-property`              | Computed missing return path                   |
|     3 | `no-unnecessary-type-conversion`               | Useless `.toString()` / `String()`             |
|     3 | `no-invalid-void-type`                         | `void` used outside return type                |
|     3 | `no-unnecessary-boolean-literal-compare`       | `=== true` / `=== false` on booleans           |
|     3 | `no-unsafe-argument`                           | `any` passed to typed parameter                |
|     3 | `no-dynamic-delete`                            | `delete obj[key]` on dynamic key               |
|     2 | `max-depth`                                    | Nesting > 4 levels deep                        |
|     2 | `no-useless-escape`                            | Unnecessary backslash escapes                  |
|     1 | `no-explicit-any`                              | Explicit `any` type annotation                 |
|     1 | `no-deprecated`                                | Using deprecated API                           |

### 2.2  Files with Most Issues

| Count | File                                        |
| ----: | ------------------------------------------- |
|    50 | `src-bun/app/fakeClient.ts`                 |
|    45 | `src/App.vue`                               |
|    41 | `src-bun/test-server.ts`                    |
|    34 | `src/components/SessionDetailsPanel.vue`    |
|    30 | `src/components/ChatWindow.vue`             |
|    29 | `src/components/TerminalPanel.vue`          |
|    26 | `src-bun/app/sessions.ts`                   |
|    26 | `src-bun/index.ts`                          |
|    18 | `src/main.ts`                               |
|    17 | `src/components/MessageComposer.vue`        |
|    17 | `src/components/SessionsManager.vue`        |
|    17 | `src/stores/layoutStore.ts`                 |
|    16 | `src/components/CommandPalette.vue`         |
|    14 | `src/components/MentionPlugin.vue`          |
|    14 | `src/components/SessionHeaderControls.vue`  |
|    13 | `src/components/SettingsPanel.vue`          |
|    13 | `src/stores/sessionsStore.ts`               |
|    12 | `src/lib/markdown.ts`                       |

### 2.3  Complexity Violations (Cyclomatic > 15)

Functions that are too branchy. Higher = harder to test and maintain.

| Complexity | File:Line                                              | Function              |
| ---------: | ------------------------------------------------------ | --------------------- |
|     **60** | `src/stores/sessionsStore.ts:287`                      | `applyToRecord`       |
|     **40** | `src/components/JsonSchemaForm.vue:160`                 | `validateNode`        |
|     **33** | `src/lib/chatEvents.ts:439`                            | `processEvents`       |
|     **32** | `src-bun/app/sessions.ts:182`                          | `normalizeTask`       |
|     **29** | `src/stores/layoutStore.ts:790`                        | `openEdgePanel`       |
|     **28** | `src/components/ToolDetails.vue:52`                    | (arrow fn)            |
|     **25** | `src-bun/app/sessions.ts:311`                          | `summarizePermission` |
|     **24** | `src-bun/app/sessions.ts:959`                          | `forward`             |
|     **24** | `src/lib/chatEvents/messageHandlers.ts:69`             | `user.message`        |
|     **23** | `src/components/SessionDetailsPanel.vue:440`           | `loadUsage`           |
|     **22** | `src-bun/app/pendingRequests.ts:153`                   | (handler)             |
|     **20** | `src-bun/app/settings.ts:240`                          | (handler)             |
|     **19** | `src/lib/chatEvents/messageHandlers.ts:135`            | (handler)             |
|     **19** | `src/stores/sessionsStore.ts:502`                      | (handler)             |
|     **18** | `src-bun/app/sessions.ts:1124`                         | (handler)             |
|     **18** | `src-bun/app/stderrFilter.ts:62`                       | (filter)              |
|     **18** | `src/stores/sessionsStore.ts:690`                      | (handler)             |
|     **17** | `src/components/McpServerForm.vue:108`                 | (form logic)          |
|     **17** | `src/lexical/plugins.ts:141`                           | (plugin)              |
|     **16** | `src-bun/app/sessions.ts:684`                          | (handler)             |
|     **16** | `src/components/TerminalPanel.vue:228`                 | (handler)             |

### 2.4  Oversized Functions (> 200 lines)

| Lines | File                                    | Function                    |
| ----: | --------------------------------------- | --------------------------- |
|   866 | `src/stores/sessionsStore.ts:239`       | Entire store body           |
|   622 | `src/stores/layoutStore.ts:163`         | Entire store body           |
|   379 | `src/lib/registerBuiltinCommands.ts:52` | `registerBuiltinCommands()` |
|   251 | `src/stores/terminalStore.ts:25`        | Entire store body           |
|   240 | `src/stores/jobsStore.ts:22`            | Entire store body           |

### 2.5  Max-Depth Violations (> 4)

| File                         | Line | Depth |
| ---------------------------- | ---: | ----: |
| `src-bun/app/audit.ts`       |  119 |     5 |
| `src/lib/chatEvents.ts`      |  560 |     5 |


---


## 3  Copy-Paste Detection (jscpd)

**23 clones detected** across the codebase.

Clones are sorted by significance (token count × lines).

### 3.1  Cross-File Clones (should extract to shared modules)

| Tokens | Lines | Source A                            | Source B                            | What's Duplicated                  |
| -----: | ----: | ----------------------------------- | ----------------------------------- | ---------------------------------- |
|    376 |    33 | `ChatTab.vue`                       | `SidebarTab.vue`                    | Panel lifecycle (title, isActive)  |
|    331 |    36 | `settingsStore.ts`                  | `settings.ts` (bun)                 | Default settings shape             |
|    257 |    27 | `electrobunBridge.ts`               | `wsBridge.ts`                       | IPC listener registry boilerplate  |
|    162 |    15 | `JsonSchemaField.vue`               | `JsonSchemaForm.vue`                | JSON Schema type definitions       |
|    147 |    12 | `PermissionDetails.vue`             | `PermissionRuleEditor.vue`          | Raw prop extraction helper         |
|    135 |    10 | `commandResultRegistry.ts`          | `terminalRegistry.ts`               | `commandExists()` helper           |
|    124 |    10 | `mcpRegistry.ts`                    | `skillsRegistry.ts`                 | `withClient()` wrapper             |
|    121 |    15 | `ChatPanel.vue`                     | `ChatTab.vue`                       | Props type + destructuring         |
|    116 |    12 | `ipc/types.ts`                      | `audit.ts`                          | Audit entry type shape             |
|    109 |    15 | `LibraryInstructionsTab.vue`        | `LibrarySkillsTab.vue`              | Accordion expand/collapse logic    |
|    103 |    11 | `MessageEditor.vue`                 | `MessageEditorBody.vue`             | Props + emit definitions           |
|    100 |    12 | `CodeEditor.vue`                    | `details/DiffEditor.vue`            | Monaco editor style setup          |
|     93 |    10 | `ModeButtonGroup.vue`               | `SessionHeaderControls.vue`         | Mode button CSS                    |
|     63 |    11 | `MentionPlugin.vue`                 | `SlashCommandPlugin.vue`            | Typeahead doc comment block        |

### 3.2  Intra-File Clones (internal repetition)

| Tokens | Lines | File                              | What's Duplicated                    |
| -----: | ----: | --------------------------------- | ------------------------------------ |
|    226 |    30 | `LibraryAgentsTab.vue`            | User vs project agent file sections  |
|    196 |    21 | `CommandPalette.vue`              | Dialog setup + imports               |
|    162 |    21 | `LibraryInstructionsTab.vue`      | User vs project instruction sections |
|    144 |    16 | `SessionsManager.vue`             | Create-session-with-workspace logic  |
|    129 |    14 | `ActivityBar.vue`                 | Top vs bottom activity items         |
|    127 |    17 | `LibraryInstructionsTab.vue`      | Group heading + expand buttons       |
|    101 |    10 | `JsonValueView.vue`               | Type detection switch                |
|     93 |    12 | `PendingRequestCard.vue`          | Comment blocks about SDK channels    |
|     61 |    11 | `ToolDetails.vue`                 | Conditional block rendering          |


---


## 4  Dead Code Detection (knip)

> ⚠️ **Knip caveat:** Knip doesn't understand Bun entry points or Electrobun
> config. The "unused files" list includes false positives like `src-bun/index.ts`,
> `electrobun.config.ts`, and test files. Focus on the exports and dependencies.

### 4.1  Unused Dependency

| Package           | Note                                                  |
| ----------------- | ----------------------------------------------------- |
| `@xterm/headless` | Was for headless terminal testing; no longer imported  |

### 4.2  Unused Dev Dependency

| Package                          | Note                                       |
| -------------------------------- | ------------------------------------------ |
| `@vue/eslint-config-typescript`  | Superseded by `typescript-eslint` directly  |

### 4.3  Unlisted Dependencies (used but not in `package.json`)

These are transitive deps that work today but could break on version bumps.

| Package             | Used In                                                    |
| ------------------- | ---------------------------------------------------------- |
| `dockview-core`     | Stores, ChatPanel, ChatTab, SidebarTab, ChatTabActions     |
| `prismjs`           | Lexical prism langs, markdown.ts                           |
| `@lexical/selection`| MessageComposer.vue                                        |

### 4.4  Unused Exports (shipped code, not test helpers)

| File                          | Unused Exports                                                       |
| ----------------------------- | -------------------------------------------------------------------- |
| `agentFiles.ts`               | `userAgentsDir`, `projectAgentsDir`                                  |
| `client.ts`                   | `setClientForTest`, `ensureClient`, `shutdownClient`                 |
| `copilotSdk.ts`               | `approveAll`, `convertMcpCallToolResult`, `createSessionFsAdapter`, `defineTool`, `SYSTEM_PROMPT_SECTIONS` |
| `logging.ts`                  | `getLogLevel`, `setLogLevel`, `subscribeLogs`                        |
| `settings.ts`                 | `ensureDefaultWorkspace`                                             |
| `stderrFilter.ts`             | `installStderrFilter`                                                |
| `plugins.ts`                  | `useLexicalComposer`                                                 |
| `chatEvents.ts`               | `clampOutput`, `pickNumber`, `pickString`                            |
| `layoutStore.ts`              | `shortPanelTitle`                                                    |

### 4.5  Unused Exported Types

Most are in `copilotSdk.ts`, `rpc.ts`, and `ipc/types.ts` — re-exports of SDK
types that exist for the public surface but aren't consumed internally yet.
**16 unused types** in `copilotSdk.ts` alone. These are mostly forward
declarations for planned features (plan mode, elicitation, permissions).


---


## 5  Structural Issues

### 5.1  God Objects

| File                      | Lines | Problem                                                  |
| ------------------------- | ----: | -------------------------------------------------------- |
| `SessionDetailsPanel.vue` | 2,417 | 6+ distinct UI sections in one SFC                       |
| `sessions.ts`             | 1,939 | CRUD + events + agents + tasks + MCP + skills + commands |
| `sessionsStore.ts`        | 1,308 | Store body is 866 lines; `applyToRecord` alone is 60 CC  |
| `layoutStore.ts`          |   953 | Dockview + edge panels + session tracking in one store   |
| `ChatWindow.vue`          | 1,104 | Message list + scroll + auto-scroll + selection          |
| `MessageComposer.vue`     | 1,124 | Lexical editor + toolbar + attachments + slash commands  |

### 5.2  Cross-Boundary Duplication

The settings type shape is defined **twice**: once in `src/stores/settingsStore.ts`
(renderer) and once in `src-bun/app/settings.ts` (main process). 36 lines / 331
tokens of identical structure. A single shared type file imported by both sides
would eliminate this and prevent drift.

The IPC listener registry pattern is copy-pasted between `electrobunBridge.ts`
and `wsBridge.ts` (27 lines / 257 tokens). Both implement `onSessionEvent`,
`onPendingRequest`, `onLogEvent`, etc. with identical add/remove-from-Set logic.
A shared `createListenerRegistry()` factory would DRY this.

### 5.3  `commandExists()` is Implemented Twice

Both `commandResultRegistry.ts:27` and `terminalRegistry.ts:43` have identical
10-line `commandExists()` functions that shell out to `where.exe` / `which`.
Should be a single shared utility in `src-bun/app/shellUtils.ts`.


---


## 6  Recommended Code Style

The current style is dense — minimal spacing, packed function bodies.
A **more spacious** style improves readability without adding real overhead:

### Spacing Rules (add to ESLint / Prettier)

```js
// -- Blank lines --
// Before and after: function declarations, class methods, control blocks,
// multi-line object/array literals, return statements preceded by logic.

// -- Function organization --
// Group related logic with a blank line and a short comment header:
//
//   // ── Session lifecycle ────────────────────────
//   function create() { ... }
//   function resume() { ... }
//   function destroy() { ... }
//
//   // ── Event processing ─────────────────────────
//   function processEvents() { ... }

// -- Imports --
// Group imports with blank lines between:
//   1. Node / Bun built-ins
//   2. Third-party packages
//   3. Internal modules (absolute paths)
//   4. Relative imports (sibling / parent)

// -- Object literals --
// Multi-property objects on separate lines, even if short:
//   const config = {
//     timeout: 5000,
//     retries: 3,
//     verbose: false,
//   };

// -- Conditionals --
// Early returns over nested if/else:
//   if (!session) return null;
//   if (!session.isActive) return null;
//   return session.data;
//
// Not:
//   if (session) {
//     if (session.isActive) {
//       return session.data;
//     }
//   }
//   return null;
```

### Recommended Prettier Config

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf",
  "singleAttributePerLine": true,
  "vueIndentScriptAndStyle": false
}
```


---


## 7  Priority Cleanup Plan

Ordered by impact — each phase is independently valuable.

### Phase 1 — Extract Shared Utilities (quick wins)

- [ ] `commandExists()` → `src-bun/app/shellUtils.ts`
- [ ] Settings type → `src/shared/settingsTypes.ts` (imported by both sides)
- [ ] IPC listener registry → `src/ipc/listenerRegistry.ts`
- [ ] Mode options list → `src/lib/sessionModeOptions.ts`
- [ ] Panel lifecycle (ChatTab/SidebarTab) → `src/composables/usePanelLifecycle.ts`
- [ ] Permission raw-prop extractor → `src/lib/permissionUtils.ts`
- [ ] Editor style constants → `src/lib/editorDefaults.ts`
- [ ] Accordion expand/collapse → `src/composables/useAccordion.ts`

### Phase 2 — Split God Objects

- [ ] `SessionDetailsPanel.vue` → 6 sub-components (Skills, MCP, Tools, Plan, Usage, Quota)
- [ ] `sessions.ts` → `sessionCrud.ts` + `sessionEvents.ts` + `sessionAgents.ts` + `sessionMcp.ts`
- [ ] `sessionsStore.ts` → extract `applyToRecord` into `src/lib/sessionReducer.ts`
- [ ] `registerBuiltinCommands.ts` → split by command group
- [ ] `ChatWindow.vue` → extract scroll manager composable
- [ ] `MessageComposer.vue` → extract toolbar, attachment logic

### Phase 3 — TypeScript Strictness

- [ ] Eliminate 40 unnecessary type assertions
- [ ] Replace 25 non-null assertions with proper guards
- [ ] Fix 7 floating promises (add `void` or `await`)
- [ ] Type the IPC bridge payloads to eliminate `as unknown as`
- [ ] Add runtime validation for WS bridge messages

### Phase 4 — Dead Code & Dependencies

- [ ] Remove `@xterm/headless` from dependencies
- [ ] Remove `@vue/eslint-config-typescript` from devDependencies
- [ ] Add `dockview-core`, `prismjs`, `@lexical/selection` to dependencies
- [ ] Remove or `@internal`-mark unused exports identified by knip
- [ ] Clean up unused exported types (decide: keep for planned API or remove)

### Phase 5 — Reduce Complexity

- [ ] `applyToRecord` (CC 60) → switch-map or strategy pattern per event type
- [ ] `validateNode` (CC 40) → per-type validator functions
- [ ] `processEvents` (CC 33) → handler registry (already partially done)
- [ ] `normalizeTask` (CC 32) → extract sub-normalizers
- [ ] `openEdgePanel` (CC 29) → separate create vs update paths
- [ ] Flatten 2 max-depth violations with early returns

### Phase 6 — Code Style & Formatting

- [ ] Add Prettier with spacious config (see §6)
- [ ] Add import sorting (eslint-plugin-import or `@trivago/prettier-plugin-sort-imports`)
- [ ] Enforce blank lines between function groups in stores
- [ ] One-time format pass on entire codebase
