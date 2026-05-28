# Code Quality Audit

> **Date:** 2026-05-27 (refreshed — all tables re-verified against codebase)
> **Codebase:** ~52,000 lines of production TypeScript + Vue across `src/` and `src-bun/` (66,090 including tests)
> **Tools used this refresh:** PowerShell `Get-Content` line scans, jscpd v4 (renderer + backend split), grep pattern scans for architectural patterns. **ESLint config is currently broken** (config-array `@typescript-eslint` plugin redefinition) — `bun run lint:eslint` exits non-zero; backend `tsc -p tsconfig.bun.json --noEmit` and frontend `vue-tsc --noEmit` both clean.
> **Prior refresh:** 2026-05-25.

---


## 1  File Size Distribution

Files above **800 lines** are strong candidates for splitting.
Re-derived 2026-05-27 from `Get-Content` on every `*.ts/*.vue` under `src/` + `src-bun/`.

| Lines | File                                              | Delta vs 2026-05-25 | Notes |
| ----: | ------------------------------------------------- | -------- | -- |
| 2,168 | `src/components/session/SessionDetailsPanel.vue`  | ↓13 | Small drift; still the #1 god component |
| 1,635 | `src/dev/Playground.vue`                          | = | Dev-only, not shipped |
| 1,276 | `src-bun/rpc.ts`                                  | ↑37 | New `readAgentFile` + `agentFiles` options added 2026-05-27 |
| 1,184 | `src/stores/shell/layoutStore.ts`                 | ↑39 | New `layoutRev` + `setActiveSessionId` (rubber-duck Sprint A) |
| 1,149 | `src/stores/chat/sessionsStore.ts`                | = | |
| 1,058 | `src-bun/app/chat/sessions.ts`                    | ↓871 (!!) | **Phase D.3 landed** — verify the 1,929 prior number was pre-extraction |
| 1,038 | `src/components/session/SessionsManager.vue`      | ↓24 | |
|   996 | `src/components/chat/MessageComposer.vue`         | ↓400 | **D.4 landed** — was 1,396 |
|   971 | `src/ipc/types.ts`                                | ↑67 | Added new agent edit/select types |
|   912 | `src/components/session/SessionHeaderControls.vue`| ↓8 | |
|   903 | `src/components/library/LibraryAgentsTab.vue`     | ↑182 | **Sprint A1/A2** — Select/Edit added; **see §3 — 77-line intra-file dup** |
|   842 | `src/components/chat/ChatWindow.vue`              | ↓343 | **D.2 landed** — was 1,185 |
|   757 | `src/components/terminal/TerminalPanel.vue`       | = | |
|   735 | `src/lib/registerBuiltinCommands.ts`              | ↑275 | Palette polish (2026-05-27) — settings catch-all + active-session controls |
|   715 | `src-bun/test-server.ts`                          | ↑23 | New test-server handlers for E2E flows 21-24 |
|   705 | `src/components/permissions/PendingRequestCard.vue`| ↓7 | |
|   685 | `src/lib/chatEvents.ts`                           | = | |
|   662 | `src-bun/index.ts`                                | ↑5 | |
|   625 | `src/components/shell/CommandPalette.vue`         | ↑85 | Palette polish — child rendering, ContextMenu, useCommandState wiring |
|   617 | `src/components/library/McpServerForm.vue`        | ↑3 | |
|   611 | `src-bun/app/client/fakeClient.ts`                | ↑6 | |
|   565 | `src-bun/app/library/agentFiles.ts`               | NEW 565 | Was ~350; A2 added `splitFrontmatter`/`parseAgentFrontmatter`/`readAgentForEdit` |
|   560 | `src/components/permissions/ToolDetails.vue`      | ↓15 | |
|   545 | `src/components/shared/FilePicker.vue`            | = | |
|   517 | `src/components/observability/LogViewer.vue`      | ↓4 | |
|   504 | `src/App.vue`                                     | ↓177 | **D.x landed** — verified ↓ |
|   473 | `src/components/permissions/PermissionRuleEditor.vue` | = | |
|   471 | `src/components/shell/GroupTab.vue`               | NEW | Groups v3.1 polish (right-click menu, color popover) |
|   464 | `src/stores/shell/groupsStore.ts`                 | = | |

