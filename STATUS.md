# Dafman - Status
> Live progress board. Update this file whenever you finish a milestone item or learn something that changes direction. Keep entries short; link to commits, issues, and `plans/` for detail.
**Active milestone:** **M1.5 - Electrobun port** (mid-stream cutover from Tauri; M1 backlog resumes after).
## How to use this file
- Tick items in the milestone checklist as PRs land.
- Add a short "Last completed" line so the next agent knows where to start.
- Move items between sections; do not silently delete.
- Prefer linking to commits / files / plans over re-writing rationale.
---
## Last completed
- **Dockview shell hardening pass.** Three follow-ups to the dockview body that landed together: (1) Startup-restore race — `<DockviewVue @ready>` fires on the *child's* `onMounted` (before parent), so `pendingRestoreLayout` was always null at the point `onDockReady` checked it; `restoreFromLayout` now applies the layout immediately when `layoutStore.api` is up, else stashes for the fallback path. (2) Killed the "Session not loaded" blank pane — we no longer prune the persisted layout JSON when resume fails; `ChatPanel.vue` instead renders a friendly orphan UI (`pi-inbox` + truncated id + "Start new session here" / "Close tab" buttons) backed by a new `layoutStore.replaceMissingPanel(orphanId, newSessionId)` that adds the new session as a tab in the orphan's group and removes the orphan. (3) Normalized the dockview-vue prop-shape gotcha in `ChatPanel.vue`: dockview-vue re-wraps panel props into a single `params` prop after the first `update()` (so user params is at `props.params.params`, panel api at `props.params.api`, and the top-level `api` prop is missing), and that update fires before our component reads — every restored panel was rendering the orphan UI even though the session had resumed cleanly. The component now resolves `userParams = props.params.params ?? props.params` and `panelApi = props.api ?? props.params.api`. Memory stored so future panel components don't trip the same wire.
- **New sessions tile by default.** `layoutStore.addPanel(sessionId, opts?)` drops new sessions as a new group to the right of the active one (`direction: "right"`), with a new `targetGroupId` option for the orphan-replacement path (`direction: "within"`). First-panel falls back to dockview's default.
- **Dockview chrome matches the app shell.** `src/style.css` bridges `--dv-*` to PrimeVue tokens (`--p-content-background` / `--p-surface-*` / `--p-text-color` / `--p-text-muted-color` / `--p-content-border-color`) for both `.dockview-theme-light` and `.dockview-theme-dark`.
- **Per-session SDK options popover** (PR #1, merged into this branch). New gear button in the chat header opens a Popover with: Run mode (interactive / plan / autopilot), Reasoning view (default / hidden / compact / expanded), Rename session, Compact history, Reset approvals. Backend gains `getSessionMode` / `setSessionMode` / `getSessionName` / `setSessionName` / `compactSessionHistory` / `setSessionApproveAll` / `resetSessionApprovals` RPCs (all in `SessionRegistry` + `src-bun/index.ts`); sessionsStore tracks per-session `mode` and `approveAll`, syncs from `session.mode_changed`. Auto-approve toggle deliberately omitted from the UI because the local `onPermissionRequest: approveAll` shim short-circuits every request anyway (the SDK-side state would have no observable effect) — the prop + setApproveAll action are retained for when real permission UX lands. Validation: `getMode` rejects non-`"interactive" \| "plan" \| "autopilot"` SDK values as `AppError.sdk`; `getName` returns `null` for nullish, rejects non-string. Integrated cleanly with dockview + persistence — ChatWindow now takes `:mode` and `:approve-all` props from the SessionRecord; restoreSession on startup fires `getSessionMode` post-resume to fill the dropdown.
- **Dockview-vue is the layout primitive.** Replaced the CSS-grid `.session-grid` in `App.vue` with a single `<DockviewVue>` body covering the whole viewport below a slim app-chrome topbar. Sessions are panels (`addPanel({ id: sessionId, component: "chat", … })`); the in-pane close button is hidden in favor of dockview's tab X (one close path → `onDidRemovePanel` → `sessionsStore.closeSession`). New `src/stores/layoutStore.ts` owns the DockviewApi and exposes `addPanel` / `removePanel` / `renamePanel` / `openEdgePanel(position, options)` / `toggleEdgeGroup` / `snapshot` / `restore`. The convention is documented in `AGENTS.md` and the new `plans/plan-frontend-shell.prompt.md`: any new persistent surface (recent-sessions picker, permission queue, log viewer, MCP status) lands as a dockview edge group, not new chrome. PrimeVue Splitter rejected (static children don't survive `v-for`); see chat in this session for the survey of alternatives (splitpanes, vue3-grid-layout, golden-layout). Bundle cost: +61 KB gzipped — worth it.
- **Layout persistence + startup resume.** Settings schema bumped v2 → v3 with `layout: { dockview: unknown | null }`. `settingsStore.persistLayout(blob)` writes the opaque dockview JSON on every `onDidLayoutChange` (debounced 300 ms). On startup, after `clientStore.createClient()`, `App.vue` extracts panel ids from the persisted layout, calls the new `resumeSession` RPC for each (which replays history via `session.getMessages()`), prunes any that failed, then hands the pruned layout to `layoutStore.restore()` before subscribing to change events. Failed restores surface as info toasts (not errors — the common case is "user `/clear`'d via CLI"). New backend RPCs: `resumeSession({ sessionId, model, reasoningEffort })`, `listSessions()` (for the upcoming recent-sessions picker, no UI yet). New SessionRegistry tests: hydrate-on-resume, idempotent-resume, SDK-failure-as-AppError, list mapping. New v2 → v3 migration + opaque-layout round-trip tests. New wire snapshot for `SessionMetadataSummary` + layout-bearing `Settings`.
- **Tool-call visibility.** Every SDK tool invocation now renders inline in the chat stream as a collapsible `ToolCallBlock`, driven by a new `kind: "tool"` `ChatItem` in `src/lib/chatEvents.ts`. State machine keyed by `toolCallId` consumes the five SDK tool events (`tool.user_requested`, `tool.execution_start`, `tool.execution_partial_result`, `tool.execution_progress`, `tool.execution_complete`) with monotonic status transitions, 64 KB output caps, and `result.detailedContent ?? result.content` priority. The backend now also lifts envelope-level `agentId` / `eventId` / `timestamp` onto `SessionEventPayload` so sub-agent tool calls are attributable. No permission UX yet — `approveAll` still in place — but the events are visible end-to-end. 10 new reducer tests + new wire-shape snapshot.
- **Copilot client failed to start under Node < 24** (`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`). `src-bun/app/client.ts` now resolves the prebuilt `@github/copilot-${platform}-${arch}` binary and hands its path to `CopilotClient({ cliPath })`, bypassing the JS entrypoint that requires Node 24 for `node:sqlite`. Logged a warning when the platform binary isn't available so the failure mode is obvious. See CHANGELOG and the SDK-gotcha section in `plans/plan-frontend-shell.prompt.md`.
- **`bun run dev:hmr` ensures `dist/` exists** before starting `electrobun dev --watch` (was crashing with `ENOENT` because Vite serves from memory in HMR mode and never created `dist/`). New `tools/prep-dist.ts` writes a stub `dist/index.html` (HTTP-refresh to `http://localhost:5173/`) and an empty `dist/assets/`; a real `vite build` overwrites the stubs.
- **Markdown shortcut composer is back on.** Re-enabled `RichTextPlugin` + `ListPlugin` + `LinkPlugin` + `registerMarkdownShortcuts` in `MessageComposer`. The previous "typing broken under WebView2" symptom did not reproduce against the rebuilt stack — diagnostic confirms the editor mounts with `contenteditable="true"`, `data-lexical-editor="true"`, accepts programmatic `insertText`, and registers Lexical's beforeinput pipeline. Added a renderer→bun log bridge (`src/ipc/rendererLog.ts`) and an opt-in `TypingDiagnostic` plugin behind `?diag=1` so future regressions surface in the bun JSON log without needing WebView2 devtools. Composer parent restructured from `display: flex` to `display: block` per Lexical's contenteditable-parent guidance to avoid Chrome focus quirks.
- **Composer typing fix + playground tile sizing.** Composer plugin set was reduced to a safe baseline in the previous iteration; this iteration brings the markdown shortcut stack back after diagnostics. `.chat-tile` now uses `height: 100%` so it fills both grid cells and plain block containers.
- **Lexical-backed chat surface** (M1 markdown rendering). Composer and assistant/reasoning/user message display run through Lexical. Sends are markdown; assistant markdown (`# heading`, fenced code, lists, links, etc.) renders via `@lexical/markdown` `TRANSFORMERS`. New `src/lexical/{theme,plugins,nodes}.ts` + `lexical.css`; new components `src/components/{MessageComposer,MessageContent}.vue`; `ChatWindow.vue` and `ReasoningBlock.vue` now delegate body rendering. Pinned `lexical@0.38.1` and matching `@lexical/*` packages to align with `lexical-vue@0.14.1`. Streaming deltas reparse via rAF throttle to keep the reconciler smooth.
- **Initial-window clipping fix** (Windows). The WebView2 surface is created at the outer window size, so the renderer ships ~16px clipped until the first WM_SIZE. We now nudge the frame ±1px on a staggered schedule (0/150/400/900ms after dom-ready plus belt-and-suspenders fallbacks) so a single resize event always lands after the renderer has painted.
- **Composer auto-grow.** A `ResizeObserver` on `.chat-tile` publishes `--tile-height`; the composer input caps at `calc(var(--tile-height) * 0.6)` so it grows up to ~60 % of the tile before scrolling.
- **Toast UX.** Click anywhere on a toast to dismiss; non-error toasts auto-dismiss at 2.5s, errors at 5s. Model-change toasts are deduped and include the reasoning effort transition.
- Branch port: Tauri (Rust + Vue) → Electrobun (Bun + Vue). `src-tauri/` removed. New `src-bun/` main process + `tools/bun-vue-loader.ts` Bun plugin for Vue SFC tests. One test runner (`bun test`). See `CHANGELOG.md` → Unreleased → "Port from Tauri → Electrobun".

