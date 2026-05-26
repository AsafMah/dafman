# Code Quality Audit

> **Date:** 2026-05-25 (refreshed: all tables verified against codebase)
> **Codebase:** ~47,200 lines of production TypeScript + Vue across `src/` and `src-bun/` (58,500 including tests)
> **Tools used:** ESLint (strictTypeChecked), deep manual code review, IDE diagnostics, build-vs-buy analysis

---


## 1  File Size Distribution

Files above **800 lines** are strong candidates for splitting.

| Lines | File                                              | Notes                            |
| ----: | ------------------------------------------------- | -------------------------------- |
| 2,181 | `src/components/session/SessionDetailsPanel.vue`  | ↓774 — composables extracted     |
| 1,929 | `src-bun/app/chat/sessions.ts`                    | ↓304 — helpers to sessionHelpers |
| 1,635 | `src/dev/Playground.vue`                          | Dev-only, not shipped            |
| 1,396 | `src/components/chat/MessageComposer.vue`         | Lexical editor + toolbar         |
| 1,239 | `src-bun/rpc.ts`                                  | IPC handler registry             |
| 1,185 | `src/components/chat/ChatWindow.vue`              | ↓24 — VueUse + bus       |
| 1,149 | `src/stores/chat/sessionsStore.ts`                | ↓317 — reducer extracted |
| 1,145 | `src/stores/shell/layoutStore.ts`                 | Dockview orchestration  |
| 1,062 | `src/components/session/SessionsManager.vue`      | Sidebar session list    |
|   991 | `src/components/settings/SettingsPanel.vue`       | Settings UI             |
|   920 | `src/components/session/SessionHeaderControls.vue`| Header bar controls     |
|   904 | `src/ipc/types.ts`                                | Shared type defs (expected big)|
|   757 | `src/components/terminal/TerminalPanel.vue`       | ↓5 — VueUse + bus       |
|   721 | `src/components/library/LibraryAgentsTab.vue`     | Agent library UI                 |
|   712 | `src/components/permissions/PendingRequestCard.vue`| Permission card                 |
|   692 | `src-bun/test-server.ts`                          | Dev test server                  |
|   685 | `src/lib/chatEvents.ts`                           | Chat event barrel + legacy       |
|   681 | `src/App.vue`                                     | Root component                   |
|   657 | `src-bun/index.ts`                                | Main process entry               |
|   614 | `src/components/library/McpServerForm.vue`        | MCP server form                  |
|   605 | `src-bun/app/client/fakeClient.ts`                | Fake SDK client                  |
|   575 | `src/components/permissions/ToolDetails.vue`      | Tool detail view                 |
|   545 | `src/components/shared/FilePicker.vue`            | File picker component            |
|   540 | `src/components/shell/CommandPalette.vue`         | Command palette                  |
|   528 | `src/components/library/LibraryMcpTab.vue`        | MCP library tab                  |
|   521 | `src/components/observability/LogViewer.vue`      | Log viewer                       |
|   473 | `src/components/permissions/PermissionRuleEditor.vue` | Permission rule editor       |
|   461 | `src/components/observability/JobsPanel.vue`      | Jobs panel                       |
|   460 | `src/lib/registerBuiltinCommands.ts`              | ↓62 — dynamicCommands extracted  |
|   454 | `src/components/shared/JsonSchemaField.vue`       | JSON schema form field           |
|   432 | `src/components/terminal/TerminalsPanel.vue`      | Terminals list panel             |
|   424 | `src/components/library/LibraryInstructionsTab.vue`| Instructions library tab        |


---


## 2  ESLint — Strict TypeScript Analysis

**Config:** `strictTypeChecked` + `eslint-plugin-vue/flat/recommended` + complexity + `@stylistic/eslint-plugin`

**Current: 0 errors, 31 warnings** (down from 92 → dispatch tables, pick helpers, composable extraction, no-dynamic-delete fixes)

### 2.1  Issues by Rule

| Count | Rule                                           | What It Means                                  |
| ----: | ---------------------------------------------- | ---------------------------------------------- |
|    17 | `complexity`                                   | Cyclomatic complexity above 15                 |
|     6 | `no-non-null-assertion`                        | `!` instead of proper null checks              |
|     5 | `max-lines-per-function`                       | Function body > 200 lines                      |
|     1 | `max-depth`                                    | Nesting > 4 levels deep                        |
|     1 | `no-redundant-type-constituents`               | ESLint parser resolves AgentInfo as error type  |
|     1 | `no-unnecessary-type-assertion`                | Assertion doesn't change the type              |

### Rules disabled (with rationale)

| Rule                                           | Why disabled                                         |
| ---------------------------------------------- | ---------------------------------------------------- |
| `no-unsafe-*` (5 rules)                        | SDK interaction produces unavoidable `any` (418 hits)|
| `no-unnecessary-condition`                     | Defensive runtime checks are intentional (135 hits)  |
| `vue/one-component-per-file`                   | Test helpers / barrel exports (6 hits)               |
| `vue/require-default-prop`                     | TypeScript handles prop defaults (5 hits)            |

### 2.2  Remaining Complexity Hotspots

| CC | File                                                     | Function                    |
| -: | -------------------------------------------------------- | --------------------------- |
| 40 | `src/components/shared/JsonSchemaForm.vue`               | `validateNode`              |
| 29 | `src/stores/shell/layoutStore.ts`                        | `openEdgePanel`             |
| 28 | `src/components/permissions/ToolDetails.vue`             | (arrow fn)                  |
| 24 | `src-bun/app/chat/sessions.ts`                           | `forward`                   |
| 24 | `src/lib/chatEvents/messageHandlers.ts`                  | `user.message`              |
| 23 | `src/components/session/SessionDetailsPanel.vue`         | `loadUsage`                 |
| 22 | `src-bun/app/chat/pendingRequests.ts`                    | `respond`                   |
| 20 | `src-bun/app/config/settings.ts`                         | `coerceTerminal`            |
| 19 | `src/lib/chatEvents/messageHandlers.ts`                  | `normalizeAttachments`      |
| 19 | `src/stores/chat/sessionReducer.ts`                      | `trackSessionArtifact`      |
| 18 | `src-bun/app/terminal/stderrFilter.ts`                   | (arrow fn CC=18)            |
| 17 | `src/components/library/McpServerForm.vue`               | `structuredFromConfig`      |

### 2.3  Complexity Violations (Cyclomatic > 15)

| CC | File                                                     | Function                    | Status        |
| -: | -------------------------------------------------------- | --------------------------- | ------------- |
| 40 | `src/components/shared/JsonSchemaForm.vue`               | `validateNode`              | Open          |
| 29 | `src/stores/shell/layoutStore.ts`                        | `openEdgePanel`             | Open          |
| 28 | `src/components/permissions/ToolDetails.vue`             | (arrow fn)                  | Open          |
| 24 | `src-bun/app/chat/sessions.ts`                           | `forward`                   | Open          |
| 24 | `src/lib/chatEvents/messageHandlers.ts`                  | `user.message`              | Open          |
| 23 | `src/components/session/SessionDetailsPanel.vue`         | `loadUsage`                 | Open          |
| 22 | `src-bun/app/chat/pendingRequests.ts`                    | `respond`                   | Open          |
| 20 | `src-bun/app/config/settings.ts`                         | `coerceTerminal`            | Open          |
| 19 | `src/lib/chatEvents/messageHandlers.ts`                  | `normalizeAttachments`      | Open          |
| 19 | `src/stores/chat/sessionReducer.ts`                      | `trackSessionArtifact`      | Open          |
| 18 | `src-bun/app/terminal/stderrFilter.ts`                   | (arrow fn)                  | Open          |
| 18 | `src-bun/app/chat/sessions.ts`                           | `createSession`/`cwdFor`    | Open          |
| 17 | `src/components/library/McpServerForm.vue`               | `structuredFromConfig`      | Open          |
| 17 | `src-bun/app/config/settings.ts`                         | `structuredFromConfig`      | Open          |
| 17 | `src/lexical/plugins.ts`                                 | (plugin)                    | Open          |
| 16 | `src/components/terminal/TerminalPanel.vue`              | `initXterm`                 | Open          |
| 16 | `src-bun/app/chat/sessions.ts`                           | `resume`                    | Open          |
| ~~60~~ | ~~`src/stores/chat/sessionsStore.ts`~~               | ~~`applyToRecord`~~         | ✅ Fixed (→ ~4) |
| ~~33~~ | ~~`src/lib/chatEvents.ts`~~                          | ~~`processEvents`~~         | ✅ Fixed (→ ~10)|
| ~~32~~ | ~~`src-bun/app/chat/sessionHelpers.ts`~~             | ~~`normalizeTask`~~         | ✅ Fixed (→ ~6) |
| ~~25~~ | ~~`src-bun/app/chat/sessionHelpers.ts`~~             | ~~`summarizePermission`~~   | ✅ Fixed (→ ~4) |

