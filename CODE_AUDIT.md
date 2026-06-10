# Code Quality Audit

> **Date:** 2026-06-10 (full refresh per `skill://code-audit` — every table re-derived from a fresh tool run this session)
> **Codebase:** 56,837 lines of production TypeScript + Vue across `src/` + `src-bun/` (233 prod files); 78,939 lines / 332 files including tests.
> **Toolchain this refresh:** `bunx eslint --format json` (0 errors, 58 warnings), `bunx jscpd src src-bun --reporters json` (272 clones), Python line-count + architectural-pattern greps over the prod file list. `git ls-files` line counts.
> **Prior refresh:** 2026-06-04. Deltas are annotated `(±N vs prior)`.
> **Landed since last audit:** #207 (atomic settings), #219/#220 (usage pill), #182 (layoutStore+sessionsStore split), #157 (reducer pure), #151 (owner-write lint guard). In-flight: #208 (resume hydration), #212 (error ownership), #205/#206 (webview hardening).
> **Tracked follow-ups:** #150 (god objects — still open for SessionsManager/sessions.ts), #157 ✅, #158 (IPC channel — partially landed).

---

## 1  File Size Distribution

Top prod files (excludes `__tests__/`, `*.test.ts`). Files > 800 lines are split candidates (AGENTS.md rule 19: > 1,200 = fix the structure before adding anything).