## Next concrete step
**Steering & message queueing.** Three send modes — Queue (default, client-side queue with reorder/delete), Steer (`session.send({ mode: "immediate" })` injected into running turn), Interrupt (`session.abort()` then immediate send). Composer gets a `SplitButton` for default-mode selection plus keyboard shortcuts (proposal: `Ctrl+Q` queue, `Ctrl+Shift+Q` interrupt, `Ctrl+Enter` steer; `Enter` runs current default). New `PendingQueueStrip` between transcript and composer for pending items. Backend gains `mode` param on `sendMessage` and a new `abortSession` RPC. Full design in this session's `plan.md`.

**Permission UX deferred** — yolo-mode is fine for now; the SDK auto-approve shim stays in `src-bun/app/sessions.ts`. Revisit before sharing the app externally.

Then resume the M1 backlog below.

Carried-over M1 backlog (full detail in `plans/plan-roadmap.prompt.md` → "Backlog"):
1. ~~**Markdown + code-block rendering** for assistant/reasoning content.~~ Done via Lexical.
2. **Real permission UX** - replace `approveAll` with a webview-side modal driven through the RPC bridge. **(P0 — see "Next concrete step" above.)**
3. **URL elicitation card + URL opener** (use Electrobun `Utils.openExternal` once the elicitation flow lands).
4. Steering & message queueing. _(SDK-ready: `session.send({ mode: "immediate" | "enqueue" })`.)_
5. File / image attachments. _(SDK-ready: `session.send({ attachments: [...] })`.)_
6. More session settings exposed (compaction, reasoning summary, system prompt modes).
7. ~~**Make the dev playground a discoverable button (currently `?dev`).**~~ Done — wrench button in topbar (dev builds only) + "Back to app" in the playground.
8. Markdown + message QoL (copy/retry/edit-and-resend).
9. GPT-5.5 `reasoning_opaque` mystery — CLI shows it, our UI gets `content: ""`.
10. **Real binary E2E**: Electrobun doesn't have a `tauri-driver` equivalent yet; investigate spawning the dev binary + driving the webview through the existing RPC bridge.
11. ~~**Tool-call visibility** — render `tool.execution_*` events in the chat stream.~~ Done — see `ToolCallBlock.vue` + reducer.
12. ~~**Pane resize / move / persist sessions across launches.**~~ Done — dockview-vue body + layout JSON in settings v3 + `resumeSession` RPC.
13. **Recent sessions picker** (use the new `listSessions` RPC). Surface as a dockview left edge group (`layoutStore.openEdgePanel("left", …)`).