### 2.4  Oversized Functions (> 200 lines)

| Lines | File                                                | Function                    |
| ----: | --------------------------------------------------- | --------------------------- |
|   614 | `src/stores/chat/sessionsStore.ts`                  | Entire store body (↓252)    |
|   598 | `src/stores/shell/layoutStore.ts`                   | Entire store body           |
|   334 | `src/lib/registerBuiltinCommands.ts`                | `registerBuiltinCommands()` (↓45) |
|   249 | `src/stores/terminal/terminalStore.ts`              | Entire store body           |
|   225 | `src/stores/observability/jobsStore.ts`             | Entire store body           |

### 2.5  Backend TypeScript errors (`src-bun/`) ✅ DONE (2026-05-25)

Previously 63 TS errors in `src-bun/`, none of which were caught by
`bun run check`. After the Phase A.5 sweep all 63 are clear and
`lint:tsc-bun` is now part of `bun run check`.

What was fixed:
- 7 stale `../rpc` import paths (directory-split regression)
- 3 stale `./app/audit` paths (now `./app/observability/audit`)
- `tools/vue-shim.d.ts` for the Counter.vue fixture
- 3 unused locals (`afterEach`, `cmd`, `removeEntry`)
- 5 missing `?.` chains on `Tool.handler` (which is optional)
- 5 test fixtures with missing `Appearance`/`TerminalPrefs`/`promoteToBackground` fields
- SDK shape drift:
  - `UserInputRequest`/`Response` moved from `index.js` → `types.js`
  - `extension-management` + `extension-permission-access` added to our
    `PermissionKind` union (both renderer + backend, kept in sync)
  - `account.getQuota()` now requires a request arg (`{}`)
  - `CopilotClientOptions.cliPath` removed → use
    `connection: RuntimeConnection.forStdio({ path })`
  - `SessionRegistry.delete`/`getMetadata` removed → use `deleteCliSession`/`getCwd`
- Bun.Terminal write signature update (`number` not `number | undefined`,
  `Bun.BufferSource` not bare `BufferSource`); `signalCode` is now
  `number | null` not `string | null` (converted at call site)
- Node fs `Dirent<NonSharedBuffer>` typing fix (use `readdir(dir,
  { encoding: 'utf-8' })` for string entries; explicit `Dirent` import
  from `node:fs` for the with-file-types path)
- 5 `as unknown as` cross-casts for SDK generated → loose `Record<string, unknown>`
- `fakeClient.rpc` type widened to nested `RpcNamespace` for `mcp.config.*`
  and `mcp.oauth.*` 3-level namespaces
- `Promise<void>` → `Promise<undefined>` in `rendererLog` rpcGuard return

**Now gated:** `bun run check` runs `lint:tsc-bun` between `lint:bun` and
`test`, so any new src-bun TS error fails CI.


---


## 3  Copy-Paste Detection (jscpd)

**70 clones detected** in `src/` (up from 16 — earlier number was scoped narrowly)

Duplication rate: **2.86%** tokens, **2.56%** lines (895 / 34,992 lines)

Of the 70, ~32 are in production code (excluding `__tests__/`); the rest are
boilerplate in test setup (acceptable). 14 cross-file + 18 intra-file are
addressable.

### 3.1  Cross-File Clones (Production)

| Lines | Source A | Source B | What's Duplicated |
| ----: | -------- | -------- | ----------------- |
| 17 | `SubagentBlock.vue:64` | `useSessionTasks.ts:110` | Sub-agent task aggregation |
| 16 | `JsonSchemaField.vue:23` | `JsonSchemaForm.vue:35` | Schema field type narrowing |
| 16 | `JobsPanel.vue:78` | `useSessionTasks.ts:105` | Task list rendering |
| 16 | `LibraryInstructionsTab.vue:337` | `LibrarySkillsTab.vue:279` | Library tab boilerplate |
| 15 | `PermissionDetails.vue:22` | `PermissionRuleEditor.vue:39` | Permission shape mapping |
| 15 | `LibraryMcpTab.vue:315` | `LibraryToolsTab.vue:153` | Library tab boilerplate |
| 13 | `sessionMetaHandlers.ts:12` | `useSessionUsage.ts:7` | Usage parsing |
| 12 | `MentionPlugin.vue:133` | `SlashCommandPlugin.vue:184` | Lexical trigger plugin scaffolding |
| 11 | `JsonSchemaField.vue:85` | `JsonSchemaForm.vue:246` | Field validation |
| 11 | `PermissionDetails.vue:54` | `ToolDetails.vue:182` | Permission/tool detail render |
| 11 | `DiffEditor.vue:52` | `CodeEditor.vue:99` | CodeMirror setup |
| 11 | `ModeButtonGroup.vue:116` | `SessionHeaderControls.vue:625` | Mode button rendering |
| 7  | `sessionMetaHandlers.ts:101` | `sessionReducer.ts:179` | Session meta merge logic |

### 3.2  Intra-File Clones (Production, top 12)

| Lines | File | What's Duplicated |
| ----: | ---- | ----------------- |
| 42 | `LibraryAgentsTab.vue:284,333` | User vs project agent sections |
| 33 | `CommandPalette.vue:206,246` | Keyboard nav blocks |
| 26 | `LibraryInstructionsTab.vue:149,204` | User vs project instructions |
| 25 | `LibraryInstructionsTab.vue:174,229` | (same — 2 paste sites) |
| 23 | `ActivityBar.vue:146,170` | Button group render |
| 23 | `JsonSchemaField.vue:164,222` | Field type rendering (string/number/bool) |
| 22 | `JsonSchemaField.vue:164,275` | (same field, repeated 3× total) |
| 22 | `JsonSchemaField.vue:164,339` | (same — 4 type-branches identical) |
| 16 | `McpServerForm.vue:360,422` | Env var entry blocks |
| 16 | `ToolDetails.vue:273,288,434,458` | Tool category headers (2 pairs) |
| 16 | `JsonValueView.vue:128,164` | Value render branches |

**High-ROI extraction candidates:**
1. `JsonSchemaField.vue` — 4 near-identical type branches (~70 lines) → polymorphic per-type sub-component
2. `LibraryAgentsTab` / `LibraryInstructionsTab` / `LibrarySkillsTab` / `LibraryMcpTab` / `LibraryToolsTab` — all share user/project tab pattern → `<LibraryTabPanel :user :project>` wrapper
3. `SubagentBlock` ↔ `useSessionTasks` ↔ `JobsPanel` — task aggregation in 3 places → single `useTaskAggregation` composable
4. `MentionPlugin` ↔ `SlashCommandPlugin` — Lexical trigger plugin scaffolding → shared `createTriggerPlugin()`
5. `DiffEditor` ↔ `CodeEditor` — CodeMirror setup → shared `useCodeMirror()` composable


---


## 4  Runtime Safety Issues

Found by manual review and IDE diagnostics.

### 4.1  Type Safety