**Total prod lines this refresh:** 51,969 across 207 files (excludes `__tests__/`, `*.test.ts`).
**Total all lines:** 66,090 across 278 files.
**Prior refresh claimed:** 47,200 prod / 58,500 total. Delta ~+4,800 prod is reasonable given the Groups v3, palette polish, E2E harness, and Sprint A work shipped since.

**Notable:**

- **D.3 (`sessions.ts`) verified:** 1,929 → 1,058 (-871, -45%). Matches §7 claim.
- **D.4 (`MessageComposer.vue`) verified:** 1,396 → 996 (-400, -29%). Matches §7 claim.
- **D.2 (`ChatWindow.vue`) verified:** 1,185 → 842 (-343, -29%). Matches §7 claim.
- **D.1 (`SettingsPanel.vue`) verified:** dropped out of top-29 entirely (was 991). The orchestrator is now `<340 lines per §7`.
- **NEW debt 2026-05-27:** `LibraryAgentsTab.vue` grew 182 lines (Sprint A1/A2). One of those rows is a 77-line intra-file dup — see §3.
- **D.5 / D.6 still deferred.** `SessionsManager.vue` (1,038) and `layoutStore.ts` (1,184) both still > 1000 lines.


---


## 2  ESLint — Strict TypeScript Analysis

**Config:** `strictTypeChecked` + `eslint-plugin-vue/flat/recommended` + complexity + `@stylistic/eslint-plugin`

### 2026-05-28 status

✅ **ESLint config repaired.** Root cause was a duplicate
`typescript-eslint` install: `gts` had its own nested copy
(`node_modules/gts/node_modules/typescript-eslint@8.59.4`) and the root
had `8.60.0`. Each loaded a distinct `@typescript-eslint/eslint-plugin`
object reference, and ESLint 10's flat-config validator rejected the
second registration as "redefine plugin".

Fix: added `"typescript-eslint": "^8.60.0"` to `package.json#overrides`
(commit pending after this audit refresh) and re-ran `bun install`.
Single `typescript-eslint` instance now; `bun run lint:eslint` clean
(0 errors, 18 warnings — see §2.1 / §2.2 below).

Also wired `lint:eslint` into `bun run check` so this stays fixed.

### 2.1  Issues by Rule (2026-05-28 — eslint config fixed via Phase F.4)

After fixing the `typescript-eslint` plugin redefinition (gts pinned an
older minor; root pinned ^8.60.0; deduped via `package.json#overrides`)
and running `eslint --fix` to clean ~3,054 prettier auto-fixable errors,
the working set is:

| Count | Rule                                           | Delta vs 2026-05-25 |
| ----: | ---------------------------------------------- | ------------------- |
|     6 | `complexity`                                   | **17 → 6 (↓11)** — D-phase splits did most of this |
|     3 | `@typescript-eslint/no-dynamic-delete`         | new — all in `groupsStore.ts` |
|     3 | `@typescript-eslint/no-redundant-type-constituents` | unchanged-ish |
|     2 | `max-depth`                                    | **1 → 2 (↑1)** — both in `agentFiles.ts#writeAgent` (Sprint A2) |
|     1 | `@typescript-eslint/no-non-null-assertion`     | **6 → 1 (↓5)** |
|     1 | `@typescript-eslint/prefer-nullish-coalescing` | new |
|     1 | `no-duplicate-imports`                         | new |
|     1 | `vue/no-template-shadow`                       | new |
| **18** | **Total warnings** (0 errors)                 | **31 → 18 (↓13)** |

`max-lines-per-function` was 5 in the stale table; it's now **0**, but
that's misleading — the rule is **disabled in `src/stores/**`** (per
`eslint.config.js` lines 150–155 — Pinia stores are intentionally long).
The store-body line totals are tracked in §2.4 below.