| Lines | File | Δ vs 2026-06-04 | Note |
| ----: | ---- | --------------- | ---- |
| 2,261 | `src/components/session/SessionDetailsPanel.vue` | 0 | 🔴 #1 god component; split tracked in #150 |
| 1,638 | `src/dev/Playground.vue` | 0 | Dev-only, not shipped |
| 1,448 | `src-bun/app/chat/sessions.ts` | **+77** | 🔴 **Regrowing again** — was 1,371 last audit |
| 1,382 | `src-bun/rpc.ts` | +53 | Wire schema/type surface; mirrors `src/ipc/types.ts` (597 dup lines — §3) |
| 1,340 | `src/components/session/SessionsManager.vue` | **+301** | 🔴 **NEW god component** — was 1,039; session list + toolbar + group mgmt all merged in |
| 1,134 | `src/components/chat/ChatWindow.vue` | +39 | 🔴 Still regrowing post D.2 split |
| 1,085 | `src/components/chat/MessageComposer.vue` | +72 | 🔴 Regrowing post D.4 split |
| 1,015 | `src/ipc/types.ts` | +8 | Wire contract mirror (see rpc.ts above) |
| 930 | `src/components/session/SessionHeaderControls.vue` | **−86** | ✅ Improved |
| 926 | `src/stores/chat/sessionsStore.ts` | **−321** | ✅ Split landed (#182) — was 1,247 |
| 860 | `src/components/settings/KeyboardShortcutsSection.vue` | +1 | 🟡 Crossed 800; shortcuts editor new feature |
| 819 | `src/lib/registerBuiltinCommands.ts` | +48 | 🟡 Crossed 800 |
| 749 | `src/components/permissions/PendingRequestCard.vue` | 0 | |
| 732 | `src-bun/index.ts` | +11 | |
| 715 | `src/components/library/LibraryAgentsTab.vue` | 0 | |
| 690 | `src/lib/chatEvents.ts` | +5 | |
| 648 | `src-bun/app/client/fakeClient.ts` | 0 | Test fake |
| ~~1,261~~ | ~~`src/stores/shell/layoutStore.ts`~~ | **−687** | ✅ **Fixed (#182)** — now 574; extracted `layoutEdgePanels` (276), `layoutPanelCrud` (221), `layoutSeeds` (124), `layoutUtils` (66) |
| ~~1,247~~ | ~~`src/stores/chat/sessionsStore.ts`~~ | **−321** | ✅ **Fixed (#182)** — now 926; extracted `sessionsListStore` (543), `sessionActions` (328), `sessionEffects` (47) |

**Totals:** 56,837 prod / 233 files (prior 55,917 / 223) → **+920 prod lines, +10 files**. All: 78,939 / 332 (prior 74,349 / 324).

**Headline:** Two god-store splits landed (#182: layoutStore −687, sessionsStore −321), but `SessionsManager.vue` has grown 301 lines and is the new #3 god component. `sessions.ts` backend is still regrowing (+77). The file-size gate (#150) is not yet in CI — structural regrowth is still silent.

---

## 2  ESLint — Strict TypeScript Analysis

**Config:** `strictTypeChecked` + `eslint-plugin-vue/flat` + `complexity` + `@stylistic`. `bunx eslint --format json`: **0 errors, 58 warnings** (prior: 0 / 23 → **+35 warnings**).

### 2.1  Warnings by rule

| Count | Rule | Δ |
| ----: | ---- | - |
| 29 | `@stylistic/padding-line-between-statements` | **+27** — entirely from `useGlobalShortcuts.ts` (20 hits); keyboard-shortcut feature work left style debt |
| 8 | `complexity` | +3 — see §2.2 |
| 5 | `@typescript-eslint/no-dynamic-delete` | 0 — split across `sessionMetadataStore.ts` (1), `groupsStore.ts` (3), `layoutStore.ts` (1) |
| 4 | `@typescript-eslint/no-non-null-assertion` | +3 |
| 3 | `no-duplicate-imports` | = |
| 3 | `@typescript-eslint/no-redundant-type-constituents` | = |
| 2 | `@typescript-eslint/no-unnecessary-type-assertion` | +1 |
| 1 | `max-lines-per-function` | new — `useMcpLibrary.ts:59` (207 lines) |
| 1 | `@typescript-eslint/use-unknown-in-catch-callback-variable` | = |
| 1 | `@typescript-eslint/prefer-nullish-coalescing` | = |
| 1 | `vue/no-template-shadow` | = |

### 2.2  Complexity hotspots (CC > 15) — fresh from eslint JSON

| CC | File | Function | Status |
| -: | ---- | -------- | ------ |
| 28 | `src/stores/chat/sessionsListStore.ts:276` | Arrow fn (grouped `computed`) | 🔴 **NEW** — freshly extracted store; grouping/sorting logic needs decomposition |
| 23 | `src/stores/chat/sessionsListStore.ts:201` | `compareByField` | 🔴 **NEW** — same file; table-driven sort function |
| 21 | `src-bun/app/config/settings.ts:357` | `coerceKeyboardShortcuts` | 🔴 **NEW** — from keyboard-shortcut feature work |
| 19 | `src/stores/shell/layoutStore.ts:250` | `recomputeActiveSession` | Open |
| 18 | `src/stores/chat/sessionsStore.ts:404` | `createSession` | Open |
| 17 | `src/composables/useGlobalShortcuts.ts:54` | `handleKeydown` | 🔴 **NEW** — keyboard shortcut feature |
| 16 | `src/components/terminal/TerminalPanel.vue:269` | `initXterm` | Open |
| 16 | `src/lib/shortcuts/editorUtils.ts:276` | `buildChordFromEvent` | 🔴 **NEW** — keyboard shortcut feature |
| ~~25~~ | ~~`src-bun/app/library/agentFiles.ts`~~ | ~~`parseAgentFrontmatter`~~ | ✅ Fixed — no longer > 15 |
| ~~18~~ | ~~`src-bun/app/shared/singleInstance.ts`~~ | ~~`acquireSingleInstanceLock`~~ | ✅ Fixed — no longer > 15 |

`max-lines-per-function` trips once: `useMcpLibrary.ts:59` (207 lines in one composable body). The `src/stores/**` exemption hides the Pinia store bodies.

**Root cause of warning spike:** The keyboard-shortcut feature (#183) added `useGlobalShortcuts.ts` with 20 padding-line violations and several CC > 15 functions. The padding-line rule should be auto-fixable with `eslint --fix`.

---

## 3  Copy-Paste Detection (jscpd combined run)

`bunx jscpd src src-bun --reporters json` — combined scan (TypeScript, HTML, CSS in .vue files).

| Format | Clones | Dup lines | Pct | Δ |
| ------ | -----: | --------: | --: | - |
| TypeScript | 237 | 2,916 / 66,068 | **4.41%** | — |
| CSS (in .vue) | 22 | 193 / 27,171 | **0.71%** | — |
| HTML (templates) | 13 | 161 / 27,513 | **0.59%** | — |
| **Total** | **272** | **3,270** | **2.21%** | — |

> Note: prior audit ran `jscpd src` and `jscpd src-bun` separately (src: 2.88%, src-bun: 1.94%); this run combines them so absolute percentages differ. Cross-run comparison is directional only.

Partition: **49 cross-file production clones**, **29 intra-file production clones**, 194 test boilerplate (acceptable).

### 3.1  Cross-file production clones (top)

| Lines | A | B | What |
| ----: | - | - | ---- |
| **597 total** | `src-bun/rpc.ts` | `src/ipc/types.ts` | 🔴 **Wire-mirror anti-pattern** — 6 clone blocks (374+81+64+38+20+20 lines); backend RPC schema and renderer type declarations are copy-maintained. Tracked in #158 |
| 23 | `JsonSchemaField.vue` | `JsonSchemaForm.vue` | Schema field narrowing |
| 21 | `ChatTab.vue` (CSS) | `GroupTab.vue` (CSS) | Tab-close button CSS (long-deferred `<TabCloseButton>`) |
| 20 | `SessionDetailsPanel.vue` | `SessionHeaderControls.vue` | TypeScript utility code |
| 18 | `LibraryMcpTab.vue` | `LibrarySkillsTab.vue` | Library tab boilerplate |
| 17 | `src-bun/app/shared/errors.ts` | `src/ipc/types.ts` | Error type definitions |
| 16 | `mcpRegistry.ts` | `skillsRegistry.ts` | Registry RPC-wrap helper |
| 16 | `ChatWindow.vue` | `SubagentBlock.vue` | HTML template |
| 16 | `LibraryInstructionsTab.vue` | `LibrarySkillsTab.vue` | CSS |
| 15 | `src-bun/app/config/settings.ts` | `src/stores/app/settingsStore.ts` | Settings type definitions |

### 3.2  Intra-file production clones (top)

| Lines | File | What | Status |
| ----: | ---- | ---- | ------ |
| 50 | `LibraryInstructionsTab.vue` | User/project scope chrome (2 pastes) | 🔴 **Biggest intra-file dup** — same shape E.8 fixed for Agents |
| 26 | `sessions.ts` (backend) | Repeated session operation pattern | Open |
| 23 | `fakeClient.ts` | Test fake branches | Test infra, acceptable |
| 17 | `PendingRequestCard.vue` | Permission-card branches | Open |
| 16 | `MessageComposer.vue` | Composer input branches | Open |
| 16 | `SessionsManager.vue` | TypeScript utility code | Open |
| 15 | `JsonValueView.vue` | Value render branches | Open |
| ~~77~~ | ~~`LibraryAgentsTab.vue`~~ | ~~User/project sections~~ | ✅ Fixed (E.8 → `LibraryAgentsTabSection.vue`) |

**Biggest new finding:** `rpc.ts` ↔ `types.ts` wire-mirror (597 dup lines across 6 blocks) is the top cross-file extraction candidate. Every RPC channel change requires a manual sync of both files.

---

## 4  Runtime Safety

### 4.1  Type-escape hatches (fresh grep)

| Pattern | Prod | Test | Notes |
| ------- | ---: | ---: | ----- |
| `as unknown as` | **17** | — | 17→ reduced from 26 prior ✅; top: `sessionMetadataService.ts` 2, `layoutStore.ts` 2; `index.ts` down to **1** (documented Electrobun SDK cast, §6.3) |
| `as any` | **0** | 2 | ✅ None in prod |
| `: any` | **4** | — | `src-bun/app/chat/sessionHelpers.ts:151,157,163,171` — function params typed `any` in a JSON-to-type converter; low risk but fixable |
| `new CustomEvent` | 1 | 0 | ✅ Only `src/lib/bus.ts` (the typed bus itself) |
| `addEventListener('dafman:`/`'app:` | **0** | 0 | ✅ Window-event anti-pattern eliminated |
| `invokeCommand(` in `*.vue` | 3 | — | `SessionDetailsPanel.vue` (1), `FilePicker.vue` (2) — only component→IPC bypasses; everything else routes through stores |
| `setTimeout(` | 25 | 12 | −3 vs prior; `TerminalPanel.vue` 3, `MessageComposer.vue` 2, `useComposerCommandMode.ts` 2 |
| `requestAnimationFrame` | 14 | 2 | −2 vs prior; `useChatScroll.ts` 5, `useChatTimelineState.ts` 3 — scroll anchoring (domain) |
| `localStorage.` | 14 | 25 | +1 vs prior; `usePersistedRef.ts` 4, `useDetailsSections.ts` 3 — see §5 |
| `new ResizeObserver` / `MutationObserver` | 0 | 0 | ✅ Via VueUse |
| `eslint-disable` | 1 | — | `sessionHelpers.ts` — single suppression |
| `@ts-ignore` / `@ts-expect-error` | 0 | — | ✅ Clean |

### 4.2  Error handling

- `rpcGuard` wrapping is consistent; `throw new Error(` in `src-bun/app/**` is only: `fakeClient.ts` (3 — test fake), `errors.ts` (1 — error factory, correct), `terminalRegistry.ts` (1 — terminal spawn failure). All are correct uses, not RPC handlers that should use `rpcGuard`.
- **#158 partially fixed:** `invoke.ts:141-142` now correctly use `b.onLogEvent?.(l)` and `b.onAuditEvent?.(l)` (optional chaining added) — the dev boot unhandled rejection is gone. `index.ts` is down to 1 documented cast (was 6).
- **#157 ✅ FIXED:** `sessionReducer.ts` no longer imports `useLayoutStore`/`useToastStore`/`useNotificationsStore`. Effects are returned as `SessionEffect[]` and consumed by `sessionEffects.ts` — the single policy owner.

---

## 5  Build vs Buy (inventory sweep of `src/lib`, `src/composables`, `src-bun/app`)

| Tag | Item | Library | Note |
| --- | ---- | ------- | ---- |
| 🟡 | `usePersistedRef.ts` (112) + `persistScheduler.ts` (70) | VueUse `useStorage` + `useDebounceFn` | Hand-rolled debounced localStorage; VueUse covers the core. Layout persistence has custom coalescing — verify fit before swapping |
| 🟡 | `useDelayedBusyValue.ts` / `useDelayedLoadedFlag.ts` | VueUse `useTimeoutFn` / `refDebounced` | Small delayed-flag helpers; straightforward replacements |
| 🟡 | `useMcpLibrary.ts` (391, **1 `max-lines-per-function` warning**) | — | 207-line composable body; extraction candidate regardless of buy/keep |
| 🟢 | `bus.ts` (63) | (`mitt`) | Intentional typed replacement for window events (rule 18); keep |
| 🟢 | `useChatScroll.ts`, `markdown.ts`, `codeLanguage.ts`, `diff.ts`, `ansi.ts`, `formatElapsed.ts` | — | Domain logic or thin lib wrappers; keep |
| 🟡 | `title=` attrs (103 occurrences, top: `SessionDetailsPanel.vue` 19, `SessionsManager.vue` 17) | PrimeVue `v-tooltip` | Native `title=` renders only on hover with system tooltip. `v-tooltip` is already used in `StatusBar.vue` (3 hits) — adopt broadly |
| 🟢 | Custom `@keyframes` (8 occurrences) | PrimeVue `ProgressSpinner` | Only 8 keyframes; `BootSplash.vue` uses a custom loader. `JobsPanel.vue` already uses `ProgressSpinner`. Blend is acceptable |
| 🟡 | Manual badge CSS (7 occurrences) | PrimeVue `Badge`/`Chip` | `SessionsManager.vue` (3), `AgentModeOverrideButton.vue` (1), `PathChip.vue` (1) — custom badge styles that could use PrimeVue primitives |
| 🟢 | Clipboard (`navigator.clipboard.writeText`, 6 occurrences) | — | Correct direct usage; no abstraction needed |
| 🟢 | `new ResizeObserver`/`MutationObserver` | VueUse | ✅ Already routed through VueUse (0 direct calls) |
| 🟢 | Virtual list | VueUse/PrimeVue `VirtualScroller` | 0 uses; session list currently doesn't need it at current scale |

> This is an inventory-level sweep (file names + API skim + §4 pattern data), not a per-file npm exhaustive search.

---

## 6  Architectural Debt

### 6.1  God objects (> 800 lines — "what's mixed together")

| File | Lines | Mixed responsibilities |
| ---- | ----: | ---------------------- |
| `SessionDetailsPanel.vue` | 2,261 | Overview + Agents + Skills + MCP + Tools + Usage/metrics + Files + Plan + fork/compact controls in one SFC — **#150** |
| `sessions.ts` (backend) | 1,448 | `SessionRegistry`: create/resume/send/abort/fork/truncate/compact + event forwarding + replayed-`isThinking` mirror + staging — **regrowing** |
| `SessionsManager.vue` | 1,340 | 🔴 **New god component** — session list render + toolbar + group management + drag sorting + context menus; grew +301 this cycle |
| `rpc.ts` | 1,382 | Wire schema + type surface + 597 lines mirrored in `types.ts` — extraction blocked on #158 |
| `ChatWindow.vue` | 1,134 | Transcript render + composer wiring + scroll + pending requests + deleted-state + retry/edit |
| `MessageComposer.vue` | 1,085 | Composer input + agent-mode toggle + attachment handling + slash/mention plugins + toolbar |
| `ipc/types.ts` | 1,015 | Renderer-side wire mirror of `rpc.ts` |
| `sessionsStore.ts` | 926 | Record lifecycle + event ingestion + guards + selectors — still large but below 1,200 cap |
| `KeyboardShortcutsSection.vue` | 860 | Shortcut list + editing dialog + conflict detection + reset UI |
| `registerBuiltinCommands.ts` | 819 | All built-in command registrations in one flat file |

### 6.2  Store coupling

- ✅ **#157 FIXED** — `sessionReducer.ts` is now pure; it returns `SessionEffect[]` consumed by `sessionEffects.ts`. Notification/toast policy lives in one place.
- Bidirectional `sessionsStore` ↔ `layoutStore` is still present (sessionsStore watches `activeSessionId`; layoutStore reads an injected title resolver).
- ✅ **#149 landed** — session title/status derives from `sessionSelectors.ts`.
- ✅ **#151 landed** — CI guard for session liveness/tombstone field writes (`ci(eslint): guard session liveness/tombstone fields to the owner store`).

### 6.3  IPC boundary

- **#158 partially fixed** — `index.ts` cast reduced from 6 to 1 (one documented, typed Electrobun SDK boundary: `webview.rpc as unknown as { send: WebviewSendChannels }`). Dev bridge `onLogEvent`/`onAuditEvent` now use optional chaining. Remaining risk: `rpc.ts` ↔ `types.ts` wire-mirror (597 dup lines) still requires manual double-maintenance per channel change.
- ✅ Window-event bus eliminated; inbound command map is snapshot-tested (`wire-contract.test.ts`).

### 6.4  Missing gates (the recurring root cause)

Landed gates: conflict markers (#148), electrobun import boundaries (#152), session liveness owner (#151). Still prose-only: **file size** (rule 19 — file-size check tool exists in `tools/check-file-sizes.ts` but isn't enforced at CI time on god-object ratchet per se).

---

## 7  What's Been Done ✅

- **#182** — `layoutStore` 1,261→574 (−687); `sessionsStore` 1,247→926 (−321). Extracted: `sessionsListStore`, `sessionActions`, `sessionEffects`, `layoutEdgePanels`, `layoutPanelCrud`, `layoutSeeds`, `layoutUtils`.
- **#157** — `sessionReducer.ts` now pure; effects returned as `SessionEffect[]`, consumed by `sessionEffects.ts`.
- **#207** — Atomic + serialized + backed-up settings persistence (`atomicWrite`).
- **#219/#220** — Context-usage pill misreads + 1M-context limit fixed.
- **#158 (partial)** — `index.ts` IPC cast 6→1 (documented); dev bridge `?.` fix.
- **#151** — CI guard for session liveness/tombstone field write ownership.
- **#149** — session title/status normalized onto `sessionSelectors.ts`.
- **Window-event bus eliminated** — 0 `dafman:`/`app:` listeners.
- **Gates landed** — `lint:markers` (#148), electrobun import boundaries (#152).
- **`LibraryAgentsTab.vue`** −188 lines (E.8 section extraction).
- **Complexity** — `agentFiles.ts#parseAgentFrontmatter` (CC 25→clean), `singleInstance.ts#acquireSingleInstanceLock` (CC 18→clean).
- **`as any`** — 0 in production. **`as unknown as`** — 26→17.

---

## 8  Priority Cleanup Plan

Ordered; each phase is gate-green and rubber-ducked before execution (skill rule 6).

- **A — Padding-line style fix.** `eslint --fix src/composables/useGlobalShortcuts.ts` clears 20 of the 29 `@stylistic/padding-line-between-statements` warnings in one shot. *5-minute win; drops warning count from 58 → ~29.*
- **B — wire-mirror extract (#158).** Kill the 597-line `rpc.ts` ↔ `types.ts` duplication. Code-generate or share a single schema file; every channel change is currently double-maintenance and the 6-block clone is the #1 jscpd hit. This also eliminates `errors.ts` ↔ `types.ts` (17 lines).
- **C — God-object burndown (#150).** Priority order: `SessionsManager.vue` (1,340, +301 this cycle — NEW most urgent), `sessions.ts` backend (1,448, still regrowing), `SessionDetailsPanel.vue` (2,261 — largest but stable). `ChatWindow.vue` (1,134) and `MessageComposer.vue` (1,085) are also regrowing. No-behavior-change extractions.
- **D — sessionsListStore.ts complexity.** `compareByField` (CC 23) and the `grouped` computed arrow (CC 28) were extracted into a new file but not cleaned up. Both are table-driven and easily decomposed into sub-functions. `coerceKeyboardShortcuts` (CC 21 in `settings.ts`) is similar.
- **E — File-size CI gate (#150).** `tools/check-file-sizes.ts` exists; wire it into `bun run check` on a ratchet capped at current maximums. Stops the silent +301/+77 regressions by construction.
- **F — In-flight worktree merges.** #208 (resume hydration guard), #212 (error ownership), #205/#206 (webview hardening) — these are in separate worktrees and need review/merge before branching on the same files.
- **G — Dup extractions.** `<TabCloseButton>` (ChatTab/GroupTab CSS, 21+13 lines), `LibraryInstructionsTab` scope-section (50 intra-file, mirror of E.8), backend registry RPC-wrap helper (mcpRegistry↔skillsRegistry, 16 lines).
- **H — `: any` cleanup.** `sessionHelpers.ts:151-171` — 4 function parameters typed `any` in JSON conversion helpers; replace with `Record<string, unknown>`.
- **I — `title=` → `v-tooltip` sweep.** 103 `title=` attributes; `v-tooltip` already used in `StatusBar.vue`. Systematic migration improves UX consistency and leverages PrimeVue's tooltip positioning.

---

> Regenerate this audit with `skill://code-audit` — every cell above is from a fresh tool run on 2026-06-10, not copied from the prior snapshot.