| Severity | File                                         | Line(s)  | Issue                                                |
| -------- | -------------------------------------------- | -------- | ---------------------------------------------------- |
| HIGH     | `src/ipc/wsBridge.ts`                        | 123, 141 | `payload as never` dispatch + `socket!` non-null     |
| MEDIUM   | `src/stores/chat/sessionsStore.ts`           | 310+     | Repeated `payload.data as {...}` casts in reducer    |
| MEDIUM   | `src-bun/app/chat/sessions.ts`               | 777      | `event as unknown as Record<string, unknown>`        |
| MEDIUM   | `src-bun/app/chat/sessions.ts`               | 413, 486, 1000 | `opts.reasoningEffort as ReasoningEffort`       |
| LOW      | `src/components/terminal/TerminalPanel.vue`  | 30, 225  | `as { compact? }`, `as HTMLInputElement`             |
| LOW      | `src/ipc/rendererLog.ts`                     | 58       | `console[method]` reassigned via `as unknown as`     |

### 4.2  Missing Error Handling

| Severity | File                                         | Line(s) | Issue                                                 |
| -------- | -------------------------------------------- | ------- | ----------------------------------------------------- |
| MEDIUM   | `src/components/terminal/TerminalPanel.vue`  | 327     | `invokeCommand('openUrl')` — no `.catch()`            |
| ~~MEDIUM~~   | ~~`src/App.vue`~~                        | ~~228~~ | ~~`dafman:focus-session` listener never removed (HMR)~~ ✅ Fixed |
| ~~MEDIUM~~   | ~~`src-bun/app/terminal/terminalRegistry.ts`~~ | ~~311~~ | ~~`flushTimer` never cleared on kill/exit~~ ✅ Fixed |

### 4.3  Performance

| Severity | File                                    | Line(s)  | Issue                                                  |
| -------- | --------------------------------------- | -------- | ------------------------------------------------------ |
| MEDIUM   | `src/components/chat/ChatWindow.vue`    | 231-244  | `timelineItems` rebuilds + sorts array every update    |
| MEDIUM   | `src/App.vue`                           | 72       | Double cast `as unknown as` on dockview group          |

### 4.4  Backend Specific

| Severity | File                                       | Line(s)    | Issue                                              |
| -------- | ------------------------------------------ | ---------- | -------------------------------------------------- |
| HIGH     | `src-bun/app/chat/sessions.ts`             | (entire)   | 1,929-line god object — CRUD+events+agents+MCP     |
| MEDIUM   | `src-bun/app/library/mcpRegistry.ts`       | 59-73      | Duplicated RPC wrapper (addConfig/updateConfig)    |
| MEDIUM   | `src-bun/app/client/fakeClient.ts`         | 287-290    | Raw `Error` throws (inconsistent with AppError)    |
| LOW      | `src-bun/app/client/client.ts`             | 21-24, 116 | Duplicate test seams (`setClientForTest` × 2)      |


---


## 5  Build vs Buy — Reinventing the Wheel Analysis

Systematic audit of every hand-rolled pattern in the codebase against available
libraries and Bun-native APIs. Sorted by replacement ROI (lines deleted × bug
risk reduced).

### Legend

- 🔴 **Replace** — mature library exists, we maintain buggy/incomplete reimplementation
- 🟡 **Consider** — library exists, but our version is acceptable or domain-specific
- 🟢 **Keep** — domain-specific, no library would cover this

### 5.1  Renderer (`src/`)

| What we hand-rolled | File(s) | Lines | Library alternative | Verdict |
|---|---|---:|---|---|
| ~~**Event bus** (window.dispatchEvent)~~ | ~~9 files, 13 dispatchers, 9 listeners~~ | ~~80~~ | ~~**mitt** (200B) or VueUse `useEventBus`~~ | ✅ Done — mitt + src/lib/bus.ts (Phase A) |
| ~~**localStorage persist** (manual JSON.parse/stringify + try/catch)~~ | ~~terminalStore.ts:135-193~~ | ~~60~~ | ~~**pinia-plugin-persistedstate**~~ | ✅ Done — `usePersistedRef` (Phase A); declined pinia-plugin (no throttle/cap) |
| ~~**Deferred listener queue** (if bridge, register; else queue)~~ | ~~invoke.ts:100-221~~ | ~~120~~ | ~~Single generic `createDeferredChannel<T>()`~~ | ✅ Done — `createDeferredChannel<L>()` (Phase A) |
| **Pub/sub fan-out** (`Set<Listener>`, subscribe, fanOut) | listenerRegistry.ts:45-95 | ~50 | **mitt** does exactly this in 200B | 🔴 Replace — hand-rolled EventEmitter |
| ~~**ANSI stripping** (3 regexes)~~ | ~~ansi.ts:1-25~~ | ~~25~~ | ~~**strip-ansi**~~ | ✅ Done (Phase A) — also fixed OSC ST-terminator bug |
| **setTimeout focus hacks** (`setTimeout(fn, 0)`) | 6 components, ~10 sites | ~30 | VueUse `useFocus`, `useActiveElement`, `nextTick` | 🟡 Consider — some are legitimate, most are lifecycle hacks |
| **Scroll management** (manual rAF + double nextTick) | ChatWindow.vue:246-349 | ~100 | VueUse `useScroll`, `useInfiniteScroll` | 🟡 Consider — our scroll logic is custom (event batching + scroll-to-bottom), but the rAF scheduling could use `useDebounceFn`/`useRafFn` |
| ~~**Resize observer** (raw ResizeObserver in ChatWindow)~~ | ~~ChatWindow.vue:157-190~~ | ~~30~~ | ~~VueUse `useResizeObserver`~~ | ✅ Done — Phase A (ChatWindow + MessageComposer + TerminalPanel) |
| **Debounce** (manual setTimeout timers) | SessionsManager.vue:188-226, App.vue:450-455 | ~40 | VueUse `useDebounceFn` or `watchDebounced` | 🔴 Replace — hand-rolled timer management |
| **`toErrorMessage()`** (ternary wrapper) | errorMessage.ts:1-5 | 5 | Inline `err instanceof Error ? err.message : String(err)` or **serialize-error** | 🟡 Consider — trivial, but used everywhere; keep as utility, just not a whole file |
| ~~**CodeMirror language resolver**~~ | ~~codeLanguage.ts:1-148~~ | ~~148~~ | ~~**@codemirror/language-data**~~ | ✅ Done — Phase A (+ lang-vue + lang-sass) |
| **Markdown pipeline** (markdown-it + DOMPurify + Prism + class rewrite) | markdown.ts:1-395 | 395 | Keep — this is heavily customized (lex-* classes, KaTeX style hook, system_notification stripping). No drop-in exists | 🟢 Keep |
| **Tool renderer registry** | toolRenderers.ts:1-296 | 296 | Keep — domain-specific, no library for this | 🟢 Keep |
| **Diff/patch parser** | diff.ts:1-92 | 92 | Keep — parses the Copilot `apply_patch` format, not standard unified diff | 🟢 Keep |
| **Terminal shell integration** (OSC 633/133/7/9/1337) | terminalShellIntegration.ts:1-131 | 131 | Keep — VS Code-specific protocol, no npm package for this | 🟢 Keep |
| **Model tree builder** | modelTree.ts:1-241 | 241 | Keep — PrimeVue TreeSelect-specific, domain logic | 🟢 Keep |
| **Layout sanitizer** | layoutSanitize.ts:1-217 | 217 | Keep — dockview-specific JSON migration/sanitization | 🟢 Keep |
| **Session commands** | sessionCommands.ts | 221 | Keep, but should talk through a typed bus instead of window events | 🟡 Consider |
| **Color palette** | color.ts:1-35 | 35 | Keep — curated palette, 12 hues, trivial code | 🟢 Keep |
| **Notification styles** | notificationStyles.ts:1-133 | 133 | Keep — domain-specific style mapping | 🟢 Keep |
| **Export conversation** | exportConversation.ts:1-257 | 257 | Keep — domain-specific format | 🟢 Keep |
| **Theme resolver** | theme.ts:1-17 | 17 | Keep — trivial, domain-specific | 🟢 Keep |
| **Path actions** | pathActions.ts:1-22 | 22 | Keep — thin wrapper with toast, specific to our IPC | 🟢 Keep |
| **Renderer log bridge** | rendererLog.ts:1-91 | 91 | Keep — specific to Electrobun IPC | 🟢 Keep |
| **Open attachment** | openAttachment.ts:1-69 | 69 | Keep — domain-specific | 🟢 Keep |
| **Command palette search** | palette.ts:1-29 | 29 | Keep — trivial, adapts vue-command-palette | 🟢 Keep |
| **Dynamic commands** | dynamicCommands.ts | — | Keep — domain-specific | 🟢 Keep |
| **Session mode options** | sessionModeOptions.ts | — | Keep — domain-specific | 🟢 Keep |