### Rules disabled (with rationale)

| Rule                                           | Why disabled                                         |
| ---------------------------------------------- | ---------------------------------------------------- |
| `no-unsafe-*` (5 rules)                        | SDK interaction produces unavoidable `any`           |
| `no-unnecessary-condition`                     | Defensive runtime checks are intentional             |
| `vue/one-component-per-file`                   | Test helpers / barrel exports                        |
| `vue/require-default-prop`                     | TypeScript handles prop defaults                     |
| `max-lines-per-function` (in `src/stores/**`)  | Pinia store callbacks are the whole store body       |

### 2.2  Remaining Complexity Hotspots (2026-05-28 — fresh from eslint --format json)

| CC | File                                                     | Function                    | Status / Note |
| -: | -------------------------------------------------------- | --------------------------- | ------------- |
| 25 | `src-bun/app/library/agentFiles.ts`                      | `parseAgentFrontmatter`     | 🔴 **NEW (Sprint A2)** — frontmatter parser branches per known key; candidate for table-driven dispatch |
| 20 | `src-bun/app/chat/sessions.ts`                           | `resume`                    | Open (was 16 in stale table; grew slightly) |
| 19 | `src/stores/shell/layoutStore.ts`                        | `recomputeActiveSession`    | Open |
| 18 | `src/stores/chat/sessionsStore.ts`                       | `createSession`             | Open |
| 17 | `src/lexical/plugins.ts`                                 | (plugin arrow fn)           | Open |
| 16 | `src/components/terminal/TerminalPanel.vue`              | `initXterm`                 | Open |
| ~~40~~ | ~~`src/components/shared/JsonSchemaForm.vue`~~       | ~~`validateNode`~~          | ✅ Fixed (no longer over threshold) |
| ~~29~~ | ~~`src/stores/shell/layoutStore.ts`~~                | ~~`openEdgePanel`~~         | ✅ Fixed |
| ~~28~~ | ~~`src/components/permissions/ToolDetails.vue`~~     | ~~(arrow fn)~~              | ✅ Fixed |
| ~~24~~ | ~~`src-bun/app/chat/sessions.ts`~~                   | ~~`forward`~~               | ✅ Fixed |
| ~~24~~ | ~~`src/lib/chatEvents/messageHandlers.ts`~~          | ~~`user.message`~~          | ✅ Fixed |
| ~~23~~ | ~~`src/components/session/SessionDetailsPanel.vue`~~ | ~~`loadUsage`~~             | ✅ Fixed |
| ~~22~~ | ~~`src-bun/app/chat/pendingRequests.ts`~~            | ~~`respond`~~               | ✅ Fixed |
| ~~20~~ | ~~`src-bun/app/config/settings.ts`~~                 | ~~`coerceTerminal`~~        | ✅ Fixed |
| ~~19~~ | ~~`src/lib/chatEvents/messageHandlers.ts`~~          | ~~`normalizeAttachments`~~  | ✅ Fixed |
| ~~19~~ | ~~`src/stores/chat/sessionReducer.ts`~~              | ~~`trackSessionArtifact`~~  | ✅ Fixed |
| ~~18~~ | ~~`src-bun/app/terminal/stderrFilter.ts`~~           | ~~(arrow fn)~~              | ✅ Fixed |
| ~~17~~ | ~~`src/components/library/McpServerForm.vue`~~       | ~~`structuredFromConfig`~~  | ✅ Fixed |

**Net:** 12 hotspots resolved (D-phase work), 1 new (Sprint A2 — file a
follow-up). Six remaining are pre-existing and tracked.

### 2.3  Other warnings worth addressing

- `agentFiles.ts:415,421` — `max-depth` ≥ 5 in `writeAgent` (Sprint A2);
  same code that introduced the CC 25 above. Fold into a single cleanup.
