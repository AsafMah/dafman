# Changelog
All notable changes to Dafman are documented here. Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org).

## [Unreleased]

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
  `/select,<dir>` opens the dir's *parent* — that was the
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
    `kind` flags.
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
  + 3 JSON + 3 filename + 3 bun-side tests pin the behaviour. Reuses
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

- **Command palette is now actually bounded + scrollable + not blurry.** Three round-three regressions, all from one CSS framing mistake.The library renders `<div command-theme> > <div command-root> > <div command-dialog> > <div command-dialog-mask> > <div command-dialog-wrapper> > {header + body}` — the actual dialog *box* is `[command-dialog-wrapper]`, NOT `[command-dialog=""]`. The previous CSS put `max-height` / `display: flex` / `border` / `background` on `[command-dialog=""]` which is an inert outer div, so the dialog ran off the bottom of the screen with no scroll. (1) Rules moved to `[command-dialog-wrapper]`. (2) Outer chrome (`[command-theme]`, `[command-root]`, `[command-dialog]`) flattened with `display: contents` so the mask's `position: fixed` establishes the stacking context cleanly. (3) `backdrop-filter: blur` removed entirely — it was the source of the "whole screen blurred" complaint; the mask's 35 % darken alone gives enough separation. (4) `[command-dialog-body]` is now `display: flex; flex-direction: column; min-height: 0` so `[command-list]` can scroll internally instead of pushing the wrapper past `max-height: 80vh`. New `CommandPalette.test.ts` regression: a CSS-source assertion that the bounding rules live on `[command-dialog-wrapper]` (not the inert outer), that the body has `min-height: 0` + flex column, and that the list has `overflow-y: auto` + `min-height: 0` — happy-dom doesn't process SFC `<style>` blocks so we assert on the source, which is exactly enough to pin THIS regression.

### Added