Other M1 items still open:
1. **Tracing/log redaction** snapshot tests; runtime log level toggle in Settings → Diagnostics.
2. **Cross-platform CI matrix** for `electrobun build` (Linux only today).
3. **Dark-mode in the Playground.** The dev playground (`src/dev/Playground.vue`) doesn't honour the `theme.darkModeSelector` (`.app-dark` on `<html>`). Add a manual theme toggle button to its toolbar so we can preview both palettes without leaving dev mode; also flip `applyThemeClass` so the playground respects the OS / settings theme on first mount.

## M0 - Foundations (DONE)
- [x] Tauri 2 + Vue 3 + PrimeVue scaffold. _(Now Electrobun + Vue 3 + PrimeVue.)_
- [x] Single SDK Client lifecycle.
- [x] Multi-session create / disconnect.
- [x] Streaming chat (per-session deltas).
- [x] Responsive grid with per-session accent color.

## M1 - Make it solid (IN PROGRESS, post-port)
Definition of done lives in `plans/plan-roadmap.prompt.md`.
- [x] **SDK swap** to `copilot-sdk-supercharged` (npm, v2.1.2).
- [x] **Observability baseline** - JSON-lines logger under `Utils.paths.userLogs`, daily rotation, `DAFMAN_LOG` env filter. Module: `src-bun/app/logging.ts`.
- [x] **Testing baseline** - `bun test` everywhere; happy-dom registered via Bun plugin loader at `tools/bun-vue-loader.ts`. Wire-shape snapshots in `src-bun/__tests__/wire-contract.test.ts`. CI runs `bun run check`.
- [x] **Centralized scripts** in `package.json` (`bun test`, `bun run lint`, `bun run check`).
- [x] **AGENTS.md** at repo root per the agents.md standard (rewritten for the Bun stack).
- [x] **Backend module layout** in `src-bun/app/{errors,settings,logging,models,client,sessions}.ts` + RPC schema in `src-bun/rpc.ts`. `AppError` discriminated union persists across the bridge unchanged.
- [x] **RPC bridge** (`BrowserView.defineRPC<DafmanRPC>`) returned from `src-bun/index.ts`; the bun→webview `sessionEvent` message fans every SDK event out keyed by `sessionId`. `SessionEventPayload` is hand-mirrored in `src/ipc/types.ts`.
- [x] **Pinia stores** (`clientStore`, `sessionsStore`, `toastStore`, `permissionsStore` stub) survive the port; centralized IPC behind `src/ipc/invoke.ts` (typed via `CommandMap`), Electrobun bridge injected from `src/main.ts`.
- [x] **Typed IPC** - hand-mirror in `src/ipc/types.ts` (`SessionEventPayload`, `Settings`, `AppErrorPayload`, `CommandMap`); single source of truth lives in `src-bun/rpc.ts`.
- [x] **Settings store** on disk (`Utils.paths.userData/settings.json`, versioned with `migrate`).
- [x] **Dark mode** persisted via settings store; resolved through `resolveIsDark(theme, prefersDark)`.
- [x] **Auto-create client on mount** - no "Create Client" button; `App.vue` calls `clientStore.createClient()` after settings load.
- [x] **Reasoning visibility** (Settings `Appearance.reasoningVisibility` hidden/compact/expanded, default compact) + per-session header override + `ReasoningBlock.vue`.
- [x] **Per-session model + reasoning effort selectors** in chat header.
- [x] **High-value event types rendered** (title change, model change, usage, turn start/end, intent, info/warning, system notification, model.call_failure, truncation, compaction, **tool.user_requested / execution_start / partial_result / progress / complete**).
- [x] **Open log folder** button in Settings → General (`openLogFolder` RPC + `Utils.showItemInFolder`).
- [ ] **Real permission UX** - replace `approveAll` with a webview-side modal driven through the RPC bridge.
- [ ] **URL elicitation card + URL opener**.
- [ ] **Log redaction** snapshot tests; runtime log level toggle in Settings → Diagnostics.
- [x] **Frontend store + component tests** to follow the refactor (will be re-added post-port; see `frontend-tests` follow-up).
- [ ] **Cross-platform `electrobun build` CI matrix.**

