# Code Quality Audit

> **Date:** 2026-05-25 (deep review: architectural debt with receipts)
> **Codebase:** ~33,000 lines of TypeScript + Vue across `src/` and `src-bun/`
> **Tools used:** ESLint (strictTypeChecked), jscpd (copy-paste detection), deep manual code review, IDE diagnostics

---


## 1  File Size Distribution

Files above **800 lines** are strong candidates for splitting.

| Lines | File                                              | Notes                            |
| ----: | ------------------------------------------------- | -------------------------------- |
| 2,181 | `src/components/session/SessionDetailsPanel.vue`  | ↓774 — composables extracted     |
| 1,929 | `src-bun/app/chat/sessions.ts`                    | ↓304 — helpers to sessionHelpers |
| 1,635 | `src/dev/Playground.vue`                          | Dev-only, not shipped            |
| 1,396 | `src/components/chat/MessageComposer.vue`         | Lexical editor + toolbar         |
| 1,319 | `src/components/chat/ChatWindow.vue`              | ↓110 — terminal extracted |
| 1,239 | `src-bun/rpc.ts`                                  | IPC handler registry             |
| 1,149 | `src/stores/chat/sessionsStore.ts`                | ↓317 — reducer extracted         |
| 1,145 | `src/stores/shell/layoutStore.ts`                 | Dockview orchestration           |
| 1,058 | `src/components/session/SessionsManager.vue`      | Sidebar session list             |
|   991 | `src/components/settings/SettingsPanel.vue`       | Settings UI                      |
|   921 | `src/components/session/SessionHeaderControls.vue`| Header bar controls              |
|   904 | `src/ipc/types.ts`                                | Shared type defs (expected big)  |
|   760 | `src/components/terminal/TerminalPanel.vue`       | Terminal container               |
|   721 | `src/components/library/LibraryAgentsTab.vue`     | Agent library UI                 |
|   712 | `src/components/permissions/PendingRequestCard.vue`| Permission card                 |
|   694 | `src-bun/test-server.ts`                          | Dev test server                  |
|   668 | `src/App.vue`                                     | Root component                   |
|   657 | `src-bun/index.ts`                                | Main process entry               |
|   631 | `src/lib/chatEvents.ts`                           | Chat event reducer               |
|   614 | `src/components/library/McpServerForm.vue`        | MCP server form                  |
|   605 | `src-bun/app/client/fakeClient.ts`                | Fake SDK client                  |
|   575 | `src/components/permissions/ToolDetails.vue`      | Tool detail view                 |
|   545 | `src/components/shared/FilePicker.vue`            | File picker component            |
|   540 | `src/components/shell/CommandPalette.vue`         | Command palette                  |
|   528 | `src/components/library/LibraryMcpTab.vue`        | MCP library tab                  |
|   522 | `src/lib/registerBuiltinCommands.ts`              | ↓62 — dynamicCommands extracted  |
|   521 | `src/components/observability/LogViewer.vue`      | Log viewer                       |


---


## 2  ESLint — Strict TypeScript Analysis

**Config:** `strictTypeChecked` + `eslint-plugin-vue/flat/recommended` + complexity + `@stylistic/eslint-plugin`

**Current: 0 errors, 31 warnings** (down from 92 → dispatch tables, pick helpers, composable extraction, no-dynamic-delete fixes)

### 2.1  Issues by Rule

| Count | Rule                                           | What It Means                                  |
| ----: | ---------------------------------------------- | ---------------------------------------------- |
|    14 | `complexity`                                   | Cyclomatic complexity above 15                 |
|     6 | `no-non-null-assertion`                        | `!` instead of proper null checks              |
|     4 | `max-lines-per-function`                       | Function body > 200 lines                      |
|     2 | `max-depth`                                    | Nesting > 4 levels deep                        |
|     1 | `no-redundant-type-constituents`               | ESLint parser resolves AgentInfo as error type  |
|     1 | `no-unnecessary-type-assertion`                | Assertion doesn't change the type              |
|     3 | misc complexity variants                       | CC 16–18 in smaller functions                  |

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
| 22 | `src-bun/app/chat/sessions.ts`                           | `respond`                   |
| 20 | `src-bun/app/config/settings.ts`                         | `coerceTerminal`            |
| 19 | `src/lib/chatEvents/messageHandlers.ts`                  | `normalizeAttachments`      |
| 19 | `src/stores/chat/sessionReducer.ts`                      | `trackSessionArtifact`      |

### 2.3  Complexity Violations (Cyclomatic > 15)