- **Reset Layout command.** `Ctrl/Cmd+K` → "Reset Layout" (Diagnostics group) closes every open panel (chat tabs, settings, dev playground, any sidebars) and re-opens the Sessions sidebar at its default 240 px width on the left. The persisted dockview JSON refreshes automatically via the existing `onDidLayoutChange` debounced writer. Sessions are disconnected (routes through `App.vue`'s `onDidRemovePanel` → `sessionsStore.closeSession`) but **not** deleted — they stay resumable from the Sessions Manager. Toast on completion shows how many sessions were closed. Backed by new `layoutStore.resetToDefault()`; 3 unit tests via a featureful fake `DockviewApi` covering: many panels closed and sidebar re-opened, no panels (first-launch idempotent reset), sidebar already open (re-creates cleanly in the existing edge group).

- **Color-coded categories + per-session accent on "Switch to" commands.** Each category (`Navigation`, `Sessions`, `Active Session`, `Appearance`, `Diagnostics`) gets a distinct hue (blue / emerald / violet / amber / orange) applied to the group heading, the icon, the row's left rail (idle-thin, selected-full), and the hover/selected backgrounds via a `--cmd-accent` custom property cascaded from `[data-group]` selectors. "Switch to: `<session title>`" commands now carry the session's per-pane `accent` color (matching the chat tile's left rail), overriding the category default via inline `style="--cmd-accent: ..."`. `accent?: string` added to the `Command` shape.

### Fixed

- **First session no longer opens in the sidebar / at a tiny width / without a tab bar.** `layoutStore.addPanel` had two iterations of a bug on the "no body group exists yet" cold path. First version called `dock.addGroup()` then added the panel with `direction: "right"` of the new (still empty) group, leaving a 50/50 split with a dead empty pane. The follow-up "fix" dropped the explicit position so dockview's *default* placement would handle it — but when only edge groups exist, dockview's default puts the panel **inside the active group**, i.e. the Sessions sidebar, which has its tab strip hidden by `.dv-edge-group .dv-tabs-and-actions-container { display: none }`, producing the "session opens at ~240 px, no tab bar, sometimes inside the sidebar" cluster the user reported. Correct fix: when we just created the body group ourselves, drop the panel `direction: "within"` it (not `"right"`). Tile-to-the-right behaviour for the "open a second session alongside an existing one" path is preserved; orphan replacement still uses `direction: "within"`. New `src/stores/__tests__/layoutStore.addPanel.test.ts` pins all four cases (empty dock / only edge group / body group exists / `targetGroupId` supplied) plus the no-op-on-duplicate-id path, against a minimal fake DockviewApi.

- **Self-review hardening pass — defensive guards + smaller perf wins.** (1) `SessionRegistry.forward` (`src-bun/app/sessions.ts`) now rejects non-plain-object `event.data` payloads (null / array / primitive) with a structured warn-log instead of silently coercing them to `{}`, where downstream reducers would have seen empty payloads instead of the real data. Regression-pinned in `sessions.test.ts`. (2) `ChatWindow`'s `ResizeObserver` for `--tile-height` is now rAF-coalesced (one CSS write per frame instead of one per resize tick) and cancels any pending frame on unmount. (3) Global `app.config.errorHandler` in `main.ts` routes Vue lifecycle errors through the existing `console.error` → `installRendererLogBridge` interceptor, so render/watch/setup throws surface in the bun JSON log with component name + info. Removed the redundant `rendererLog` call in `MessageComposer`'s `onError` (the console interceptor already mirrors). (4) Dropped the dead `_workingDirectory` param from `layoutStore.composePanelTitle` and its 3 call sites (`App.vue`, `SessionsManager.vue` × 2). (5) Extracted `fenced(content, language)` into `src/lib/markdown.ts` and made the outer fence length scale to `max(3, longestInnerRun + 1)` — tool output containing ``` no longer closes the block early. 6 new `markdown.test.ts` cases.

### Changed

- **Composer + tab strip alignment fix.** (1) Active `ChatTab`'s 4 px accent rail now sits flush at `x=0` so it lines up with `.chat-tile`'s 4 px left rail underneath (was offset by 2 px from `margin: 0 2px`). Inactive tabs compensate with 2 px of left padding so content x-position stays consistent. (2) `ModeButtonGroup` moved off its own `.composer-row` and into the new `#leading` slot on `MessageComposer`, so it shares the composer's `border-top` + padding + flex-row geometry instead of sitting in a separate row with `align-items: flex-end` (which "stuck it to the bottom"). Restyled to use the session accent: idle = 8 % accent tint; selected = full accent fill (mirrors the SubmitButton accent treatment). `align-self: flex-start` keeps the control short when the input grows multiline.

- **Steering, queueing, and interrupt — composer with explicit shortcuts and SDK mode passthrough.** Plain `Enter` is now reserved for Lexical's paragraph-break command so markdown block breaks reach the transcript (fixes "Shift+Enter gives a soft break, plain Enter sends, so I can't get a paragraph break"). Send actions are explicit modifier chords on Enter: `Ctrl+Enter` = send with the session default (Steer by default), `Ctrl+Shift+Enter` = interrupt + send (calls `abortSession` then `sendMessage`), `Alt+Enter` = force queue (`mode: "enqueue"`). The send button is a PrimeVue `SplitButton`: primary label/icon flips between Send/Steer and Queue per the session default; dropdown picks default + explicit "Send & interrupt". Composer no longer disables while a turn is in flight — queueing/steering mid-turn is the whole point. New backend RPCs: `sendMessage` accepts `mode?: "enqueue" | "immediate"`, new `abortSession` backed by `session.abort()`. `SessionRecord.defaultSendMode: "steer" | "queue"` (in-memory; v2 persists to settings). 4 new wire-contract snapshots. Phase-2 follow-ups (queue strip, wait-for-idle after abort, verified `mode: "immediate"` semantics) deferred.

- **Sessions Manager — left edge-group panel listing every CLI-side session.** New dockview edge panel (toolbar toggle, `pi pi-list`) lists sessions from `listSessions`, grouped by workspace (basename label, full path tooltip), most-recently-modified first, with a "No workspace" fallback bucket. Per-row: click to resume into a new chat panel (`restoreSession` + `addPanel`); delete via PrimeVue `ConfirmPopup` (danger-styled). An "open" badge marks sessions currently in a panel. Auto-refresh when in-app session count changes; manual refresh button in the header. New backend `deleteSession` RPC backed by `client.deleteSession` — disconnects in-app sessions first so the SDK can release its handle. New `sessionsListStore` caches the catalog. Layout helpers `isPanelOpen(id)` / `closePanel(id)` for toggle-style buttons. **Sessions panel opens by default on first launch** (user closes survive reloads — we only auto-open when the persisted layout didn't reference it). **Closing the panel tears down the parent edge group when empty**, so reopen always lands at the configured `initialSize: 280` instead of inheriting a residual collapsed strip.

- **Per-tool rendering — summaries + syntax highlighting.** New per-tool renderer registry (`src/lib/toolRenderers.ts`) maps each tool to a `summary(args, result)` one-liner plus `argsLanguage` / `resultLanguage` for code-block rendering. Built-in renderers + aliases: shell/bash/execute, read/write/edit/view, apply_patch (sniffs first file path from the diff body), grep, glob, fetch/web_fetch, todo_write. `read_file` / `view` / `write_file` infer result language from the file extension via a short ext→prism-id map. MCP-hosted tools fall through to JSON args + markdown result. `ToolCallBlock`'s collapsed header now leads with the renderer-supplied summary (`shell ls -la /tmp` instead of "shell · Running"); args / partial output / result blocks render through `MessageContent` wrapping fenced code (` ```{lang}\n...\n``` `) so they pick up prism highlighting through `@lexical/code`'s `registerCodeHighlighting`. 9 unit tests. **Known gap:** `@lexical/code` bundles a fixed subset of prism grammars (clike, js/ts, markup, markdown, c, css, objc, sql, powershell, python, rust, swift, java, cpp). Languages outside that set — bash, json, diff, yaml, toml, go, ruby, php, kotlin, csharp — currently render uncoloured. A side-effect import of `prismjs/components/*` was tried and reverted (crashed the renderer at startup); a proper fix will swap in Shiki or another highlighter as a follow-up.

- **Per-session workspace (cwd) — inline.** The topbar now hosts a PrimeVue `AutoComplete` (path input) + folder-picker button + "New Session" button, so creating a session in a different folder is a one-line flow with no modal. The chosen path is passed through `createSession` → SDK `SessionConfig.workingDirectory`; empty input falls back to the bun process cwd. Native picker via Electrobun `Utils.openFileDialog({ canChooseDirectory: true })`, exposed as `pickFolder` RPC. `SessionRecord.workingDirectory` is also lifted from the `session.start` event's `data.context.cwd`, so resumed sessions show the path the CLI remembers, and the chat-tab options popover (`SessionHeaderControls.vue`) displays it with an RTL-ellipsised tail. **MRU persisted across runs:** Settings schema bumped v3 → v4 with a new `workspaces: { recent: string[] }` field (cap 10, deduped, trimmed). Every successful create with a non-empty path bumps the entry to the head of the MRU via `settingsStore.recordWorkspaceUse`. The AutoComplete suggests from `settings.workspaces.recent` (focus-open + substring filter). Added migration tests v2 → v4 (empty MRU) and v3 → v4 (empty MRU); coercion drops non-strings, trims whitespace, dedupes, caps to the limit; wire snapshot regenerated.

### Changed

- **Reasoning card compacted into the header.** In compact-visibility mode the standalone `REASONING` label + below-the-line preview collapsed into a single clickable header row (muted + italic + ellipsised inline next to the chevron). The full "Reasoning" label is kept only in fully-expanded mode where there's no preview to act as a title. Entire header is keyboard-activatable (Enter / Space).

- **User vs assistant message bubbles are now visibly distinct.** User-message left rail uses `--p-text-muted-color`; assistant rail keeps the session accent. Per-session accent moved off user bubble backgrounds (it was conflating user content with the session-identity signal) and into the composer chrome: composer-shell border (50% accent mix idle, full accent + 1px ring on focus) and send-button (accent fill with hover/focus states). Falls back to PrimeVue primary token when no `--accent` is in scope (dev playground / unit tests).

- **Resumed sessions now render their transcript.** Bun-side replay of the SDK's `getMessages()` history fires through `webview.rpc.send.sessionEvent` *during* the `resumeSession` RPC handler. Those messages travel over the same channel as the RPC response and arrived at the renderer *before* the awaiting promise resolved, so `handleEvent` saw no matching `SessionRecord` and silently dropped every replayed event (transcript, `session.start`, model, title, …). `sessionsStore` now buffers events whose sessionId has no record yet in a module-level `pendingEvents: Map<sessionId, SessionEventPayload[]>` (capped at 5000/session); `createSession` and `restoreSession` drain through `applyToRecord` immediately after pushing the record so history shows up and `session.start` / `session.resume` metadata (workingDirectory, mode, title, …) lands on the record. `sessionsStore` also listens on both `session.start` and `session.resume` for the workingDirectory backfill.

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
  - **Stop pruning the layout JSON on failed resume.** Previously we dropped panel entries whose `resumeSession` RPC came back "Session not found" before handing the JSON to dockview's `fromJSON`; dockview however *still* created placeholder panels for the grid references, which then resolved to a blank "Session … not loaded" pane. We now keep the layout intact and surface a friendly recovery surface inside the orphan panel (see below).
  - **`ChatPanel.vue` orphan UI.** When no `SessionRecord` matches the panel id, the chat slot renders a centered "Session no longer available" surface with `pi-inbox` icon, the truncated session id, a primary "Start new session here" button (calls `sessionsStore.createSession()` then `layoutStore.replaceMissingPanel(orphanId, newId)` to drop the new session into the same group and close the orphan), and a secondary "Close tab" button. The orphan layout itself is preserved so the user's pane geometry survives a CLI-side delete.

- **dockview-vue prop-shape gotcha in `ChatPanel.vue`.** dockview-vue mounts panel components with `{ params, api, containerApi, tabLocation }` only on `init`; after any `update()` the renderer re-wraps everything into a single top-level `params` prop (so user params live at `props.params.params` and the panel api at `props.params.api`). Since the update fires before our component reads, `props.api` was undefined and `props.params.sessionId` was undefined — every restored panel rendered the orphan UI even though the session had resumed cleanly. The component now normalizes both shapes (`userParams = props.params.params ?? props.params`; `panelApi = props.api ?? props.params.api`). Documented in a stored memory + `ChatPanel.vue` header comment so future panel components don't trip the same wire.

### Changed

- **New sessions tile by default.** `layoutStore.addPanel(sessionId, opts?)` now drops new sessions as a *new group to the right* of the currently active group (`position: { referenceGroup: activeGroupId, direction: "right" }`), instead of stacking them as tabs in the active group. First panel (no active group yet) falls back to dockview's default placement. `addPanel` also gained a `targetGroupId` option so the orphan-replacement path can add the new session *inside* the orphan's group (`direction: "within"`).
- **Dockview chrome matches the app shell.** `src/style.css` now bridges dockview's `--dv-*` palette (group background, tab bar, active/inactive tab states, divider/separator/scrollbar/icon-hover colours) to PrimeVue's `--p-content-background` / `--p-surface-*` / `--p-text-color` / `--p-text-muted-color` / `--p-content-border-color` tokens for both `.dockview-theme-light` and `.dockview-theme-dark`, so the tab bar and panel background no longer clash with the topbar on either theme.

### Added

- **Per-session SDK options popover** (merged from PR #1). Gear button in the chat header opens a Popover with Run mode (interactive / plan / autopilot), Reasoning view override, Rename session, Compact history, and Reset approvals. Backend gains `getSessionMode` / `setSessionMode` / `getSessionName` / `setSessionName` / `compactSessionHistory` / `setSessionApproveAll` / `resetSessionApprovals` RPCs; `sessionsStore.SessionRecord` gains `mode` + `approveAll` fields (synced from `session.mode_changed`); `restoreSession` fires `getSessionMode` after resume so the dropdown reflects the right value on restored panes. The auto-approve toggle is deliberately omitted from the UI for now because the local `onPermissionRequest: approveAll` shim short-circuits every request (SDK-side toggle has no observable effect); the prop + action are retained so the row can be re-added once real permission UX lands. Validation on the backend: `getMode` rejects non-`"interactive" \| "plan" \| "autopilot"` SDK values as `AppError.sdk`; `getName` returns `null` for nullish, rejects non-string. Tests cover the proxying, unknown-id handling, and the validation branches.
- **Dockview-vue is the layout primitive.** The body of `App.vue` is a single `<DockviewVue>` covering the whole viewport below a slim app-chrome topbar. Sessions are panels (`layoutStore.addPanel({ id: sessionId, … })`); dockview's tab X is the only close path (the in-pane close button is hidden via a new `ChatWindow :hide-close` prop) → `onDidRemovePanel` → `sessionsStore.closeSession`. New `src/stores/layoutStore.ts` owns the DockviewApi and exposes `addPanel` / `removePanel` / `renamePanel` for chat panels, plus `openEdgePanel(position, options)` / `toggleEdgeGroup(position)` for future sidebars / status bars / log viewers. Resize, drag-to-reorder, drag-between-groups, drag-to-split, drag-to-tab, popout windows, edge groups — all free, all serializable. The convention is documented in `AGENTS.md` and `plans/plan-frontend-shell.prompt.md`: any new persistent UI surface goes in as a dockview panel/edge group, never as new chrome.
- **Layout persistence + startup resume.** Settings schema v2 → v3 with `layout: { dockview: unknown | null }` (opaque dockview JSON). `settingsStore.persistLayout(blob)` writes the snapshot on every `onDidLayoutChange` (debounced 300 ms). On startup, after `clientStore.createClient()`, `App.vue` extracts panel ids from the persisted layout (`Object.keys(layout.panels)`), calls the new `resumeSession` RPC for each one, prunes any that failed, then hands the pruned layout to `layoutStore.restore()` *before* subscribing to change events so the restore itself doesn't write back. Failed restores surface as info toasts (not errors — the common case is "user `/clear`'d the session via the CLI"). New backend RPCs: `resumeSession({ sessionId, model, reasoningEffort })` (hydrates history via `session.getMessages()` → forwards through the standard emit path so the reducer rebuilds the transcript) and `listSessions()` (returns `SessionMetadataSummary[]` for the upcoming recent-sessions picker — RPC ready, UI not yet wired).
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


