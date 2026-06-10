# Changelog

All notable changes to Dafman are documented here. Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed (2026-06-10 dual-reduction slice 2 — issue #209)

- **Unified the duplicated session status-delta derivation between the two reducers (internal).** Following slice 1 (pending-requests), the per-event derivation of title, model + reasoning-effort, current sub-agent, and turn/thinking state was still duplicated between the record-side reducer (`sessionReducer.ts`) and the ambient-side chat-event handlers. Both now route through one pure, no-Pinia `reduceSessionStatusEvent` + `SessionStatusDelta` union in `src/lib/sessionStatus.ts`; the record side applies it via `applyStatusDeltaToRecord` and the ambient handlers apply the same delta. Removed 6 duplicate record-side handlers. A 32-case convergence test asserts both projections agree (and documents the intentional divergences — e.g. abort/task-complete clear the record's turn state but deliberately not the ambient's). No behavior change.

### Added (2026-06-10 session config templates — issue #243)

- **Session config templates.** Save a session's configuration (agent, enabled MCP servers, disabled skills, run mode) as a named, reusable template, then apply it to a running session or spin up a new session from it. The session details panel gains **Save as template…** (captures the live config) and **Apply template…** (applies a saved one, toasting any servers/skills that no longer exist). The command palette gets a dynamic **Templates** group — **New session from template** entries (`template.new.<id>`). Templates are delta-encoded (explicit MCP-enable + skill-disable lists, so a new global server isn't silently force-disabled) and persisted to `<userData>/session-templates.json` via a new Bun `TemplateService` (atomic writes). Backed by `listTemplates`/`saveTemplate`/`deleteTemplate`/`applyTemplate`/`captureTemplate` RPCs (wired into both the app and the test backend). Phase 1 scope: storage + palette + details-panel actions (the Library Templates tab is Phase 2).

### Fixed (2026-06-10 fake-client session-mode shape — test infra)

- **Fixed the fake SDK client's `mode.get()` return shape.** It resolved a `{ mode: 'interactive' }` envelope, but the real SDK (and `sessionMetadataService.getMode`'s validation) expects a bare mode string — so any code path reading the session mode in the full-E2E harness threw `unexpected session mode from SDK`. Surfaced by the new `captureTemplate` flow; the fake now returns the bare string.

### Added (2026-06-10 prompt snippet library — issue #242)

- **Reusable prompt snippets (Library → Snippets).** A new Snippets tab in the Library lets you create, edit, tag, and delete reusable prompt fragments (title + markdown body + tags + optional slash shortcut), persisted to `<userData>/snippets.json` via a new Bun `SnippetService` (atomic temp+rename writes). Insert a snippet into the active session's composer from the row's Insert action or the command palette's **Insert Snippet…** group — the body lands at the cursor (never replacing existing content) via an `insert-composer-text` bus event the composer consumes for its session. Backed by `listSnippets`/`saveSnippet`/`deleteSnippet` RPCs (wired into both the app and the test backend). Phase 1 scope: CRUD + palette + insert (slash-typeahead and a composer toolbar button are deferred to phases 2/3).

### Changed (2026-06-10 dual-reduction slice 1 — issue #209)

- **Unified the duplicated pending-request shape between the two session-state reducers (internal).** `SessionRecord.pendingRequests` (sessionsStore) and `ChatAmbient.pendingRequests` (chatEvents) were byte-identical discriminated unions built by two separate hand-written switches. Both now share one `SessionPendingRequest` type + `pendingRequestEntryFromPayload`/`pendingRequestEntryFromData` builders in a new no-Pinia `src/lib/sessionStatus.ts`. A table-driven convergence test asserts the record-side and ambient-side projections produce the identical entry. No behavior change — the first, lowest-risk slice of #209 (status-delta unification deferred).

### Added (2026-06-10 cross-session search — issue #241)

- **Search across all open session transcripts (`Mod+Shift+F`).** A new left-edge **Search** panel runs a debounced substring query against every open session's transcript (user messages, assistant replies, system notifications), grouping matches by session with `<<…>>` context snippets. Clicking a match focuses the owning session and scrolls to the exact message via reveal-by-event-index. Backed by a `searchSessionTranscripts` RPC + `SessionRegistry.searchTranscripts`; the per-event matching/snippet logic lives in a focused, unit-tested `src-bun/app/chat/transcriptSearch.ts` helper. Phase 1 scope: open sessions only (closed/on-disk search is deferred); long-transcript event-index precision is tail-bounded.

### Fixed (2026-06-10 full-E2E harness CSP regression)

- **Restored the full-E2E tier (test infra).** The strict renderer CSP added in #205 (`connect-src 'self' ws://localhost:*`) silently broke every `e2e/full` flow: the harness connected the browser to `ws://127.0.0.1:<port>`, which CSP treats as a distinct origin from `localhost` and blocks — so the renderer never reached the backend and every flow timed out on boot. The harness now connects via `localhost` to match production (Electrobun RPC) and the CSP. Caught while adding the cross-session-search E2E flow; the tier is not in required CI, so the regression went unnoticed.
- **Fixed the `19-library-skills` E2E flow broken by #253 (test infra).** The Skills two-column work (#28/#253) added a second per-row toggle ("This session"), so the flow's `.skill-row … .p-toggleswitch` selector matched 2 elements (strict-mode violation). The flow now targets the first ("Default"/global) toggle, which is what it asserts.
- **Stabilized a flaky `bun test` failure (test infra).** The unit job intermittently aborted with `Export named 'PrimeVueConfirmSymbol' not found in primevue/useconfirm` — a Bun ESM-linker concurrency bug (the export is statically present) triggered when many `.vue` test files race to import `primevue/confirmationservice` under the custom SFC preload. The preload now warms that module graph once, single-threaded, before tests fan out.

### Added (2026-06-10 palette session jump — issue #185)