- `groupsStore.ts:261,351,356` — three `no-dynamic-delete` (`delete obj[key]`);
  prefer `delete (obj as Record<string, unknown>)[key]` cast or a
  `Map<>`-based store.
- `CommandPalette.vue:87` — single `!` non-null assertion; refactor away.

### 2.4  Oversized Functions (> 200 lines)

Backed by hand line counts (eslint `max-lines-per-function` is disabled
inside `src/stores/**` so these don't appear in §2.1).

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

**2026-05-27 refresh:** ran `bunx jscpd src` and `bunx jscpd src-bun` separately.

| Scope | Clones | Duplicated lines | Pct |
| ----- | -----: | ---------------: | --: |
| `src/` (renderer) | 90 | 1,070 of 44,070 | **2.43%** |
| `src-bun/` (backend) | 25 | 251 of 11,264 | **2.23%** |
| **Both combined** | 115 | 1,321 of 55,334 | **~2.4%** |

Partition of the 90 renderer clones:
- **Cross-file production:** 18 (down from 14 last refresh — small uptick due to Sprint A1/A2 work)
- **Intra-file production:** 14 (down from 18, but ONE BIG ONE: see §3.2)
- **Test boilerplate:** 58 (acceptable)

### 3.1  Cross-File Clones (Production, top 15)

| Lines | Source A | Source B | What's Duplicated |
| ----: | -------- | -------- | ----------------- |
| 22 | `ChatWindow.vue` | `SubagentBlock.vue` | Sub-agent task aggregation (was 17 — grew) |
| 21 | `ChatTab.vue:235` | `GroupTab.vue:362` | **Tab-close button CSS** (`.chat-tab-close` / `.group-tab-close` identical) |
| 16 | `JsonSchemaField.vue` | `JsonSchemaForm.vue` | Schema field type narrowing |
| 16 | `LibraryInstructionsTab.vue` | `LibrarySkillsTab.vue` | Library tab boilerplate |
| 15 | `PermissionDetails.vue` | `PermissionRuleEditor.vue` | Permission shape mapping |
| 15 | `LibraryMcpTab.vue` | `LibraryToolsTab.vue` | Library tab boilerplate |
| 14 | `JsonSchemaField.vue` | `JsonSchemaFieldFrame.vue` | Frame helpers (partial extraction; rest deferred per Phase E) |
| 13 | `sessionMetaHandlers.ts` | `useSessionUsage.ts` | Usage parsing |
| 13 | `ChatTab.vue:15` | `GroupTab.vue:24` | **Tab script setup boilerplate** (closely-coupled to the 21-line CSS dup above) |
| 12 | `MentionPlugin.vue` | `SlashCommandPlugin.vue` | Lexical trigger plugin scaffolding (still deferred — only 2 plugins) |
| 12 | `MessageComposer.vue` | `MessageEditorBody.vue` | Editor surface chrome (D.4 left this seam) |
| 11 | `PermissionDetails.vue` | `ToolDetails.vue` | Permission/tool detail render |
| 11 | `JsonSchemaField.vue` | `JsonSchemaForm.vue` | Field validation |
| 11 | `ModeButtonGroup.vue` | `SessionHeaderControls.vue` | Mode button rendering |
| 10 | `TerminalSettingsSection.vue` | `WorkspaceSettingsSection.vue` | Settings-section list-row chrome |

**Backend (`src-bun/`) cross-file:**

| Lines | Source A | Source B | What's Duplicated |
| ----: | -------- | -------- | ----------------- |
| 13 | `mcpRegistry.ts` | `skillsRegistry.ts` | RPC wrap helper (caught in §4.4 last refresh) |
| 11 | `sessionSkillsService.ts` | `skillsRegistry.ts` | Skills surface bridging |
| 10 | `sessionMcpService.ts` | `mcpRegistry.ts` | MCP surface bridging |
| 8 | `index.ts` | `test-server.ts` | RPC handler-table boilerplate |

### 3.2  Intra-File Clones (Production)

**🔴 NEW REGRESSION:** the biggest intra-file clone in the renderer is now my own work from Sprint A1/A2.

| Lines | File | What's Duplicated | Status |
| ----: | ---- | ----------------- | ------ |
| **77** | **`LibraryAgentsTab.vue:336,420`** | **Project section ↔ User section** (Select / chip / Edit / Reveal / Delete rendered identically). Grew from 42 → 77 because A1 added Select + chip and A2 added Edit pencil, doubling the markup. | 🔴 **Open — added 2026-05-27 by Sprint A** |
| 26 | `LibraryInstructionsTab.vue` | User/project chrome | Open |
| 25 | `LibraryInstructionsTab.vue` | (same — 2nd paste) | Open |
| 16 | `ToolDetails.vue` | Tool category headers | Open |
| 16 | `PendingRequestCard.vue` | Permission-card branches | Open |
| 16 | `JsonValueView.vue` | Value render branches | Open |
| 16 | `McpServerForm.vue` | Env var entry blocks | Open |
| 12 | `MessageComposer.vue` | Internal | Open |
| 11 | `sessionCommands.ts` | Slash-command boilerplate | Open |
| 11 | `layoutSanitize.ts` | Sanitization branches | Open |
| 10 | `GroupTab.vue` | Group-tab variants | Open |

### 3.3  Resolution status of prior audit's top 5 candidates

| Prior candidate | This refresh |
| --------------- | ------------ |
| 1. JsonSchemaField polymorphic split | 🟡 partial — `JsonSchemaFieldFrame.vue` extracted (E.4) but type-branch dups remain (14 + 16) |
| 2. `<LibraryTabPanel>` 5-way wrapper | ❌ rejected per Phase E — only 2 tabs share the shape |
| 3. `useTaskAggregation` composable | ✅ shipped as `formatElapsed` (E.2) — was a jscpd false positive per rubber-duck |
| 4. `createTriggerPlugin()` Lexical factory | ⏸️ deferred — only 2 plugins |
| 5. `useCodeMirror()` composable | ✅ shipped as `codeMirrorShared.ts` helpers (E.3) |

### 3.4  New high-ROI extraction candidates (2026-05-27)

| # | Candidate | ROI |
| - | --------- | --- |
| 1 | **`LibraryAgentsTab` user/project sections → `<AgentSection :scope :entries>`** | 🔴 HIGH — 77 lines, freshly added in Sprint A. The Edit button worsened the dup; same fix has to land in both branches. **Do this before B.** |
| 2 | **`<TabCloseButton>` extracted from ChatTab + GroupTab** | 🟡 LOW — 21 lines CSS + 13 lines script. Real but visual, both files are < 500 lines. Defer until either grows. |
| 3 | **`<EnvKeyValueRow>` for env-var blocks (McpServerForm intra)** | 🟡 LOW — would also help Settings env sections. Defer. |
| 4 | **`<LibraryInstructionsScopeSection>`** for user/project chrome (instructions tab dup, 26+25 lines) | 🟡 MEDIUM — similar shape to #1; could share the same wrapper. |

---


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
| ~~HIGH~~ | ~~`src-bun/app/chat/sessions.ts`~~         | ~~(entire)~~ | ~~1,929-line god object~~ ✅ Phase D.3 — now 1,058 lines (-45%); 5 sibling services + SessionEventForwarder + config builder + MetadataService extracted |
| MEDIUM   | `src-bun/app/library/mcpRegistry.ts`       | 59-73      | Duplicated RPC wrapper (addConfig/updateConfig) — still present (jscpd confirms 13-line cross-file dup with skillsRegistry.ts in §3) |
| MEDIUM   | `src-bun/app/client/fakeClient.ts`         | 293, 296   | Raw `Error` throws — verified 2026-05-27 (still present; only 2 sites left). Acceptable in test infra path, not gated by AppError |
| ~~LOW~~  | ~~`src-bun/app/client/client.ts`~~         | ~~21-24, 116~~ | ~~Duplicate `setClientForTest` × 2~~ ✅ Done (SDK simplification 2026-05-25; per §7) |

### 4.5  Architectural pattern counts (verified 2026-05-27 by grep)

| Pattern | Prior count | This refresh | Delta |
| ------- | ----------: | -----------: | ----- |
| `window.dispatchEvent('dafman:…')` callsites | 0 (Phase A killed) | **0** | = ✅ |
| `addEventListener('dafman:…')` callsites | 0 (Phase A killed) | **0** | = ✅ |
| `as unknown as` (prod files only) | ~25 | **25** | = (renderer 14, backend 11). Tests have many more but they're acceptable scaffolding. |
| `invokeCommand(` directly in `*.vue` | 3 | **3** | = (`SessionDetailsPanel.vue` x1, `FilePicker.vue` x2). Pre-existing per Phase B. |
| `setTimeout(fn, 0)` callsites | unknown | **7** prod (TerminalPanel 2, MessageComposer 2, MessageEditorBody 1, FilePicker 1, useComposerCommandMode 1) | NEW count — these are the Phase F.1 backlog. |
| `requestAnimationFrame` callsites | unknown | **15** prod (composables/useChatScroll 5, useChatTimelineState 3, others 7) | Mostly intentional (D.2 transcript controllers). Phase F.2 backlog. |
| `localStorage.setItem` raw callsites | unknown | **7** prod (4 via `usePersistedRef`, 3 directly in components — `useDetailsSections.ts`, `useSessionSkills.ts`, `LibraryPanel.vue`, `FilePicker.vue`, `sessionCommands.ts`) | The 3 direct sites should migrate to `usePersistedRef` for consistency. |
| `new ResizeObserver` | unknown | **0** prod (all via `useResizeObserver` from VueUse) | ✅ Clean. |
| `throw new Error(` in `src-bun/app/` RPC paths | unknown | **0** in production RPC handlers (the 3 hits are 1 in `terminalRegistry` runtime-unsupported guard, 2 in `fakeClient` test infra, 1 in `shared/errors.ts` AppError factory itself) | ✅ Clean. rpcGuard discipline holds. |


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

### Since the last audit (2026-05-26 → 2026-05-27)

- [x] **Groups v3 + v3.1 polish** — nested DockviewVue per workspace
  group; G4a–G4c right-click move-to-group / inline rename / cross-
  group drag. Multiple `fix(groups)` commits.
- [x] **Settings restore fix (`c97b0a5`)** — bun-side `coerceLayout`
  was stripping all v3 fields, making restore impossible. Added
  passthrough + regression test.
- [x] **Tier-3 E2E harness extension (`f999bfd`)** — `bunHarness.restart()`,
  `urlFor()` helper, flows 21-24 (layout restore, settings round-trip,
  groups create, groups move-session). Catches the v3 bug class.
- [x] **Plans restructure (`4bff70c`)** — 17 `plan-*.prompt.md` →
  `DONE.md` + `TODO.md` + `_archive/`. Docs only but eliminates
  drift sources.
- [x] **Palette polish (`46540cd` + follow-ups)** — inline sub-menus
  + child label as breadcrumb (so context survives when fuse hides
  the parent) + settings coverage + `useCommandState` integration
  (kills the hand-rolled query mirror that was racing the library).
- [x] **`childMatchTokens` / `parentSelfTokens` extracted** — single
  source of truth for which child fields participate in the parent's
  fuse corpus vs auto-expand.
- [x] **`activeSessionId` fix (`0d20fb5`)** — `recomputeActiveSession`
  + GroupPanel `onDidActivePanelChange` now correctly track chat-tab
  changes inside the v3 active group. Was breaking every
  `session.*` palette command + the right-rail.
- [x] **Sprint A1 — Library Agents Select/Deselect (`bca5704`)**
  — per-row Select/Deselect button, "Selected" chip, left-rail accent.
  Reuses `useSessionAgents`.
- [x] **Sprint A2 — Library Agents Edit (`a529ef5`)** — safe-subset
  edit via `splitFrontmatter` + `parseAgentFrontmatter` + verbatim
  preserved-tail. Unknown frontmatter keys (mcp-servers / github /
  plugins) survive byte-for-byte. +3 unit tests.
- [x] **Sprint A3 — `/agent <name>` actually selects (`a529ef5`)**
  — slash parses argument, looks up via `listAgents`, calls
  `selectAgent`. Unknown name → warn toast with available list.
- [x] **MANUAL_TESTS split (`1308a58`)** — 1338-line file split
  into active `MANUAL_TESTS.md` + `MANUAL_TESTS_archive.md`. Active
  file gathers all failing items into a single ❌ work list.

**Tests:** 600 → **679 pass**. **Type gates:** all clean
(`vue-tsc --noEmit` + `tsc -p tsconfig.bun.json --noEmit`).
**ESLint:** ✅ repaired 2026-05-28 (Phase F.4); 0 errors, 18 warnings.


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

### Phase E — Deduplication: extract repeated patterns 🟡 PARTIAL (2026-05-26)

Per §3 jscpd scan. Reshaped by the 2026-05-26 rubber-duck — several
audit-suggested abstractions turned out to be jscpd false positives
or over-abstractions; this section is the executed plan, not the
original.

- [x] **E.1 / audit #6** ✅ `ArgumentsPreview.vue` — the
  `<details><summary>Arguments</summary><CommandBlock lang="json" /></details>`
  shape shared by `PermissionDetails.vue` (2 sites) + `ToolDetails.vue` (2 sites).
- [x] **E.2 / audit #3** ✅ `lib/formatElapsed.ts` + 11 unit tests.
  Audit's "task aggregation composable" was a jscpd false positive
  per rubber-duck — the actual duplicated code was duration
  formatting. SubagentBlock / useSessionTasks / JobsPanel now all
  delegate to `formatElapsed({activeTimeMs?, startedAt?, completedAt?})`.
- [x] **E.3 / audit #5** ✅ `lib/codeMirrorShared.ts` — NOT a full
  `useCodeMirror()` composable per rubber-duck (DiffEditor's
  MergeView rebuild semantics are incompatible with CodeEditor's
  Compartment lifecycle). Just `buildCodeMirrorTheme` +
  `resolveLanguageWithFallback` helpers shared between the two.
- [x] **E.4 / audit #1** ✅ `JsonSchemaFieldFrame.vue` — extracted the
  shared label / required-marker / description chrome (4 sites in
  `JsonSchemaField.vue`: array, enum, number, string). Boolean keeps
  its inline layout. Per-type subcomponent split deferred — the
  chrome hoist alone removed the actual duplication (454 → 395 lines).
- [x] **E.7 / audit #8** ✅ `ActivityButton.vue` — extracted the
  identical `<button>` markup the ActivityBar rendered twice (top
  stack + bottom stack).
- [ ] **audit #2 (`LibraryTabPanel`)** ❌ rejected per rubber-duck.
  Only Agents + Instructions share the user/project two-section
  shape; Skills/MCP/Tools have different shapes. A single 5-slot
  wrapper would be a god-component bigger than the duplication.
- [ ] **audit #4 (Lexical trigger factory)** ❌ deferred per
  rubber-duck. Mention + SlashCommand share only ~12 lines of
  trigger scaffolding; their behavior diverges enough that a
  factory would over-indirect. Revisit if a third plugin appears.
- [ ] **audit #7 (`CommandPalette` intra-file)** — deferred. The 33
  dup lines are template, and a sub-component would add similar
  boilerplate. Defer until the file grows.
- [ ] **audit #9 (`McpServerForm` / `ToolDetails` / `JsonValueView`
  intra-file)** — deferred for the same reason.

