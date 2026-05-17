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
- **Markdown shortcut composer is back on.** Re-enabled `RichTextPlugin` + `ListPlugin` + `LinkPlugin` + `registerMarkdownShortcuts` in `MessageComposer`. The previous "typing broken under WebView2" symptom did not reproduce against the rebuilt stack — diagnostic confirms the editor mounts with `contenteditable="true"`, `data-lexical-editor="true"`, accepts programmatic `insertText`, and registers Lexical's beforeinput pipeline. Added a renderer→bun log bridge (`src/ipc/rendererLog.ts`) and an opt-in `TypingDiagnostic` plugin behind `?diag=1` so future regressions surface in the bun JSON log without needing WebView2 devtools. Composer parent restructured from `display: flex` to `display: block` per Lexical's contenteditable-parent guidance to avoid Chrome focus quirks.
- **Composer typing fix + playground tile sizing.** Composer plugin set was reduced to a safe baseline in the previous iteration; this iteration brings the markdown shortcut stack back after diagnostics. `.chat-tile` now uses `height: 100%` so it fills both grid cells and plain block containers.
- **Lexical-backed chat surface** (M1 markdown rendering). Composer and assistant/reasoning/user message display run through Lexical. Sends are markdown; assistant markdown (`# heading`, fenced code, lists, links, etc.) renders via `@lexical/markdown` `TRANSFORMERS`. New `src/lexical/{theme,plugins,nodes}.ts` + `lexical.css`; new components `src/components/{MessageComposer,MessageContent}.vue`; `ChatWindow.vue` and `ReasoningBlock.vue` now delegate body rendering. Pinned `lexical@0.38.1` and matching `@lexical/*` packages to align with `lexical-vue@0.14.1`. Streaming deltas reparse via rAF throttle to keep the reconciler smooth.
- **Initial-window clipping fix** (Windows). The WebView2 surface is created at the outer window size, so the renderer ships ~16px clipped until the first WM_SIZE. We now nudge the frame ±1px on a staggered schedule (0/150/400/900ms after dom-ready plus belt-and-suspenders fallbacks) so a single resize event always lands after the renderer has painted.
- **Composer auto-grow.** A `ResizeObserver` on `.chat-tile` publishes `--tile-height`; the composer input caps at `calc(var(--tile-height) * 0.6)` so it grows up to ~60 % of the tile before scrolling.
- **Toast UX.** Click anywhere on a toast to dismiss; non-error toasts auto-dismiss at 2.5s, errors at 5s. Model-change toasts are deduped and include the reasoning effort transition.
- Branch port: Tauri (Rust + Vue) → Electrobun (Bun + Vue). `src-tauri/` removed. New `src-bun/` main process + `tools/bun-vue-loader.ts` Bun plugin for Vue SFC tests. One test runner (`bun test`). See `CHANGELOG.md` → Unreleased → "Port from Tauri → Electrobun".
- **Per-session options popover** (M1 "More session settings"). Chat header now has a gear button that opens a `Popover` with run mode, reasoning view, auto-approve permissions toggle, rename, compact-history, reset-approvals. Backend RPCs `getSessionMode`/`setSessionMode`/`getSessionName`/`setSessionName`/`compactSessionHistory`/`setSessionApproveAll`/`resetSessionApprovals` wrap `session.rpc.{mode,name,history,permissions}.*`; store reacts to `session.mode_changed`.

## Next concrete step
**End-to-end smoke run.** Launch `bun run dev`, verify a real `copilot` CLI session streams replies through the new `sessionEvent` RPC fan-out, that Settings + Open log folder still work, and that the dev playground (`?dev`) still renders, and that the new Lexical composer/display behave under real traffic (markdown shortcuts, streamed code blocks, very long messages). Then resume the M1 backlog below.

Carried-over M1 backlog (full detail in `plans/plan-roadmap.prompt.md` → "Backlog"):
1. ~~**Markdown + code-block rendering** for assistant/reasoning content.~~ Done via Lexical.
2. **Real permission UX** - replace `approveAll` with a webview-side modal driven through the RPC bridge.
3. **URL elicitation card + URL opener** (use Electrobun `Utils.openExternal` once the elicitation flow lands).
4. Steering & message queueing.
5. File / image attachments.
6. More session settings exposed (compaction, reasoning summary, system prompt modes). *Partially done in this PR — gear-menu popover exposes run mode, reasoning view, auto-approve, reset approvals, compact-history, rename. System-prompt-mode override still pending.*
7. **Make the dev playground a discoverable button (currently `?dev`).** Done — wrench button in topbar (dev builds only) + "Back to app" in the playground.
8. Markdown + message QoL (copy/retry/edit-and-resend).
9. GPT-5.5 `reasoning_opaque` mystery — CLI shows it, our UI gets `content: ""`.
10. **Real binary E2E**: Electrobun doesn't have a `tauri-driver` equivalent yet; investigate spawning the dev binary + driving the webview through the existing RPC bridge.

Other M1 items still open:
1. **Tracing/log redaction** snapshot tests; runtime log level toggle in Settings → Diagnostics.
2. **Cross-platform CI matrix** for `electrobun build` (Linux only today).

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
- [x] **High-value event types rendered** (title change, model change, usage, turn start/end, intent, info/warning, system notification, model.call_failure, truncation, compaction).
- [x] **Open log folder** button in Settings → General (`openLogFolder` RPC + `Utils.showItemInFolder`).
- [ ] **Real permission UX** - replace `approveAll` with a webview-side modal driven through the RPC bridge.
- [ ] **URL elicitation card + URL opener**.
- [ ] **Log redaction** snapshot tests; runtime log level toggle in Settings → Diagnostics.
- [x] **Frontend store + component tests** to follow the refactor (will be re-added post-port; see `frontend-tests` follow-up).
- [ ] **Cross-platform `electrobun build` CI matrix.**

## Tests at a glance
| Surface | Runner | Status |
|---|---|---|
| Backend (`src-bun/__tests__/`) | `bun test` | 22 tests passing (settings, errors, models, sessions registry, wire contracts) |
| Vue SFC loader smoke (`tools/__tests__/`) | `bun test` + `tools/bun-vue-loader.ts` | 1 test passing |
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