### 5.2  Backend (`src-bun/`)

| What we hand-rolled | File(s) | Lines | Library/API alternative | Verdict |
|---|---|---:|---|---|
| **JSON-lines logger** (file append + ring buffer + subscribers) | logging.ts:1-227 | 227 | **pino** (Bun-compatible, JSON logger, built-in file rotation, child loggers) or **winston** | 🟡 Consider — ours works and has redaction baked in; pino would give us log rotation, pretty-print, and child loggers for free. But migrating redaction hooks is work |
| **Audit log** (JSONL append + ring buffer + subscribers) | audit.ts:1-234 | 234 | Same pattern as logging — could share infrastructure. Or use pino with separate transport | 🟡 Consider — shares 90% of logging.ts's structure (ring buffer, subscribers, file append). Should at minimum share the generic ring+append pattern |
| **Redaction** (regex key matching + depth-limited walk) | redact.ts:1-162 | 162 | **pino-noir** / **pino** built-in redaction paths | 🟡 Consider — if we adopt pino, redaction comes free. If we keep custom logger, our redaction is good enough |
| **File search** (recursive walk + fuzzy match + caching) | fileSearch.ts:1-316 | 316 | **globby** or **fast-glob** + **fuse.js** for fuzzy scoring. Bun also has `Bun.Glob` built-in | 🟡 Consider — our path-navigation mode is domain-specific; but the recursive walk + scoring could use `Bun.Glob` for the walk and fuse.js for fuzzy matching |
| **Stderr filter** | stderrFilter.ts:1-127 | 127 | Keep — highly specific to Copilot CLI's node-pty noise | 🟢 Keep |
| **Diagnostics export** | diagnostics.ts:1-188 | 188 | Could use **archiver** or `Bun.zip` (when stable) to produce actual ZIP instead of folder. But current approach works | 🟡 Consider — `Bun.write()` + folder copy is fine for v1 |
| **Error types** (AppError discriminated union + rpcGuard) | errors.ts:1-89 | 89 | Keep — specific to our RPC bridge | 🟢 Keep |
| **Settings coercion** | settings.ts | — | **zod** or **valibot** for schema validation + coercion | 🟡 Consider — zod would give us type-safe validation, coercion, and default values. Our manual coercion functions are CC=20+ |
| **`toErrorMessage()`** (same as renderer) | shared/errorMessage.ts:1-5 | 5 | Same — trivial utility, keep | 🟢 Keep |

### 5.3  Bun-native APIs we're not using

Bun has APIs that could replace some of our code:

| Bun API | What it replaces | Current code |
|---|---|---|
| `Bun.Glob` | Part of fileSearch.ts's recursive walk | Hand-rolled `fs.readdir` + recursion |
| `Bun.file().text()` / `Bun.write()` | Various `readFile`/`writeFile` calls | Using `node:fs/promises` throughout |
| `Bun.spawn()` with `stdout: 'pipe'` | CLI process management | Already using this, good |
| `Bun.serve()` + WebSocket | Dev server / HMR bridge | Already using via Electrobun, fine |
| `Bun.password.hash()` | N/A — we don't do auth | N/A |
| `Bun.Transpiler` | N/A — Vite handles renderer | N/A |

### 5.4  PrimeVue — components we have but don't use

We pay for PrimeVue (~80 components, directives, composables) but only use
~15 of them: Button, InputText, Select, SelectButton, ToggleSwitch, Chip,
TreeSelect, Dialog, Popover, SplitButton, RadioButton, Textarea, InputNumber,
ColorPicker, AutoComplete, Tabs/TabList/Tab/TabPanels/TabPanel, Tag,
Toast, ConfirmDialog, ConfirmPopup.

Patterns we hand-roll that PrimeVue already provides:

| What we hand-roll | PrimeVue component/directive | Where we reinvent |
|---|---|---|
| **Tooltips** (`title="..."` everywhere) | `v-tooltip` directive or `Tooltip` component — animated, themed, positioned | 90+ `title=` attrs across all components |
| **Badges** (`.badge-pending`, `.open-badge`, `.activity-badge`) | `Badge` / `BadgeDirective` (`v-badge`) — overlay or standalone | SessionsManager, ActivityBar, ChatTab |
| **Empty states** (`.empty-hint`, `.empty-message`, `.logviewer-empty`, etc.) | `Message` component with `severity="info"` or custom `EmptyMessage` | 30+ hand-styled empty-state `<div>`s |
| **Loading spinners** (custom `@keyframes` per component) | `ProgressSpinner` or `Skeleton` — consistent, themed | 5 components with custom `@keyframes` |
| **Copy to clipboard** (raw `navigator.clipboard.writeText`) | VueUse `useClipboard` (not PrimeVue, but ecosystem) | MessageActions, CodeEditor, TerminalPanel |
| **Scrollable panels** (raw `overflow-y: auto`) | `ScrollPanel` — custom scrollbar, themed | 12+ components with manual overflow |
| **Accordion sections** (manual v-if toggles) | `Accordion` / `AccordionTab` | SessionDetailsPanel (10+ collapsible sections) |
| **Virtual scrolling** (none — renders all items) | `VirtualScroller` — built into DataTable/Listbox | ChatWindow (renders all transcript items) |
| **Keyboard shortcuts** | VueUse `useMagicKeys` / `onKeyStroke` | 6 components with raw addEventListener('keydown') |

### 5.5  Vue ecosystem — broader misses

| Category | What we hand-roll | Ecosystem solution |
|---|---|---|
| **Clipboard** | Raw `navigator.clipboard.writeText` + try/catch in 5 files | VueUse `useClipboard` — reactive, fallback support |
| **Event listeners** | Raw `addEventListener`/`removeEventListener` in 13 files | VueUse `useEventListener` — auto-cleanup on unmount |
| **Resize/Intersection/Mutation observers** | Raw `new ResizeObserver()` in 4 files | VueUse `useResizeObserver`, `useIntersectionObserver`, `useMutationObserver` |
| **Dark mode** | Custom `theme.ts` (17 lines) | VueUse `useDark` / `useColorMode` |
| **Window focus** | Raw `document.hasFocus()` checks | VueUse `useWindowFocus` — reactive |
| **Local/Session storage** | Manual `JSON.parse(localStorage.getItem(...))` with try/catch | VueUse `useLocalStorage` / `useSessionStorage` — reactive, type-safe |
| **Debounce/Throttle** | 10+ manual `setTimeout` timers with cleanup | VueUse `useDebounceFn` / `useThrottleFn` / `watchDebounced` |
| **Transition animations** | 5 custom `@keyframes` blocks | Vue `<Transition>` + PrimeVue animation classes |
| **Form validation** | None (manual checks scattered) | **vee-validate** + zod/valibot schema — typed, reactive, per-field |

### 5.6  Summary of recommended replacements

**High-ROI replacements (Phase A — do first):**

| Library | Replaces | Lines deleted | Weekly downloads |
|---|---|---:|---|
| **@vueuse/core** | event listeners, debounce, localStorage, resize observer, focus management, rAF helpers | ~300+ | 3.8M |
| **mitt** | window event bus (13 dispatchers, 10 listeners) + listenerRegistry.ts | ~130 | 3.5M |
| **pinia-plugin-persistedstate** | terminalStore manual localStorage | ~60 | 800K |
| **strip-ansi** | ansi.ts regexes | ~25 | 160M |
| **@codemirror/language-data** | codeLanguage.ts manual ext→lang map | ~100 | 300K |

**Medium-ROI (Phase B — consider after A):**