| CC | File                                                     | Function                    | Status        |
| -: | -------------------------------------------------------- | --------------------------- | ------------- |
| 40 | `src/components/shared/JsonSchemaForm.vue`               | `validateNode`              | Open          |
| 29 | `src/stores/shell/layoutStore.ts`                        | `openEdgePanel`             | Open          |
| 28 | `src/components/permissions/ToolDetails.vue`             | (arrow fn)                  | Open          |
| 24 | `src-bun/app/chat/sessions.ts`                           | `forward`                   | Open          |
| 24 | `src/lib/chatEvents/messageHandlers.ts`                  | `user.message`              | Open          |
| 23 | `src/components/session/SessionDetailsPanel.vue`         | `loadUsage`                 | Open          |
| 22 | `src-bun/app/chat/sessions.ts`                           | `respond`                   | Open          |
| 20 | `src-bun/app/config/settings.ts`                         | `coerceTerminal`            | Open          |
| 19 | `src/lib/chatEvents/messageHandlers.ts`                  | `normalizeAttachments`      | Open          |
| 19 | `src/stores/chat/sessionReducer.ts`                      | `trackSessionArtifact`      | Open          |
| 18 | `src-bun/app/chat/sessions.ts`                           | `createSession`/`cwdFor`    | Open          |
| 17 | `src-bun/app/config/settings.ts`                         | `structuredFromConfig`      | Open          |
| 17 | `src/lexical/plugins.ts`                                 | (plugin)                    | Open          |
| 16 | `src/components/terminal/TerminalPanel.vue`              | `initXterm`                 | Open          |
| 16 | `src-bun/app/chat/sessions.ts`                           | `resume`                    | Open          |
| ~~60~~ | ~~`src/stores/chat/sessionsStore.ts`~~               | ~~`applyToRecord`~~         | ✅ Fixed (→ ~4) |
| ~~33~~ | ~~`src/lib/chatEvents.ts`~~                          | ~~`processEvents`~~         | ✅ Fixed (→ ~10)|
| ~~32~~ | ~~`src-bun/app/chat/sessionHelpers.ts`~~             | ~~`normalizeTask`~~         | ✅ Fixed (→ ~6) |
| ~~25~~ | ~~`src-bun/app/chat/sessionHelpers.ts`~~             | ~~`summarizePermission`~~   | ✅ Fixed (→ ~4) |
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
| **Event bus** (window.dispatchEvent) | 8 files, 13 dispatchers, 10 listeners | ~80 | **mitt** (200B) or VueUse `useEventBus` | 🔴 Replace — untyped, no cleanup guarantee, untraceable |
| **localStorage persist** (manual JSON.parse/stringify + try/catch) | terminalStore.ts:135-193 | ~60 | **pinia-plugin-persistedstate** (zero-config) | 🔴 Replace — duplicated 2×, no validation |
| **Deferred listener queue** (if bridge, register; else queue) | invoke.ts:100-221 | ~120 | Single generic `createDeferredChannel<T>()` or mitt + lazy init | 🔴 Replace — 6 identical blocks |
| **Pub/sub fan-out** (`Set<Listener>`, subscribe, fanOut) | listenerRegistry.ts:45-95 | ~50 | **mitt** does exactly this in 200B | 🔴 Replace — hand-rolled EventEmitter |
| **ANSI stripping** (3 regexes) | ansi.ts:1-25 | 25 | **strip-ansi** (npm, 1.2M weekly, battle-tested) | 🔴 Replace — our regexes miss edge cases |
| **setTimeout focus hacks** (`setTimeout(fn, 0)`) | 6 components, ~10 sites | ~30 | VueUse `useFocus`, `useActiveElement`, `nextTick` | 🟡 Consider — some are legitimate, most are lifecycle hacks |
| **Scroll management** (manual rAF + double nextTick) | ChatWindow.vue:246-349 | ~100 | VueUse `useScroll`, `useInfiniteScroll` | 🟡 Consider — our scroll logic is custom (event batching + scroll-to-bottom), but the rAF scheduling could use `useDebounceFn`/`useRafFn` |
| **Resize observer** (raw ResizeObserver in ChatWindow) | ChatWindow.vue:157-190 | ~30 | VueUse `useResizeObserver` | 🔴 Replace — manual cleanup, no throttle |
| **Debounce** (manual setTimeout timers) | SessionsManager.vue:188-226, App.vue:450-455 | ~40 | VueUse `useDebounceFn` or `watchDebounced` | 🔴 Replace — hand-rolled timer management |
| **`toErrorMessage()`** (ternary wrapper) | errorMessage.ts:1-5 | 5 | Inline `err instanceof Error ? err.message : String(err)` or **serialize-error** | 🟡 Consider — trivial, but used everywhere; keep as utility, just not a whole file |
| **CodeMirror language resolver** | codeLanguage.ts:1-148 | 148 | **@codemirror/language-data** (official package) has `languages[]` with load/extensions | 🔴 Replace — we maintain a manual ext→lang map that's incomplete |
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

**Circular conceptual dependency:** `sessionsStore → layoutStore` and
`sessionReducer → layoutStore`, but `layoutStore` exposes `activeSessionId`
which is derived from session panel state. Who owns "current session"?