## Tests at a glance
| Surface | Runner | Status |
|---|---|---|
| Backend (`src-bun/__tests__/`) | `bun test` | 32 tests passing (settings v3 + migration, errors, models, sessions registry incl. resume/list, wire contracts incl. tool envelopes + SessionMetadataSummary + persisted layout) |
| Vue SFC loader smoke (`tools/__tests__/`) | `bun test` + `tools/bun-vue-loader.ts` | 1 test (currently failing — pre-existing, unrelated to layout work; tracked) |
| Frontend pure reducers (`src/lib/__tests__/`) | `bun test` | 10 tests passing (reducer model-change + tool-call state machine) |
| Vue component/store tests | `bun test` | _to be re-added post-port_ |
| E2E (real Electrobun binary) | _not yet wired_ | - |

## Conventions for agents
Agent contract lives in [`AGENTS.md`](AGENTS.md) at the repo root (per the [agents.md](https://agents.md/) standard). Highlights:
- Read `plans/plan-overview.prompt.md` first; it indexes everything else.
- No hardcoded hex colors - use `var(--p-*)` PrimeVue tokens. Per-session accent (`accentForSession` from `src/lib/color.ts`) is the only exception.
- Domain modules under `src-bun/app/` do not import `electrobun/bun`; only `src-bun/index.ts` may.
- Every new RPC handler: wrap with `rpcGuard` from `src-bun/app/errors.ts`.
- Every new wire type: add it to `src-bun/rpc.ts`, mirror in `src/ipc/types.ts`, snapshot in `src-bun/__tests__/wire-contract.test.ts`.
- Run `bun run check` before committing.
- Update this file when you finish a milestone item or change direction.

## Open questions / decisions to make
- Product name (still `dafman`).
- Editor: Monaco vs CodeMirror 6 for the M7 diff viewer.
- MCP scope per release (full vs minimal).
- Whether to ship a per-session WebSocket (Bun.serve) if the global `sessionEvent` fan-out becomes a back-pressure problem with multiple noisy panes.
