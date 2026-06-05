# Code Quality Audit

> **Date:** 2026-06-04 (full refresh per `skill://code-audit` — every table re-derived from a fresh tool run this session)
> **Codebase:** 55,917 lines of production TypeScript + Vue across `src/` + `src-bun/` (223 prod files); 74,349 lines / 324 files including tests.
> **Toolchain this refresh:** `eslint . --format json` (0 errors, 23 warnings), `jscpd src` + `jscpd src-bun` (v4 JSON reporter), Python line-count + architectural-pattern scans over the tree. `vue-tsc` and `tsc -p tsconfig.bun.json` both clean.
> **Prior refresh:** 2026-05-27. Deltas are annotated `(±N vs prior)`.
> **Tracked follow-ups filed from this audit:** #150 (god objects — expanded), #157 (reducer side-effects), #158 (untyped IPC channel). Related in-flight: #149 (state normalization — ✅ landed), #151 (owner-write lint guard).

---

## 1  File Size Distribution

Top prod files (excludes `__tests__/`, `*.test.ts`). Files > 800 lines are split candidates (AGENTS.md rule 19: > 1,200 = fix the structure before adding anything).

| Lines | File | Δ vs 2026-05-27 | Note |
| ----: | ---- | --------------- | ---- |
| 2,261 | `src/components/session/SessionDetailsPanel.vue` | +93 | 🔴 **#1 god component; not previously tracked** (now in #150) |
| 1,638 | `src/dev/Playground.vue` | +3 | Dev-only, not shipped |
| 1,371 | `src-bun/app/chat/sessions.ts` | **+313** | 🔴 **Regrowing** — D.3 split was 1,929→1,058; +313 since |
| 1,329 | `src-bun/rpc.ts` | +53 | Whole RPC schema/type surface |
| 1,261 | `src/stores/shell/layoutStore.ts` | +77 | 🔴 > 1,200 (#150) |
| 1,247 | `src/stores/chat/sessionsStore.ts` | +98 | 🔴 > 1,200 (#150) |
| 1,095 | `src/components/chat/ChatWindow.vue` | **+253** | 🔴 **Regrowing** — D.2 split was 1,185→842; +253 since |
| 1,039 | `src/components/session/SessionsManager.vue` | +1 | |
| 1,016 | `src/components/session/SessionHeaderControls.vue` | +104 | Crossed 1,000 |
| 1,013 | `src/components/chat/MessageComposer.vue` | +17 | 🔴 Crossed 1,000 again — D.4 split was 1,396→996 |
| 1,007 | `src/ipc/types.ts` | +36 | Crossed 1,000 |
|   771 | `src/lib/registerBuiltinCommands.ts` | +36 | |
|   757 | `src/components/terminal/TerminalPanel.vue` | +0 | |
|   749 | `src/components/permissions/PendingRequestCard.vue` | +44 | |
|   721 | `src-bun/index.ts` | +59 | |
|   718 | `src-bun/test-server.ts` | +3 | Test infra |
|   715 | `src/components/library/LibraryAgentsTab.vue` | **−188** | ✅ Improved — E.8 section extraction landed |
|   685 | `src/lib/chatEvents.ts` | +0 | |
|   648 | `src-bun/app/client/fakeClient.ts` | +37 | Test fake |
|   634 | `src/components/shell/CommandPalette.vue` | +9 | |
|   617 | `src/components/library/McpServerForm.vue` | +0 | |
|   603 | `src-bun/app/library/agentFiles.ts` | +38 | |

**Totals:** 55,917 prod / 223 files (prior 51,969 / 207) → **+3,948 prod lines**. All: 74,349 / 324 (prior 66,090 / 278).

**Headline:** the D-phase splits (`sessions.ts`, `ChatWindow.vue`, `MessageComposer.vue`) are **silently regrowing** because nothing gates file size — rule 19 is prose, not CI. `SessionDetailsPanel.vue` (2,261) is the largest file and was untracked. → file-size gate proposed in #150.

---

## 2  ESLint — Strict TypeScript Analysis

**Config:** `strictTypeChecked` + `eslint-plugin-vue/flat` + `complexity` + `@stylistic`. `bun run lint:eslint`: **0 errors, 23 warnings** (prior: 0 / 18).

### 2.1  Warnings by rule

| Count | Rule | Δ |
| ----: | ---- | - |
| 5 | `@typescript-eslint/no-dynamic-delete` | +2 — all in `groupsStore.ts` |
| 5 | `complexity` | −1 |
| 3 | `@typescript-eslint/no-redundant-type-constituents` | = |
| 2 | `max-depth` | = — `agentFiles.ts#writeAgent` |
| 2 | `@stylistic/padding-line-between-statements` | new |
| 1 | `use-unknown-in-catch-callback-variable` | new |
| 1 | `prefer-nullish-coalescing` | = |
| 1 | `no-unnecessary-type-assertion` | new |
| 1 | `vue/no-template-shadow` | = |
| 1 | `no-non-null-assertion` | = |
| 1 | `no-duplicate-imports` | = |

### 2.2  Complexity hotspots (CC > 15) — fresh from eslint JSON

| CC | File | Function | Status |
| -: | ---- | -------- | ------ |
| 25 | `src-bun/app/library/agentFiles.ts:318` | `parseAgentFrontmatter` | Open — table-driven dispatch candidate |
| 19 | `src/stores/shell/layoutStore.ts:316` | `recomputeActiveSession` | Open |
| 18 | `src/stores/chat/sessionsStore.ts:466` | `createSession` | Open |
| 18 | `src-bun/app/shared/singleInstance.ts:100` | `acquireSingleInstanceLock` | 🟡 **NEW since prior audit** |
| 16 | `src/components/terminal/TerminalPanel.vue:269` | `initXterm` | Open |
| ~~20~~ | ~~`src-bun/app/chat/sessions.ts`~~ | ~~`resume`~~ | ✅ Fixed (no longer > 15) |
| ~~17~~ | ~~`src/lexical/plugins.ts`~~ | ~~(arrow)~~ | ✅ Fixed |

`max-lines-per-function` reports **0** — but it's disabled in `src/stores/**` (Pinia bodies); the real store sizes are in §1. No non-store function trips it.

---

## 3  Copy-Paste Detection (jscpd v4)

| Scope | Clones | Dup lines | Pct | Δ |
| ----- | -----: | --------: | --: | - |
| `src/` (renderer) | 114 | 1,306 / 45,300 | **2.88%** | +0.45pp |
| `src-bun/` (backend) | 26 | 254 / 13,122 | **1.94%** | −0.29pp |

Renderer partition: **13 cross-file prod**, **12 intra-file prod**, 89 test boilerplate (acceptable).

### 3.1  Cross-file production clones (top)

| Lines | A | B | What |
| ----: | - | - | ---- |
| 21 | `ChatTab.vue:260` | `GroupTab.vue:395` | Tab-close button CSS (the long-deferred `<TabCloseButton>`) |
| 18 | `LibraryMcpTab.vue:151` | `LibrarySkillsTab.vue:86` | Library tab boilerplate |
| 16 | `LibraryInstructionsTab.vue:321` | `LibrarySkillsTab.vue:221` | Library tab boilerplate |
| 16 | `JsonSchemaField.vue:24` | `JsonSchemaForm.vue:35` | Schema field narrowing |
| 15 | `PermissionDetails.vue:23` | `PermissionRuleEditor.vue:39` | Permission shape mapping |
| 14 | `MentionPlugin.vue:178` | `SlashCommandPlugin.vue:211` | Lexical trigger scaffolding (still only 2 plugins) |
| 13 | `ChatTab.vue:16` | `GroupTab.vue:24` | Tab script-setup boilerplate (couples to the 21-line CSS dup) |

### 3.2  Intra-file production clones (top)

| Lines | File | What | Status |
| ----: | ---- | ---- | ------ |
| 26 + 25 | `LibraryInstructionsTab.vue` | User/project scope chrome (2 pastes) | 🔴 **Now the biggest intra-file dup** — same shape E.8 fixed for Agents |
| 17 | `PendingRequestCard.vue` | Permission-card branches | Open |
| 16 | `McpServerForm.vue` | Env-var entry blocks | Open |
| 16 | `JsonValueView.vue` | Value render branches | Open |
| ~~77~~ | ~~`LibraryAgentsTab.vue`~~ | ~~User/project sections~~ | ✅ Fixed (E.8 → `LibraryAgentsTabSection.vue`; now 13 lines) |

**Backend cross-file:** `mcpRegistry.ts`↔`skillsRegistry.ts` (13), `sessionSkillsService.ts`↔`skillsRegistry.ts` (11), `sessionMcpService.ts`↔`mcpRegistry.ts` (10) — the registry/service RPC-wrap helper, still un-extracted.

---

## 4  Runtime Safety

### 4.1  Type-escape hatches (fresh grep)

| Pattern | Prod | Test | Notes |
| ------- | ---: | ---: | ----- |
| `as unknown as` | 26 | 115 | Top: `src-bun/index.ts` **6** (outbound IPC cast — #158), `layoutStore.ts` 4, `sessionMetadataService.ts` 2 (SDK boundary). Most prod ones are documented SDK-shape casts. |
| `as any` | **0** | 2 | ✅ None in prod |
| `new CustomEvent` | 1 | 0 | ✅ Only `src/lib/bus.ts` (the typed bus itself) |
| `addEventListener('dafman:`/`'app:` | **0** | 0 | ✅ Window-event anti-pattern eliminated (AGENTS rule 18 honored) |
| `invokeCommand(` in `*.vue` | 3 | — | `SessionDetailsPanel.vue` (1), `FilePicker.vue` (2) — the only component→IPC bypasses; everything else routes through stores |
| `setTimeout(` | 28 | 12 | Timing: `TerminalPanel.vue` 3, `index.ts` 3, `openAttachment.ts` 2, `plugins.ts` 2 |
| `requestAnimationFrame` | 16 | 2 | `useChatScroll.ts` 5, `useChatTimelineState.ts` 3 — scroll anchoring (domain) |
| `localStorage.` | 13 | 25 | `usePersistedRef.ts` 4, `useDetailsSections.ts` 3 — see §5 |
| `new ResizeObserver` / `MutationObserver` | 0 | 0 | ✅ Via VueUse |

### 4.2  Error handling

- `rpcGuard` wrapping is consistent; raw `throw new Error(` in prod is mostly test fakes (`fakeClient.ts`) + `invoke.ts`/`main.ts` boot paths, not RPC handlers. Low concern.
- **#158**: `invoke.ts:141-142` call `b.onLogEvent`/`b.onAuditEvent` **unguarded** while `:144,146` use `?.`; the dev/HMR bridge omits the former → unhandled rejection every dev boot (visible in `bun run smoke`).

---

## 5  Build vs Buy (inventory sweep of `src/lib`, `src/composables`, `src-bun/app`)

Most infrastructure is reasonable wrappers around real libs (markdown-it, CodeMirror, xterm) or genuine domain logic. Clear candidates:

| Tag | Item | Library | Note |
| --- | ---- | ------- | ---- |
| 🟡 | `usePersistedRef.ts` (112) + `persistScheduler.ts` (70) | VueUse `useStorage` + `useDebounceFn` | Hand-rolled debounced localStorage; VueUse covers the core, but layout persistence has custom coalescing — verify fit before swapping |
| 🟡 | `useDelayedBusyValue.ts` / `useDelayedLoadedFlag.ts` | VueUse `useTimeoutFn` / `refDebounced` | Small delayed-flag helpers |
| 🟢 | `bus.ts` (63) | (`mitt`) | Intentional typed replacement for window events (rule 18); keep |
| 🟢 | `useChatScroll.ts`, `markdown.ts`, `codeLanguage.ts`, `diff.ts`, `ansi.ts`, `formatElapsed.ts` | — | Domain logic or thin lib wrappers; keep |

> Honesty note: this is an **inventory-level** sweep (file names + API skim + the §4 pattern data), not a per-file npm search of all 100 files. The two 🟡 rows are the clear candidates surfaced by the `localStorage`/timing greps.

---

## 6  Architectural Debt

### 6.1  God objects (> 800 lines — "what's mixed together")

| File | Lines | Mixed responsibilities |
| ---- | ----: | ---------------------- |
| `SessionDetailsPanel.vue` | 2,261 | Overview + Agents + Skills + MCP + Tools + Usage/metrics + Files + Plan + fork/compact controls in one SFC |
| `sessions.ts` (backend) | 1,371 | `SessionRegistry`: create/resume/send/abort/fork/truncate/compact + event forwarding + replayed-`isThinking` mirror + staging |
| `ChatWindow.vue` | 1,095 | Transcript render + composer wiring + scroll + pending requests + deleted-state + retry/edit |
| `layoutStore.ts` | 1,261 | dockview lifecycle + groups + persistence + active-session + title resolver |
| `sessionsStore.ts` | 1,247 | Record lifecycle + all mutation actions + event ingestion + guards + (now) selectors |

### 6.2  Store coupling

- 🔴 **#157** — `sessionReducer.ts` (nominally pure) imports `useLayoutStore` (`:48,:305`), `useToastStore` (`:221,240,268,280`), `useNotificationsStore` (`:312`). Notification policy is split: `turnEnd` fires from the reducer, `waitingForInput` from `sessionsStore.ts:410`.
- Bidirectional `sessionsStore` ↔ `layoutStore` (sessionsStore watches `activeSessionId`; layoutStore reads an injected title resolver from sessionsStore).
- ✅ **#149 landed** — session title/status now derives from one owner (`sessionSelectors.ts`); removed the App.vue watcher + `renamePanel` + `syncSidebarCatalog` title pushes.

### 6.3  IPC boundary

- 🔴 **#158** — outbound `webview.rpc as unknown as { send: … }` ×6 in `index.ts` bypasses the wire contract; renderer channel guards inconsistent; dev bridge incomplete.
- ✅ Window-event bus eliminated; inbound command map is snapshot-tested (`wire-contract.test.ts`).

### 6.4  Missing gates (the recurring root cause)

The recurring bug/debt class is **structural rules with no mechanical gate**. Landed gates: conflict markers (#148), electrobun import boundaries (#152). Still prose-only: **file size** (rule 19 — #150 proposes the gate), **single-owner writes** (#151).

---

## 7  What's Been Done ✅

- **#149** — session title/status normalized onto one owner (3 PRs, #154/#155/#156).
- **Window-event bus eliminated** — 0 `dafman:`/`app:` listeners; typed `bus.ts` only.
- **Gates landed** — `lint:markers` (#148), electrobun import boundaries (#152).
- **`LibraryAgentsTab.vue`** −188 lines (E.8 section extraction); intra-file dup 77 → 13.
- **Complexity** — `sessions.ts#resume`, `lexical/plugins.ts` no longer > 15.
- **`as any`** — 0 in production.

---

## 8  Priority Cleanup Plan

Ordered; each phase is gate-green and rubber-ducked before execution (skill rule 6).

- **A — File-size gate (#150).** `tools/check-file-sizes.ts` ratcheting on current max, wired into `bun run check`. Stops the silent regrowth (§1) by construction. *Highest leverage; mechanical.*
- **B — God-object burndown (#150).** `SessionDetailsPanel` (2,261), `sessions.ts` (1,371), `ChatWindow` (1,095), both stores < 800. No-behavior-change extractions; update STATUS/DEVLOG size rows (rule 21).
- **C — Reducer side-effects (#157).** Make `sessionReducer` pure; move notify/toast policy to one consumer.
- **D — Typed IPC channel (#158).** Kill the 6 `as unknown as` send casts; fix the dev-bridge `onLogEvent`/`onAuditEvent` boot errors.
- **E — Owner-write lint guard (#151).** Locks the #149 invariant mechanically.
- **F — Dup extractions.** `<TabCloseButton>` (ChatTab/GroupTab, 21+13), `LibraryInstructionsTab` scope-section (26+25, mirror of E.8), backend registry RPC-wrap helper.

---

> Regenerate this audit with `skill://code-audit` — every cell above is from a fresh tool run on 2026-06-04, not copied from the prior snapshot.