**toastStore is a universal dependency** — 8 stores import it. This is
technically fine (it's a leaf node) but means every store mixes data logic
with UI notification side effects.

**Fix:** Stores should be pure data layers. Side effects (toasts,
notifications, layout commands) should be triggered by watchers/subscribers
at the App level or in composables that observe store state.

### 6.6  Components bypassing stores for IPC

12+ Vue components call `invokeCommand()` directly instead of going through
stores. Business logic (API calls, error handling, retry) lives in `.vue` files
where it can't be unit-tested without mounting the component.

**Fix:** Strict rule: components → stores → IPC. Components only read reactive
state and call store actions.

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
| `MessageComposer.vue` | 1,396 | Lexical editor setup + toolbar + attachments + slash commands + file picker + send logic |
| `ChatWindow.vue` | 1,319 | Transcript rendering + scroll management + command terminal + event processing + selection |
| `layoutStore.ts` | 1,145 | Dockview API + edge panels + session tracking + panel lifecycle + size management |
| `SessionsManager.vue` | 1,058 | Session list + creation form + workspace picker + sidebar rendering + sorting |
| `SettingsPanel.vue` | 991 | Every settings category in one template |

### 6.10  Settings type defined twice

`src/stores/app/settingsStore.ts` and `src-bun/app/config/settings.ts` define
the same settings shape independently. Changes to one silently break the other
at runtime. Should be a shared type file imported by both sides.

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
| localStorage set/hydrate | terminalStore (2× identical pairs) | Boilerplate |
| Deferred listener queue | invoke.ts (6× identical blocks) | Boilerplate |
| `as unknown as` shape probes | layoutStore (12×) + App.vue (1×) | Type safety hole |
| Component → IPC direct calls | 12 .vue files, ~35 call sites | Architecture bypass |
| Window event bus | 8 event names, 13 dispatchers, 10 listeners | Untyped global coupling |
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


---


## 8  Priority Cleanup Plan

### Phase A — Foundation: library replacements + typed constants

Per §5 build-vs-buy analysis, replace hand-rolled implementations with
battle-tested libraries. This is the highest-ROI phase — it deletes ~600+
lines of bespoke plumbing and eliminates entire bug categories.

1. **Add @vueuse/core** — replace hand-rolled `useEventListener`, debounce
   (`useDebounceFn`), localStorage (`useLocalStorage`), resize observer
   (`useResizeObserver`), focus management (`useFocus`), rAF helpers
   (`useRafFn`). Estimated ~300 lines deleted across 10+ files
2. **Add mitt** (or VueUse's `useEventBus`) — replace all 8 `dafman:*` window
   events (13 dispatchers, 10 listeners) + listenerRegistry.ts with a typed,
   centrally-registered event bus. Estimated ~130 lines deleted
3. **Add pinia-plugin-persistedstate** — replace terminalStore's manual
   localStorage persistence (2× identical blocks, ~60 lines)
4. **Add strip-ansi** — replace `src/lib/ansi.ts` hand-rolled regexes (~25 lines)
5. **Add @codemirror/language-data** — replace `codeLanguage.ts` manual ext→lang
   map (~100 lines of incomplete mapping)
6. **Panel ID constants** — single `src/constants/panels.ts` with typed
   string literal union for all panel/component IDs
7. **Shared settings type** — single `src/shared/settings.ts` imported by
   both renderer and backend

### Phase B — Data flow: decouple stores + kill event bus

1. **Store-only IPC rule** — move all `invokeCommand` calls from 12 .vue files
   into stores/composables
2. **Decouple stores** — extract cross-store side effects (toasts, notifications,
   layout commands) into App-level watchers or composables
3. **Kill window event bus** — replace 13 dispatch sites + 10 listener sites
   with mitt bus or provide/inject
4. **Deferred listener generic** — replace 6 identical blocks in invoke.ts with
   a single `createDeferredChannel<T>()` (or just use mitt + lazy init)

### Phase C — Type safety: dockview + IPC

1. **Typed dockview wrapper** — `dockviewTypes.ts` with interfaces for the
   runtime shape we actually use; centralize all 13 `as unknown as` casts
2. **Reduce unsafe casts in sessionsStore** — typed discriminated unions for
   event payloads instead of `payload.data as {...}`

### Phase D — Split god objects

- [ ] `sessions.ts` → session CRUD, event forwarding, agent lifecycle modules
- [ ] `MessageComposer.vue` → toolbar composable, attachment composable, send logic
- [ ] `ChatWindow.vue` → scroll composable, event processing composable
- [ ] `layoutStore.ts` → edge panel module, panel tracking module
- [ ] `SettingsPanel.vue` → per-category sub-components

### Phase E — Clean up timing hacks + remaining ESLint

- [ ] Replace `setTimeout(fn, 0)` focus hacks with `nextTick` or VueUse lifecycle
- [ ] Replace double-rAF patterns with proper settle helpers
- [ ] 14 `complexity` — CC > 15 functions
- [ ] 6 `no-non-null-assertion` — xterm addon closures
- [ ] 4 `max-lines-per-function` — Pinia store bodies (structural, low priority)
- [ ] 2 `max-depth` — nested conditionals
- [ ] 5 misc