- **Jump to / resume sessions from the command palette (`Mod+K`).** Open sessions appear as `Jump` entries (focus/reveal via the cross-group path from #173); closed, on-disk sessions appear as `Resume` entries (reopen + reveal), capped at 20 with a "browse all" entry beyond that. Open sessions are listed before closed ones; the list refreshes when the palette opens. Replaces the old `session.switch` command.

### Added (2026-06-10 Library Skills two-column — issue #28)

- **Library → Skills tab: per-session override toggle.** Each skill row now shows a **"Default"** (global) + **"This session"** (per-session override, via `setSessionSkillEnabled` for the focused session) toggle pair, disabled with a "No active session" hint when none is focused — mirroring the MCP two-column (#200). Continues the #28 Library-as-source-of-truth model. (Tools stay global-only for now — they have no per-session runtime/persistence; tracked in #252.)

### Fixed (2026-06-10 reload transcripts — issue #235)

- **Reloading the renderer (Ctrl+R / HMR) no longer blanks open transcripts.** The backend session resume short-circuited for an already-live session and skipped replaying its history, so a reload restored the tabs/sidebar but left the message panes empty (a full restart was needed to get them back). `SessionRegistry.resume()` now re-runs the same hydrate/replay path for already-registered sessions (reusing the live SDK session), and the renderer guards against double-appending into a record that already has events. Cold boot, the #172 readiness gate, and the #208 replay hydration-guard are all preserved.

### Changed (2026-06-10 wire contract single-source — issue #210/#158)

- **The IPC wire contract is now single-source.** The payload/request types were hand-mirrored between `src-bun/rpc.ts` and `src/ipc/types.ts` (the repo's largest duplication — ~597 cloned lines). They now live in one no-`electrobun` module `src/shared/wireTypes.ts` that both sides import: `src-bun/rpc.ts` (1390→213) derives the Electrobun `RPCSchema` from the shared `CommandMap` via a mapped type and stays the only file that imports `electrobun/bun`; `src/ipc/types.ts` (1019→218) is now a thin renderer barrel. Net −1,978 lines of duplicated declarations; every wire change is now one edit.
- **Fixed a latent wire drift:** the renderer's `CommandMap['sendMessage']` was missing the `agentMode` arg the backend already accepted (#41). The `wire-contract.test.ts` request samples now use `satisfies CommandMap[...]['args']` so this class of drift fails at compile time.

### Fixed (2026-06-08 context-usage pill — issues #219, #220)

- **Context-usage pill no longer corrupted by per-call usage events (#219).** `assistant.usage` carries only per-API-call `inputTokens`/`outputTokens` (verified against the SDK types), not the cumulative `currentTokens`; `mergeUsage` was misreading `inputTokens` as `currentTokens`, so any sub-agent/mcp-sampling call (which shares the session's ambient) would drop the pill to that call's small token count. The pill now sources `currentTokens`/`tokenLimit` solely from `session.usage_info`.
- **1M-context models report usage correctly (#220).** Raised the context-limit plausibility cap from 500k to 4M so GPT-4.1 / Gemini 2.5 Pro (1M windows) are no longer rejected as implausible (which left the pill unable to compute a percentage).

### Fixed (2026-06-08 durable persistence — issue #207)

- **`settings.json` can no longer be silently wiped by a torn or concurrent write (#207).** All writes now go temp-file + atomic `rename` (`src-bun/app/shared/atomicWrite.ts`), a `writeChain` serializes concurrent `update()` calls, and a `settings.json.bak` of the last-good parse is kept and used for recovery before falling back to defaults (a corrupt primary never overwrites a good `.bak`). Previously a power-loss/disk-full/concurrent write could truncate the file, and the next boot silently reset every setting **and** the whole persisted layout. The same atomic write is applied to `session-metadata.json`.

### Fixed (2026-06-08 resume hydration — issue #208)

- **Resuming sessions no longer shows phantom "unseen activity" counts (#208).** On resume the backend replays a session's historical events; replayed `assistant.turn_end` events were run through the side-effectful session reducer, so every past turn bumped `unseenTurns` (and fired a turn-end OS notification when enabled) for each non-active restored session — a multi-session restart lit up bogus unread dots and reordered the sidebar. Replayed events are now wire-tagged (`replay: true`) and `handleTurnEnd` skips the unseen-count bump + notify on replay while still clearing the thinking state.

### Fixed (2026-06-08 error ownership — issue #212)

- **Changing run mode / model / approve-all no longer emits an unhandled promise rejection (#212).** These fire-and-forget setters toasted the error **and** re-threw it; the `void`-called UI sites had no `.catch`, so the rejection surfaced as `unhandledrejection` (e.g. `unknown rpc: setSessionMode`). They now own the error via the toast and return `Promise<boolean>` (false on failure) instead of re-throwing; `startAutopilot` and the auto-approve toast key off that boolean so nothing double-reports or falsely confirms.

### Security (2026-06-08 webview hardening — issue #205)

- **Hardened the privileged webview against navigation to attacker-controlled content (#205).** Agent/tool/MCP output is untrusted, and the renderer holds privileged IPC, so a navigation to external content is an RCE/phishing risk. Three layers added: (1) a native navigation guard — `setNavigationRules([appOrigin])` plus `will-navigate`/`new-window-open` handlers that keep the main webview on its own origin and route external `http(s)` links through the existing `openUrl` RPC (external browser, https allowlist); (2) a DOMPurify `afterSanitizeAttributes` hook forcing `target="_blank"` + `rel="noopener noreferrer"` on **all** anchors (previously only markdown-token links got this, so raw HTML `<a>` could navigate the top document); (3) a strict Content-Security-Policy `<meta>` (`default-src 'self'`, `script-src 'self'`, `object-src 'none'`, etc.) as defense-in-depth behind the DOMPurify sanitizer.

### Fixed (2026-06-08 keyboard editor chord — issue #202)

- **Rebound the keyboard-shortcuts editor to `Mod+Shift+K`** (was `Mod+K Mod+S`). The original sequence was unreachable: `Mod+K` (command palette) is a single chord that fires on the first press, so any sequence sharing that prefix never resolved. Found dogfooding the keyboard system; `Mod+Shift+K` is a free global chord (`useGlobalShortcuts` dispatch unchanged). The `e2e/full` keyboard flow's previously-`fixme` editor test is now active.

### Added (2026-06-07 Library MCP two-column — issue #28)

- **Library → MCP tab: per-session override toggle.** Each Configured server row now shows two clearly-labelled toggles — **"Default"** (the existing global allowlist, applies to all new sessions) and **"This session"** (a per-session override for the focused session, driven by `setSessionMcpEnabled`). The "This session" toggle is disabled with a "No active session" hint when no session is focused (follows `lastFocusedSessionId` via the existing `getLibrarySession()`). First slice of the decided #28 Library-merge model; validates the two-column pattern before it rolls to Skills/Tools and the session rail's sections are removed.
- New composable surface on `useMcpLibrary`: `librarySession` / `hasLibrarySession` (reactive focused-session context), `sessionEnabled(name)` (per-session enabled state — a server is session-disabled iff its session status is `'disabled'`, otherwise enabled; inherits the global default when the session has no status for it), and `setSessionEnabled(name, enabled)` (focused session only — does not touch the global all-sessions sync).
- Known follow-up: flipping the global "Default" toggle still pushes to all sessions and can stomp a per-session override (tracked in **#199**).
- Coverage: 7 new `LibraryMcpTab.twoColumn.test.ts` tests (both toggles render; disabled with no session; "This session" calls `setSessionMcpEnabled` for the focused session only and not the global RPC; the `sessionEnabled` status rule for disabled/connected/no-status).

### Added (2026-06-07 per-message agent mode — issue #41)

- **Per-message agent-mode override.** A new one-shot control (`AgentModeOverrideButton.vue`) sits beside `ModeButtonGroup` in the composer toolbar; selecting Interactive/Plan/Autopilot arms the _next_ message only — it does NOT mutate the session mode. The override clears automatically after submit (one-shot), tinted by the mode color while pending. State lives in a per-`ChatWindow` composable `useComposerAgentMode` (`nextMessageMode` / `setNextMessageMode` / `resolveForSubmit`); ephemeral UI state, not session data.
- **`agentMode` threaded through the send pipeline.** New optional `agentMode?: SessionMode` on the `sendMessage` RPC (`rpc.ts`, forwarded in `index.ts` to the already-one-shot-correct backend `sessions.send`), plus `ComposerSubmitPayload` → `ChatSubmitTransport` → `sessionsStore.sendMessage` → `ChatWindow` transport closure. Backend semantics were already in place (`sessions.ts:906`); this wires the renderer to reach them. The SDK's `"shell"` agentMode is intentionally excluded.
- Deferred: the `Ctrl+Shift+P` plan-send chord (to the keyboard-shortcuts wave, configurable via #31) and `onAutoModeSwitchRequest` override-clearance (to #40).
- Coverage: 2 new `wire-contract.test.ts` snapshots (explicit `agentMode`, with explicit delivery mode); 7 `useComposerAgentMode` tests (arm/resolve/one-shot reset/independence). `sessions.test.ts:#35` one-shot test unchanged.

### Added (2026-06-07 — session-pane controls + keyboard-shortcuts editor)

- **Session pane: grouping, sort, search, color-by-group (#184).** `SessionsManager` toolbar now offers grouping (by workspace / dockview group / date bucket / flat), sort field (modified / created / name / activity) with a direction toggle, a collapsible search box (OR-matches title / cwd / sessionId / summary), and a color-by-group toggle that tints open rows with their dockview group color (closed/unassigned stay gray). View prefs persist via `usePersistedRef('dafman.sessionPane.view')`; search is not sticky. `WorkspaceGroup` generalized to a discriminated `SessionGroup`; the store computes the ordered+filtered groups (single source of truth). The old open-first sub-sort is replaced by the `activity` sort. Default (workspace + modified + desc) matches prior behavior.
- **Settings → Keyboard Shortcuts editor (#183).** New `KeyboardShortcutsSection` lists every command's binding grouped by scope, with current/default chips, conflict badges (exact / shadow / prefix), per-command Reset + Reset-all, a search box, and a chord recorder (capture-phase, normalizes via `tinykeys` syntax, previews conflicts) that persists through `settingsStore.setKeyboardShortcuts`. Non-reassignable rows (composer core, native) are shown read-only. `keyboardShortcuts.open` now scrolls Settings to the section.

### Added (2026-06-07 keyboard Phase 4 — global cutover)

- **Global keyboard dispatcher (`src/composables/useGlobalShortcuts.ts`).** Single capture-phase `keydown` listener wired from `App.vue`. Resolves scope: if focus is inside an editable surface (`input`, `textarea`, `[contenteditable]`, Lexical composer, Xterm textarea), only the allowlist (`commandPalette.toggle`, `settings.open`) fires; otherwise scope is `global`. Delegates matching to `shortcutRegistry.match()`/`bindingsForScope()` via `tinykeys` `matchKeybindingPress` + `parseKeybinding`. Tracks multi-chord sequences (`$mod+K $mod+S`) with a 1 s timeout. Does NOT `preventDefault` when no binding matches — editors keep all their native keys.
- **Registered 4 previously-unbound commands** in `registerBuiltinCommands.ts`: `library.open` (Mod+Shift+L → right Library panel), `logs.open` (Mod+Shift+O → left Logs panel), `sessionDetails.toggle` (Mod+I → right Session Details rail), `keyboardShortcuts.open` (Mod+K Mod+S → stub → opens Settings until the Keyboard Shortcuts section is built).
- **`commandPaletteStore` Phase 4 cutover complete.** `open()` now guards against PrimeVue overlays (`.p-confirmpopup`, `.p-dialog-mask`) before setting `isOpen`. `toggle()` delegates to `open()`/`close()` so the guard applies on all code paths. `registerCommands()` called from `App.vue` alongside `registerBuiltinCommands`.

### Changed (2026-06-07 keyboard Phase 4 — global cutover)

- **`CommandPalette.vue` hardcoded `Ctrl/Cmd+K` listener removed.** Visibility is now driven entirely from `commandPaletteStore.isOpen`. `prevFocus` is captured via a `flush: 'pre'` watcher that fires before Vue patches the DOM so `document.activeElement` is still the original element. The dead `openPalette()` / `isOtherOverlayOpen()` functions are removed.
- **`CommandPalette.test.ts`** updated: `mountOpenPalette` now calls `commandPaletteStore.open()` directly (no Ctrl+K dispatch); the end-to-end shortcut dispatch path is covered by `useGlobalShortcuts.test.ts`.

### Tested (2026-06-07 keyboard Phase 4)

- `src/composables/__tests__/useGlobalShortcuts.test.ts` (7 tests): Ctrl+K opens palette; does not open over dialog; global pane shortcut runs command; scope guard blocks non-allowlisted shortcuts while contenteditable/input focused; allowlist (Ctrl+K) fires regardless of focus.

### Changed (2026-06-07 SDK bump — chore/deps)

- **Bumped `@github/copilot-sdk` from `1.0.0-beta.9` to `^1.0.0` (stable) and `@github/copilot` from `^1.0.54` to `^1.0.55`.** Installed: `copilot-sdk@1.0.0`, `copilot@1.0.60`. No type breaks (1.0.0 is a direct promotion of beta.9 with the same surface). All 112 backend tests and both lint passes clean.

### Fixed (2026-06-07 MCP OAuth — issue #7)

- **MCP OAuth sign-in now works reliably for all HTTP server types (#7).** Four distinct bugs fixed:
  1. **(#4, core) "MCP server does not exist" on Sign-in.** Root cause (SDK-confirmed): sessions load their MCP server list once at creation time via `enableConfigDiscovery`. The global user config written by `mcp.config.add` is not re-read by `session.mcp.reload`, so any server added to global config after a session was created was absent from the session's MCP runtime and `oauth.login` threw. Fix: `SessionRegistry.create()` and `resume()` now accept `mcpServers` and the `createSession`/`resumeSession` handlers in `index.ts` pre-fetch `mcp.listConfigs()` and pass the result, ensuring every new or resumed session has all globally-configured servers from the first turn.
  2. **(#1) "Already exists" dead-end error when re-adding a server.** `upsertConfig('add', ...)` now detects the "already exist" error from the SDK and automatically falls back to `updateMcpConfig`, returning `wasUpdate: true` so the caller can toast "updated" instead of "added". Non-"already-exists" errors still propagate normally.
  3. **(#3) Project/discovered HTTP servers had no Sign-in affordance.** The Sign-in button in `LibraryMcpTab.vue` was only rendered in the Configured section. It now also appears in the Discovered section for any entry with `type === 'http'` or `type === 'sse'`, using the same `needsSignIn` guard. `onSignIn` now accepts `{ name: string }` instead of `ConfiguredEntry`.
  4. **(#2) Sign-in button appeared on all configured HTTP servers regardless.** This was a consequence of #4 (no session status data → `undefined` → button shows). After #4's fix, servers with `status === 'connected'` correctly suppress the button; `needsSignIn` logic itself was already correct.
- Coverage: 3 new backend tests (`sessions.test.ts`) assert `mcpServers` is forwarded to `createSession`/`resumeSession`; 2 new frontend tests (`useMcpLibrary.test.ts`) cover the "already exists" auto-update path.

### Fixed (2026-06-06 dogfood batch — 10 issues)

- **Restored sessions no longer come back empty (#172).** A cold-boot race ran `restoreFromLayout()` before the Copilot CLI finished opening its DB, so `resumeSession` got empty history (silently swallowed). Boot now warms up the CLI (`listSessions` probe) before resuming, `hydrateHistory` retries an empty `getEvents()` once (with a warning), and pre-webview session events are buffered + drained on bind so none are dropped.
- **MCP OAuth sign-in works for freshly-added HTTP servers (#7).** Adding a server now reloads the active session's MCP runtime (`reloadSessionMcpServers` → SDK `session.mcp.reload`) so Sign-in can find it (was: "MCP server does not exist"), and the Sign-in button now stays visible for any non-`connected` HTTP server (was: hidden once status became `disabled`/`failed` after reopen).
- **"Go to session" navigates instead of duplicating (#173).** Reveal now scans inner per-group dockviews before opening, activating the existing panel in its group rather than recreating the session in the current group.
- **Closing a panel no longer kills a running job (#174).** `GroupPanel` skips the destructive session close when the session still has active background jobs, so the job survives and "Go to session" can reopen it.
- **Autopilot tool failures show on the job row (#36).** A `hadToolFailureThisTurn` guard stops the turn-complete watcher from clobbering the `⚠ <tool> failed` message with "Turn complete".
- **Slash commands complete instead of firing on Enter (#175).** Enter (and click) on a highlighted `/command` now inserts `/command ` for arguments (mirrors Tab), instead of executing immediately.
- **Send-mode is now visible (#177).** A Steer/Queue chip shows the active send-mode next to the send button, with a queued indicator when messages are waiting behind a running turn.
- **Enter on an emptied composer is a no-op (#178).** Deleting all text then pressing Enter no longer inserts a stray newline.
- **Header controls stay reachable when narrow (#176).** "Allow all" and the workspace/directory control collapse to compact icons instead of disappearing; the dockview tab bar got `container-type` so the `@container` queries actually fire.
- **Selecting one agent no longer flashes the whole list (#127).** The Library agents list scoped its disabled state to the acting row instead of a list-wide busy flag.

### Fixed (#166 — `/rename` did nothing; rename is now inline — 2026-06-05)

- **`/rename` works again, and renaming is now inline instead of a blocking modal.** The rename dialog and its `rename-session` listener had been gated to the `area='all'` `SessionHeaderControls`, whose only host (`ChatTabActions`, dockview's right-header-actions slot) was removed when session controls moved to the composer toolbar — so `/rename` silently no-opped in every real build since #144. Rename now happens **in place on the session tab**: `ChatTab.vue` swaps its title for an inline input (Enter/blur commit, Escape cancels), with no modal. **`/rename <title>` now sets the name directly** via `setSessionName` with no UI at all. Deleted the orphaned PrimeVue rename modal from `SessionHeaderControls.vue`. Regression coverage in `src/components/chat/__tests__/ChatTab.rename.test.ts` and `/rename` arg/bus cases in `src/lib/__tests__/sessionCommands.test.ts`; live-dogfooded per `MANUAL_TESTS.md` RP.1.

### Changed (tab affordances — 2026-06-05)

- **Session tabs now rename on double-click**, matching the group tabs (`ChatTab.vue` double-click → inline title editor; same Enter/blur-commit, Escape-cancel behavior as `/rename`). **Group tabs drop the maximize button** — maximizing a whole group is meaningless (only individual sessions maximize), so `GroupTab.vue` keeps rename / color / close and loses the `pi-window-maximize` action.

### Changed (#149 — session title normalized onto one owner — 2026-06-04)

- **A session's display title now derives from a single owner instead of three hand-synced copies.** The dockview tab and the Sessions Manager sidebar read a `displayTitle(sessionId)` selector (`src/stores/chat/sessionSelectors.ts`) resolving `SessionRecord.title → catalog summary → short GUID`, so rename / auto-title propagate reactively with no fan-out. Removed the drift-prone sync — the App.vue title watcher, `layoutStore.renamePanel`, and the `syncSidebarCatalog` title pushes on rename/`title_changed` — which were the source of the #131/#133/#134 (stale tab/sidebar) propagation-gap class. Live rename/restore dogfood is queued in `MANUAL_TESTS.md` SN.1–SN.2.

### Fixed (#131, #133, #134 — session rename propagation — 2026-06-02)

- **Session renames now propagate everywhere immediately.** `/rename` opens a PrimeVue rename dialog from the typed `rename-session` bus event, manual renames update the live `SessionRecord` without waiting for a delayed SDK echo, first-message auto-title events patch the sidebar catalog, and dockview tab titles now update inside the active inner group dockview instead of looking only at the outer group shell.

### Fixed (#136 — command-result pills inline into prompt — 2026-06-02)

- **Attached command results now reach the agent as prompt context, not as optional temp files.** `SessionRegistry.send` appends the rendered command-result markdown to the SDK prompt and omits the command-result from `attachments`, while preserving the visible user-message text when the SDK echoes the turn. Dragged/dropped text files still use the #110 staging path. Regression coverage is at the `SessionRegistry.send` boundary in `src-bun/__tests__/sessions.test.ts`.

### Fixed (#129 — deleted open session panel — 2026-06-02)

- **Deleting a session now leaves any already-open panel in a clear read-only deleted state instead of a live composer.** The active `SessionRecord` is tombstoned after the catalog delete succeeds, preserving the transcript while disabling the composer and guarding send/session-mutation actions in the store. The tab title/icon now marks the session as deleted. Regression coverage in `src/stores/chat/__tests__/sessionsListStore.delete.test.ts`; live delete-while-open dogfood is queued in `MANUAL_TESTS.md` DSP.1.

### Fixed (#126 — composer typeahead viewport flip — 2026-06-02)

- **Composer `@` file-picker and `/` slash-command popups now stay inside the viewport.** Both Lexical typeahead surfaces use `@floating-ui/dom` (`flip` + `shift`) against the caret anchor instead of a CSS-only upward `translateY`, so the default bottom composer can still pop upward while a high/edge composer flips below or shifts horizontally instead of clipping off-screen. Regression coverage locks out the old transform; live visual dogfood is queued in `MANUAL_TESTS.md` TF.1.

### Fixed (#135 — duplicate session event forwarding — 2026-06-01)

- **Chat session events now render once instead of twice.** Fresh-created and resumed sessions no longer double-forward the SDK stream through both `config.onEvent` and `session.on`, fixing duplicate user messages, duplicate reasoning blocks, and doubled backend event log lines.

### Fixed (#132 — slash-command highlighted selection — 2026-06-01)

- **Slash-command autocomplete now honors the highlighted item.** Pressing **Tab** to complete a `/` command uses lexical-vue's current `selectedIndex` instead of always completing the first filtered command, while **Enter** continues to defer through the menu and uses lexical-vue's own `props.options[selectedIndex]` selection path. Regression coverage in `src/components/chat/__tests__/slashCommandSelection.test.ts`; live keyboard verification is pending in `MANUAL_TESTS.md` KB.3 / KB.7.

### Fixed (#127 — agent select transition — 2026-06-01)

- **Selecting an agent in the Session Details rail no longer flashes the whole agent list.** The busy/disabled state is now scoped to the clicked Select/Deselect row while the handler still ignores concurrent select attempts globally, and the active row's Select ↔ Deselect swap uses Vue's built-in `<Transition>` for a soft fade instead of a hard cut. Regression coverage in `src/components/session/__tests__/SessionDetailsPanel.agentActions.test.ts`; visual transition timing is queued in `MANUAL_TESTS.md` AST.1.

### Fixed (#128 — tab-bar maximize affordance — 2026-06-01)

- **Session and group tabs have their maximize/restore button again.** The regression dropped the custom `pi-window-maximize` tab action originally shipped in `5a1da9e`; Dafman now restores it on both inner session tabs and outer group tabs, using dockview's `panel.api.maximize()` / `exitMaximized()` APIs with accessible Maximize/Restore labels. Unit coverage locks both tab buttons.

### Fixed (#137 — chat scroll anchoring — 2026-06-01)

- **The chat transcript now stays where you put it.** Scrolling up to re-read an earlier message no longer gets yanked back to the bottom when new content streams in — the transcript sticks to the bottom only while you're actually at the bottom. When new content arrives while you're scrolled up, a floating **"Jump to latest"** pill appears and returns you on click instead of stealing your position. Focusing or switching into a session now _restores_ its scroll position (pinned → bottom; scrolled-up → keep where you were) and never jumps to the top. Implemented as one anchoring model in `useChatScroll.ts` (VueUse `useScroll`: pin on `arrivedState.bottom`, un-pin only on an actual upward scroll, so streaming and content-growth can't un-pin you), replacing the previous unconditional `scrollToBottom()` on every flush. Regression coverage in `src/components/chat/__tests__/ChatWindow.test.ts`; runtime-only behavior (focus restore, pill, no-yank) in `MANUAL_TESTS.md` SC.1–SC.4.

### Changed (composer Enter keybindings — fixed chord scheme, 2026-05-31)

- **The composer now sends on plain Enter, the conventional chat default** (was Ctrl+Enter). The full fixed scheme: **Enter** sends at the session's current Steer/Queue mode; **Shift+Enter** inserts a soft line break; **Ctrl/Cmd+Enter** inserts a hard newline (new paragraph); **Alt+Enter** force-steers; **Ctrl+Shift+Enter** force-queues; **Ctrl+Alt+Enter** sends-and-interrupts. While a `/`-command or `@`-file typeahead menu is open with a selectable option, **Enter selects the menu item** instead of sending (and Shift+Enter inserts a soft break rather than selecting). This replaces the prior Ctrl+Enter-sends mapping; it is a **fixed scheme, not a user setting** (supersedes the #88 "submit-keybinding setting" proposal). Decision matrix is a pure, unit-tested resolver (`resolveEnterAction`, `src/lexical/plugins.ts`); menu coordination uses a per-editor `WeakMap` registry (`src/lexical/composerMenuState.ts`) the HIGH-priority Enter handler reads synchronously so it can defer to the LOW-priority typeahead handler. Coverage: `src/lexical/__tests__/submitOnEnter.test.ts` (20 cases) + e2e flows 01/02/07. Keyboard/menu-timing interactions need a manual walk — see `MANUAL_TESTS.md` KB.1–KB.6.

### Added (release-channel indicator — 2026-05-31)

- **A dev/canary build now announces itself, so a development instance running alongside a stable one is unmistakable.** The bottom StatusBar shows a small tinted pill next to the `dafman` brand — `DEV` (violet) or `CANARY` (amber) — and the OS window title is suffixed (`Dafman — canary`). Stable builds show neither (no pill, bare `Dafman` title). The channel is sourced build-side from the bundled `Resources/version.json` via Electrobun's `Updater.getLocalInfo()` and exposed to the renderer through a new `getAppInfo` RPC (`{ channel, version }`); the renderer caches it via the `useAppInfo` composable. Pill-render logic is unit-tested (`src/components/shell/__tests__/StatusBar.test.ts`); the live tint/title needs a packaged build (smoke harness has no channel) — see `MANUAL_TESTS.md` CI.1 / CI.2.

### Fixed (release builds were tagged `dev` — 2026-05-31)

- **`bun run build` now produces a `stable`-channel bundle instead of a `dev`-channel one.** Electrobun's `electrobun build` defaults `--env` to `dev` (`node_modules/electrobun/src/cli/index.ts:2081`), so the documented release build (`bun run build`) was tagging release artifacts as the `dev` channel — which keys the WebView2 user-data folder + JSON state on `dev`, and (with the new indicator above) would have shown a `DEV` pill on a stable release. `build` is now explicitly `--env=stable`; `build:canary` is unchanged. CI's per-platform build matrix calls `bunx electrobun build` directly and is unaffected.

### Fixed (packaged builds couldn't start the Copilot SDK — 2026-05-31)

- **Installed/packaged builds (e.g. the `canary` channel) now actually start the Copilot SDK instead of dying on every chat with `Cannot find module '@github/copilot/sdk'`.** dafman had only ever run via `bun run dev` (node_modules on disk), so a packaging gap went unnoticed: `electrobun build` emits just `Resources/app/bun/index.js` + `views/` with **no node_modules**. At runtime `src-bun/app/client/client.ts` resolves the prebuilt native CLI (`@github/copilot-<plat>-<arch>/copilot[.exe]`) via `import.meta.resolve` and passes it to the SDK as `cliPath`; with no node_modules that resolve threw, so no `cliPath` was passed and the SDK fell back to its own `getBundledCliPath()` (`import.meta.resolve('@github/copilot/sdk')`), which also failed. Fix: `electrobun.config.ts` now copies the building platform's native `copilot` binary next to the bundled bun entry (`Resources/app/bun/copilot.exe`), and `resolvePlatformCliBinary()` falls back to `join(import.meta.dir, 'copilot[.exe]')` when the npm resolve misses (packaged mode); `bun run dev` is unaffected (npm resolve still wins there). The config also **throws** if the binary is missing at build time, because Electrobun's copy step only logs-and-continues on a missing source (would otherwise ship a silently-broken bundle). Installer size grows ~32 MB → ~99 MB (the bundled CLI).

### Fixed (single-instance crash — 2026-05-31)

- **Launching dafman while another copy is already open on the same build channel no longer crashes the webview.** Two instances on the same channel share one WebView2 user-data folder (`…/<identifier>/<channel>/WebView2`) and dafman's JSON state (settings, session metadata, audit, command results); the collision silently kills the webview with no JS error in the log. Electrobun ships no single-instance API, so dafman now acquires a PID+token lockfile at `join(Utils.paths.userData, 'dafman.lock')` during boot (`src-bun/app/shared/singleInstance.ts`, wired in `src-bun/index.ts` before any shared-state init). A duplicate writes a loud stderr note (pointing at `bun run install:canary`), logs `duplicate instance blocked`, and exits cleanly; a stale lock left by a force-killed instance is detected (dead PID / corrupt file) and reclaimed. The lock path is channel-scoped, so `dev`/`canary`/`stable` still coexist — the supported way to run a second instance while developing. Unit coverage in `src-bun/__tests__/singleInstance.test.ts` (fresh acquire, foreign-live-pid block, stale-dead-pid + corrupt-file takeover, owned-vs-usurped release).

### Added (run a second instance for development — 2026-05-31)

- **`bun run install:canary`** builds the `canary` channel and runs its Setup installer (`tools/install-channel.ts`), giving you a dafman you can keep open _alongside_ `bun run dev` without tripping the single-instance guard (different build channel → separate WebView2 + JSON state). The in-place `electrobun build` output is a packaged Setup stub + sibling `.tar.zst`, not a runnable tree, so the helper runs the installer rather than the bare `bin/launcher`.

### Fixed (#105 — 2026-05-31)

- **The literal `<system_notification>` wrapper no longer leaks into rendered sub-agent reports (or top-level system callouts).** The CLI runtime emits `system.notification` events whose `data.content` is wrapped in `<system_notification>…</system_notification>` XML tags (`SystemNotificationData.content`, `node_modules/@github/copilot/copilot-sdk/generated/session-events.d.ts:3901`). The reducer's `system.notification` handler pushed that raw content as a `system` chat item, which both `ChatWindow.vue` and `SubagentBlock.vue` render as literal `{{ item.text }}` (no markdown strip), so the envelope showed up as visible text. Fix: a scoped `unwrapSystemNotification` helper strips the exact `<system_notification>` tags (including a dangling streaming open tag) in `calloutHandlers.ts` before the content reaches the timeline, keeping the inner message and dropping empty wrappers. Regression coverage in `src/lib/chatEvents/__tests__/calloutHandlers.test.ts`.

### Added (#103 — 2026-05-31)

- **Sub-agent transcript cards can now be collapsed from the full header row or the bottom footer affordance.** The affordances are native buttons with `aria-expanded` / `aria-controls`, while the expanded body remains outside the click target so links, nested tool controls, and other inner interactive content do not accidentally fold the parent card.

### Fixed (#106, #107 — 2026-05-31)

- **Create/edit tool calls now render their file changes once, in the file-aware view.** `create`/write-file calls show the `file_text` body as syntax-highlighted file content instead of a raw JSON argument blob, and edit/str-replace calls suppress the redundant result block once the old/new arguments are rendered as a diff.

### Fixed (#110 — 2026-05-31)

- **Drag-and-dropped (and pasted) text/code files are now actually read by the agent — even when they live outside the session's working directory.** The composer turns a dropped `File` into a base64 `blob` attachment, but investigation of the bundled host CLI (`node_modules/@github/copilot/app.js`, `Jio`/`fae`/`wIn`) showed it only inlines `blob` attachments whose mimeType is a recognized image or a native office/PDF document — **every other file blob (a `.ts`/`.py`/`.md` file, whose webview `File.type` is empty so it ships as `application/octet-stream`) was silently DROPPED**, so the model "couldn't find the file". `SessionRegistry.send` detects non-inlinable file blobs and stages them to a real temp file, sending a `type:'file'` attachment instead; the host exposes those through its `<tagged_files>` flow, which works for paths outside the cwd. Boundary tests in `src-bun/__tests__/sessions.test.ts` and `src-bun/__tests__/attachmentStaging.test.ts`.

### Fixed (#109 — 2026-05-31)

- **Re-opening a session now restores the per-session "Allow all" (auto-approve) flag and run mode.** Both were in-memory only on the `SessionRegistry` (`approveAllBySession` / `modeBySession` Maps), dropped on close with no rehydrate on resume, so a reopened session reverted to the global `defaultApproveAll` and the SDK's default run mode. A new dafman-owned per-session metadata store (`src-bun/app/chat/sessionMetadataStore.ts`, persisted to `<userData>/session-metadata.json`) write-throughs `approveAll`/`mode` on every `setApproveAll` / `setMode`, and `SessionRegistry.resume()` re-applies them to both the live SDK session and the in-memory mirrors. The `resumeSession` RPC response now carries `approveAll` + `mode` so the renderer's `SessionRecord` shows the restored state immediately. (The SDK persists neither across resume: approve-all isn't in its `SessionMetadataSnapshot`, and the high-level `client.getSessionMetadata()` doesn't expose the persisted run mode.) Permanent session deletion drops the persisted entry; plain close/app-quit leave it intact for the next open.

### Fixed (#93 — 2026-05-31)

- **Library Agents / Skills / MCP session-switch reloads no longer flash a Loading indicator when the refresh resolves instantly.** The shared library list loading flag now keeps stale content visible during cached/fast reloads and only exposes the loading affordance after the same short delay used by the Agents Select affordance, while genuinely slow reloads still show feedback.

### Added (#36 — 2026-05-31)

- **Failed tool executions are now observed through the SDK's `postToolUseFailure` hook and surfaced in the Activity log + Jobs panel.** The backend wires `onPostToolUseFailure` (under `SessionConfig.hooks`, beta.9) to record a structured `toolFailure` audit entry carrying the SDK-provided `error` message (argument key NAMES only — never values), which flows through the existing audit pipeline into the Diagnostics → Activity view. The Jobs panel surfaces that SDK error context on the matching active Autopilot job's latest-response line, so a tool failure shows the real failure reason rather than only our parsed stream event. Backend coverage in `sessionConfigBuilder.test.ts` (hook records the audit entry, redacts values, never throws) and `jobsStore.test.ts` (audit entry enriches the active job; cross-session entries are ignored); wire shape locked in `wire-contract.test.ts`.

### Fixed (#81 — 2026-05-31)

- **Library → Agents now flags custom agent files the Copilot SDK rejected instead of showing them as normal selectable rows.** Session-scoped filesystem rows are annotated from the SDK-loaded agent set plus `session.custom_agents_updated` diagnostics, rejected rows show the validation message, and `/agent <name>` now reports the load failure instead of a bare "not found" toast.

### Fixed (#83 — 2026-05-30)

- **Messages with two or more mermaid diagrams now render each in its own block.** Previously the first block painted all the diagrams overlapping each other and the later blocks came out empty. `MermaidBlock.vue` built its mermaid render id as `` `mermaid-${Date.now()}-${++counter}` ``, but `counter` was declared inside `<script setup>` — i.e. per component instance — so it was always `1`, and `Date.now()` ties for diagrams mounted in the same tick. Two diagrams therefore shared an identical id and mermaid rendered both into the same element. Fix: use Vue 3.5 `useId()` (app-scoped unique) for the render id. Regression test in `src/components/shared/__tests__/MermaidBlock.test.ts` mounts two blocks in one app with a frozen clock and asserts mermaid receives distinct ids (fails on the pre-fix component, passes after).

### Fixed (#76 — 2026-05-30)

- **Fenced CodeMirror code blocks now follow light/dark mode instead of always using the dark `oneDark` theme.** CodeEditor resolves the app's existing `useDockviewTheme().isDark` signal, uses CodeMirror's default light syntax highlighting in light mode, keeps `oneDark` in dark mode, and reconfigures through a CodeMirror `Compartment` so already-rendered chat code blocks switch live when the app theme flips. DiffEditor uses the same shared selector and rebuilds on theme flips so tool diffs don't stay pinned dark either. Regression coverage is `codeMirrorShared.test.ts`, which locks the light-vs-dark theme selector seam.

### Fixed (#78 — 2026-05-30)

- **Library → Agents no longer flashes the Select button's refresh/loading affordance for instant selections.** The row still disables immediately to prevent duplicate clicks, but the PrimeVue loading affordance now appears only after the agent operation remains pending past a short delay, so the common synchronous/near-instant select path transitions cleanly. Regression coverage in `LibraryAgentsTabSection.loading.test.ts` asserts both the no-flash instant path and the genuinely-pending async path.

### Fixed (#85 — 2026-05-30)

- **Closing an empty workspace group no longer opens a confirmation dialog.** Empty groups now close immediately because no sessions would be lost. Non-empty group closes still require confirmation, but the dialog now has a clear title, explicit "this will close sessions" wording, a danger-styled **Close group** action, a secondary **Cancel** action, and defaults focus to Cancel so the destructive action is not focused by accident.

### Fixed (#79 — 2026-05-30)

- **Library slash commands now reveal/focus the already-open Library panel instead of closing it.** `/agent`, `/skill`, `/skills`, `/mcp`, and `/library` now use an idempotent edge-panel reveal path, preserving activity-rail click toggles while making command navigation keep the panel open.

### Changed (#77 — 2026-05-30)

- **Library tab header action buttons are now consistent across Agents, Skills, MCP, Tools, and Instructions.** Refresh / New / Add / bulk tool actions now share one right-aligned header affordance with the same small PrimeVue button styling, labels, titles, and accessible names while preserving their existing handlers.

### Fixed (#96 — 2026-05-30)

- **Library → MCP → Discovered now includes workspace `.mcp.json` servers for the chat session the user was viewing before opening the Library panel.** MCP discovery now keys off the last focused chat session's working directory (falling back to the active/any open session) instead of trusting `activeSessionId` alone, so edge-panel focus no longer makes the SDK discover user-scope servers only.

### Fixed (#82 — 2026-05-30)

- **Library → Agents Refresh now reloads the SDK registry before re-scanning files.** With an active session, the Refresh button passes `reloadSdk: true` through `listAgentFiles`, which reuses the existing `session.rpc.agent.reload()` path before returning the filesystem rows. Externally-dropped valid `.agent.md` files therefore become selectable immediately; no-session/global listing remains filesystem-only and session-switch auto-loads do not force extra SDK reloads.

### Fixed (#69 — 2026-05-30)

- **An MCP tool call that needs OAuth mid-session now prompts you instead of failing silently.** When an agent (not the user) triggers an MCP server that requires authentication, the SDK runtime — because we deliberately do **not** register interest in `mcp.oauth_required` — runs its browserless fallback, which reuses a cached token if one exists and otherwise flips the server to `needs-auth`. Previously nothing surfaced that transition, so the tool call appeared to silently fail and the reducer's `mcp.oauth_required` toast handlers were dead code (the event never fires without `registerInterest`). We now react to the runtime's actual signal: a `session.mcp_server_status_changed` → `needs-auth` raises a **warn toast** naming the server and pointing at the Library Sign-in button (which drives the existing `mcp.oauth.login` → system-browser flow from #7); a subsequent transition back to `connected` for a server we prompted confirms recovery with a success toast. The prompt is de-duped per server name (the runtime re-emits `needs-auth` on every connection attempt) and the guard clears on `connected`/`disabled` so a later re-auth re-prompts. **Why not `registerInterest('mcp.oauth_required')` (the issue's literal proposal):** the SDK's `buildMcpOAuthHandler` flips, when interest is registered, from the browserless fallback to a path that _blocks the MCP connection_ awaiting `respondToMcpOAuth(requestId, OAuthClientProvider)` — and `mcp.oauth.login` (keyed by server name) cannot satisfy that pending `requestId`. Registering interest without a full `OAuthClientProvider` implementation would hang the connection, strictly worse than today; the status-toast path delivers the "surface a prompt, not a silent failure" outcome without that risk. Coverage in `sessionsStore.mcpOauth.test.ts` (warn-on-needs-auth, per-server de-dup, connected-confirms-recovery, re-prompt-after-clear, plain-connect-no-toast). The end-to-end agent-driven OAuth round-trip is inherently manual (needs a real OAuth-gated MCP server mid-session — `MANUAL_TESTS.md`).

### Fixed (#66 — 2026-05-30)

- **The composer toolbar no longer overlaps its controls when the chat pane is resized — it reflows, then wraps.** At a narrow band of widths (~750–760 px, right at the `@container (max-width: 760px)` breakpoint) the left group's auto-approve button painted ~3–5 px over the center group's command-trigger. Root cause was structural, not a breakpoint to nudge: the three toolbar groups (`.lex-toolbar-left/center/right`) carried `min-width: 0`, which lets the flexbox algorithm shrink a group's _box_ below its own rigid (already container-query-collapsed) content; the toolbar had **no `flex-wrap`** and only `overflow-x: hidden`, so the over-sized content spilled sideways over the neighbouring group instead of wrapping. (This is the same class of bug as #17 resurfacing in a new spot.) Fix: drop `min-width: 0` from the three groups so a group is never sized below its content, and add `flex-wrap: wrap` + `row-gap` to the toolbar so that when even the collapsed content can't fit one line, the right-hand controls drop to a clean second row — the graceful fallback the existing code comment already promised but never implemented. Regression coverage is a new E2E flow (`e2e/full/flows/25-composer-resize.pwtest.ts`) that drives the real composer across 36 viewport widths (320→1280, straddling every breakpoint) and asserts no two visible toolbar controls overlap on both axes at any width — it fails on the pre-fix bundle (750/760 px) and passes after.

- **The MCP "Sign in" button now appears only when a server actually needs authentication.** Previously every configured HTTP MCP server showed a Sign-in button (gated purely on `transport === 'http'`) — an over-correction from #8 — so already-connected or no-auth servers carried a misleading affordance. The SDK's session-live `mcp.list()` exposes a per-server `McpServerStatus` (`connected` / `needs-auth` / `failed` / `pending` / `disabled` / `not_configured`); `loadAll` already fetched that list but discarded the status, using only the names. We now capture it: Sign-in shows when the live status is `needs-auth` **or** unknown (no active session, or the server isn't loaded into the current session — so auth is never made unreachable when we simply lack data) and hides for `connected` / `disabled` / `pending`. Coverage in `useMcpLibrary.test.ts` (`needsSignIn` connected→false / needs-auth→true / unknown→true) and `LibraryMcpTab.signin.test.ts` (connected hides the button, needs-auth shows it).

### Fixed (#7 — 2026-05-30)

- **The MCP HTTP Sign-in flow now brands the OAuth consent screen with the app name and runs through the active session.** Issue #7 asked for a "real OAuth popup" login for HTTP MCP servers. Investigation found the flow was already wired end-to-end — the Library Sign-in button (shipped in #8) calls `mcp.oauth.login`, which returns an `authorizationUrl`; we open it in the **system browser** (`openUrl`) and the SDK runtime starts the loopback callback listener before returning, completes the exchange in the background, persists the token, and reconnects (signalled via `session.mcp_server_status_changed`). Opening the system browser rather than an embedded webview popup is the correct, spec-compliant approach for a desktop app (RFC 8252 "OAuth 2.0 for Native Apps" mandates an external user-agent; embedded webviews are rejected by providers such as Google). Two real gaps were closed: (1) the renderer never passed the SDK's optional `clientName`, so the OAuth consent screen showed the SDK's neutral fallback instead of the product name — `signIn` now passes `PRODUCT_NAME` (`'Dafman'`, new shared `src/lib/product.ts` constant), which the SDK applies to newly-registered dynamic clients; (2) `signIn` ran through `sessions[0]` rather than the session whose workspace the Library reflects — it now prefers `layoutStore.activeSessionId` (falling back to any open session), mirroring `loadAll()`. Regression coverage in `useMcpLibrary.test.ts` (asserts the branded `clientName`, active-session selection, and the no-session path); the end-to-end provider auth + keychain persistence is inherently manual (`MANUAL_TESTS.md` §7).

### Fixed (#18 — 2026-05-30)

- **Light mode no longer renders the dock chrome dark.** In light mode every dockview surface — the group tab bar, the session tabs, the main panel, and the edge-group panels (Jobs / Terminals / Session details / Library) — rendered with a near-black background, leaving low-contrast titles and "weak" buttons (Library Tools _Enable all_ / _Disable all_, the composer mode select) sitting on the wrong colour. Root cause: dockview-core v6 themes via a **`theme` _prop_** (a `DockviewTheme` object), not a CSS class on a wrapper element. App.vue and GroupPanel.vue passed no `theme` prop, so dockview-core fell back to its built-in **`themeAbyss`** (a dark theme) and applied `--dv-color-abyss-dark: #000c18` to its own root — a closer ancestor than the `.dock-wrapper` whose `.dockview-theme-light` class our `style.css` `--dv-*` → `--p-*` bridge keys off — so the abyss dark always won, in _both_ modes. Every affected surface already used invertible semantic tokens (`--p-content-background`, `--p-text-muted-color`, `color-mix(... --p-content-background)`); they only looked broken because they sat on the abyss-dark dockview background. Fix: a shared `useDockviewTheme()` composable resolves the appearance to `themeLight` / `themeDark` (from `dockview-core`) and **both** dockviews (`App.vue` outer, `GroupPanel.vue` inner = session tabs) now pass `:theme="dockviewTheme"`. dockview then applies the matching `dockview-theme-light` / `dockview-theme-dark` className to its own root, our bridge binds, and the chrome follows the theme. Verified live via `bun run inspect`: in light mode `--dv-group-view-background-color` now resolves to `#ffffff` (was `#000c18`). The composable also replaces App.vue's hand-rolled `matchMedia` block with VueUse `usePreferredDark` (AGENTS.md rule 16). Regression coverage in `useDockviewTheme.test.ts` (light → `themeLight`, dark → `themeDark`, reacts to setting flips); the visual sweep is a new `MANUAL_TESTS.md` entry (dockview chrome has no geometry in happy-dom). A separate composer-resize/overlap regression spotted during the same sweep is filed as #66.

### Fixed (#54 — 2026-05-30)

- **The session-details (and Library) rail cog closes in one click again, even after you interact inside the rail.** `activateEdgePanel` decided whether the rail was "open" via `panel.api.isActive`, but that flag is true only when the panel is active **and** its group is dockview's globally-active group. Clicking any control inside the rail (a field, a button, a tab) drops the group's global-active status while the rail stays visibly open — so the next cog click took the "open it" branch (a no-op re-activate) instead of collapsing, and the rail only closed on the _second_ click. Fix: the toggle now keys off "is this the panel the edge group is currently **displaying**" via `panel.group.activePanel?.id === id` (dafman's dockview-core fork exposes `DockviewGroupPanel.activePanel` independent of global focus), so a displayed-but-not-globally-active rail collapses on a single click. Multi-panel edge semantics are preserved: clicking a tab whose panel is _not_ the displayed one (e.g. Library while session-details is shown on the same right edge) still switches to it rather than collapsing. Test-first regression coverage in `layoutStore.edgeTabs.test.ts` (the fake DockviewApi now models `group.activePanel` separately from per-panel `isActive`): the #54 repro fails before the fix and passes after, plus a sibling-switch guard.

### Fixed (#19 — 2026-05-30)

- **Library Instructions markdown now respects theme tokens in both light and dark mode.** The `.instruction-content` wrapper around rendered instruction markdown used `background: var(--p-surface-100)` — a value on PrimeVue's _numeric_ surface scale, which (unlike the _semantic_ tokens) does **not** invert under `.app-dark`, so the panel stayed light-on-light in light mode and light-on-dark in dark mode. The previous author had papered over it with four hand-rolled `:global(.app-dark)` override blocks (a workaround smell). Fix: the wrapper now uses an invertible `color-mix(in srgb, var(--p-text-color) 4%, var(--p-content-background))` background — the same construction the already-correct `.lex-code` block uses — and all four `:global(.app-dark)` overrides are deleted. Added `:not(.lex-*)` fallback rules so raw `<a>` / `<code>` / `<pre>` HTML typed literally in an instruction file (which passes DOMPurify but never gets a `.lex-*` class from markdown-it) also renders with invertible tokens. Visual inversion is covered by a new `MANUAL_TESTS.md` entry (computed-color inversion has no geometry in happy-dom).

### Added (#37 — 2026-05-30)

- **MCP tool calls now land in the Activity audit log.** Wired the SDK's `onPreMcpToolCall` hook (beta.8+) as an observe-only forensic recorder: every MCP tool invocation appends a 4th audit kind `mcp` (`serverName` · `toolName`, optional `toolCallId`, plus the **top-level argument key NAMES only** — capped at 20, with a true `argKeyCount` — never any raw argument values) to a dedicated `mcp.jsonl` and fans out through the existing `subscribeAudit → auditEvent → auditStore → LogViewer` pipeline, so MCP activity surfaces in the Activity view alongside permission decisions and URL opens. The hook is deliberately observe-only: the SDK's `onPreMcpToolCall` output can **only** rewrite `_meta` — it cannot block a call or modify its arguments (blocking lives on `onPermissionRequest` / `excludedTools`), so the handler returns `undefined` to preserve `_meta`. Defensive by construction — `extractArgKeys` degrades to empty on non-plain-object / throwing `arguments` (proxy), and the whole hook body is wrapped so an audit failure can never break or delay the MCP critical path. **Key placement gotcha (caught in review):** tool/session-lifecycle hooks live under `config.hooks` (the SDK's `SessionHooks` surface), NOT at the top level like `onPermissionRequest` — placing it top-level makes the SDK silently ignore it.

### Fixed (#17 — 2026-05-30)

- **Composer mode selector restores its compact form on narrow panes.** Commit `6343902` removed the `@container (max-width: 620px)` rule that hid the 3-icon `ModeButtonGroup` and was _supposed_ to swap in a `.mode-select-shell` compact picker — but that fallback class never existed, so the agent just deleted the hide. The wide segmented control then stayed at every width, crowding the bottom bar and (per the user) "ruining" the resize on narrow panes. Fix: `ModeButtonGroup` now renders **both** forms — the existing `SelectButton` segmented control and a single icon-only PrimeVue `Select` (`.mode-select-compact`) — and a `@container (max-width: 620px)` query swaps the segmented control out for the compact Select once the composer toolbar drops below 620px. The compact trigger shows just the active mode's icon (colored per mode); the dropdown lists all three with icon + label. Regression test (`ModeButtonGroup.compact.test.ts`) asserts both forms render and the compact Select reflects the active mode (test-first verified: failed before the fix). The width-based visual swap is covered by smoke + a new `MANUAL_TESTS.md` entry (container-query layout has no geometry in happy-dom).

### Fixed (#8 — 2026-05-30)

- **MCP "Sign in" button now shows for every configured HTTP server.** The button was gated on `entry.hasOauth`, which `classifyTransport` only set when the _static_ config blob carried an `oauthClientId`/`oauthGrantType` field. Real HTTP MCP servers — e.g. the GitHub remote MCP, configured as `{ type: 'http', url: … }` — negotiate OAuth dynamically and carry neither field, so the Sign-in affordance was permanently hidden for exactly the servers that need it. Fix: show Sign-in for any `transport === 'http'` server and drop the misleading static-OAuth heuristic (`hasOauth` removed from `ConfiguredEntry` / `classifyTransport`). The sign-in flow itself is already the source of truth — it warns "No session to authenticate" when there's no session and toasts "Already signed in" when the SDK reports the server needs no OAuth. Regression test `LibraryMcpTab.signin.test.ts` renders the tab with an http server that has no static OAuth fields and asserts the button appears (and stays hidden for stdio servers).

### Fixed (#10 — 2026-05-30)

- **Removing a configured MCP server no longer bounces it into "Discovered".** The Configured and Discovered lists are sibling `<section>`s rendered together (not tabs), and `newlyDiscovered` = `discovered` minus configured names. A configured server round-trips through `mcp.discover` (source `"user"`, and may also be a live session server), so the instant it left `configured` on remove it re-surfaced under the Discovered section — the user perceived this as "Remove jumps it to Discovered." `removeConfig` now also drops the removed name from the in-memory `discovered` list (a genuine workspace-file server legitimately returns on the next `loadAll`). Test-first regression coverage in `src/composables/library/__tests__/useMcpLibrary.test.ts` (2 tests: removed server leaves Discovered; other discovered servers untouched).

### Fixed (#16 — 2026-05-30)

- **Jobs panel "Go to session" now scrolls to the spawning tool call, not the top of the transcript.** Clicking "Go to session" on a background job switched to the owning session but stranded the user at the top of a long transcript. Two causes: (1) the navigation used a `setTimeout(100ms)` `scroll-to-bottom` bus emit, but mitt has no replay — on a freshly-opened panel the emit fired before the target ChatWindow registered its listener and was dropped; (2) the spec wants the user landed on the **message that spawned the job**, not the bottom. Fix: replaced the transient bus emit with a durable, store-parked reveal intent. `jobsStore.openOwningSession(sessionId, toolCallId?)` now calls `layoutStore.requestReveal(sessionId, { toolCallId })`; each ChatWindow consumes the intent on mount **and** via a watch (race-free for both freshly-opened and already-open panels), scrolls the matching tool-call card (`[data-tool-call-id]`) into view with a brief highlight flash, and retries across a bounded number of frames before falling back to the bottom if the node never renders. Jobs without a `toolCallId` (autopilot sessions) fall back to bottom-scroll. Regression tests in `jobsStore.test.ts` (reveal-intent parking) and `ChatWindow.test.ts` (scrollIntoView on the matching card for both mount-timing paths).

### Added (#35 — 2026-05-30)

- **Per-message `agentMode` now reaches the SDK.** `@github/copilot-sdk` beta.9 added `MessageOptions.agentMode` (`interactive` / `plan` / `autopilot` / `shell`) — the first canonical way to request plan/autopilot mode on a _single_ send. `SessionRegistry.send` now passes `agentMode` through to `session.send()`. Default is **pass-through**: each send carries the session's current mode (`modeBySession`), so the existing session-wide toggle (`session.rpc.mode.set`) stays the source of truth; an optional explicit override scopes the mode to one message. The session-wide toggle is **not** dropped — `modeBySession` still drives our local autopilot gating (the `onPermissionRequest` / `onUserInputRequest` / `onElicitationRequest` short-circuits in `sessionConfigBuilder`), which per-message `agentMode` doesn't touch. Backend-only (no composer UI change). Regression test in `sessions.test.ts` covers default pass-through, explicit override from a non-plan session, and toggle-tracking.

### Fixed (#20 — 2026-05-30)

- **Resume no longer stuck on "Thinking…".** If the app exited while a session's agent was mid-turn, the persisted history ended with a dangling `assistant.turn_start` and no terminal boundary. On resume the bun side replays that history through the same forwarder, so the renderer reducer derived `isThinking = true` — and a freshly-resumed SDK session does **not** auto-continue the interrupted turn (verified: SDK `continuePendingWork` defaults to `false`; `AbortReason` is only user/remote-initiated so a hard kill emits no `abort`), so no `assistant.turn_end` / `session.idle` ever arrived to clear it. Fix: `SessionRegistry.resume` now scans the (capped) replay slice with `historyEndsMidTurn` — a mirror of the reducer's `isThinking` transitions — and, when it ends mid-turn, appends a synthetic `dafman.resume_settled` event as the **last** replayed event. The renderer reducer maps `dafman.resume_settled` → clear-thinking (deliberately _not_ `assistant.turn_end`, which fires OS notifications + unseen-turn bumps). Bounded inside the replay stream, so no separate post-replay emit and no live-event interleaving surface. Regression tests at both boundaries: bun (`sessions.test.ts` — dangling `turn_start` → marker appended; clean `turn_end` → no marker) and renderer (`sessionsStore.restore.test.ts` — `dafman.resume_settled` clears a mid-turn `isThinking`).
- **Stop button / interrupt-send no longer leaves a stuck spinner.** Folded-in hardening uncovered during the #20 review: the reducer cleared `isThinking` only on `assistant.turn_end` / `session.idle` / `session.error`, but `session.abort()` (stop button, interrupt-send) emits an `abort` event and the agent can emit `session.task_complete` — both are turn terminators the reducer ignored. Both are now mapped to clear-thinking (via `handleThinkingOff`, not `handleTurnEnd`, since the user stopped the turn themselves). `historyEndsMidTurn` treats them as terminators too, so a persisted trailing `abort`/`task_complete` doesn't trigger a redundant `dafman.resume_settled`. Code-review verified the bundled CLI does not forward sub-agent `abort`/`task_complete` to the parent stream, so there's no premature-clear risk. Regression tests in both `sessions.test.ts` and `sessionsStore.restore.test.ts`.

### Fixed (#29 — 2026-05-29)

- **Full E2E suite green again (48/48).** The 18 failing flows were stale tests, not product bugs — they predated two deliberate UI commits. (1) The details rail no longer auto-opens on session create (`6343902`); flows now open it explicitly via the composer cog. (2) The ActivityBar was replaced with native dockview edge tabs (`e39bdc9`) — activity tabs render as `<div class="activity-bar-tab" aria-label="…">` (role generic, not buttons) with shortened labels, so `getByRole("button", {name:/library/i})` timed out. New `pageHarness` helpers `openActivityTab(page, label)` and `openDetailsRail(page)` encapsulate the current locators. Also fixed a genuine fake-SDK drift: `FakeCopilotClient` exposed `getMessages()` but production resume calls `session.getEvents()` (SDK rename) — renamed + added regression test `fakeClientResume.test.ts`. **Re-added the Full E2E job to required status checks** (removed during the #29 mitigation). Test-only change; no product code touched except the fake client.

### Fixed (#51 — 2026-05-28)

- **Library tabs auto-refresh on session switch.** `LibraryAgentsTab` / `LibrarySkillsTab` / `LibraryMcpTab` now watch `layoutStore.activeSessionId` (mirrors the canonical pattern in `LibraryInstructionsTab`); switching session re-fires the IPC fetches so Agents/Skills/MCP lists reflect the new session's cwd. Tools tab is intentionally unwatched (built-in tool list is static). **Also fixed a tightly-coupled order-of-ops bug in `layoutStore.setApi`:** `onDidActivePanelChange` was calling `recomputeActiveSession` _before_ `groupsStore.setActiveGroupId`, so switching between outer-dock groups read the stale `activeGroupId` and resolved the wrong inner dock — leaving `activeSessionId` pinned to the previous group's chat. Caught during #51 dogfood when within-group switches refreshed Library but between-group switches didn't. Swap is purely local to the panel-change callback.

### Changed (vite + plugin-vue bump — 2026-05-28)

- **Bumped `vite` from `6.4.2` to `8.0.x` and `@vitejs/plugin-vue` from `5.2.4` to `6.0.x`.** Third and final fork of #44 dep-majors umbrella. Vite 8 swaps the bundler engine from esbuild/Rollup to Rolldown + Oxc — **build time dropped from ~11s to ~1.6s** (7× speedup). Zero source-code changes needed; our `vite.config.ts` is minimal (single `vue()` plugin + `@/*` alias + port/outDir) and dodges every breaking-change surface (we don't use `rollupOptions`, `esbuildOptions`, `optimizeDeps.esbuildOptions`, `build.minify`, or `manualChunks`). Electrobun has no vite peer-dep — it just copies `dist/*` from whatever Vite emits. Both prod and HMR smoke + spinner probes pass; full E2E e2e:run unchanged. New warnings (not errors) from Rolldown: one `@vueuse/core` PURE annotation position, five "ineffective dynamic import" warnings on files imported both statically and dynamically — pre-existing tree-shaking signals worth a follow-up but not regressions.

### Changed (TS bump — 2026-05-28)

- **Bumped `typescript` from `5.9.3` to `6.0.x`.** Two tsconfig migrations triggered by TS 6 deprecation defaults: (1) dropped `baseUrl` (deprecated; paths now resolved relative to tsconfig dir), (2) added explicit `"types": ["bun"]` to renderer `tsconfig.json` (TS 6 changed `types` default from "enumerate all `@types/*`" to `[]`, breaking auto-discovery of `bun:test` imports in renderer test files). No source-code changes — TS 6 didn't surface any new type errors in our codebase. Second fork of #44 dep-majors umbrella.

### Changed (vue-tsc bump — 2026-05-28)

- **Bumped `vue-tsc` from `2.2.12` to `3.3.2`.** Two small Vue 3.5 migrations: (1) refactored `useComposerToolbarLayout` to accept the toolbar ref from the caller via `useTemplateRef('toolbarRef')` instead of destructuring an opaque ref from the composable's return value — vue-tsc 3 can't link a template string-ref to a composable-internal `ref()`. (2) Deleted dead `target` ref in `MermaidBlock.vue` (Mermaid renders via `v-html`, the ref was never read). The other 19 string template refs across `src/` still work in Vue 3.5 (deprecated but functional); broader `useTemplateRef()` migration filed as follow-up.

### Changed (SDK bump — 2026-05-28)

- **Bumped `@github/copilot-sdk` from `1.0.0-beta.7` to `1.0.0-beta.9`.** Two handler renames per SDK beta.8 API review: `onExitPlanMode` → `onExitPlanModeRequest` and `onAutoModeSwitch` → `onAutoModeSwitchRequest`. Without the rename, both handlers would have silently fallen through (TS doesn't catch the property-name change because `buildBaseSessionConfig` returns an untyped object — exactly the silent-fallthrough class AGENTS.md rule 23 is designed to prevent). New SDK surfaces (`agentMode` per-message, `postToolUseFailure` / `preMcpToolCall` hooks, remote + cloud sessions, `runtime_instructions`, provider model overrides) are filed as separate issues #35–#43 per rule 23.

### Fixed

- **Jobs panel spinner centered.** Running job status icons now use a square icon box with an explicit center transform origin so the spinner rotates around its own center.

### Changed (Process / Workflow — 2026-05-28)

- **Work-tracking migrated to GitHub Issues** + Projects board + sprint milestones. `plans/TODO.md` frozen as `plans/TODO_archive.md`. `MANUAL_TESTS.md` failing-rows section replaced with pointer to `gh issue list --label manual-test-fail`. Pending-verification section kept.
- **CI level-up.** `ci.yml` refactored: parallel `lint`/`test`/`smoke`/`e2e` jobs that mirror `bun run check` exactly. Bun install cache + Playwright cache + concurrency cancel-in-progress. CodeQL workflow (javascript-typescript, weekly + PR). Dependabot (npm + GH-actions weekly, grouped, `@lexical/*` pinned). Auto-labeler (path globs → area:\* labels). Stale-bot (90d issues / 30d PRs). Automerge workflow. Branch protection on `main` requires `lint`/`test`/`smoke`/`e2e`/`build-matrix(ubuntu-latest)`.
- **Issue / PR templates rewritten.** YAML form templates for bug / feature / tech-debt aligned to AGENTS.md rules. PR template is now a full anti-laziness checklist. `CONTRIBUTING.md` rewritten from Tauri-era stale to current shape.
- **New script:** `bun run pr:review` formats `git diff main...HEAD` into a code-review-subagent prompt, writes to temp file, copies to clipboard.

### Fixed (Phase F.4 — 2026-05-28)

- **ESLint repaired.** `bun run lint:eslint` had been silently broken since the `typescript-eslint` 8.59→8.60 bump (commit `9b9cf11`): a duplicate `typescript-eslint` install (nested under `gts`) caused ESLint 10 to reject the second `@typescript-eslint` plugin registration. Fixed via `package.json#overrides` + `eslint --fix` (3,054 prettier auto-fixes across 29 files). `lint:eslint` is now part of `bun run check` so this can't regress silently again. Live warning count: 18 (down from 31 in the 2026-05-25 baseline).
- **Phase E.8 — `<LibraryAgentsTabSection>` extracted (2026-05-28).** The 77-line intra-file dup that Sprint A1+A2 introduced in `LibraryAgentsTab.vue` is gone (jscpd: 77 → 12 lines, −84%). Parent component shrank 912 → 775 lines.
- **`.gitattributes` added (2026-05-28).** `* text=auto eol=lf` so the working tree gets LF regardless of `core.autocrlf=true`. Stops new files getting CRLF on Windows checkouts and triggering prettier errors.

### Added (Groups v3 — nested DockviewVue per workspace group)

- **Workspace groups landed (v3, nested-dockview design).** The body of the app now contains one or more named groups, each shown as a tab at the top of the body. Each group owns its own set of chat / terminal / playground panels — switching groups is a single native dockview panel-activation toggle (no remount: scroll, Lexical state, pending composer text all survive). The activity bar (Sessions / Terminals / Jobs / Logs / Settings / Library / Session Details) stays on the outer dockview and is shared across all groups.
- **`view.newGroup`, `view.nextGroup`, `view.prevGroup`** in the command palette (`Layout` group). Use Ctrl+K, type "new group" / "next group" / "previous group".
- **Per-group close button** — clicking the X on a group tab confirms, then closes every chat session in that group and removes the group meta. Last group can't be closed (one always remains).
- **Color dot + session count badge** on each group tab. Color cycles automatically through an 8-swatch palette on create.

### Changed (Groups v3)

- **Schema-bumped persisted layout to v3.** Existing v2 layouts auto-migrate on first save: the old dockview body (panels + grid) becomes the inner body of a new "Default" group. Activity-bar edges are re-seeded from defaults (intentional — edges resize themselves and the persisted v2 edge state was rarely worth carrying forward).
- **`settings.layout` field shape changed.** `dockview` is now legacy (kept for hydration only); `outer` + `groups` + `activeGroupId` + `innerBodies` are the v3 source of truth, written atomically via `composePersistLayout` (cache-first composition so unmounted groups' bodies never get dropped — closes the v1 "groups config never persisting" bug class).
- **Outer drag-overlay policy consolidated.** A single `onWillShowOverlay` handler on the outer dockview now covers both (a) activity-bar tabs (can only drop into another edge group's tab strip) and (b) group panels (can only reorder within the body tab strip — no split-screen of two groups side by side).

### Known follow-ups (v3 → v3.1 candidates)

- Native cross-group drag of chat tabs via `onUnhandledDragOverEvent` + `onDidDrop` (~80 LOC). For v3, move sessions between groups via the (forthcoming) right-click "Move to group…" menu — the underlying `useGroupsActions.moveSessionToGroup` action is implemented and tested; the menu UI is the only piece outstanding.
- Lazy-mount placeholder for inactive groups (eager mount in v3; revisit if boot regresses past the 130 ms gate).
- Per-group cwd / model / mode (the "Projects" concept).

### Upstream dependency bumps (shipped in `9b9cf11`)

- `@github/copilot` 1.0.52 → 1.0.54
- `dockview-core` / `dockview-vue` 6.4.0 → 6.6.1 (ships [#1304](https://github.com/mathuo/dockview/issues/1304) "cancel pending popout restorations on fromJSON re-entry" — the orphan-group crash that probably sank groups v1/v2; deduped a stale 6.4.0 nested copy under `dockview-vue/node_modules/`)
- `dompurify` 3.4.5 → 3.4.6
- `markdown-it` 14.1.1 → 14.2.0
- `markdown-it-deflist` 3.0.0 → 3.0.1
- `typescript-eslint` 8.59.4 → 8.60.0

### Changed

- **Replaced the custom 48 px ActivityBar rail with dockview's native vertical tab strips on both edges.** Left edge shows Sessions / Terminals / Jobs / Logs / Settings as vertical tabs; right edge shows Session Details + Library (Library moved from left → right; Settings stayed on the left rail after a one-commit detour to body grid). Tabs are drag-reorderable within / across edge groups and auto-collapse to 44 px when no tab is active — all native dockview behavior. Activity-bar tabs can no longer be dropped into the main grid / floating windows / popout — enforced via `dock.api.onWillShowOverlay`. Sessions icon changed from `pi-list` to `pi-comments` (was visually identical to Logs's `pi-bars`).
- **Added a thin 22 px status bar** at the bottom of the app shell. Hosts the brand logo (left), a future indicators slot (center), and a dev-only Playground wrench (right). Settings is no longer in the status bar — toggle via the left rail like any other activity tab.
- **Schema-bumped persisted layout to v2** with a narrow migration: extracts chat session IDs from the old layout, re-resumes them, then `seedDefaultLayout()` rebuilds the edge groups. Body grid arrangement is best-effort (chats re-tile at default). Chat session data is preserved.
- **Reorganized the renderer and bun codebase by domain.** Stores now live under 6 `src/stores/` folders, components under 9 `src/components/` feature folders plus `details/`, and bun-side modules under 8 `src-bun/app/` domain folders.
- **Standardized renderer imports on the `@/` path alias.** `tsconfig.json` now maps `@/*` → `src/*`, and 129 renderer files were updated to use alias imports. Backend imports intentionally remain relative because `Bun.build` does not reliably honor tsconfig path aliases for the bun entry graph.
- **Extracted shared utilities before the restructure.** `createListenerRegistry()`, `revealPath()`, and `MODE_OPTIONS` now live in shared helpers instead of duplicated call sites.
- **Migrated from `copilot-sdk-supercharged` to `@github/copilot` SDK directly.**
  All features used from supercharged are available in the official SDK v1.0.52+.
  The adapter at `copilotSdk.ts` already imported from `@github/copilot/copilot-sdk/index.js`;
  supercharged was only a transitive dependency installer.

### Fixed (v2 activity-rail follow-ups)

- **Edge-tab icon stayed visually pressed after the strip collapsed.** Dockview's `panel.api.isActive` is a tab-level "selected tab" state, not "visible." Activity-bar tabs now also subscribe to the group's `onDidCollapsedChange` and gate the pressed state on `isActive && !groupCollapsed`.
- **Left strip had no enforced minimum width** — could be dragged narrower than the most-demanding tab's content (Logs needs 420 px), breaking layout. Dockview's splitview reads `EdgeGroupView._expandedMinimumSize` from a private field set only at `addEdgeGroup` time; no public setter. Worked around by seeding each edge group with `max(all-tab-mins)` at creation: left=420, right=380.
- **Settings panel collapse buttons didn't toggle** (dormant since the Phase D.1 SettingsPanel split, surfaced when v2 promoted Settings to a permanent edge tab). The template bound `@update:collapsed="setCollapsed('id')"` — Vue treats this as an inline handler `($event) => setCollapsed('id')` and discards the curried closure. Switched all 7 sections to `v-model:collapsed`.

### Developer Experience

- **Added `bun run inspect <selector>`** (`tools/inspect.ts`). Live-app DOM/CSS introspection via Playwright + CDP. Supports `--rules` (full matching-CSS-rule cascade, same as Chrome DevTools' Computed panel), `--eval` (arbitrary expressions), `--click`, and `--screenshot`. Built after a debugging session where a stale `display: none` rule in our own `style.css` cost ~45 minutes of probe-test round-trips that this tool resolves in one command.
- Added a diagnostic ladder to `AGENTS.md` (rung 1 `ide_search_text` → rung 2 `ide_diagnostics` → rung 3 `bun run inspect` → rung 4 `pwtest` probe → rung 5 JetBrains debugger). Personal Copilot instructions carry the same ladder + receipts.
- Adopted **gts + Prettier** as the formatting baseline.
- Added a follow-up spacing pass for more readable control-flow / return blocks.
- Extracted `shellUtils`, fixed floating promises, and cleaned unused dependencies.
- Resolved the remaining ESLint issues down to **0 errors, 31 warnings** (down from 92).
- Extracted `useCommandTerminal` composable and `watchDynamicCommands` helper to reduce duplication.
- Applied dispatch table pattern to sessionReducer, chatEvents, and sessionHelpers for complexity reduction.
- Added `pickStr/pickNum/pickBool/pickEnum` typed field extraction helpers.
- Fixed recurring dockview component casing regression with ESLint disable block.

### Fixed

- **Session history not loading on restore.** SDK renamed `session.getMessages()`
  to `session.getEvents()` — restored sessions had no messages displayed.
- **Session titles missing after restore.** Title poll now fires immediately
  after resume, not only after the next turn completes.
- **Duplicate confirm dialog on session delete.** The delete popup no longer
  triggers the global app confirm dialog simultaneously.
- **Session tab title.** Session tabs now show the real session title
  instead of the first 8 chars of the GUID. `addPanel()` resolves the
  title from sessionsStore at creation time, and after each turn the
  backend polls `session.getMetadata()` for the auto-summarised title
  as a reliable fallback (mirroring the official CLI UI approach).
- **Session close with active work.** Closing a chat tab now also checks
  `isThinking` and `pendingRequests` in addition to jobs, so sessions
  with active streaming/thinking are properly detached rather than
  disconnected.
- **MCP toggle takes effect immediately.** Toggling an MCP server in the
  Library now pushes the change to all active sessions via
  `session.mcp.enable/disable`, not just to the config (which only
  affected new sessions).
- **Skills discovery.** The Library Skills tab now passes the active
  session's `workingDirectory` to `discoverSkills`, matching the MCP
  tab pattern. Previously workspace-level skills were not found.
- **Session workspace grouping.** Sessions now correctly group by their
  working directory in the Sessions Manager instead of all appearing
  under "No workspace". Root cause: the SDK's `toSessionMetadata()`
  remaps `context.cwd` → `context.workingDirectory`; our code was still
  reading the old field name after the SDK migration.

### Added (Phase 23c — Long Jobs + Autopilot UI)

- **Terminal panes (Bun native PTY).** Added a Bun `TerminalRegistry`
  backed by `Bun.spawn(..., { terminal })`, terminal RPC/events, xterm.js
  dockview panels, command-palette actions for standalone/session
  terminals, and session-workspace terminals.
- **Terminal default profile setting.** Settings now persists a default
  terminal profile id (`platform-default` initially); full profile CRUD
  remains a later slice.
- **Global Jobs panel.** New activity-bar Jobs surface aggregates SDK
  agent and shell tasks across registered sessions, shows active counts,
  and exposes open-session, cancel, remove, and promote-to-background
  actions where the SDK supports them.
- **Current-session Autopilot launcher.** Jobs panel now starts an
  Autopilot run for the active session by switching mode to Autopilot
  and sending the goal, with a local running/completed/cancelled job row
  tied to the session turn.
- **Detach instead of kill for active jobs.** Closing a chat tab with
  active jobs now detaches the pane while keeping the session/job handle
  alive so it can be reopened from Jobs.
- **Task wire broadening.** `TaskInfo` now mirrors SDK agent and shell
  task shapes; `JobRecord` is the normalized UI-facing model and the
  backend exposes aggregate `listJobs` plus `promoteTask`.
- **Composer/sidebar follow-ups.** Library/details/jobs edge panels now
  enforce minimum widths (including stale persisted left/right edge
  sizes), menus render outside clipped panes, and the composer toolbar is
  split into left mode/Allow all/workspace/shell, center upload/editor
  formatting, and right model/settings controls. Narrow composers switch
  mode to an icon-only select, hide Allow all text, and move formatting
  into an overflow menu instead of overlapping. `/mcp`, `/skill(s)`,
  `/agent`, `/model`, and `/autopilot` now execute local UI actions
  instead of forwarding token-wasting chat messages.
- **Expanded editor formatting.** Composer formatting now uses Lexical
  commands for bold, italic, underline, strikethrough, inline code,
  headings, quote, code block, bullet list, and numbered list.
- **Slash menu polish.** Slash command selection stays scrolled into
  view, `/model` has a visible icon, and `/model` opens the session model
  selector directly.
- **Responsive UI audit pass.** Removed CSS floors that fought Dockview,
  made edge-panel contents shrink via container/intrinsic sizing, and
  added compact states for FilePicker, Jobs, Log Viewer, tool rows,
  message actions, pending-request actions, and Library instruction
  headers.
- **Terminal Windows native PTY.** Electrobun now bundles Bun 1.3.14 so
  Windows ConPTY works in the packaged runtime; the stdin/stdout pipe
  workaround was removed.
- **Composer terminal capture removed.** The unreliable embedded
  "send and capture output" PTY flow was removed; `!` no longer opens a
  capture terminal and terminal usage is via normal terminal panes.
- **Terminal addon foundation.** Terminal panels now load xterm addons for
  search, web links, clipboard, Unicode width/grapheme handling, web fonts,
  progress, ligatures, images, WebGL, and serialization.
- **Terminal manager panel.** Added an ActivityBar Terminals panel with
  running terminal list, open/kill actions, a basic new-terminal form for
  command/args/cwd. Terminal display/addon settings now live in Settings with
  color pickers and visible foreground/background swatches.
- **Terminal shell integration foundation.** New terminals get a per-terminal
  nonce and shell-integration env. PowerShell/pwsh now emit VS Code-style
  OSC 633 command/CWD/exit markers; cmd emits best-effort prompt/CWD markers.
  Terminal panels parse OSC 633/133/7/9/1337 into active command, command
  history, current CWD, and trusted command metadata for later smart-terminal
  actions. Command history is bounded per terminal, and the nonce is scrubbed
  from the child process environment after the shell hook captures it.
- **Manual smart terminal history.** The Terminals panel can reveal recent
  shell-integrated commands per terminal and copy a command line manually;
  output copy/send-to-chat remains deferred until command buffer ranges are
  anchored.
- **Terminal header accessibility/search.** Terminal toolbar actions now use
  visible text labels with clearer icons/titles. Buffer/Paste header buttons
  were removed, selected-text copy works from `Ctrl+Shift+C` and `Alt+Insert`,
  and Find now enables the xterm proposed API needed by search decorations,
  focuses the search box, performs incremental lookup, exposes match/no-match
  status, and clears highlights when closed.
- **`!!` command result attachments.** Typing `!!` in an empty composer enters
  a distinct command mode backed by the real session terminal, so shell
  autocomplete and shortcuts still work. The composer now has separate
  Command and Terminal buttons, the Terminal button focuses the existing
  session terminal tab, full terminal panels have a Session button to jump back,
  embedded command mode hides terminal chrome and freezes the duplicate full
  terminal panel, completed command-result records auto-insert a first-class
  `commandResult` pill, and command-result rendering/copying strips ANSI escape
  codes.
- **Bun entry reachability gate.** `bun run check` now runs
  `bun run lint:bun`, a Bun.build dry-run over `src-bun/index.ts`, so
  dead Bun-side imports fail before a developer hits `electrobun dev`.

### Fixed (2026-05-22 — UI problem sweep)

- **Composer/session controls polish:** model controls now stay
  right-aligned, model picker labels keep full model names, run modes
  are color-coded, and the composer bar includes a color-coded
  auto-approve toggle.
- **Default model settings:** Settings → Appearance can choose the
  default model and reasoning effort for new sessions; new sessions
  start with those defaults visible instead of waiting for the first
  model-change event.
- **Library and details cleanup:** Library now has a Tools tab with
  global enable/disable toggles, discovered MCP rows use the same switch
  UI as configured servers, the new-agent form is an in-flow card, and
  markdown descriptions render as markdown.
- **Side rails and artifacts:** left activity panels are exclusive, the
  dev playground button closes an open playground tab, the right details
  rail preserves width across session switches, duplicated session
  settings are collapsed by default, and touched files moved from the
  useless footer chip into a collapsible details section.

### Added (Phase 23b — Copilot CLI mode parity)

- **Native plan/autopilot lifecycle wiring.** Dafman now uses the
  bundled Copilot JSON-RPC SDK entrypoint that exposes
  `onExitPlanMode` and `onAutoModeSwitch`, while preserving the
  prebuilt native `cliPath` workaround for Node-version compatibility.
- **Plan approval pending cards.** `exit_plan_mode` requests now show
  an in-chat approval card with plan summary/content, feedback, and
  actions for Interactive, Autopilot, Exit only, and Autopilot fleet.
- **Autopilot unavailable-user behavior.** Autopilot honors existing
  approve-all/session approvals, then resolves permission/input/form
  requests as unavailable/declined instead of hanging on a user reply.
- **CLI-style `/plan <prompt>` local command** switches to Plan mode
  and sends the one-shot `[[PLAN]]` bootstrap prompt while keeping the
  existing three-way mode toggle.
- **Plan file refresh.** `session.plan_changed` now refreshes the
  Session Details plan preview/editor.

### Added (Phase 23a — Library Instructions + command wiring)

- **Library → Instructions tab** with read-only inventory of global
  and project instruction sources. Global candidates include common
  Copilot user-instruction locations; project candidates include
  root `AGENTS.md`, `.github/copilot-instructions.md`, and nested
  `AGENTS.md` files (skipping heavy/generated folders such as
  `node_modules`, `.git`, `dist`, `build`). Existing files can be
  expanded inline and revealed in the OS file manager; missing
  candidates stay visible as guidance.
- **`/library [mcp|skills|agents|instructions]` local slash command**
  opens the Library sidebar and switches tabs. Later UI follow-up also
  maps `/mcp`, `/skill(s)`, and `/agent` to local Library tabs.
- **SDK `CommandDefinition` infrastructure** now registers a
  non-colliding `library` command in each session config. This gives
  the SDK/TUI a safe hook without shadowing built-in CLI commands.

### Added (Phase 22b — Tools section grouped view + allowlist)

- **Grouped tools view** in the session details rail. Tools are
  split by source: built-in (no `namespacedName`) first, then
  alphabetically-sorted namespace groups (MCP servers, skills,
  etc.) derived from `namespacedName.split("/")[0]`. Avoids the
  flat ~30-tool list that obscured which tool came from where.
- **Per-tool tri-state control** (SelectButton: Default / Only
  allow / Forbid) replaces the previous on/off toggle. Backed by
  two settings lists — `tools.defaultExcluded` (denylist) and the
  new `tools.defaultAllowed` (allowlist) — that are mutually
  exclusive per tool. The SDK's `availableTools` allowlist takes
  precedence over `excludedTools`, so when the allowlist is
  non-empty the rail surfaces a banner ("Allowlist active —
  sessions are restricted to the tools marked 'Only allow'") and
  the registry omits `excludedTools` from the session config.
- **Critical-tool warning badge** on built-ins whose removal makes
  the agent effectively unusable (`bash`, `shell`,
  `str_replace_editor`, `write_file`, `create_file`, `edit_file`).
  Warning, not block — users may intentionally want a restricted
  / no-shell mode.
- **Canonical tool key**: settings now store and the SDK is
  configured with `tool.namespacedName ?? tool.name`. The previous
  code used `name` only, which would have been ambiguous for MCP
  tools with the same `name` from different servers.
- **Settings schema bumped v10 → v11** with
  `tools.defaultAllowed: string[]`. v10 documents migrate cleanly
  with an empty allowlist (= no restriction). Empty allowlist
  intentionally **omits** `availableTools` from the SDK config —
  passing `availableTools: []` would tell the SDK to allow no
  tools at all.
- 6 new tests: 2 settings (v10→v11 migration + allowlist
  coercion) + 3 session-config (empty allowlist omits
  `availableTools`; non-empty allowlist wins over `excludedTools`;
  both-empty omits both) + 1 manual-test checklist.

### Added (Phase 22c — Remembered Permissions Settings tab)

- **New "Permissions" section in Settings panel.** Single toggle:
  "Default to approve all for new sessions". Off by default —
  explicit user opt-in. When ON, brand-new sessions automatically
  approve every privileged tool call (file write, shell, network,
  etc.) without prompting. The per-session rail toggle continues to
  drive runtime state; this setting only affects what NEW sessions
  start with. The SDK doesn't expose a list-approvals RPC, so we
  can't show what's been remembered — this is the only knob we can
  surface globally.
- **Settings schema bumped v9 → v10**: new `permissions.defaultApproveAll`
  field. v9 documents migrate cleanly with the default value (false)
  so existing users never silently flip approve-all on.

### Added (Phase 22a — MCP OAuth toast)

- **MCP OAuth lifecycle toasts.** `mcp.oauth_required` from the SDK
  now surfaces an info toast naming the server that needs sign-in
  ("MCP server needs sign-in — `<serverName>`: open the Library panel
  and click the auth link to complete OAuth"). When the user
  completes the flow, `mcp.oauth_completed` emits a success toast
  ("MCP signed in — Connection established"). Previously both
  events were in `IGNORED_EVENTS` and silently dropped, leaving the
  user with no feedback that the MCP server was waiting on them.
- **Toast de-duplication keyed by SDK requestId** so resumed
  sessions don't replay stale `_required` notifications, and stray
  `_completed` events (from another client driving the OAuth flow)
  are ignored.

### Added (Phase 19c — Fleet + nested sub-agent rendering)

- **`/fleet [prompt]` slash command** in the composer + command
  palette. Spawns parallel sub-agents via the @experimental
  `session.rpc.fleet.start` surface. Fire-and-forget; sub-agent
  activity streams via session events tagged with the sub-agent's
  envelope `agentId`.
- **Sub-agent inline blocks in chat**: new `SubagentChatItem`
  variant in the ChatItem union with its own nested `items[]`.
  `SubagentBlock.vue` renders a collapsible card (header with
  status pill, display name, elapsed time, error if any; body
  shows the sub-agent's assistant messages, reasoning, tool
  calls). Default expanded while running; default collapsed
  when completed/failed; user toggle wins after first click.
- **`processEvents` reducer refactored** for scoped dispatch:
  - Per-buffer indices: each `ReducerContext` builds its own
    `assistantIdx`/`reasoningIdx`/`toolIdx` Maps over its own
    items[] (was: one set of indices over the top-level items[]
    only). Prevents collisions between root and sub-agent tool
    calls with the same `toolCallId`.
  - `subagent.started/.completed/.failed` handled inline (not via
    the family handler dispatch table); they create / update the
    nested SubagentChatItem and register / deregister in a
    routing map.
  - Routing rules: visual events (assistant/reasoning/tool/system
    notification) with envelope `agentId` matching a known
    sub-agent get dispatched into the nested context. ALL other
    events (session lifecycle, ambient updates, pending requests)
    stay at top level — so a sub-agent can't mutate session-level
    state (per the 19c duck's blocking finding #4).
- **`startFleet` bun RPC** wrapping `session.rpc.fleet.start`.

### Added (Phase 19b.2 — Library Agents tab)

- **Library → Agents tab**: third tab in the Library panel.
  Lists filesystem-backed custom agents grouped by scope (Project /
  User), with a "+ New agent" button that opens an inline form.
  Form fields: scope (radio), name, displayName, description (required),
  tools (csv), skills (csv), model, user-invocable (toggle), prompt
  (textarea). Submit writes `<scope-root>/<name>.agent.md` with YAML
  frontmatter and the prompt body.
- **`src-bun/app/agentFiles.ts` module** with strict name validation
  (alphanumerics + dot/hyphen/underscore, max 64 chars, rejects
  path traversal + Windows reserved names like CON/PRN/AUX/COMx/LPTx),
  scope path resolution (defense-in-depth root check), minimal YAML
  serializer for the supported frontmatter, atomic write (tmp +
  rename), and refuse-overwrite semantics.
- 4 new bun RPCs: `listAgentFiles` (session-scoped, includes Project
  - User), `listAgentFilesGlobal` (User only — for the "no session"
    case), `writeAgentFile`, `deleteAgentFile`. Write/delete call
    `session.rpc.agent.reload` after success so the new agent shows
    up in the picker immediately.
- **Create + delete only** in v1 — no Edit. The SDK accepts
  frontmatter keys we don't model (`mcp-servers`, `github` toolsets,
  etc.); a write-only serializer would lose those on save. Per the
  19b duck's blocking finding #2, edit is deferred until we have a
  parse-and-preserve round-trip implementation.
- Refers users to "Reveal" the file for advanced edits.

### Added (Phase 19b.1 — Tasks panel)

- **Background tasks** section in the right rail's
  `SessionDetailsPanel.vue`. Lists agent-delegated tasks for the
  session (the agent spawns these via its built-in `task` tool — the
  rail is observational). Each row shows status pill (running / idle
  / completed / failed / cancelled with theme-aware colors), agent
  name, elapsed time, description, error if any, and a
  Cancel/Remove button.
- 3 new bun RPCs wrapping `session.rpc.tasks.*`: `listTasks`,
  `cancelTask`, `removeTask`. Filtered to `type === "agent"`; shell
  tasks (internal bookkeeping) are dropped before the wire.
- Auto-refresh on `subagent.started` / `.completed` / `.failed` and
  on the SDK's `session.background_tasks_changed` event, driven via
  a per-record `tasksRefreshCounter` (counter, not boolean — a
  boolean flag would miss two events in a row).
- Sequence-guarded loader: stale slow responses can't overwrite a
  fresh fast one.
- The `startAgent` task RPC is intentionally NOT exposed in v1 — the
  user-facing trigger for task delegation is the chat composer; the
  agent decides, the rail observes.

### Added (Phase 19a — Custom agent picker)

- **Custom agent picker** in the right rail's new `Agents` section
  (`SessionDetailsPanel.vue`). Lists every custom agent the SDK
  discovered for the session (workspace `.github/agents/` +
  `<userConfigDir>/agents/`, surfaced via the @experimental
  `session.rpc.agent.list` RPC). Each row shows the agent's display
  name, optional description (expand on chevron click), a
  "Project" / "User" source badge derived from the agent's
  absolute path, and a `Select` / `Deselect` button. A
  `Reload from disk →` button at the section footer calls
  `session.rpc.agent.reload` so newly-added agent files surface
  without restarting the session.
- **Header agent chip** in `SessionHeaderControls.vue` next to the
  workspace pill. Renders the currently-selected custom agent's
  display name; hidden when the default agent is in use to keep
  the header clutter-free for users not using this feature.
  Clicking opens the right rail so the user can switch / deselect.
- 5 new bun RPCs wrapping `session.rpc.agent.*`: `listAgents`,
  `getCurrentAgent`, `selectAgent`, `deselectAgent`, `reloadAgents`.
  All session-scoped, methods live on `SessionRegistry` (matching
  the 21a refactor's convention for session-scoped methods).
- `subagent.selected` and `subagent.deselected` SDK events now
  drive `ChatAmbient.currentAgent` + `SessionRecord.currentAgent`
  reactively. Transient sub-agent delegation events (those
  carrying `parentToolCallId`) are filtered out — session-level
  selection and per-turn delegation are separate concepts
  (delegation rendering arrives in 19c).
- `getCurrentAgent` is fire-and-forget-fetched on session create
  and resume to seed the chip + rail without waiting for the
  first `subagent.selected` event.

### Changed (Phase 21d — dependency bumps)

- **Lexical 0.38.1 → 0.44.0** (6-minor jump across the 5 direct
  `@lexical/*` packages + core). `lexical-vue@0.14.1` hard-pins
  every transitive `@lexical/*` to 0.38.1, so the bump required a
  `package.json` `overrides` block to force the entire dep tree to
  0.44.0. lexical-vue's compiled JS calls the lexical core API
  which is backwards-compatible across 0.38 → 0.44 (verified at
  runtime via dev + smoke).
- **Katex 0.16.47 → 0.17.0**. The only breaking change in 0.17 is
  the internal `__defineFunction` API (private, underscore-prefix);
  we use only the public `katex.render()` surface via
  markdown-it-texmath.

### Fixed (Phase 21d — adjacent bugs surfaced during the bump)

- **20b dead-code regression: `ensureDefaultWorkspace` restored.**
  knip flagged it as unused; the consumer in `src-bun/index.ts`
  was missed because knip's reachability graph doesn't trace
  through electrobun's bun-side build entry. Caused
  `electrobun dev --watch` to fail to start on a fresh checkout.
- **Typeahead z-index regression: file/slash menus appearing
  behind dockview's left sidebar.** Pre-existing CSS stacking-
  context bug exposed by the Lexical bump's slightly shifted
  geometry. `.mention-menu-anchor` and `.slash-menu` use
  `transform: translateY(...)` which creates a new stacking
  context — the `z-index: 1200` we'd set on `.file-picker`
  (inside) was confined to the local context. Set `z-index: 1200`
  on the stacking-context root (anchor) instead; same fix for
  `.slash-menu` (was at z-index 100, below dockview's 999).

### Changed (Phase 21c — type / UX / perf nits)

- **U1: per-session vs global RPC split in SessionDetailsPanel.**
  `builtinTools` (static SDK built-in tool list) and `quota`
  (account-wide) now load ONCE on mount instead of re-firing on
  every chat-tab switch. Per-session loaders (`skills`, `usage`,
  `mcp`, `plan`) still re-fetch on switch.
- **U2: don't reset `warnedThresholds` on session switch.** Quota
  warning toasts (75% / 90%) used to re-fire every time the user
  clicked a different chat tab because the rail's debounce Set
  was being cleared. Now persists for the full rail lifetime.
- **U3: warn on `openSessionsByDefault` retry exhaustion.** Was
  silently giving up after 20 retries × 50ms; now logs to
  `console.warn` so the issue surfaces in the in-app log viewer.
- **U6: re-check `cwdFor` after each await before write.** A
  concurrent `cwdFor` call could backfill the entry while we
  were waiting on `getSessionMetadata` / `listSessions`; the
  second writer now skips the write to avoid a stale overwrite.
- **U7: `removePending` single-pass.** Was scanning both
  `pendingRequests` AND `items` independently by `kind` when no
  `requestId` was supplied — could remove different entries from
  each list if there was more than one pending of the same kind.
  Now resolves the target requestId from the ambient queue first
  and removes by requestId from both lists.
- **U8: `messageHandlers.ts` backwards loop.** Was
  `[...ctx.items].reverse().find(...)` — copies the entire items
  array on every `user.message`, including the full history
  replay on resume. Now a manual backwards `for` loop with
  early break.
- **T3: de-export 6 internal-only types.** `PermissionAuditDecision`
  (audit.ts), `FileSearchKind` (fileSearch.ts), `PatchOp` +
  `PatchHunk` (diff.ts), `ToolRenderResult` + `ToolRendererArgs`
  (toolRenderers.ts). All only used within their defining file.
- **T1 / T2: cast safety review.** Existing `as Record<string, unknown>`
  casts in `summarizePermission` and `forward()` are already guarded
  by `typeof` field checks; no change. The renderer-side
  `payload as unknown as Record<string, unknown>` in
  `applyPendingToRecord` is structurally equivalent at runtime and
  doesn't warrant a SessionEventPayload type widen.

### Fixed (Phase 21b — SessionRegistry correctness)

- **S1: bounded shutdown.** `shutdownAll()` now races each
  `session.disconnect()` against a 2s timeout per session
  (`SHUTDOWN_TIMEOUT_MS`). A hung SDK can't deadlock app exit. Also
  drains the pending queue with `settleAll` up front and handles
  `SIGTERM` (window close) in addition to `SIGINT`.
- **S2: `create()` race fix.** Events fired by the SDK BEFORE
  `createSession` resolves used to forward under the literal
  `"pending"` placeholder, orphaning them on the renderer side
  (renderer keys its pending-events buffer by real sessionId). Now
  buffered locally and drained under the resolved id after the
  session object is in hand.
- **S3: entries.delete moved after `await session.disconnect()`** in
  all three teardown paths (`disconnect`, `deleteCliSession`,
  `setWorkingDirectory`). Concurrent RPCs see the entry as live
  during the disconnect window and fail predictably with
  `SessionNotFound` AFTER, instead of mid-teardown.
- **S5: history-replay cap on resume.** `getMessages()` returns the
  full transcript; long-lived sessions can produce thousands of
  events. Now caps at the last `HISTORY_REPLAY_CAP` (500) events
  and replays in `HISTORY_REPLAY_BATCH` (50)-sized chunks with
  `queueMicrotask` yields between them, so the renderer can paint
  between batches instead of receiving one giant IPC flood.

### Changed (Phase 21a — architectural extractions out of sessions.ts)

- **`PendingRequestQueue` extracted** to `src-bun/app/pendingRequests.ts`.
  The SDK callback queue (permission / userInput / elicitation
  multiplexer + typed cancellations + audit hand-off) lives behind a
  focused class. `SessionRegistry.respondToRequest` is now a one-line
  delegate. New `removeEntry` helper on the registry centralizes the
  teardown contract (`pending.settleForSession` runs before
  `entries.delete`).
- **`McpRegistry` extracted** to `src-bun/app/mcpRegistry.ts`. The 7
  server-scoped MCP methods (`listConfigs`, `addConfig`,
  `updateConfig`, `removeConfig`, `enable`, `disable`, `discover`)
  moved out. Session-scoped MCP methods (which need entries-Map
  lookup) stay on `SessionRegistry`.
- **`SkillsRegistry` extracted** to `src-bun/app/skillsRegistry.ts`.
  `discover` + `setGloballyDisabled` mirror the MCP registry shape.
- Each registry takes a constructor-injected `getClient` so tests
  can pass a fake client without going through the global
  `_setClientForTest` seam. A private `withClient` helper lets
  `AppError.clientNotStarted` escape unwrapped while wrapping
  everything else as `AppError.sdk`.
- `src-bun/app/sessions.ts` shrank from 1451 → ~1100 LoC; clearer
  module boundaries for the 21b correctness work (shutdown(),
  create() race, history-replay cap, etc.).

### Fixed (Phase 20c — code review surgical fixes)

- **`respondToPending` no longer appends a phantom response event
  on RPC failure.** 20a fix restored the pending entry in catch but
  left the appended `dafman.pending_response` event in place — the
  chat reducer would close the card in the transcript view despite
  the SDK still holding the request open. Now appends the event
  AFTER the RPC succeeds.
- **`setSessionWorkingDirectory` no longer mutates a stale record
  reference.** Captured `record` before await; if the user closed
  the session mid-RPC, the update silently mutated a detached
  reactive object. Now captures `baseWorkingDirectory` read-only
  before the await and re-looks-up the record after.
- **`chatEvents.upsertAssistant/Reasoning/Tool` O(N²) → O(1).** Was
  `items.find(...)` per event — streaming 30 deltas/sec into a
  200-item session = 6000 ops/sec just locating the in-progress
  message. Now uses ephemeral per-call `Map<id, index>` indices.

### Changed (Phase 20c)

- **9 npm dependencies bumped** to safe minors: Vue 3.5.34,
  `@vue/compiler-sfc` 3.5.34, `@vitejs/plugin-vue` 5.2.4, vite
  6.4.2, vue-tsc 2.2.12, TypeScript 5.9.3, dockview-vue 6.4.0,
  concurrently 9.2.1, `@happy-dom/global-registrator` 20.9. Lexical
  (6-version jump) and Katex (major) deferred to dedicated PRs.
- **`ARCHITECTURE.md` refresh**: removed `permissionsStore` row
  (deleted in 20b), added Library + SessionDetailsPanel + new
  components, documented the Electrobun-error-wrapping wire contract
  in the rpcGuard hard rule.
- **`plans/plan-tech-debt.prompt.md`** created with all deferred
  findings from the 20c code review (3 architectural extractions,
  5 correctness items, 3 type-safety nits, 8 UX/perf nits, 3 test
  gaps, 2 dep deferrals).

### Removed (Phase 20b — dead code + dep sweep)

- **`src/stores/permissionsStore.ts`** — orphan placeholder file
  never wired up; the real permission flow uses the
  `dafman.pending_request` channel through `sessionsStore`.
- **Dead exports**: `getAuditDir` (audit.ts), `exportDisplayName +
readBundleFile` (diagnostics.ts), `ensureDefaultWorkspace`
  (settings.ts), `MarkdownSync + CodeHighlightPlugin`
  (plugins.ts), `hashString + accentForSession` (color.ts),
  `sep` re-export (directoryBrowser.ts), `IGNORED_EVENTS`
  re-export (chatEvents.ts).
- **De-exported (internal-only)**: `SESSION_DETAILS_PANEL_ID`
  (layoutStore.ts), `APP_ERROR_PREFIX` (errors.ts),
  `WORKSPACES_MRU_LIMIT` (settings.ts bun side).
- **Duplicated `basename` helper** in sessionsListStore — now
  imports from layoutStore (single source).
- **Unused npm dependencies**: `@codemirror/commands`,
  `@codemirror/language`, `@lexical/utils`, `codemirror`
  (umbrella; we use specific `@codemirror/*` packages),
  `@types/dompurify`, `@types/katex`.
- **Noisy `[boot]` console.info traces** — trimmed to a 4-line
  startup timeline (start / N sessions / settled / fromJSON ok +
  onDockReady) instead of per-step.

### Fixed (Phase 20a — RPC error sweep)

- **`respondToPending` now rolls back on RPC failure.** Previously
  the pending-request card was spliced from the UI + a
  `dafman.pending_response` event was appended BEFORE the
  `respondToRequest` RPC. If the RPC threw (session disconnected
  mid-flight, etc.), the UI dropped the card while the SDK still
  had the request open — leaving the user stuck with no way to
  respond. Now snapshots the entry + index before the splice and
  re-inserts in catch, plus fires an error toast.
- **`logStore.setLevel` now returns the new level + propagates RPC
  errors.** Previously called as `void logStore.setLevel(v)` from
  LogViewer — if bun rejected, the error was silently dropped.
  Caller now catches + toasts.
- **`pickAttachment` in FilePicker now catches** — bridge errors
  were leaking unhandled. Error toast on failure.
- **`openUrl` in PendingRequestCard now catches** — same pattern.
- **`revealPath` in SessionDetailsPanel / SessionHeaderControls /
  LibrarySkillsTab now catches** — same pattern. These were
  `void invokeCommand(...)` paths that depended on errors being
  silently swallowed (the pre-fix behaviour).

### Added (Phase 20a)

- **Test coverage**: `invoke.test.ts` now asserts a round-trip for
  every `AppErrorPayload` discriminated-union variant
  (ClientNotStarted / SessionNotFound / Settings / Sdk / Io) so a
  future protocol drift fails loudly.
- **`sessionsStore.respondToPending.test.ts`**: 2 new tests
  asserting both happy-path splice AND rollback-on-RPC-failure
  with the pending entry restored at its original index + an
  error toast queued.

### Added (Phase 19b)

- **"Manage globally →" link** in the right-rail Skills section
  that opens the Library panel and switches it to the Skills tab.
  Uses a `dafman:library-activate-tab` custom event so an already-
  mounted Library re-focuses without remount.
- **F19 E2E** covers Skills tab grouped render, toggle persistence
  via `setGloballyDisabledSkills`, and the Manage-globally link.

### Added (Phase 19a)

- **Library panel** — new top-level left-edge sidebar (activity bar:
  pi-book icon). Hosts global / cross-session config that doesn't
  belong on the per-session rail. First tab: **MCP servers**.
- **MCP server registry UI** with Configured + Discovered sections.
  Configured rows: enable/disable toggle (writes the SDK's global
  allowlist via `mcp.config.enable/disable`), Edit and Remove
  buttons, inline "Sign in" action for http servers with OAuth
  (calls `mcp.oauth.login` and opens the returned authorization
  URL via the renderer's `openUrl`).
- **Add MCP server dialog** with a structured form (transport
  switch: local stdio / http, command/args/env or url/headers/
  oauth fields) plus a **View as JSON** mode that round-trips
  the same payload through a textarea editor.
- **8 new bun RPCs** wrapping `client.rpc.mcp.config.*` (list,
  add, update, remove, enable, disable), `client.rpc.mcp.discover`,
  and session-scoped `session.rpc.mcp.oauth.login`. fakeClient
  stubs back all of them with an in-memory map for E2E.
- **E2E F18** covers: open library from activity bar, see
  Discovered list, add via structured form, JSON-mode round-trip.

### Fixed (right-rail polish, follow-up to Phase 18b)

- **Right-rail is now a singleton** instead of one panel per session.
  Previously each session got its own rail (`session-details-${id}`),
  so users with N open sessions saw N rail tabs stacked in the right
  edge group — and switching chat tabs did NOT switch which rail
  was visible. The new rail uses a fixed id and binds reactively
  to `layoutStore.activeSessionId`.
- **`activeSessionId` no longer blanks when a non-chat panel becomes
  active** (the rail itself, Settings, dev playground). Previously
  the moment the rail's tab took focus, the rail's content vanished
  because it depended on its own group's active panel being a chat.
  `recomputeActiveSession` now preserves the last bound chat unless
  no chat exists in any body group.
- **Sections are collapsible with persistence**. Tools is collapsed
  by default (the description list is long); skills / MCP / plan /
  usage / quota expanded. State persists in `localStorage` under
  `dafman.details.section.<key>`.
- **Long tool / skill descriptions truncate to one line** with a
  "Show more" link. Multi-line / >120-char descriptions get the
  expander; short ones render full-width.
- **Toggle switches no longer overflow** the panel on narrow widths.
  Added `flex-shrink: 0` on the `ToggleSwitch` inside each row +
  `min-width: 0` on the row itself so the text column truncates
  instead of pushing the switch off-screen.
- **Legacy per-session rail panels are stripped on layout restore**,
  preventing orphan tabs in the right edge group after upgrading
  from the previous 18b build.

### Added

- **Tool toggle UI in the right-rail details panel (Phase 18b).** Lists
  built-in tools from `rpc.tools.list` and MCP servers from
  `rpc.mcp.list`; per-tool ToggleSwitches edit the new global
  `settings.tools.defaultExcluded`. The SDK has no runtime mutation API
  for tool gating, so every toggle surfaces a "Restart session to
  apply" info toast — changes take effect on the next session create.
- **Plan section in the right-rail details panel (Phase 18b).** Reads
  and writes `rpc.plan.*` for the session. Empty state shows "Create
  plan"; existing plans render as a scrollable markdown preview with
  an inline "Edit" textarea + Save/Cancel actions.
- **Account quota dashboard in the right-rail details panel (Phase
  18b).** Polls `rpc.account.getQuota` on mount and renders per-type
  usage bars (chat, premium_interactions, …). Fires a single
  `info` toast at 75% used and a `warn` toast at 90% used per type
  (CLI 1.0.32 parity). Dedupes per (type, threshold) so a refresh
  doesn't re-fire.
- **`settings.tools.defaultExcluded` (settings v9).** New string-array
  field consumed at session create via `client.createSession({
excludedTools })`. Existing settings migrate transparently with an
  empty list.

### Changed

- **Per-session settings moved from gear popover to right-rail panel.**
  `SessionDetailsPanel.vue` is a dockview right-edge panel hosting the
  full session-config surface (rename, run mode, reasoning view,
  workspace chip, auto-approve, skills, usage metrics, export
  Markdown/JSON, compact history, reset approvals) plus a new **Fork
  session** button at the top. Auto-opens with each new session;
  state persists via dockview's existing layout JSON (no settings
  bump). Cog button in the tab strip toggles. The popover is gone.

### Fixed

- **Permission rule editor: "Allow for session" now actually allows
  follow-up commands.** The bundled CLI's matcher (`aYr` in
  `@github/copilot/app.js`) treats bare identifiers like `"git"` as
  strict equality and only `:*`-suffixed ones like `"git:*"` as
  prefix-broadening. The editor was fabricating its own first-token
  identifier, so `git status` re-prompted even after the user
  approved `git`. Fix: use the SDK-offered `commandIdentifiers`
  (which include `git:*`); custom-prefix input auto-appends `:*`.
- **File / folder pill now carries the absolute path.** Electrobun's
  `openFileDialog` can return paths relative to the bun process cwd
  (the exe's `bin/` in prod), producing pills like
  `../Resources/version.json`. `pickAttachment` + `pickFolder` now
  `path.resolve()` the result.
- **Reveal-in-explorer respects file vs folder on Windows.** The
  previous fix used `explorer /select,<path>` uniformly, but
  `/select,<dir>` opens the dir's _parent_ — that was the
  diagnostics + export bundle reveal bug. Now: `stat` the path; file
  → `/select,<file>`; folder → `explorer <folder>`.
- **CI Tier-2 (`electrobun build` matrix) actually runs on every
  PR.** Removed `needs: check` so a transient tier-1 flake no
  longer skips the tier-2 jobs — they were silently invisible.

### CRITICAL: Session working directory now persists across app restart.

- Resumed sessions previously defaulted to
  `process.cwd()` (the Electrobun exe folder) when the SDK catalog
  didn't surface a `cwd`. Root cause: `cwdFor` fell back to
  `process.cwd()` silently. Fix: cache `workingDirectory` on the
  registry `Entry` at create+resume; fetch persisted cwd from
  `getSessionMetadata` before resume; pass it explicitly to
  `client.resumeSession`; drop the dangerous fallback. The export
  feature, the @-picker, the workspace chip, and anything else
  reading the session cwd were all silently wrong before this fix.
- **Audit JSONL re-hydrates into the in-memory ring on bun startup.**
  Previously, the on-disk `<userData>/audit/*.jsonl` files persisted
  correctly but the Activity tab was empty after restart until new
  events flowed. `initAudit` now reads the tail of each file into
  the `recent` ring on startup.
- **Reveal-in-explorer on Windows now selects the file** instead of
  opening its parent. Spawns `explorer.exe /select,<path>` directly
  (the canonical Windows "reveal file in folder" idiom) rather than
  going through `Utils.showItemInFolder`, which has been opening the
  parent folder without selecting the target.
- **Permission rule editor shows the actual shell command.** SDK
  field is `fullCommandText` (not `command`); the editor was always
  showing empty. Both the bun-side `summarizePermission` and the
  renderer-side rule editor now read all known aliases.
- **Reasoning-hidden suppresses the action bar too.** When
  Settings → Reasoning view = "Hidden", the (invisible) reasoning
  bubble's MessageActions strip stayed visible. Now gated on
  `reasoningVisibility !== "hidden"`.
- **Read/Write permission rules honestly disclose the SDK limit.**
  Per-path glob rules aren't a Copilot SDK feature — read/write
  approvals are session-wide. The editor now says so instead of
  pretending finer granularity is possible.

### Changed

- **`pickAttachment` RPC takes `kind: "file" | "directory"`.** Windows
  native dialogs cannot offer mixed file+folder picking (the
  `IFileDialog` API is either an Open-File dialog or a folder
  dialog, never both). The composer's FilePicker now exposes two
  buttons — "File…" and "Folder…" — instead of one ambiguous
  "Browse…". Mac/Linux behave the same way for consistency.

### Added

- **Real E2E test tier.** `bun run e2e` (and `bun run e2e:run` for
  the build-skipping variant). Architecture: Playwright + chromium +
  bun subprocess (`src-bun/test-server.ts`) + mocked Copilot SDK
  (`src-bun/app/fakeClient.ts`) + real temp-fs workspace per test.
  Renderer picks the WebSocket bridge (`src/ipc/wsBridge.ts`) when
  loaded with `?testBridge=ws://host:port`. Six baseline flows
  (`e2e/full/flows/`): create+send smoke, @-picker happy path,
  `@.` trigger (doesn't exit), `@./src/` path-nav, Alt+H/Alt+I
  toggle persistence across reload, shell permission with audit
  log assertion. 12 s wall, all green. CI integrated on
  ubuntu-latest. See `plans/plan-e2e.prompt.md`.

- **`@file` / `@folder` picker rebuild.** The composer's `@`-trigger
  and the paperclip button now both open the same `FilePicker.vue`
  popup. Two modes:
  - **Fuzzy** (no separators) — walks the session cwd recursively
    (cached per `(cwd, includeHidden)`), ranks by filename startsWith
    > substring > path-substring, returns files + directories with
    > `kind` flags.
  - **Path navigation** — queries starting with `/`, `~/`, `./`, `../`,
    a Windows drive letter, or containing a `/` switch to a directory-
    listing-with-leaf-prefix mode against the resolved base (fs root /
    home / cwd). Matches CLI 1.0.5's `@/abs`, `@~/foo`, `@../path`
    ergonomics.
  - **Show hidden / ignored** toggle reveals dotfiles + IGNORED_DIRS
    (`node_modules`, `dist`, `target`, …).
  - **Browse…** escape hatch opens the native OS file/folder picker
    via the new `pickAttachment` RPC.
  - Single-pick per popup; directories attach as `directory` pills
    (existing AttachmentNode kind + `pi-folder` icon).
  - Removed the hidden `<input type="file">` paperclip path — it only
    yielded blob attachments due to WebView2 sandboxing; the native
    dialog returns absolute paths so we ship `type: "file"` /
    `"directory"` attachments end-to-end. Drag-drop + paste still use
    the blob path for pasted images / dragged temp files.

- **Permission + URL audit log.** Append-only JSONL under
  `<userData>/audit/permissions.jsonl` and `urls.jsonl`. Every
  `respondToRequest` permission decision records `permissionKind`,
  decision, summary, and (for `approveForSession`) the approval scope
  or URL domain. Every `openUrl` records the URL + allowed flag +
  reason ("ok" / "scheme-blocked" / "openExternal-threw: …"). Live
  tail via a new `auditEvent` webview message; visible in a new
  Activity tab on the Diagnostics edge panel (sits alongside the
  Logs tab, same SelectButton primitive). Per-decision row tinting
  in the UI (reject = red, approveForSession = primary accent). Ring
  buffer caps at 500 in-memory; on-disk files are never auto-deleted
  (separate posture from the diagnostic JSON log). 4 bun-side audit
  tests + 1 integration test driving the full SDK → handler →
  `respondToRequest` → audit pipeline + 1 wire-shape snapshot.

- **Export conversation (Markdown + JSON).** Per-session gear popover
  gains "Export Markdown" / "Export JSON" buttons. The renderer builds
  the document via the new `formatConversation` helper (Markdown
  ordering: title + model + workspace + export timestamp + message
  count → per item: user with attachments, assistant, reasoning folded
  in `<details>`, tool with args/output/result/error, system bubbles
  with severity icons; pending-request items deliberately skipped).
  Bun-side `saveExportFile` RPC writes under `<userData>/exports/`
  with `basename(normalize(...))` defence against path traversal, then
  the file's folder auto-reveals in the OS file explorer. 15 markdown
  - 3 JSON + 3 filename + 3 bun-side tests pin the behaviour. Reuses
    the same `processEvents` reducer the chat tile runs so the export
    is in lockstep with what's on screen.

- **Phase 1 — Observability tail.** In-app log viewer (`LogViewer.vue`,
  reachable from the Activity Bar's bottom rail) tails the bun JSON
  log live. Header has three controls: Active level (mutates the
  bun-side configured level via the new `setLogLevel` RPC — controls
  what reaches the daily file + stderr), Display level (renderer-only
  display filter — flip it without losing buffered records),
  full-text search across the serialised record. Records use CSS
  grid (timestamp / level / message + fields below) with per-level
  color hints and warn/error row tinting. Pause-on-scroll
  auto-detects so a user reading history isn't yanked back to the
  tail; a "paused" indicator surfaces in the count row. Buffered
  ring is 4000 records renderer-side, 1000 records bun-side (the
  initial fill comes from a `getLogState` RPC that returns the
  bun-side ring). Subscribers receive **every** emitted record
  irrespective of level so flipping the display filter reveals
  buffered context without re-fetching.

- **Diagnostics bundle export.** New "Export bundle" button in the log
  viewer header calls `exportDiagnostics` which writes
  `<userData>/dafman-diagnostics-YYYY-MM-DD-HHMM/` containing:
  - All `dafman-*.log` files from the configured log dir.
  - `logs/recent.json` — JSON dump of the in-memory ring (covers
    records that haven't flushed to file yet, including pre-init
    records).
  - `settings.json` — snapshot of the live settings.
  - `README.md` — describes the redaction posture so the recipient
    knows what to expect before sharing.
    Result is revealed in the OS file explorer afterwards via
    `revealPath` so the user can zip and attach to a bug report.

- **Structured-log redaction (`src-bun/app/redact.ts`).** Logger fields
  pass through two redaction rules before they reach disk OR
  subscribers:
  - **Sensitive keys** (matched by regex: `token`, `secret`, `password`,
    `apiKey`, `authorization`, `cookie`, `credential`, `bearer`,
    `private_key`, `PAT`, `x-github-token`) → replaced with `***`.
  - **Content keys** (`prompt`, `content`, `text`, `message`, `body`,
    `answer`, `data`, `reasoningText`, `reasoningOpaque`,
    `encryptedContent`, `delta`) → replaced with a shape descriptor
    `{ len, prefix }` (first 16 chars). Non-string content fields
    (objects/arrays under one of these keys) → `{ _redacted: "content",
_type }`.
  - Long strings under unfamiliar keys (> 256 chars) → shape descriptor
    with `elided: true`.
  - Recursion depth budget (6) + array item cap (32 with `_truncated`
    tail marker) so a pathological payload can't stall the logger.
    12 snapshot/expect tests in `src-bun/__tests__/redact.test.ts` pin
    each rule individually plus an end-to-end test that asserts a
    realistic record never contains the full token or prompt in its
    serialised form.

- **`setLogLevel` RPC + `getLogState` RPC + `logEvent` webview message.**
  Bridge gains `onLogEvent(listener)`; smoke + tests stubs updated.

- **`AppError.Io` variant** for the diagnostics file operations. Mirrored
  in `src/ipc/types.ts`; formatter updated in `src/ipc/invoke.ts`.

- **Cross-platform CI matrix.** New `.github/workflows/ci.yml` Tier-2 job
  runs `bunx electrobun build` on `ubuntu-latest` + `macos-latest` +
  `windows-latest` after the Tier-1 lint/test/smoke gate. Marked
  `continue-on-error: true` for now so a transient native-toolchain
  failure doesn't block merges; flip to required once green for a week.
  Build artifacts upload on failure with 7-day retention.

- **Real elicitation UX — accept/deny/respond/open-URL modal for SDK callbacks.** Replaces the `approveAll` shim that has gated permissions since M1. `SessionRegistry` now installs typed handlers for `onPermissionRequest`, `onUserInputRequest`, and `onElicitationRequest`; the agent's `ask_user` tool and elicitation surface (URL OAuth handoffs, MCP form requests) now actually reach the user. Architecture: handler captures the SDK Promise resolver into a per-session `pendingHandlers` Map keyed by a bun-generated `requestId`, pushes a `pendingRequest` IPC message to the renderer; new `respondToRequest({ sessionId, requestId, response })` RPC resolves the awaiting Promise with the typed SDK shape. Idempotent (double-submit returns `false`). Lifecycle settlement on `disconnect()` / `deleteCliSession()` / `shutdownAll()` cancels every pending handler with a typed cancellation (`{ kind: "user-not-available" }` for permission, `{ answer: "", wasFreeform: false }` for user input, `{ action: "cancel" }` for elicitation) so the SDK never hangs. Reducer + `SessionRecord` switched from singular `pendingRequest` to FIFO `pendingRequests[]` queue per session — multiple in-flight callbacks no longer overwrite each other. Modal lives at `App.vue` level (NOT inside `ChatWindow`) so requests on non-active panels can still be answered; opening auto-activates the owning panel via new `layoutStore.activatePanel`. Three layouts: **permission** = Allow once / Allow for session / Reject + collapsible request details (raw JSON of `command`/`path`/`url`/etc.); **userInput** = question + optional choice radios + textarea (when `allowFreeform`) with Ctrl+Enter submit + Cancel; **elicitation url-mode** = URL pill + "Open in browser" (via new `openUrl` RPC) → switches to "I'm done" → resolves accept; **elicitation form-mode** = explicit "form-based input isn't supported yet" message + Cancel (full JSON-Schema form renderer deferred — separate ticket). Per-session `approveAll` toggle short-circuits the permission handler with `{ kind: "approve-once" }`; `setSessionApproveAll` mirrors the toggle into registry state so the dafman handler honors it (previously only updated the SDK's own flag, which our handler bypassed). 10 new tests (5 registry: pending+settle+approveAll+idempotency, 5 reducer: queue+FIFO+id-scoped cleanup) + 6 wire-shape snapshots (PendingRequestPayload × 3 kinds, RespondToRequestParams × 3 responses). 220 tests pass · lint clean · smoke green on both prod (`vite preview`) and hmr (`vite dev`) per anti-regression rule 3a.

- **`openUrl` RPC** (`http://` / `https://` allowlist via regex, refuses other schemes; backed by `Utils.openExternal`). Used by the elicitation url-mode dialog; any future "open in browser" affordance routes through here so the scheme check stays centralized.

- **`layoutStore.activatePanel(sessionId)`** brings a dockview panel forward in its group. Used by the global `PendingRequestModal` to surface the owning session when a request fires for a non-active panel.

- **Playwright renderer smoke test (`bun run smoke`).** New `e2e/` directory with Playwright config + a single `smoke.spec.ts` that loads the Vite-built `dist/` over chromium (via `vite preview`), installs a deterministic stub RPC bridge before the bundle evaluates (matched against the typed `CommandMap` wire contract), waits for the boot splash to mount + the dockview body to mount + the splash to dismiss, and asserts zero `console.error` and zero `pageerror` events. Catches the exact class of regression that has repeatedly slipped past `bun run check` — the prism component load-order blank screen (`cff49fb` → `02aae07`), the boot-splash freeze, the dockview placement bug, the command palette CSS framing — because vue-tsc + bun test + vite build all prove resolution / type-correctness / topological sort, but **none of them evaluate the bundle in a browser-shaped environment**. New `bun run smoke` script also runs `vite build` first; `bun run smoke:run` reuses an existing build for CI. `bun run check` now includes `smoke:run` so the full gate covers eval-time crashes. CI integration in `.github/workflows/ci.yml` installs Playwright chromium + runs smoke as a required check; Playwright reports upload as a failure artifact for 14 days. Required dep: `@playwright/test`. To wire the stub bridge at module-eval time, `src/main.ts` reads an optional `window.__DAFMAN_TEST_RPC__` global before constructing the Electrobun bridge — invasive only insofar as one extra `typeof window !== "undefined"` check on the bundle's startup path.

### Changed

- **`SessionRecord.pendingRequest` (singular) → `pendingRequests: PendingRecordRequest[]` (FIFO queue).** Multiple SDK callbacks in flight no longer overwrite each other. Both `ChatTab` and `SessionsManager` indicator dots read the queue head (`pendingRequests[0]?.kind`). The composer banner in `ChatWindow.vue` reads the same head; if the queue has more than one pending request the banner surfaces the oldest and the modal handles them one at a time. The `approveAll` default flipped from `true` to `false` — interactive mode is now the actual default, since the dafman handler is the authoritative path (the old `true` was a workaround for the SDK shim that no longer exists).

- **Notification handlers** no longer set state from SDK `*.requested` events (they're informational now; the canonical add path is the synthetic `dafman.pending_request` the sessionsStore pushes through the reducer). SDK `*.completed` events remain as stale-state cleanup in case the SDK resolves a request out-of-band. Per-event no-op handlers preserved so the completeness test still owns the event types.

### Added

- **Markdown rendering expanded with footnotes / definition lists / math / emoji / inline HTML.** Round-2 of the markdown-it switch closes the rest of the "the markdown is underwhelming" gap.New plugins wired through `renderMarkdown` in `src/lib/markdown.ts`: `markdown-it-footnote` (`[^1]` references + a footnotes section with backref links), `markdown-it-deflist` (`Term\n: Definition`), `markdown-it-emoji` (`:smile:` → 😄), `markdown-it-texmath` + `katex` (`$E=mc^2$` inline and `$$…$$` block math, rendered via KaTeX HTML output mode). `katex/dist/katex.min.css` loaded once from `main.ts`. **markdown-it switched to `html: true`** with DOMPurify as the security boundary — raw `<details>/<summary>` collapsible sections now work, plus `<kbd>`, `<mark>`, `<sub>`, `<sup>`. DOMPurify allowlist tightened: `<script>`, `<style>`, event handlers, `javascript:` URLs, and arbitrary `style` attributes are stripped; the one exception is a constrained subset of `style` properties KaTeX uses for inline math sizing (width / height / margin / padding / top / left / vertical-align / position), enforced by a `uponSanitizeAttribute` hook with an explicit regex. `<div style="color: red">` does **not** render red — the `<div>` is dropped (not in allowlist) and even if it weren't, the `style` regex would strip the property. New CSS in `lexical.css` covers `dl/dt/dd`, `.footnotes` section + backrefs, collapsible `<details>` chrome with a soft background tint, `<kbd>` chips, `<mark>` highlight. 10 new tests in `markdown.test.ts` covering each surface and the sanitization paths. 203 tests pass total.

- **Prism grammar set restored + expanded.** When `MessageContent` stopped going through Lexical, the transitive `@lexical/code` → `prism-markdown` → `prism-clike/javascript/typescript/python/...` chain went with it. `prismExtraLanguages.ts` now explicitly registers the full set: `clike`, `c`, `cpp`, `javascript`, `typescript`, `jsx`, `tsx`, `markup`, `css`, `markdown`, `python`, `rust`, `java`, `swift`, `objectivec`, `sql`, `powershell` (the @lexical/code stock bundle), plus `bash`, `json`, `diff`, `yaml`, `toml`, `go`, `ruby`, `php`, `kotlin`, `csharp` (extras we added earlier for tool output). `prism-markup-templating` loaded first because `bash`/`php`/templated shells depend on it. Fixes "syntax highlighting doesn't work" for python/js/ts/etc. on the read-only display.

### Changed

- **Markdown rendering for read-only messages now goes through markdown-it + DOMPurify** instead of Lexical's `@lexical/markdown` `TRANSFORMERS`. Lexical's default transformer set is intentionally minimal (headings, blockquotes, lists, fenced code, bold/italic/strike/highlight/inline-code, links) — no GFM tables, no task lists, no images, no horizontal rules in the bundled set, no autolinks for bare URLs. The composer's needs (decorator chips for `@file` / `/slash` mentions, attachments, in-place editing) and the read-only display's needs (render every common GFM extension once and forget) are different enough that one engine isn't the right answer for both. `MessageContent.vue` (consumed by assistant + user bubbles, reasoning blocks, and tool args/output/result rendering) now renders markdown through `renderMarkdown(text)` in `src/lib/markdown.ts`: markdown-it (`html: true`, `linkify: true`) pipes through custom renderer rules that tag every block with the existing `lex-*` CSS classes (so the same stylesheet covers display + composer); Prism highlights fenced code through the expanded `prismExtraLanguages` set; DOMPurify sanitizes with an explicit GFM-safe allowlist (no `<script>`, no `<style>`, no event handlers, only safe link/img protocols, only narrow KaTeX-style attributes). Composer (`MessageComposer.vue`) still uses Lexical — see AGENTS.md / plan.md for the rationale: `lexical-vue@0.14.1` exposes every primitive we need for upcoming composer features (TypeaheadMenuPlugin for mentions/slash, DecoratorBlockNode + DecoratedTeleports for chips, TablePlugin, CheckListPlugin, AutoLinkPlugin, HashtagPlugin, AutoEmbedPlugin).

### Deferred (separate tickets)

- **Mermaid diagrams.** The `mermaid` lib is 1 MB+ and needs lazy loading, theme integration (light/dark), and a custom transformer that intercepts ` ```mermaid ` fences. Worth a dedicated PR — and gated behind a Settings toggle since the dep cost is significant.
- **GitHub-style cross-references** (`@octocat`, `#42`, `GH-7`). Not a markdown feature. Linkifying these requires the renderer to know which GitHub repo a session is "about", which we don't currently track. Defer until we have repo context (project surface in M3).
- **`<div style="color: ...">` and other CSS-bearing HTML.** Allowing arbitrary inline `style` opens CSS-injection surface (positioning, font swaps, image-via-background-url, etc.). If we want colored callouts, we ship a dedicated Markdown extension (`!!! tip`, `:::info`, or a `<span class="callout-warn">`-style allowlist).

### Fixed

- **Command palette is now actually bounded + scrollable + not blurry.** Three round-three regressions, all from one CSS framing mistake.The library renders `<div command-theme> > <div command-root> > <div command-dialog> > <div command-dialog-mask> > <div command-dialog-wrapper> > {header + body}` — the actual dialog _box_ is `[command-dialog-wrapper]`, NOT `[command-dialog=""]`. The previous CSS put `max-height` / `display: flex` / `border` / `background` on `[command-dialog=""]` which is an inert outer div, so the dialog ran off the bottom of the screen with no scroll. (1) Rules moved to `[command-dialog-wrapper]`. (2) Outer chrome (`[command-theme]`, `[command-root]`, `[command-dialog]`) flattened with `display: contents` so the mask's `position: fixed` establishes the stacking context cleanly. (3) `backdrop-filter: blur` removed entirely — it was the source of the "whole screen blurred" complaint; the mask's 35 % darken alone gives enough separation. (4) `[command-dialog-body]` is now `display: flex; flex-direction: column; min-height: 0` so `[command-list]` can scroll internally instead of pushing the wrapper past `max-height: 80vh`. New `CommandPalette.test.ts` regression: a CSS-source assertion that the bounding rules live on `[command-dialog-wrapper]` (not the inert outer), that the body has `min-height: 0` + flex column, and that the list has `overflow-y: auto` + `min-height: 0` — happy-dom doesn't process SFC `<style>` blocks so we assert on the source, which is exactly enough to pin THIS regression.

### Added

- **Reset Layout command.** `Ctrl/Cmd+K` → "Reset Layout" (Diagnostics group) closes every open panel (chat tabs, settings, dev playground, any sidebars) and re-opens the Sessions sidebar at its default 240 px width on the left. The persisted dockview JSON refreshes automatically via the existing `onDidLayoutChange` debounced writer. Sessions are disconnected (routes through `App.vue`'s `onDidRemovePanel` → `sessionsStore.closeSession`) but **not** deleted — they stay resumable from the Sessions Manager. Toast on completion shows how many sessions were closed. Backed by new `layoutStore.resetToDefault()`; 3 unit tests via a featureful fake `DockviewApi` covering: many panels closed and sidebar re-opened, no panels (first-launch idempotent reset), sidebar already open (re-creates cleanly in the existing edge group).

- **Color-coded categories + per-session accent on "Switch to" commands.** Each category (`Navigation`, `Sessions`, `Active Session`, `Appearance`, `Diagnostics`) gets a distinct hue (blue / emerald / violet / amber / orange) applied to the group heading, the icon, the row's left rail (idle-thin, selected-full), and the hover/selected backgrounds via a `--cmd-accent` custom property cascaded from `[data-group]` selectors. "Switch to: `<session title>`" commands now carry the session's per-pane `accent` color (matching the chat tile's left rail), overriding the category default via inline `style="--cmd-accent: ..."`. `accent?: string` added to the `Command` shape.

### Fixed

- **First session no longer opens in the sidebar / at a tiny width / without a tab bar.** `layoutStore.addPanel` had two iterations of a bug on the "no body group exists yet" cold path. First version called `dock.addGroup()` then added the panel with `direction: "right"` of the new (still empty) group, leaving a 50/50 split with a dead empty pane. The follow-up "fix" dropped the explicit position so dockview's _default_ placement would handle it — but when only edge groups exist, dockview's default puts the panel **inside the active group**, i.e. the Sessions sidebar, which has its tab strip hidden by `.dv-edge-group .dv-tabs-and-actions-container { display: none }`, producing the "session opens at ~240 px, no tab bar, sometimes inside the sidebar" cluster the user reported. Correct fix: when we just created the body group ourselves, drop the panel `direction: "within"` it (not `"right"`). Tile-to-the-right behaviour for the "open a second session alongside an existing one" path is preserved; orphan replacement still uses `direction: "within"`. New `src/stores/__tests__/layoutStore.addPanel.test.ts` pins all four cases (empty dock / only edge group / body group exists / `targetGroupId` supplied) plus the no-op-on-duplicate-id path, against a minimal fake DockviewApi.

- **Self-review hardening pass — defensive guards + smaller perf wins.** (1) `SessionRegistry.forward` (`src-bun/app/sessions.ts`) now rejects non-plain-object `event.data` payloads (null / array / primitive) with a structured warn-log instead of silently coercing them to `{}`, where downstream reducers would have seen empty payloads instead of the real data. Regression-pinned in `sessions.test.ts`. (2) `ChatWindow`'s `ResizeObserver` for `--tile-height` is now rAF-coalesced (one CSS write per frame instead of one per resize tick) and cancels any pending frame on unmount. (3) Global `app.config.errorHandler` in `main.ts` routes Vue lifecycle errors through the existing `console.error` → `installRendererLogBridge` interceptor, so render/watch/setup throws surface in the bun JSON log with component name + info. Removed the redundant `rendererLog` call in `MessageComposer`'s `onError` (the console interceptor already mirrors). (4) Dropped the dead `_workingDirectory` param from `layoutStore.composePanelTitle` and its 3 call sites (`App.vue`, `SessionsManager.vue` × 2). (5) Extracted `fenced(content, language)` into `src/lib/markdown.ts` and made the outer fence length scale to `max(3, longestInnerRun + 1)` — tool output containing ```no longer closes the block early. 6 new`markdown.test.ts` cases.

### Changed

- **Composer + tab strip alignment fix.** (1) Active `ChatTab`'s 4 px accent rail now sits flush at `x=0` so it lines up with `.chat-tile`'s 4 px left rail underneath (was offset by 2 px from `margin: 0 2px`). Inactive tabs compensate with 2 px of left padding so content x-position stays consistent. (2) `ModeButtonGroup` moved off its own `.composer-row` and into the new `#leading` slot on `MessageComposer`, so it shares the composer's `border-top` + padding + flex-row geometry instead of sitting in a separate row with `align-items: flex-end` (which "stuck it to the bottom"). Restyled to use the session accent: idle = 8 % accent tint; selected = full accent fill (mirrors the SubmitButton accent treatment). `align-self: flex-start` keeps the control short when the input grows multiline.

- **Steering, queueing, and interrupt — composer with explicit shortcuts and SDK mode passthrough.** Plain `Enter` is now reserved for Lexical's paragraph-break command so markdown block breaks reach the transcript (fixes "Shift+Enter gives a soft break, plain Enter sends, so I can't get a paragraph break"). Send actions are explicit modifier chords on Enter: `Ctrl+Enter` = send with the session default (Steer by default), `Ctrl+Shift+Enter` = interrupt + send (calls `abortSession` then `sendMessage`), `Alt+Enter` = force queue (`mode: "enqueue"`). The send button is a PrimeVue `SplitButton`: primary label/icon flips between Send/Steer and Queue per the session default; dropdown picks default + explicit "Send & interrupt". Composer no longer disables while a turn is in flight — queueing/steering mid-turn is the whole point. New backend RPCs: `sendMessage` accepts `mode?: "enqueue" | "immediate"`, new `abortSession` backed by `session.abort()`. `SessionRecord.defaultSendMode: "steer" | "queue"` (in-memory; v2 persists to settings). 4 new wire-contract snapshots. Phase-2 follow-ups (queue strip, wait-for-idle after abort, verified `mode: "immediate"` semantics) deferred.

- **Sessions Manager — left edge-group panel listing every CLI-side session.** New dockview edge panel (toolbar toggle, `pi pi-list`) lists sessions from `listSessions`, grouped by workspace (basename label, full path tooltip), most-recently-modified first, with a "No workspace" fallback bucket. Per-row: click to resume into a new chat panel (`restoreSession` + `addPanel`); delete via PrimeVue `ConfirmPopup` (danger-styled). An "open" badge marks sessions currently in a panel. Auto-refresh when in-app session count changes; manual refresh button in the header. New backend `deleteSession` RPC backed by `client.deleteSession` — disconnects in-app sessions first so the SDK can release its handle. New `sessionsListStore` caches the catalog. Layout helpers `isPanelOpen(id)` / `closePanel(id)` for toggle-style buttons. **Sessions panel opens by default on first launch** (user closes survive reloads — we only auto-open when the persisted layout didn't reference it). **Closing the panel tears down the parent edge group when empty**, so reopen always lands at the configured `initialSize: 280` instead of inheriting a residual collapsed strip.

- **Per-tool rendering — summaries + syntax highlighting.** New per-tool renderer registry (`src/lib/toolRenderers.ts`) maps each tool to a `summary(args, result)` one-liner plus `argsLanguage` / `resultLanguage` for code-block rendering. Built-in renderers + aliases: shell/bash/execute, read/write/edit/view, apply_patch (sniffs first file path from the diff body), grep, glob, fetch/web_fetch, todo_write. `read_file` / `view` / `write_file` infer result language from the file extension via a short ext→prism-id map. MCP-hosted tools fall through to JSON args + markdown result. `ToolCallBlock`'s collapsed header now leads with the renderer-supplied summary (`shell ls -la /tmp` instead of "shell · Running"); args / partial output / result blocks render through `MessageContent` wrapping fenced code (` ```{lang}\n...\n``` `) so they pick up prism highlighting through `@lexical/code`'s `registerCodeHighlighting`. 9 unit tests. **Known gap:** `@lexical/code` bundles a fixed subset of prism grammars (clike, js/ts, markup, markdown, c, css, objc, sql, powershell, python, rust, swift, java, cpp). Languages outside that set — bash, json, diff, yaml, toml, go, ruby, php, kotlin, csharp — currently render uncoloured. A side-effect import of `prismjs/components/*` was tried and reverted (crashed the renderer at startup); a proper fix will swap in Shiki or another highlighter as a follow-up.

- **Per-session workspace (cwd) — inline.** The topbar now hosts a PrimeVue `AutoComplete` (path input) + folder-picker button + "New Session" button, so creating a session in a different folder is a one-line flow with no modal. The chosen path is passed through `createSession` → SDK `SessionConfig.workingDirectory`; empty input falls back to the bun process cwd. Native picker via Electrobun `Utils.openFileDialog({ canChooseDirectory: true })`, exposed as `pickFolder` RPC. `SessionRecord.workingDirectory` is also lifted from the `session.start` event's `data.context.cwd`, so resumed sessions show the path the CLI remembers, and the chat-tab options popover (`SessionHeaderControls.vue`) displays it with an RTL-ellipsised tail. **MRU persisted across runs:** Settings schema bumped v3 → v4 with a new `workspaces: { recent: string[] }` field (cap 10, deduped, trimmed). Every successful create with a non-empty path bumps the entry to the head of the MRU via `settingsStore.recordWorkspaceUse`. The AutoComplete suggests from `settings.workspaces.recent` (focus-open + substring filter). Added migration tests v2 → v4 (empty MRU) and v3 → v4 (empty MRU); coercion drops non-strings, trims whitespace, dedupes, caps to the limit; wire snapshot regenerated.

### Changed

- **Reasoning card compacted into the header.** In compact-visibility mode the standalone `REASONING` label + below-the-line preview collapsed into a single clickable header row (muted + italic + ellipsised inline next to the chevron). The full "Reasoning" label is kept only in fully-expanded mode where there's no preview to act as a title. Entire header is keyboard-activatable (Enter / Space).

- **User vs assistant message bubbles are now visibly distinct.** User-message left rail uses `--p-text-muted-color`; assistant rail keeps the session accent. Per-session accent moved off user bubble backgrounds (it was conflating user content with the session-identity signal) and into the composer chrome: composer-shell border (50% accent mix idle, full accent + 1px ring on focus) and send-button (accent fill with hover/focus states). Falls back to PrimeVue primary token when no `--accent` is in scope (dev playground / unit tests).

- **Resumed sessions now render their transcript.** Bun-side replay of the SDK's `getMessages()` history fires through `webview.rpc.send.sessionEvent` _during_ the `resumeSession` RPC handler. Those messages travel over the same channel as the RPC response and arrived at the renderer _before_ the awaiting promise resolved, so `handleEvent` saw no matching `SessionRecord` and silently dropped every replayed event (transcript, `session.start`, model, title, …). `sessionsStore` now buffers events whose sessionId has no record yet in a module-level `pendingEvents: Map<sessionId, SessionEventPayload[]>` (capped at 5000/session); `createSession` and `restoreSession` drain through `applyToRecord` immediately after pushing the record so history shows up and `session.start` / `session.resume` metadata (workingDirectory, mode, title, …) lands on the record. `sessionsStore` also listens on both `session.start` and `session.resume` for the workingDirectory backfill.

- **User messages render from `user.message` events (history replay).** The reducer previously skipped `user.message` entirely on the grounds that the local optimistic `appendUserMessage` covers live sends — but history replay through `getMessages()` emits `user.message` events as the only source for the user side of the timeline, so resumed sessions only showed assistant content. Reducer now handles `user.message`: dedupes by envelope `eventId` (idempotent replay) and by text match against local optimistic items (no double bubble on live sends); otherwise appends. 4 new reducer tests.

- **Workspace surfaces as a chip in the tab strip, not in the tab title.** Tab titles were too long with `<folder> · <SDK title>`; `composePanelTitle` now returns just the SDK title (or short id). Workspace lives as a `pi pi-folder` chip in `SessionHeaderControls` (right header actions): basename label, full path tooltip, click opens the folder in the OS file explorer via a new `revealPath` RPC (Electrobun `Utils.showItemInFolder`). Theme-aware hover (`color-mix(in srgb, var(--p-text-color) 8%, transparent)`).

### Fixed

- **Blank screen on startup after enabling extra prism grammars.** A side-effect import of `prismjs/components/prism-{bash,json,diff,yaml,toml,go,ruby,php,kotlin,csharp}.js` from `src/lexical/prismLanguages.ts` crashed the renderer at module init. Likely cause: `prismjs` has no `"exports"` field, and `@lexical/code` bundles its own prism instance with its supported components pre-registered; loading the same components from a separate path before `@lexical/code`'s prism setup ran (or hitting Vite's import-analysis on a non-exported subpath) tripped a hard error. Reverted: dropped `prismLanguages.ts` and the import from `main.ts`. The languages still highlight via the `@lexical/code` bundle (see "Per-tool rendering" above for the supported set). A proper fix lands when we swap in Shiki.

- **Empty "..." assistant card before tool calls.** Every assistant turn emits `assistant.message_start` (creating an empty assistant item in the reducer) before any deltas arrive. When the turn went straight to a tool call without text, the renderer fell back to a `"..."` placeholder, producing a noisy empty Assistant card right before the tool block. `ChatWindow.vue` now skips rendering assistant items whose `text === ""`, and the pending "Thinking…" spinner stays visible until a non-empty assistant exists (predicate flipped from `text === ""` to `text !== ""`). User and system cards still render placeholders if empty (those should never happen in practice).

- **`[CLI subprocess] AttachConsole failed` stack-trace spam on Windows.** The Copilot CLI loads `node-pty`, whose `conpty_console_list_agent.js` helper crashes during module init with `AttachConsole failed` when the parent (bun under Electrobun) has no Windows console attached. The SDK relays the CLI's stderr verbatim with a `[CLI subprocess]` prefix, so the multi-line stack landed in our terminal on every run. New `src-bun/app/stderrFilter.ts` patches `process.stderr.write` to (1) drop lines matching the known node-pty / AttachConsole stack frames, (2) route remaining `[CLI subprocess]` lines into `log.debug` so they're preserved in the JSON log file for diagnostics, and (3) pass everything else through unchanged. Installed in `src-bun/index.ts` immediately after `initLogger`, before the SDK can spawn the CLI. Tested in `src-bun/__tests__/stderrFilter.test.ts`.

- **Session controls moved into the dockview tab strip.** Each session's chrome (model + reasoning-effort selects, options gear + popover with run mode, reasoning visibility, rename, compact history, reset approvals) now lives in the group's tab strip via a new `ChatTabActions.vue` mounted as dockview's `rightHeaderActionsComponent`. The actions component reads dockview's `activePanel` (auto-updates on `onDidActivePanelChange`) and forwards to a new `SessionHeaderControls.vue` for the active chat panel. `ChatWindow.vue` lost its in-pane header entirely (~280 LOC trimmed) — it's now transcript + composer only. `sessionsStore.SessionRecord` gained an in-memory `reasoningVisibilityOverride: ReasoningVisibility | "default"` field + `setSessionReasoningOverride(id, value)` action so the controls in the tab strip can mutate per-session state without prop-drilling.
- **Custom dockview tab (`ChatTab.vue`)** registered as the `defaultTabComponent`. Each tab is a top-rounded pill with the session accent as its left rail (4 px when active, 2 px when inactive) and an accent-tinted background (`color-mix` of `18% / 12% (hover) / 6% (idle)` over `--p-content-background`). Reactive to `api.onDidTitleChange` and `api.onDidActiveChange`; close ✕ is in-tab (fades in on hover; persistent when active). Active tab gets `margin-bottom: -1px` so it visually merges with the chat tile below. `src/style.css` neutralises dockview's own `.dv-tab` chrome (`padding: 0; background: transparent`) so our custom surface is the only visible layer.
- **Prominent per-session accent in the chat tile.** Replaced the old 3 px top accent stripe with a 4 px left rail and a soft top-down accent wash (`color-mix(in srgb, var(--accent) 7%, content-background)` fading to background over 220 px) on `.chat-tile`. User-message bubbles also tint at 8 % accent so the session colour runs end-to-end through the transcript; assistant tint bumped 14 % → 18 %.
- **Chat tile sits flush against the dockview tab strip.** Dropped the tile's top border + top corner radius (`border-top: none; border-radius: 0 0 xl xl`), so the active tab's rounded top and the tile below read as a single shape.
- **Session options popover pre-fills the rename input.** `nameDraft` is now seeded from `record.title` and re-seeded every time the popover opens (inside the click handler, not a watcher, so an in-flight edit isn't clobbered by a late `session.title_changed` echo while the popover is still open).

### Fixed

- **Vite dev server failed to resolve `dockview-vue/dist/styles/dockview.css`.** `dockview-vue` and `dockview-core` were declared in `package.json` but not actually installed in `node_modules` (drifted lockfile). Re-running `bun install` brought them back in.

- **Startup-restore race + lost session panels after dockview `fromJSON`.** Three related fixes converged into one user-visible behavior:
  - `<DockviewVue @ready>` fires from the child component's `onMounted` — which in Vue 3 runs **before** the parent's `onMounted` — so `App.vue`'s async `restoreFromLayout()` was setting `pendingRestoreLayout` long after `onDockReady` had already seen it null. The persisted dockview layout was never applied. Restore now calls `layoutStore.restore(layout)` immediately when `layoutStore.api` is already up, and only falls back to stashing for `onDockReady` if it isn't (covers `<Suspense>` corner cases).
  - **Stop pruning the layout JSON on failed resume.** Previously we dropped panel entries whose `resumeSession` RPC came back "Session not found" before handing the JSON to dockview's `fromJSON`; dockview however _still_ created placeholder panels for the grid references, which then resolved to a blank "Session … not loaded" pane. We now keep the layout intact and surface a friendly recovery surface inside the orphan panel (see below).
  - **`ChatPanel.vue` orphan UI.** When no `SessionRecord` matches the panel id, the chat slot renders a centered "Session no longer available" surface with `pi-inbox` icon, the truncated session id, a primary "Start new session here" button (calls `sessionsStore.createSession()` then `layoutStore.replaceMissingPanel(orphanId, newId)` to drop the new session into the same group and close the orphan), and a secondary "Close tab" button. The orphan layout itself is preserved so the user's pane geometry survives a CLI-side delete.

- **dockview-vue prop-shape gotcha in `ChatPanel.vue`.** dockview-vue mounts panel components with `{ params, api, containerApi, tabLocation }` only on `init`; after any `update()` the renderer re-wraps everything into a single top-level `params` prop (so user params live at `props.params.params` and the panel api at `props.params.api`). Since the update fires before our component reads, `props.api` was undefined and `props.params.sessionId` was undefined — every restored panel rendered the orphan UI even though the session had resumed cleanly. The component now normalizes both shapes (`userParams = props.params.params ?? props.params`; `panelApi = props.api ?? props.params.api`). Documented in a stored memory + `ChatPanel.vue` header comment so future panel components don't trip the same wire.

### Changed

- **New sessions tile by default.** `layoutStore.addPanel(sessionId, opts?)` now drops new sessions as a _new group to the right_ of the currently active group (`position: { referenceGroup: activeGroupId, direction: "right" }`), instead of stacking them as tabs in the active group. First panel (no active group yet) falls back to dockview's default placement. `addPanel` also gained a `targetGroupId` option so the orphan-replacement path can add the new session _inside_ the orphan's group (`direction: "within"`).
- **Dockview chrome matches the app shell.** `src/style.css` now bridges dockview's `--dv-*` palette (group background, tab bar, active/inactive tab states, divider/separator/scrollbar/icon-hover colours) to PrimeVue's `--p-content-background` / `--p-surface-*` / `--p-text-color` / `--p-text-muted-color` / `--p-content-border-color` tokens for both `.dockview-theme-light` and `.dockview-theme-dark`, so the tab bar and panel background no longer clash with the topbar on either theme.

### Added

- **Per-session SDK options popover** (merged from PR #1). Gear button in the chat header opens a Popover with Run mode (interactive / plan / autopilot), Reasoning view override, Rename session, Compact history, and Reset approvals. Backend gains `getSessionMode` / `setSessionMode` / `getSessionName` / `setSessionName` / `compactSessionHistory` / `setSessionApproveAll` / `resetSessionApprovals` RPCs; `sessionsStore.SessionRecord` gains `mode` + `approveAll` fields (synced from `session.mode_changed`); `restoreSession` fires `getSessionMode` after resume so the dropdown reflects the right value on restored panes. The auto-approve toggle is deliberately omitted from the UI for now because the local `onPermissionRequest: approveAll` shim short-circuits every request (SDK-side toggle has no observable effect); the prop + action are retained so the row can be re-added once real permission UX lands. Validation on the backend: `getMode` rejects non-`"interactive" \| "plan" \| "autopilot"` SDK values as `AppError.sdk`; `getName` returns `null` for nullish, rejects non-string. Tests cover the proxying, unknown-id handling, and the validation branches.
- **Dockview-vue is the layout primitive.** The body of `App.vue` is a single `<DockviewVue>` covering the whole viewport below a slim app-chrome topbar. Sessions are panels (`layoutStore.addPanel({ id: sessionId, … })`); dockview's tab X is the only close path (the in-pane close button is hidden via a new `ChatWindow :hide-close` prop) → `onDidRemovePanel` → `sessionsStore.closeSession`. New `src/stores/layoutStore.ts` owns the DockviewApi and exposes `addPanel` / `removePanel` / `renamePanel` for chat panels, plus `openEdgePanel(position, options)` / `toggleEdgeGroup(position)` for future sidebars / status bars / log viewers. Resize, drag-to-reorder, drag-between-groups, drag-to-split, drag-to-tab, popout windows, edge groups — all free, all serializable. The convention is documented in `AGENTS.md` and `plans/plan-frontend-shell.prompt.md`: any new persistent UI surface goes in as a dockview panel/edge group, never as new chrome.
- **Layout persistence + startup resume.** Settings schema v2 → v3 with `layout: { dockview: unknown | null }` (opaque dockview JSON). `settingsStore.persistLayout(blob)` writes the snapshot on every `onDidLayoutChange` (debounced 300 ms). On startup, after `clientStore.createClient()`, `App.vue` extracts panel ids from the persisted layout (`Object.keys(layout.panels)`), calls the new `resumeSession` RPC for each one, prunes any that failed, then hands the pruned layout to `layoutStore.restore()` _before_ subscribing to change events so the restore itself doesn't write back. Failed restores surface as info toasts (not errors — the common case is "user `/clear`'d the session via the CLI"). New backend RPCs: `resumeSession({ sessionId, model, reasoningEffort })` (hydrates history via `session.getMessages()` → forwards through the standard emit path so the reducer rebuilds the transcript) and `listSessions()` (returns `SessionMetadataSummary[]` for the upcoming recent-sessions picker — RPC ready, UI not yet wired).
- **Tool-call visibility in the chat stream.** Every SDK tool invocation now renders as its own collapsible `ToolCallBlock` between assistant messages, keyed by `toolCallId`. The reducer in `src/lib/chatEvents.ts` consumes the five SDK tool events (`tool.user_requested`, `tool.execution_start`, `tool.execution_partial_result`, `tool.execution_progress`, `tool.execution_complete`) into a single `kind: "tool"` `ChatItem` with `status: "running" | "success" | "error"`, accumulated `partialOutput` (capped at 64 KB to keep noisy shell tools from grinding the renderer), latest `progressMessage`, and final `resultContent` (preferring `result.detailedContent` over `result.content`, since the latter is LLM-truncated). Status transitions are monotonic: once a tool reaches a terminal status, a delayed `execution_start` only merges metadata, never regresses back to running. `mcpServerName` / `mcpToolName` are surfaced for MCP-hosted tools. New collapsible `ToolCallBlock.vue` shows the tool name + status tag + one-line preview when closed, and pretty-printed args + output + result/error when expanded.
- **Envelope metadata on `SessionEventPayload`.** The backend now lifts `agentId`, `eventId`, and `timestamp` off the SDK event envelope (previously only `event.data` was forwarded). This preserves sub-agent attribution so a tool call from a sub-agent is identifiable on the frontend; the new `ToolCallBlock` shows a "sub-agent" pill when present. Wire snapshot added for the extended shape.
- **Renderer → bun log bridge** (`src/ipc/rendererLog.ts`). Mirrors `console.error`, uncaught errors, and unhandled promise rejections into bun's JSON log via a new `rendererLog` RPC, so renderer-side failures are visible to `tail dafman-*.log` even when WebView2 devtools is closed. Plus a new opt-in `TypingDiagnostic` plugin (mount via `?diag=1` URL param) that logs editor state + the result of a programmatic `insertText` so we can sanity-check composer mounts without a screen.
- **Lexical-backed chat composer + message display.** Replaces the PrimeVue `InputText` composer and the plain-`<p>` assistant/reasoning body with two new components, `MessageComposer.vue` and `MessageContent.vue`, both backed by [Lexical](https://lexical.dev) via the `lexical-vue` Vue 3 binding (`lexical-vue@0.14.1` + `lexical@0.38.1` + matching `@lexical/*` packages, all version-pinned to avoid duplicate-version drift). The composer uses `RichTextPlugin` + `ListPlugin` + `LinkPlugin` and registers `@lexical/markdown`'s `TRANSFORMERS` keystroke shortcuts (`# heading`, `**bold**`, ` ``` `, `- list`, `> quote`, `---`, links, etc. auto-format as you type). Sends are serialized to markdown via `$convertToMarkdownString(TRANSFORMERS)`; the display renders the same markdown back via `$convertFromMarkdownString`. Streaming assistant deltas are coalesced via `requestAnimationFrame` so a burst of 5–30 deltas/sec triggers at most one Lexical reconcile per frame. New `src/lexical/{theme,plugins,nodes}.ts` keep Lexical wiring out of SFCs; global `src/lexical/lexical.css` styles the theme classes Lexical injects into the DOM (scoped CSS can't reach those nodes). Composer height auto-grows up to 60 % of the chat tile via a `ResizeObserver`-published `--tile-height` custom property. The composer's `enableMarkdownShortcuts` prop (default `true`) lets the parent fall back to plain text if a future plugin combo destabilises typing under WebView2.
- **Dev URL flags.** `DAFMAN_PLAYGROUND=1` boots into `?dev` (Playground); `DAFMAN_AUTO_SESSION=1` boots into the main app with a session auto-created on mount. Strictly dev-channel; ignored in canary/prod builds.
- **`bun run dev:hmr` ensures `dist/` exists** before starting `electrobun dev --watch`. Previously the watcher crashed with `ENOENT` because Vite hadn't created the `dist/` directory yet in HMR mode (Vite serves the renderer from memory). New `tools/prep-dist.ts` writes a stub `dist/index.html` (HTTP-refresh to `http://localhost:5173/`) and an empty `dist/assets/` before electrobun's watcher attaches; a real `vite build` will overwrite the stubs.
- **`plans/plan-frontend-shell.prompt.md`** — authoritative snapshot of the current Vue + Bun frontend shell (module map, lifecycle diagram, session-lifecycle invariants, IPC table, settings schema, SDK gotchas). Newer than `plan-architecture.prompt.md` (which is Rust/Tauri legacy with a post-port note); `AGENTS.md` now points here first for frontend work.

### Fixed

- **Copilot client failed to start under Node < 24** (`ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite`). The SDK's `getBundledCliPath()` returns `@github/copilot/index.js`, which the CLI's npm-loader requires Node ≥ 24 for (`node:sqlite` shipped stable in Node 24). When the agent ran under a Volta-pinned Node 20, the JS path crashed before the first RPC. We now resolve `@github/copilot-${process.platform}-${process.arch}` (the prebuilt native binary, e.g. `copilot.exe` on Windows x64) and hand its path to `CopilotClient` via `cliPath`. The SDK's existing JS-vs-binary branch then spawns the prebuilt directly, skipping the Node-version-dependent JS path. Falls back to the JS path with a logged warning when the platform binary isn't available (architectures without prebuilds / `--no-optional` installs).
- **Composer's contenteditable parent was `display: flex`**, which Lexical warns causes Chrome/WebView2 focus quirks when clicking just outside the editable region. `.lex-composer-shell` is now `display: block`; the contenteditable inside is a normal block element with `min-height` / `max-height` constraints intact.
- **`.chat-tile` only filled its container as a grid item.** When mounted in a plain block container (the dev playground's `.chat-frame`) the tile collapsed to its intrinsic content height (header + composer + tiny messages area) regardless of how tall the frame was. Added `height: 100%`; safe in both grid (item already stretches) and block layouts.
- **Initial window clipping (Windows).** The WebView2 surface attaches at the outer window size, so the renderer reported a viewport ~16 px wider/taller than the visible client area until the first WM_SIZE — anything past that boundary was clipped. We now schedule a ±1 px frame nudge from the Bun main process on a staggered timeline (0/150/400/900 ms after `dom-ready`, plus 200/600/1500 ms fallbacks) so a single resize event always lands after the renderer has finished its first layout, regardless of how slow the renderer mount is (a few hundred ms with Lexical).
- **Model-change toast was emitted twice and lost the reasoning effort.** The SDK fires `session.model_change` for both the user-requested switch and the backend's auto-switch echo. The reducer now dedupes by `(previousModel, newModel, previousReasoningEffort, reasoningEffort)` and folds the effort delta into the toast detail (`claude-sonnet-4.5 → gpt-5.5 (medium → high effort)`).
- **Bun SFC loader emitted duplicate `_hoisted_*` constants** for any SFC whose template had static class attributes on multiple elements. The loader gated the standalone-template-compile pass on `scriptBlock.scriptSetup` — which is `undefined` on the `SFCScriptBlock` returned by `compileScript({inlineTemplate: true})` — so it ran a redundant `compileTemplate` whose hoisted vnode constants collided with the inlined ones. Now gated on `descriptor.scriptSetup` (the source descriptor) instead.

### Changed

- **Toasts.** Click anywhere on a toast to dismiss it. Default auto-dismiss shortened from 4 s → 2.5 s (errors from 6 s → 5 s) to make the stream less noisy during a session.
- **Chat tile + composer layout.** `.session-grid` now uses `minmax(min(360px, 100%), 1fr)` and the chat header wraps; selectors don't push the tile past the viewport.

### Known gaps

- SFC tests for `MessageComposer` / `MessageContent` were prototyped but removed: Bun's ESM loader trips a TDZ inside `@lexical/{history,rich-text,link}` (`Cannot access 'X' before initialization`) that Vite's bundler handles transparently. The components are exercised end-to-end via the Vite production build and the dev playground; deep rendering coverage moves to e2e (see roadmap).

## [Earlier unreleased entries]

- **Port from Tauri → Electrobun.** The Rust backend (`src-tauri/`) is gone; main process is now TypeScript under `src-bun/`, driven by [Electrobun](https://docs.electrobunny.ai/electrobun/) on Bun. The SDK swap is `github-copilot-sdk` (Rust crate) → `copilot-sdk-supercharged` (npm), same JSON-RPC engine. Tauri's per-session `Channel<SessionEventPayload>` is replaced with a single bun→webview `sessionEvent` RPC message that carries `sessionId`. Settings live at `Utils.paths.userData/settings.json`; logs at `Utils.paths.userLogs/dafman-YYYY-MM-DD.log` (JSON lines). "Open log folder" uses Electrobun's `Utils.showItemInFolder`. Per-session permission UX still defers to `approveAll` until M1's PermissionService lands.
- **One runner, one language.** Vitest, `@vue/test-utils`, `happy-dom`, `cargo test`, and `insta` are all gone. `bun test` runs everything; Vue SFC tests work via `tools/bun-vue-loader.ts` (Bun plugin patterned on the [Svelte test guide](https://bun.com/docs/guides/test/svelte-test) using `@vue/compiler-sfc` + `@happy-dom/global-registrator` + `@testing-library/vue`). IPC wire-shape snapshots moved from `insta` inline snapshots to `expect(...).toMatchSnapshot()` in `src-bun/__tests__/wire-contract.test.ts`.
- **package.json scripts**: `dev` / `dev:hmr` / `build` / `test` / `lint` / `check` all run through Bun. Dropped `tauri`, `test:rust`, `test:all`, `lint:rust`, `fmt:rust`.
- **CI**: `.github/workflows/ci.yml` simplifies to a single Linux job (`bun install` → `bun run lint` → `bun test` → `bunx vite build`). Cross-platform `electrobun build` matrix is a follow-up.

### Removed

- `src-tauri/` crate (Rust backend + cargo toolchain + tauri-driver plan).
- `@tauri-apps/api`, `@tauri-apps/cli`, `@tauri-apps/plugin-opener` deps.
- `vitest.config.ts`, `vitest`, `@vitest/coverage-v8`, `@vue/test-utils`, `happy-dom` dev-deps.
- The `insta` integration-test crate (`src-tauri/tests/ipc_contract.rs`).

### Fixed

- Reasoning card was illegible in dark mode (muted text on muted surface); body now uses `--p-text-color`, label stays muted; dark mode bg uses `--p-content-background` tinted via `color-mix` so theme switches keep contrast correct. Same fix on message + system cards.
- Per-session reasoning Select rendered empty by default because the v-model was `null`; it now defaults to a `"default"` sentinel and shows "Default".
- Settings dialog SelectButtons had no accessible name; added `aria-labelledby` pointing at their visible labels.
- Empty / opaque reasoning events no longer render phantom "Thinking..." cards: events with no id AND no text are dropped with a `console.warn`; OpenAI's opaque `reasoning_opaque`-style events (empty `content`, ~500-char base64 `reasoningId`) are dropped unless they update an existing card.
- Session colours: first 12 sessions in a client are now visually distinct via a curated palette indexed by creation order (was a colliding id-hashed HSL hue).

### Added

- **Dev playground** at `?dev` (`src/dev/Playground.vue`). DEV-only, dynamically imported so tree-shaking removes it from production bundles. Includes scripted event sequences, a custom event JSON pusher, toast firing for all four severities, and a live `ChatWindow` preview.
- **Render high-value session events**: `session.title_changed` (header title), `session.model_change` (model badge + toast), `session.usage_info` / `assistant.usage` (footer token pill), `assistant.turn_start/end` (drives "Thinking..." indicator off real boundaries with heuristic fallback), `assistant.intent` (replaces the spinner label with the intent text), `session.info` / `session.warning` / `system.notification` / `model.call_failure` (severity-tinted inline cards), `session.truncation`, `session.compaction_start/complete`. Explicit no-op cases for `assistant.streaming_delta` (dup of `message_delta`), raw `system.message` (system prompt), and the `tools_updated` / `skills_loaded` / `custom_agents_updated` family.
- **Per-session model + reasoning effort selectors** in the chat header. New `list_models` / `set_session_model` IPC commands backed by `app::models::ModelSummary` (slim mirror of `github_copilot_sdk::Model`); `modelsStore` lazy-loads and caches the catalog. The Effort Select only renders when the chosen model advertises `supports.reasoningEffort`. Backend-initiated model switches (e.g. rate-limit auto-switch via `session.model_change`) keep the UI in sync.
- **Open log folder** button in Settings → General. New `get_log_dir` IPC returns Tauri's `app_log_dir()`; frontend pairs it with `revealItemInDir` from `tauri-plugin-opener` (already a dep) so users can pop the daily JSON log file without copying paths.
- **Per-session event logging**: backend forwarder logs `event_type` + `session_id` at debug for every event (default-on); reasoning/error/warning/`model.call_failure` data at debug; every other event's data at trace. `M1-TODO(observability)` comment notes this is intentionally chatty during early M1 and should be demoted to trace once the chat surface is feature-complete and Settings → Diagnostics log toggle ships.
- **Auto-create client on mount**: drops the "Create Client" button; `App.vue` calls `clientStore.createClient()` in `onMounted` after settings load. Placeholder copy shows "Starting Copilot client..." then "Click New Session to start chatting."
- **mockIPC E2E** (`src/__tests__/App.e2e.test.ts`) covering auto-create-client → new-session → stream events → send message via `@tauri-apps/api/mocks`. No Tauri binary required.
- **Test coverage** doubled to 82 vitest (across `lib/`, `stores/`, `components/`, `ipc/`, `__tests__/` E2E) and 17 cargo (10 lib + 7 integration including `AppError` wire snapshots for every variant).
- **Reasoning visibility + full-width chat redesign** — `assistant.reasoning_delta` / `assistant.reasoning` events render as muted full-width cards next to the user/assistant cards. Settings v2 adds `Appearance.reasoningVisibility` (`hidden` / `compact` / `expanded`, default `compact`); v1 documents migrate cleanly via serde defaults. Per-session override in the chat header. Chat messages were redesigned from bubbles-with-avatars to full-width tinted cards distinguished by border colour.
- **M1: Settings store on disk** — new `app::settings` module owning `Settings { version, appearance: { theme, reasoningVisibility } }` persisted to `app_config_dir()/settings.json`. `SettingsService::load_or_default` is sync at startup (falls back to defaults on missing/malformed files, with a tracing warning) and `update` writes via `tauri::async_runtime::spawn_blocking`. Forward migrations are a `Settings::migrate` match arm so adding v2 is localized. Frontend gets a `settingsStore` + `SettingsDialog.vue` (General + Appearance tabs) reached via a cog button in the topbar. Dark mode is three-state (System / Light / Dark) and resolved through `resolveIsDark(theme, prefersDark)`.

### Changed

- **M1: Pinia stores + typed IPC wrapper** — added `clientStore`, `sessionsStore`, `toastStore`, `modelsStore`, `settingsStore`, and a `permissionsStore` scaffold for the upcoming permission UX. New `src/ipc/invoke.ts` is the only place that calls `@tauri-apps/api/core`'s `invoke`; `CommandMap` in `src/ipc/types.ts` types every Tauri command surface. `App.vue` and `ChatWindow.vue` are now dumb components reading stores. PrimeVue `Toast` mounted at the app root and fed from `toastStore`. New dep: `pinia`.
- **M1: Per-session Tauri channel** — `create_session` now takes a `tauri::ipc::Channel<SessionEventPayload>` and forwards SDK events through it instead of the global `session-event` emitter. `SessionEventPayload` drops its `sessionId` field (the channel identity scopes events).
- **M1: Backend module refactor** — split `src-tauri/src/lib.rs` into `app/{error,events,state,settings,models}.rs` + `ipc/commands/{client,session,settings,models,diagnostics}.rs`. Introduced `AppError` (`thiserror`); every command returns `AppResult<T>` instead of `Result<T, String>`.
- Multi-session chat panes in a responsive grid (M0).
- Streaming token deltas per session via the GitHub Copilot SDK (Supercharged).
- Per-session accent color derived from the session id.
- Light & dark mode via PrimeVue tokens (Aura preset, green primary).
- Initial design documents in `plans/` covering vision, architecture, roadmap, messaging UX, tools & permissions, platform features, SDK & external surfaces, and testing strategy.
- plans/plan-observability.prompt.md ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â logging, tracing, metrics, audit, performance budgets, in-app Log Viewer, privacy controls. Cross-referenced from the overview, architecture, roadmap (M1ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“M7 observability bullets), and testing strategy.

### Changed

- N/A ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â initial release.

### Fixed

- N/A ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â initial release.