**Net result:** ~250 production lines removed (matches the audit's
expected impact), 11 new unit tests, 5 new files. jscpd duplication
should re-measure under 1.5%.

**2026-05-27 refresh:** actual remeasure showed `src/` at **2.43%**
(not 1.5%). Sprint A1/A2 added the new 77-line intra-file dup
in `LibraryAgentsTab.vue` (see §3.2 + new candidate §3.4 #1). Defer
the original Phase E completion and add Phase E.8 below to clean
up the new debt before it grows.

### Phase E.8 — `<AgentSection>` extraction (NEW 2026-05-27)

🔴 **Triggered by:** Sprint A1 + A2 doubled the per-row markup
(Select + chip + Edit + Reveal + Delete), turning the prior 42-line
project-vs-user dup in `LibraryAgentsTab.vue` into a **77-line**
intra-file clone — biggest single dup in the renderer.

**Scope:**
- Extract `<AgentSection :scope="user|project" :entries />` component
  for the agent row + actions block.
- Same component can absorb `LibraryInstructionsTab.vue`'s 26+25
  line user/project dups (cross-file reuse opportunity).
- Keep `LibraryAgentsTab.vue` as orchestrator (form + grouping +
  Select wiring) — should shrink from 903 → ~750 lines.

**Anti-goal:** don't try to also wrap Skills / MCP / Tools per the
2026-05-26 rubber-duck rejection (different shapes; would be a
god-component).

### Phase F — Clean up timing hacks + remaining ESLint 🟡 PARTIAL

**Done (2026-05-26):**
- [x] prettier CRLF/LF normalization (4803 → 0)
- [x] complexity 17 → 5 warnings
- [x] 6 `no-non-null-assertion` cleaned
- [x] 5 `max-lines-per-function` disabled per-file for stores
- [x] 1 `max-depth` cleaned
- [x] 9 misc fixes

**Open:**
- [ ] **F.1** Replace `setTimeout(fn, 0)` focus hacks with `nextTick`
  or VueUse lifecycle (**7 sites** verified 2026-05-27: TerminalPanel x2,
  MessageComposer x2, MessageEditorBody, FilePicker, useComposerCommandMode)
- [ ] **F.2** Replace double-rAF patterns with proper settle helpers
  (15 rAF sites — most intentional in scroll/timeline controllers; the
  auditable ones are App.vue + useGroupsActions + bootLayout)
- [ ] **F.3** Migrate 3 direct `localStorage.setItem` callsites to
  `usePersistedRef` (`useDetailsSections.ts`, `useSessionSkills.ts`,
  `LibraryPanel.vue`, `FilePicker.vue`, `sessionCommands.ts`)
- [x] **F.4** ✅ **Fix ESLint config** — DONE (2026-05-28). Root cause:
  duplicate `typescript-eslint` install (gts had its own nested copy).
  Fixed via `package.json#overrides` + reinstall + `eslint --fix` (3,054
  prettier auto-fixes across 29 files). `lint:eslint` now wired into
  `bun run check`. Warning count 31 → 18; complexity hotspots 17 → 6.
  See §2 for the live numbers.

---

### Phase G — God objects (NEW 2026-05-27)

The 2026-05-27 refresh showed 7 files still > 800 lines. Phase D
closed three of them; the rest break into:

- **Still-deferred from Phase D:**
  - **D.5** `SessionsManager.vue` (1,038) — split when sidebar work
    resumes
  - **D.6** `layoutStore.ts` (1,184) — split only if Dockview feature
    or bug forces it
  - **`SessionDetailsPanel.vue`** (2,168) — D-class candidate; was
    already extracted into 7 composables but the SFC stayed huge

- **NEW (post-Phase D):**
  - **`registerBuiltinCommands.ts`** (735, ↑275 since 2026-05-25 due
    to palette polish) — would benefit from splitting per-section
    (Static / Settings catch-all / Active-session / Dynamic parents)
    but each section is a coherent unit. Defer unless it crosses 800.

**Triage:** none of these are urgent. The biggest *new* signal is
`SessionDetailsPanel.vue` at 2,168 still being #1 god component
despite its composables — a template-side split (per-section SFCs
mirroring the composables) could meaningfully cut it.