| Library | Replaces | Benefit |
|---|---|---|
| **zod** or **valibot** | settings.ts coercion (CC=20) | Type-safe validation, eliminates complexity warnings |
| **pino** | logging.ts + audit.ts shared pattern | Log rotation, child loggers, built-in redaction |
| **fuse.js** | fileSearch.ts scoring logic | Better fuzzy matching, maintained algorithm |

**Keep as-is (domain-specific, no good library):**

markdown.ts, diff.ts, terminalShellIntegration.ts, modelTree.ts,
layoutSanitize.ts, toolRenderers.ts, exportConversation.ts, errors.ts,
notificationStyles.ts, stderrFilter.ts, rendererLog.ts


---


## 6  Architectural / Design Debt (Deep Review)

These are the real problems — not ESLint numbers but structural patterns that
make the codebase fragile, hard to reason about, and expensive to change.

### 6.0  No utility libraries — everything is hand-rolled

The project has **zero general-purpose utility libraries**: no VueUse, no lodash,
no mitt, no date-fns, no pinia-plugin-persist. Every common pattern — event
emitters, debounce, localStorage persistence, scroll management, resize
observers, deferred execution — is reimplemented from scratch.

This is the root cause of many items below. Adopting VueUse alone would delete
hundreds of lines of bespoke plumbing.

### 6.1  Window event bus — 8 custom events, untyped, scattered

The codebase uses `window.dispatchEvent(new CustomEvent('dafman:*'))` as a
global event bus. **13 dispatch sites** across 8 files, **10 listener sites**
across 6 files. No type safety, no central registry, no cleanup guarantees.

| Event name | Dispatched from | Listened in |
|---|---|---|
| `dafman:focus-session` | notificationsStore:120 | App.vue:245 |
| `dafman:focus-composer` | TerminalPanel:266, CommandPalette:126, SessionsManager:362 | ChatWindow:139 |
| `dafman:focus-terminal` | useCommandTerminal:94, SessionHeaderControls:257 | TerminalPanel:437 |
| `dafman:open-command-terminal` | *(dispatched somewhere)* | ChatWindow:140 |
| `dafman:close-command-terminal` | SessionHeaderControls:268 | ChatWindow:141 |
| `dafman:scroll-to-bottom` | SessionsManager:357, jobsStore:149 | ChatWindow:142 |
| `dafman:open-model-selector` | sessionCommands:163 | SessionHeaderControls:47 |
| `dafman:library-activate-tab` | sessionCommands:81, useSessionSkills:64 | LibraryPanel:64 |
| `dafman:rename-session` | sessionCommands:221 | *(listener not found in grep)* |

**Problems:**
- No TypeScript coverage — event names are bare strings, payloads are `any`
- No guaranteed cleanup — some listeners use `removeEventListener` in `onUnmounted`,
  but `App.vue:245` never removes the `dafman:focus-session` listener (HMR leak)
- Untraceable data flow — you can't ctrl-click from dispatch to handler
- Testing requires `window.dispatchEvent` mocking instead of direct calls

**Fix:** Replace with a typed event bus (mitt — 200 bytes gzipped), or
provide/inject for parent→child, or store subscriptions.

### 6.2  invoke.ts — deferred listener queue (repeated 6×)

`src/ipc/invoke.ts:100–221`: six identical blocks, each following the pattern:
```ts
const pendingXListeners = new Set<Listener>();
export function onX(cb: Listener): () => void {
  if (rpcBridge) { /* register directly */ }
  else { pendingXListeners.add(cb); }
  return () => { /* unsubscribe */ };
}
// later in setRpcBridge(): for (const cb of pendingXListeners) { ... }
```

The listenerRegistry.ts (`createListenerRegistry`) already abstracts the
subscribe/fanOut part — but invoke.ts duplicates the **deferred registration**
pattern 6 more times on top. This is ~120 lines of pure boilerplate.

**Fix:** Single `createDeferredChannel<T>()` factory. Or just use mitt with
lazy initialization.

### 6.3  listenerRegistry.ts is hand-rolled mitt

`src/ipc/listenerRegistry.ts:45–95` implements a typed pub/sub with
`Set<Listener>`, `subscribe()`, and `fanOut()`. This is literally what
`mitt` does in 200 bytes — but custom, with manual error swallowing.

### 6.4  layoutStore vs dockview — 12 `as unknown as` casts

`src/stores/shell/layoutStore.ts` has 12 `as unknown as` casts (counted from
grep, not estimated), all probing dockview-vue's untyped internal objects:

```ts
// line 213: accessing group's panels
(group as unknown as { panels?: unknown[] }).panels
// line 250: accessing edge API
edge as unknown as { isExpanded?: boolean; setExpanded?: (b: boolean) => void }
// lines 286-287: reading dock dimensions
(dock as unknown as { width?: number })?.width
// line 769: panel move API mismatch
target as unknown as Parameters<typeof panel.api.moveTo>[0]['group']
// line 831: removePanel type mismatch
dock.removePanel(panel as unknown as Parameters<typeof dock.removePanel>[0])
// lines 932, 955-956, 1005, 1007, 1059: more shape probes
```

Also in `App.vue:71-73`:
```ts
dock.groups.filter((g) => (g as unknown as { location?: { type?: string } }).location?.type === 'grid')
```

**Root cause:** dockview-vue exports generic `IDockviewPanel` / `DockviewGroupPanel`
types but the actual runtime objects have richer shape (`.panels`, `.width`,
`.isExpanded`). The codebase reaches into these undocumented internals.

**Fix:** Create a `dockviewTypes.ts` with typed interfaces that mirror the
runtime shape we use, and centralize the cast to one `asDockviewInternal()`
helper. Then when dockview upgrades, there's one place to fix.

### 6.5  Store dependency graph — spaghetti

Direct store-to-store imports (production code only, not tests):

```
sessionsStore ──→ layoutStore
              ──→ notificationsStore
              ──→ settingsStore
              ──→ toastStore

sessionReducer ──→ layoutStore
               ──→ notificationsStore
               ──→ toastStore

terminalStore ──→ sessionsStore
              ──→ toastStore

jobsStore ──→ layoutStore
          ──→ sessionsStore
          ──→ toastStore

settingsStore ──→ toastStore
notificationsStore ──→ settingsStore
clientStore ──→ toastStore
sessionsListStore ──→ toastStore
modelsStore ──→ toastStore
commandResultsStore ──→ toastStore
```

**Circular dependency:** ✅ Resolved in Phase B (commit `c63b36a`).
Previously `layoutStore` did a `require('../chat/sessionsStore')` at
runtime to look up panel titles (commented as "Dynamic import avoids
circular dependency" — a workaround, not a fix). Now `layoutStore`
exposes `setSessionTitleResolver(fn)` injected at boot by App.vue;
neither store imports the other.

`sessionsStore → layoutStore` for `activeSessionId` READS (unseen-dot
watcher, sessionReducer's `shouldFireForRecord` and `handleTurnEnd`)
is acceptable one-way coupling — layoutStore already publishes that
value and pulling it via injection would be overkill for the cost.

**toastStore is a universal dependency** — 8 stores import it. Per the
2026-05-25 rubber-duck on Phase B, this is acceptable as-is: stores
catch + toast + (optionally) rethrow per documented contract; decoupling
to App-level watchers would create silent-failure risks. Treated as a
legitimate cross-cutting concern (same as the `log` import).

**Fix (legacy):** ~~Stores should be pure data layers.~~ Superseded:
layout/session coupling is resolved; toast coupling stays.

### 6.6  Components bypassing stores for IPC ✅ Mostly fixed (Phase B, 2026-05-25)

Before: 12 Vue components called `invokeCommand()` directly (36 call sites).

After Phase B: **3 calls remaining** in 2 files, all per-instance picker
flows that the rubber-duck explicitly recommended NOT extracting
(SessionDetailsPanel `saveExportFile`, FilePicker `searchWorkspaceFiles`
+ `pickAttachment`). Everything else moved into composables or shared
helpers — see §7 Phase B entry for the new module layout.

### 6.7  terminalStore — hand-rolled localStorage persistence (duplicated 2×)

`src/stores/terminal/terminalStore.ts:135–193`: two nearly-identical
set/hydrate pairs for `sessionTerminalIds` and `sessionTerminalBuffers`:
```ts
function setSessionTerminalIds(map: Record<string, string>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}
function hydrateSessionTerminalIds(): Record<string, string> {
  try { const raw = localStorage.getItem(LS_KEY); return JSON.parse(raw!); } catch { return {}; }
}
// repeated identically for sessionTerminalBuffers
```

**Fix:** Either `pinia-plugin-persistedstate` (zero-config Pinia persistence),
or a generic `usePersistedRef<T>(key, defaultValue)` composable.

### 6.8  20+ setTimeout / requestAnimationFrame timing hacks

| File | Count | What they do |
|---|---:|---|
| `App.vue` | 6 | Splash watchdog, layout save debounce, boot retry, double-rAF settle |
| `ChatWindow.vue` | 5 | Event processing scheduler (rAF), scroll-to-bottom (double rAF + nextTick) |
| `MessageComposer.vue` | 4 | Focus hacks (`setTimeout(() => editor.focus(), 0)` × 3), esc timer |
| `TerminalPanel.vue` | 4 | Search rAF debounce, focus terminal after init, fit after delay |
| `SessionHeaderControls.vue` | 1 | Delayed focus after dropdown close |
| `SessionsManager.vue` | 1 | Browse debounce timer |
| `lexical/plugins.ts` | 2 | Prism highlight retry polling (`setTimeout(probe, 100)`) |
| `FilePicker.vue` | 1 | Focus input after mount |
| `openAttachment.ts` | 2 | Blob URL revocation delay |
| `jobsStore.ts` | 1 | Delayed scroll-to-bottom dispatch |
| `MessageEditorBody.vue` | 1 | Focus after mount |

Many of these are legitimate (blob URL cleanup, debounce). But the `setTimeout(fn, 0)`
focus hacks and double-rAF settle patterns are symptoms of missing lifecycle
management. VueUse's `useEventListener`, `useDebounceFn`, `useRafFn` would
formalize these.

### 6.9  God objects — still the core problem

| File | Lines | What's mixed together |
|---|---:|---|
| `sessions.ts` (backend) | 1,929 | Session CRUD + event forwarding + agent lifecycle + MCP + pending requests + workspace |
| `MessageComposer.vue` | 1,389 | Lexical editor setup + toolbar + attachments + slash commands + file picker + send logic (↓7 — Phase A) |
| `ChatWindow.vue` | 1,185 | Transcript rendering + scroll management + command terminal + event processing + selection (↓24 — Phase A) |
| `layoutStore.ts` | 1,145 | Dockview API + edge panels + session tracking + panel lifecycle + size management |
| `SessionsManager.vue` | 1,062 | Session list + creation form + workspace picker + sidebar rendering + sorting |
| `SettingsPanel.vue` | 339 | ~~Every settings category~~ ✅ shell + 4 sections (D.1) |

### 6.10  Settings type defined twice — accepted (wire-shape mirror)

`src/ipc/types.ts` (renderer) and `src-bun/rpc.ts` (backend) define the
same `Settings`, `Appearance`, `TerminalPrefs`, `NotificationPrefs`
interfaces. This is an INTENTIONAL wire-shape mirror per AGENTS.md
(testing instructions): the two sides MUST stay in sync, and
`src-bun/__tests__/wire-contract.test.ts` snapshots catch drift.

Sharing the type via a third module would break the simple "one
tsconfig per side" build boundary (no cross-imports between src/ and
src-bun/), require either a shared package or path-mapping hacks, and
remove the explicit wire-contract review point. Net cost > benefit.

This row was a Phase C candidate that the Phase B/C review (2026-05-25)
declined for the above reasons. Wire-contract snapshots cover the
synchronization risk — and Phase A.5 confirmed they work (the
`extension-management` permission kind drift was caught + propagated
to both sides).

### 6.11  Missing abstractions

- **No service layer:** Business operations are scattered across stores, components,
  and `src/lib/` utilities with no clear ownership
- **No error boundary pattern:** Error handling is ad-hoc (some try/catch + toast,
  some `.catch(() => {})`, some silent swallow)
- **Computed sorts/joins in components:** `ChatWindow.vue:231-244` merges transcript
  items with command results in a computed — this belongs in a store selector
- **Magic strings for panel/component IDs:** `'chat'`, `'sessionsManager'`,
  `'settingsPanel'` etc. scattered across 15+ files instead of a single enum/const

### 6.12  Potential dead/unused state

- `terminalStore.droppedCommandCounts` — written in `finishCommand()` but only
  read in `TerminalsPanel.vue` (may be unused in practice if panel doesn't
  display it)
- `dafman:rename-session` event — dispatched in `sessionCommands.ts:221` but
  no corresponding listener found in grep

### 6.13  Cross-boundary duplication summary

| Pattern | Where | Impact |
|---|---|---|
| Settings type shape | settingsStore + settings.ts (backend) | Runtime drift risk |
| ~~localStorage set/hydrate~~ | ~~terminalStore (2× identical pairs)~~ | ✅ Fixed — `usePersistedRef` (Phase A) |
| ~~Deferred listener queue~~ | ~~invoke.ts (6× identical blocks)~~ | ✅ Fixed — `createDeferredChannel<L>()` (Phase A) |
| ~~`as unknown as` shape probes~~ | ~~layoutStore (12×) + App.vue (1×)~~ | ✅ Mostly fixed (Phase C.1) — 12 → 2 in layoutStore via dockviewTypes accessors |
| ~~Component → IPC direct calls~~ | ~~12 .vue files, ~36 call sites~~ | ✅ Fixed (Phase B) — 3 picker-flow holdouts left, rest moved to composables |
| ~~Window event bus~~ | ~~9 event names, 13 dispatchers, 9 listeners~~ | ✅ Fixed — mitt + `src/lib/bus.ts` (Phase A) |
| setTimeout focus hacks | 6+ components, ~10 sites | Missing lifecycle mgmt |


---


## 7  What's Been Done ✅

- [x] **Code style:** gts + Prettier adopted, spacious padding lines
- [x] **ESLint:** 2,354 issues → 31 warnings (0 errors) — dispatch tables, pick helpers, composable extraction
- [x] **Shared utilities:** `createListenerRegistry`, `revealPath`, `MODE_OPTIONS`, `shellUtils`
- [x] **Directory restructure:** stores (6 folders), components (9 folders), backend (8 folders)
- [x] **Path aliases:** `@/` configured for all renderer imports (129 files)
- [x] **Dependencies:** removed unused, added unlisted transitive deps
- [x] **SessionDetailsPanel composables:** 7 composables extracted (agents, tasks, tools, usage, plan, skills, sections)
- [x] **Backend helpers:** pure functions extracted to `sessionHelpers.ts`
- [x] **Session reducer:** `applyToRecord` extracted to `sessionReducer.ts`
- [x] **Duplicate imports:** merged across 7 files
- [x] **Type cleanup:** removed redundant `| unknown`, `| null`; fixed `void` in IPC; annotated catch callbacks
- [x] **Vue emit modernization:** converted 5 components to tuple emit syntax
- [x] **Nullish coalescing:** configured `ignorePrimitives` for intentional `||` on strings/booleans
- [x] **Complexity reduction:** dispatch tables for sessionReducer, chatEvents, sessionHelpers
- [x] **no-dynamic-delete:** destructuring rest pattern in terminalStore, SessionHeaderControls
- [x] **Composable extraction:** `useCommandTerminal`, `watchDynamicCommands`, `usePanelLifecycle`
- [x] **Phase A (2026-05-25):** library swaps + typed constants (8 commits)
  - [x] +49 regression tests for ansi/terminalStore/listenerRegistry/codeLanguage
  - [x] `strip-ansi` replaces 3 hand-rolled OSC/CSI regexes — also fixed OSC ST-terminator bug
  - [x] `@codemirror/language-data` + lang-vue/sass replace the 22-entry extension map and the 11 hand-rolled factory functions (148 lines → 0 in `codeLanguage.ts`'s mapping; full file 148 → 124)
  - [x] `mitt` typed app bus — 13 `window.dispatchEvent` dispatchers + 9 `addEventListener` listeners deleted, 9 channels typed end-to-end, per-listener exception isolation preserved
  - [x] `createDeferredChannel<L>()` generic — 6 IPC channel pairs collapsed (invoke.ts: 222 → 187 lines)
  - [x] `usePersistedRef` composable — replaces 4 hand-rolled localStorage functions (terminalStore: 347 → 297 lines), adds 250ms throttle + buffer cap (perf win)
  - [x] VueUse selective adoption — 3 ResizeObservers + 4 keyboard listener pairs → `useResizeObserver`/`useEventListener`, 7 lifecycle hooks deleted
  - [x] `src/constants/panels.ts` — typed IDs replacing magic-string `'library'`/`'sessionsManager'`/`'sidebarTab'` in production code
  - **Net Phase A: ~420 production lines deleted, 3 real bugs fixed, +49 tests (551 → 600), lint clean throughout**
- [x] **Phase A.5 (2026-05-25):** backend TypeScript cleanup
  - [x] Discovered 63 errors in `src-bun/` that `bun run check` was hiding
  - [x] Fixed all 63: stale paths (`../rpc`, `./app/audit`), unused locals, missing `?.` on `Tool.handler`, test fixtures, SDK shape drift (UserInputRequest/Response export, extension-* permission kinds, account.getQuota signature, cliPath → RuntimeConnection.forStdio, SessionRegistry.delete → deleteCliSession), Bun.Terminal write signature, Node Dirent typing
  - [x] Wired `lint:tsc-bun` into `bun run check` so future regressions fail CI
  - [x] AGENTS.md rule 22 updated to reflect the gate is now active
- [x] **SDK simplification (2026-05-25):** swapped deep node_modules imports for `@github/copilot-sdk@1.0.0-beta.7`
  - [x] 3 `'../../../node_modules/...'` deep paths → clean `from '@github/copilot-sdk'`
  - [x] `ReasoningEffort` no longer hand-mirrored — derived from `SessionConfig['reasoningEffort']`
  - [x] `UserInputRequest`/`Response` derived from `SessionConfig.onUserInputRequest` (package exports map blocks sub-paths)
  - [x] Duplicate `setClientForTest`/`_setClientForTest` collapsed to one impl
  - [x] Tracked Canvas API (new in beta.7) for post-Phase-B wiring
- [x] **Phase B (2026-05-25):** data-flow decoupling
  - [x] B.1 OS-helper centralization — pathActions.openUrl/revealPath/openLogFolder + useFolderPicker composable (7 callsites)
  - [x] B.2 Library tab composables — useToolsLibrary, useInstructionsLibrary, useSkillsLibrary, useAgentsLibrary, useMcpLibrary (the big one: 13 IPC calls + ~190 lines extracted from LibraryMcpTab.vue) + browseDirectorySafe helper
  - [x] B.3 Killed layoutStore→sessionsStore circular dep (require()-based) with `setSessionTitleResolver(fn)` injected at boot
  - **Net Phase B: .vue direct invokeCommand calls 36 → 3, 5 new composables, 1 real circular dep eliminated, 600 tests pass**
- [x] **Phase C (2026-05-25):** type safety
  - [x] C.1 Typed dockview accessor module (`src/stores/shell/dockviewTypes.ts`) — 12 → 2 `as unknown as` casts in layoutStore
  - [x] C.2 sessionsStore reducer casts — re-examined, already safe (typed shape probes + runtime guards). No-op.
  - [x] C.3 Shared settings type — declined; wire-shape mirror is intentional and covered by snapshot tests (§6.10).
- [x] **Phase D.1 (2026-05-25):** SettingsPanel split (`9125e50`)
  - [x] 968 → 339 lines for the orchestrator shell
  - [x] New `SettingsGroup.vue` wrapper for repeated section chrome
  - [x] 4 section components extracted: AppearanceSettingsSection (206),
    TerminalSettingsSection (203), WorkspaceSettingsSection (111),
    NotificationSettingsSection (110)
  - [x] Smaller categories (Permissions/Diagnostics/About) kept inline
    via shared `<SettingsGroup>` chrome
  - [x] All bindings route through typed setters on `settingsStore`
    (`setTheme`, `setReasoningVisibility`, `setTerminalPrefs`, etc.) —
    no more inline `update(...)` calls


---


## 8  Priority Cleanup Plan

### Phase A — Foundation: library replacements + typed constants ✅ DONE (2026-05-25)

Per §5 build-vs-buy analysis, replace hand-rolled implementations with
battle-tested libraries. This is the highest-ROI phase — it deletes ~500+
lines of bespoke plumbing and eliminates entire bug categories.

**Ordering per rubber-duck critique (2026-05-25):** start with the smallest
blast radius, add regression tests first, defer settings-type split, and
pick exactly one event-bus abstraction.

All 8 items completed in commits `4396c7e` → `1dfee83`. See §7 for the
cumulative delta. Highlights:

- [x] 1. Regression safety net (+49 tests across 4 files)
- [x] 2. `strip-ansi` — also fixed real OSC ST-terminator bug
- [x] 3. `@codemirror/language-data` + lang-vue + lang-sass (148 → 124 line)
- [x] 4. `mitt` typed app bus (22 window event sites → 0; full type safety)
- [x] 5. `createDeferredChannel<L>()` generic (invoke.ts: 222 → 187 lines)
- [x] 6. `usePersistedRef` composable (terminalStore: 347 → 297; +throttle/cap)
- [x] 7. Selective VueUse (3 ResizeObservers + 4 keyboard listener pairs)
- [x] 8. `src/constants/panels.ts` typed panel IDs

**Deferred to Phase C** (was item 7): shared settings type between renderer
and backend. This is cross-boundary architecture work, not a library swap,
and needs explicit wire-shape tests.

### Phase A.5 — Backend TypeScript errors ✅ DONE (2026-05-25)

All 63 src-bun TS errors cleared in commits following the §2.5 audit
discovery. `lint:tsc-bun` is now part of `bun run check`. See §2.5 for
the full breakdown of what was fixed.

### Phase B — Data flow: decouple stores + kill event bus ✅ DONE (2026-05-25)

Reshaped per rubber-duck critique before execution. Original plan
("store-only IPC rule") risked replacing component god objects with
store god objects. Final shape:

- [x] **B.1** OS-helper centralization — `pathActions.openUrl`/`revealPath`/
  `openLogFolder` + `useFolderPicker` composable. 7 callsites migrated.
- [x] **B.2** Library tab composables — `useToolsLibrary`,
  `useInstructionsLibrary`, `useSkillsLibrary`, `useAgentsLibrary`,
  `useMcpLibrary` (the big one — 13 IPC calls + ~190 lines extracted from
  `LibraryMcpTab.vue`). Plus `browseDirectorySafe` for SessionsManager.
- [x] **B.3** Killed the layoutStore→sessionsStore `require()`-based
  circular dep — replaced with `setSessionTitleResolver(fn)` injected at
  boot (commit `c63b36a`).
- [x] **B.4** Window event bus — ✅ already done in Phase A step 4 (mitt).
- [x] **B.5** Deferred listener generic — ✅ already done in Phase A step 5.

**Skipped per critique:** global toast-decoupling — would create silent-
failure risks. `toastStore` stays as an acceptable cross-cutting concern.

**Skipped per critique:** moving 3 picker flows (SessionDetailsPanel
`saveExportFile`, FilePicker `searchWorkspaceFiles` + `pickAttachment`)
— per-instance, no shared state, would be thin shims.

**Result:** .vue direct invokeCommand calls 36 → 3. Tests 600 pass.

### Phase B — Legacy plan (preserved for reference)

1. ~~**Store-only IPC rule**~~ — replaced with composable-first approach
   per critique (see actual items above).
2. ~~**Decouple stores from toastStore**~~ — declined per critique.
3. ~~**Kill window event bus**~~ — done in Phase A step 4.
4. ~~**Deferred listener generic**~~ — done in Phase A step 5.
### Phase C — Type safety: dockview + IPC + shared settings ✅ DONE (2026-05-25)

- [x] **C.1** Typed dockview accessor module (`src/stores/shell/dockviewTypes.ts`)
  — interfaces + accessor functions for the dockview-vue runtime shapes
  the public types don't expose (`group.panels`, `group.id`,
  `group.width`/`height`, `dock.width`/`height`, structural cast for
  `removePanel`). Migrated 10 of 12 `as unknown as` shape probes in
  `layoutStore.ts`; the remaining 2 are intentional local casts
  (edgeApi 4-property setter, panel.api.moveTo structural).
- [x] **C.2** sessionsStore reducer casts — **already safe**. Re-examination
  showed the `payload.data as {field?: unknown}` casts are typed shape
  probes followed by runtime guards (`typeof d.field === 'string'`).
  This is the correct pattern for unknown-shaped data; the "cast" only
  declares the field exists for TS narrowing, runtime guards do the
  real validation. No work needed.
- [x] **C.3** Shared settings type — **declined** per §6.10. The duplication
  is an intentional wire-shape mirror covered by snapshot tests; sharing
  would break the per-side tsconfig boundary without real benefit.

### Phase C — Legacy plan (preserved for reference)

1. ~~Typed dockview wrapper~~ — done in C.1.
2. ~~Reduce unsafe casts in sessionsStore~~ — already safe (see C.2).
3. ~~Shared settings type~~ — declined (wire-shape mirror is intentional).

### Phase D — Split god objects 🟡 IN PROGRESS (2026-05-25)

Per rubber-duck (Phase D critique, 2026-05-25): work each target as a
separate vertical slice with its own pre-split rubber-duck pass, test
scaffolding, and audit refresh. Do NOT run them straight through —
the risk profiles differ too much (Lexical state, dockview restore
logic, SessionRegistry public API, etc.).

- [x] **D.1 `SettingsPanel.vue`** ✅ done (commit `9125e50`): 968 → 339
  lines via 4 section components + shared `SettingsGroup` chrome. Small
  categories (Permissions / Diagnostics / About) stay inline.
- [x] **D.2 `ChatWindow.vue`** ✅ done (commits `4b972fe`, `38ebbca`,
  `640e108`, `4689010`, `a638860`): 1,185 → 838 lines (-29%). 8-test
  regression net landed FIRST (flush w/ droppedEventCount, timeline
  merge, optimistic send + attachments, retry anchor, fork anchor,
  pending banner, sendHandler bypass, editor-save replay). Pre-split
  rubber-duck reshaped the extraction: single transcript-state
  controller (`useChatTimelineState`) with semantic APIs
  (`appendOptimisticUser`, `appendSystemError`,
  `resetForReplay({markSending})`) instead of a thin
  `useChatEventFlush` + escape hatches. Extracted:
  `useChatScroll` (DOM/rAF), `useChatTimelineState` (state machine),
  `useChatSubmit` (optimistic-send orchestrator + sendHandler
  bypass), `useMessageActions` (edit/quote/retry/fork/fork-notice +
  editor save/cancel + anchor walks). `<ChatTranscript>` skipped —
  not needed once 838 lines reached.
- [x] **D.3 `sessions.ts`** ✅ done (commits `f1402df`, `<r2>`): 1,904 →
  1,025 lines (-46%). Round 1: 5 sibling services (Plan / Skills /
  Tasks / Agents / Mcp) behind `SessionServiceContext { getEntry,
  wrapSdk }`. Round 2 (after user pushback that 10% wasn't enough):
  extracted `SessionEventForwarder` (SDK envelope unwrap + mode/idle
  side-effects), `sessionConfigBuilder` (170-line callbacks factory
  shared by create/resume), and `SessionMetadataService` (13 thin
  SDK-passthrough methods + 2 client-level ones). Registry now owns
  only lifecycle (constructor, create, resume, replayHistory,
  setWorkingDirectory, list, deleteCliSession, send,
  searchWorkspaceFiles, getCwd/cwdFor, disconnect, shutdownAll) plus
  thin delegating methods for every service. 44 sessions.test.ts
  tests + RPC wiring untouched.
- [x] **D.4 `MessageComposer.vue`** ✅ partial (-28%): 1,389 → 996 lines
  via 6 extractions — `composerFormat.ts` (actions table +
  applyEditorFormat + computeFormatState), `useComposerToolbarLayout`
  (responsive width), `useComposerAttachments` (drag/drop/paste +
  blobFromFile), `ComposerSubmitButton` (SplitButton wrapper),
  `ComposerEditorBridge` (editor capture + update/selection listeners),
  `useComposerCommandMode` (!-entry / Esc-Esc exit). Remaining ~990
  lines are mostly LexicalComposer template + plugin wiring +
  focus/text/append helpers; further reductions need either
  regression tests for the Lexical state machine or a template
  split.
- [ ] **D.5 `SessionsManager.vue`** (1,062 lines): defer — large but
  understandable. Split when sidebar work resumes.
- [ ] **D.6 `layoutStore.ts`** (1,145 lines): defer/drop. Recent
  dockview-types extraction (Phase C.1) means another touch is
  high blast radius. Split only if a Dockview feature/bug forces it.

### Phase E — Deduplication: extract repeated patterns

Per §3 jscpd scan. Pure refactors with no dependency on Phases A–D.

1. **`JsonSchemaField.vue`** — 4 near-identical type branches (string/number/bool/enum)
   at lines 164/222/275/339 (~90 dup lines) → polymorphic per-type sub-component
   (`JsonSchemaFieldString.vue`, etc.) dispatched from a single switch
2. **Library tabs** — `LibraryAgentsTab`, `LibraryInstructionsTab`, `LibrarySkillsTab`,
   `LibraryMcpTab`, `LibraryToolsTab` all share the user/project two-section pattern
   (~110 dup lines) → `<LibraryTabPanel :user :project :renderItem>` slot wrapper
3. **Task aggregation** — `SubagentBlock.vue:64`, `useSessionTasks.ts:105-110`,
   `JobsPanel.vue:78` (~33 dup lines) → single `useTaskAggregation()` composable
4. **Lexical trigger plugins** — `MentionPlugin.vue` ↔ `SlashCommandPlugin.vue` share
   trigger scaffolding (~12 dup lines) → `createTriggerPlugin({ trigger, query, render })`
   factory
5. **CodeMirror setup** — `DiffEditor.vue` ↔ `CodeEditor.vue` (~11 dup lines) →
   `useCodeMirror(opts)` composable
6. **Permission/Tool detail render** — `PermissionDetails.vue` ↔ `ToolDetails.vue`
   share argument-row rendering (~11 dup lines) → shared `<ArgRow>` component
7. **`CommandPalette.vue`** — intra-file keyboard-nav blocks at 206/246 (~33 dup
   lines) → single nav helper
8. **`ActivityBar.vue`** — intra-file button-group render at 146/170 (~23 dup lines)
   → `<ActivityButton>` sub-component
9. **`McpServerForm.vue`** / **`ToolDetails.vue`** / **`JsonValueView.vue`** —
   remaining intra-file paste sites (~50 dup lines combined) → smaller sub-components

**Expected impact:** ~250 production lines deleted, jscpd duplication drops
from 2.56% → ~1.2%. Intra-file dedups (#1, #7, #8, #9) are independent of
each other; cross-file dedups (#2–#6) touch multiple files but are still
narrow in scope.

### Phase F — Clean up timing hacks + remaining ESLint

- [ ] Replace `setTimeout(fn, 0)` focus hacks with `nextTick` or VueUse lifecycle
- [ ] Replace double-rAF patterns with proper settle helpers
- [ ] 17 `complexity` — CC > 15 functions
- [ ] 6 `no-non-null-assertion` — xterm addon closures
- [ ] 5 `max-lines-per-function` — Pinia store bodies (structural, low priority)
- [ ] 1 `max-depth` — nested conditional
- [ ] 5 misc
