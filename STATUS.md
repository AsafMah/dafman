# Dafman — Status

> Live progress board. Updated whenever a milestone item ships or direction
> changes. Move items between sections; **never silently delete history**.
>
> See [`DEVLOG.md`](DEVLOG.md) for the session-by-session running log,
> [`CHANGELOG.md`](CHANGELOG.md) for release notes,
> [`ARCHITECTURE.md`](ARCHITECTURE.md) for the live architecture snapshot,
> [`MANUAL_TESTS.md`](MANUAL_TESTS.md) for the manual-test backlog
> (per-feature checklists the user runs to sign off),
> [`plans/plan-backlog-audit.prompt.md`](plans/plan-backlog-audit.prompt.md)
> for the comprehensive feature gap list across all plans/,
> and [`plans/plan-roadmap.prompt.md`](plans/plan-roadmap.prompt.md) for the
> definition-of-done per milestone.

**Active milestone:** **Post-M2 audit burn-down**.
M1 + M2 shipped (including in-app log viewer, export conversation,
permissions tab, tools allowlist, MCP OAuth toast). Current work is
the audit's Phase 23 local slice: Copilot CLI mode parity, the
2026-05-22 UI problem sweep, and first-pass Long Jobs + Autopilot UI. The
three-way mode toggle now has native plan/autopilot lifecycle handling,
`/plan <prompt>` bootstrap behavior, exit-plan approval UI, autopilot
unavailable-user semantics, polished composer/details/library surfaces
from `problems.md`, and a global Jobs panel with current-session
Autopilot launcher. The local check gate also now includes a Bun-side
entry reachability dry-run so dead `src-bun/index.ts` imports fail in
`bun run check`. Terminal integration is in progress with Bun native PTY
(`Bun.spawn(..., { terminal })`) on Electrobun's bundled Bun 1.3.14
runtime, xterm.js dockview panels, terminal pane commands, and responsive
composer/sidebar polish from the terminal regression sweep. Terminal panels
now load the requested xterm addon foundation (search, links, clipboard,
Unicode, web fonts, progress, ligatures, images, WebGL, serialization).
The ActivityBar now has a Terminals panel for listing, opening, killing,
and creating terminals with command/args/cwd, plus display/addon settings.
The first shell-integration slice emits/parses OSC 633/133/7/9/1337 markers
for PowerShell/cmd so terminals can track CWD, active commands, exit codes,
and nonce-backed trusted command lines without reviving PTY output scraping.
Terminal header actions now use visible labels instead of icon-only controls,
Buffer/Paste header buttons are gone, selected-text copy has keyboard
shortcuts, and terminal Find enables xterm search decorations, focuses the
search field, and reports match state.
The first `!!` composer command-mode slice now runs bounded session-cwd
subprocesses for persisted command-result records, audits command metadata
without output bytes, and renders/copies command output without ANSI escape
garbage. The visible composer flow for `!!` now opens the real session terminal
inside the composer so autocomplete/shortcuts work. The composer exposes
separate Command and Terminal buttons; the full terminal has a Session button to
return to the owning chat; duplicate full terminal panels are closed while the
embedded terminal is active; completed terminal commands auto-add a
command-result pill by default.
The current UI audit pass also removes hard CSS edge-panel floors and
adds compact responsive states across panels, popovers, tool rows, jobs,
logs, pending requests, and message actions.

---

## Next concrete steps

**2026-05-25:** Phase 22 complete (MCP OAuth toast + Permissions tab
+ Tools tri-state allowlist). See DEVLOG for receipts. Image
generation **stays deferred** per the user's earlier "skip until
used" call — we will not pursue it speculatively.

Picking from the audit's unshipped phases (`plans/plan-backlog-audit.prompt.md` §C):

1. **Long jobs registry + Autopilot UI follow-up** (audit P23, remaining).
   First pass shipped: global Jobs panel, SDK task aggregation,
   promote/cancel/remove actions, detach-on-active-job close, and
   current-session Autopilot launcher. Remaining follow-ups: persisted
   job history across restart, optional git cleanliness checks,
   richer completion diff summaries, and commit/PR handoff.
2. **Library tab consolidation follow-up** (audit P21, remaining).
   Initial slice shipped: Instructions tab + `/library ...` command
   wiring + SDK `CommandDefinition` registration. Remaining optional
   work: unified Library item grid, in-app instruction editor (must be
   permissioned), or deeper SDK hook features (`onUserPromptSubmitted`,
   `onSessionStart`) once there is a concrete use case.
3. **App shell redesign — sidebar + status bar** (audit P22, ~2 d).
   Replaces the topbar-only chrome with a left activity bar + bottom
   status bar; affects every screen so it's a larger structural lift.
4. **Terminal integration follow-up** (audit P24, remaining). First
   pass adds Bun native PTY registry/RPC, xterm dockview panels, and
   command palette actions. Electrobun is pinned
   to bundle Bun 1.3.14 because 1.3.13 rejects Windows `terminal`.
   Terminal addon foundation, the ActivityBar terminal manager, terminal
   settings, and the first Windows shell-integration parser/emitter are now
   wired. Remaining follow-ups: richer profile CRUD, bash/zsh/fish shell
   integration, buffer persistence UX, the return of session-bound terminal
   affordances inside session/editor surfaces, agent terminal tool, inline
   terminal blocks, shortcut design, and optional Ghostty Web renderer spike.
5. **Composer toolbar + steering/queueing** (audit P25, ~2 d). WYSIWYG
   surface for the composer.

Older candidates (Tier-2 E2E, metrics counters / histograms) stay in
the backlog but get displaced by the higher-ROI items the audit
surfaced.

Explicitly **out of scope**:
- Image generation (deferred per user; un-defer requires explicit ask).

---

## Audit snapshot (2026-05-21)

Authoritative map of what's in the code, grouped by area. DONE / PARTIAL /
TODO reflects current state against the M0–M7 ambitions in
`plans/plan-roadmap.prompt.md`.

### Foundations (M0–M1)

| Area | Status | Notes |
|---|---|---|
| Tauri → Electrobun port | DONE | `src-tauri/` deleted; one TS+Bun stack. |
| SDK pinned to bundled Copilot JSON-RPC SDK | DONE | `src-bun/app/copilotSdk.ts` centralises the bundled SDK import; prebuilt platform binary resolved in `src-bun/app/client.ts` to dodge the Node 24 floor. |
| Single Client lifecycle | DONE | `clientStore` + bun `client.ts`. |
| Multi-session create / resume / disconnect / delete | DONE | `SessionRegistry`; layout-driven resume on startup. |
| Streaming chat | DONE | rAF-coalesced; reducer in `src/lib/chatEvents.ts`. |
| Per-session accent color | DONE | `accentForIndex`. |
| Pinia stores | DONE | 11 stores. |
| Settings store on disk + migration | DONE | Versioned (current: **v8**). |
| Dark mode | DONE | PrimeVue tokens; `.app-dark` selector; auto-flips dockview chrome + code blocks. |
| Boot splash + phased startup | DONE | `bootStore` + `BootSplash.vue`. |
| Reasoning visibility (hidden / compact / expanded) | DONE | Global setting + per-session override; opaque-reasoning placeholder for GPT-5.x / Claude. |
| Per-session model + reasoning effort picker | DONE | `SessionHeaderControls.vue`. |
| Tool-call visibility | DONE | `ToolCallBlock.vue` + per-tool renderers + language map; 64 KB output cap. |
| Real permission UX | DONE | `PendingRequestCard.vue` + `PermissionRuleEditor.vue` with per-kind rule shapes (commands / read / write / mcp / mcp-sampling / memory / custom-tool / url-domain). |
| URL elicitation card + `openUrl` RPC | DONE | http(s) allowlist. |
| Layout persistence + startup resume | DONE | dockview JSON in settings; debounced 300 ms. |
| Workspace MRU + native folder picker | DONE | Settings v3 → v4 migration; `pickFolder` RPC. |
| Sessions Manager edge panel | DONE | resume / delete; grouped by workspace. |
| Command palette (Cmd/Ctrl+K) | DONE | `vue-command-palette`; live `visibleCommands` predicate. |
| Notifications (turn-end + waiting input) | DONE | Browser Notification API; gated by settings + pane focus. |
| Markdown rendering | DONE | markdown-it + Prism + DOMPurify + KaTeX; footnotes / deflists / emoji / task lists / safe HTML subset. |
| Mermaid diagrams (opt-in, lazy) | DONE | `MermaidBlock.vue`; Settings → Appearance toggle. |
| File / image attachments (composer) | DONE | Inline `AttachmentNode` (DecoratorNode); icon by type; click-to-open; round-trip in user-message bubbles. |
| `@file` / `@folder` picker | DONE | `FilePicker.vue` + `MentionPlugin.vue` + `searchWorkspaceFiles` RPC. Fuzzy + path-nav (`@/abs`, `@~/`, `@../`); hidden / ignored toggle; native Browse via `pickAttachment` RPC. Single-pick; dirs attach as `directory` pills. Same popup also opens via the paperclip button. |
| Slash commands (local) | DONE | `SlashCommandPlugin.vue` + `lib/sessionCommands.ts` for `/cd`. |
| Steering / queue / interrupt sends | DONE | `Ctrl+Enter` / `Alt+Enter` / `Ctrl+Shift+Enter` + SplitButton; per-session `defaultSendMode`. |
| Message actions (copy / quote / retry / edit / fork) | DONE | `MessageActions.vue`. |
| Per-session gear popover | DONE | Name, mode, reasoning view, workspace, skills toggle, usage metrics, compact, reset. |
| Bounded `record.events` ring buffer | DONE | 5000-cap; consumers track absolute progress. |
| Reasoning on `assistant.message` (CLI wire) | DONE | Reducer harvests `reasoningText` / `reasoningOpaque` / `encryptedContent` into a synthesised reasoning ChatItem. |
| Brand favicon + activity-bar mark | DONE | `public/dafman.svg`. |
| Dev playground (`?dev` / wrench) | DONE | Synthetic event harness; dark-mode preview toggle. |
| Playwright renderer smoke (prod + HMR) | DONE | `bun run smoke`. |

### Observability tail (M1, open → CLOSING)

| Item | Status | Notes |
|---|---|---|
| JSON-lines logger + daily rotation | DONE | `src-bun/app/logging.ts`; `DAFMAN_LOG` env filter. |
| Log redaction (token / prompt / attachment shape-only) | DONE | `src-bun/app/redact.ts`; 12 snapshot tests pin per-rule behavior; sensitive keys → `***`, content keys → `{len, prefix}`. |
| In-app log viewer | DONE | `LogViewer.vue` edge panel (activity-bar bottom rail); live tail via `logEvent` webview message; level + display + search filters; pause-on-scroll auto-detect. |
| Runtime log-level toggle | DONE | `setLogLevel` RPC; in the LogViewer panel header ("Active level" dropdown). |
| Diagnostics bundle export | DONE | `exportDiagnostics` RPC → `<userData>/dafman-diagnostics-YYYY-MM-DD-HHMM/` with logs + redacted recent.json + settings + README; reveals in OS file explorer. |
| Bench harness (`bench_event_dispatch`, …) | TODO | None wired. |
| Metrics counters / histograms exposed in Settings | TODO | M2 definition-of-done item. |

### Cross-platform CI (DONE)

| Item | Status | Notes |
|---|---|---|
| Tier-1 gate (Linux) | DONE | lint + bun test + vite build + Playwright smoke. |
| Tier-2 `electrobun build` matrix | DONE | Ubuntu + macOS + Windows runners; `continue-on-error: true` for now — flip to required once green for a week. |

### M2 tail (open)

| Item | Status | Notes |
|---|---|---|
| Export conversation | DONE | Per-session gear popover → "Export Markdown" / "Export JSON". Renderer builds the document via `formatConversation`; bun-side `saveExportFile` writes under `<userData>/exports/` with basename-only sanitisation; auto-reveals in OS file explorer. |
| Image generation (response_format = image) | TODO | SDK supports; UI doesn't surface it. |

### M3 — Tools & permissions

| Item | Status | Notes |
|---|---|---|
| Permission UX with rule editor | DONE | (Cross-link to M1.) |
| Permission audit log | DONE | `<userData>/audit/permissions.jsonl` + `urls.jsonl`. Append-only JSONL; live tail visible in Diagnostics → Activity tab. Records permission decision + permissionKind + summary + approval scope; URL audits record allow/block + reason. |
| URL policy editor | TODO | Today: allowlist regex baked in; no rule UI. |
| Built-in tool registry (fs / shell / http) | TODO | We rely entirely on the SDK's built-ins; no Dafman-native tools. |
| Per-session tool allow/exclude list | TODO | SDK supports `availableTools` / `excludedTools`; UI doesn't expose. |
| Diff viewer for `fs.edit` / `apply_patch` | TODO | M7-coded item but valuable earlier. |

### M4 — Projects, accounts, resumability

| Item | Status | Notes |
|---|---|---|
| Resume sessions across restart | DONE | Layout-driven. |
| Workspace path per session (cwd) | DONE | MRU + native picker. |
| Sessions list / Sessions Manager panel | DONE | (Supersedes "Recent sessions sidebar".) |
| Project picker / Project model | TODO | We have workspaces; no Project entity with overlay settings yet. |
| Per-project settings overlay | TODO | (Depends on Project model.) |
| Multi-account auth | TODO | One account; no OS-keyring integration; no per-session pin. |
| Idle timeout configurable per session | TODO | SDK supports. |
| `SessionFsProvider` impl writing under `<app-data>` | TODO | Today the SDK uses its own default location. |

### M5 — Integrations: skills, MCP, agents

| Item | Status | Notes |
|---|---|---|
| Skills enable/disable per session | DONE | Gear popover; SDK `rpc.skills.*`. |
| Skill library (CRUD + scope) | TODO | No library UI; only the SDK-discovered list. |
| Slash command UI (composer typeahead) | DONE | `SlashCommandPlugin.vue`. Wired to local commands; SDK `CommandDefinition` not yet surfaced. |
| MCP server registry UI | TODO | No install / start / stop UI; no per-server settings; SDK `rpc.mcp.*` exists. |
| MCP OAuth via URL flow | PARTIAL | URL elicitation path handles ad-hoc URL prompts; MCP-specific toast not built. |
| Agents / fleets UI | TODO | SDK `rpc.fleet.*` + `rpc.agent.*` exist; no UI. |
| Custom system message transforms | TODO | SDK supports `customize` mode; no editor. |
| Plans API surface | TODO | SDK `rpc.plan.*`; no rendering. |
| Memory backend | TODO | M5+. |

### M6 — Automations & notifications

| Item | Status | Notes |
|---|---|---|
| OS notifications + per-channel toggles | DONE | turn-end + waiting-input. (Cross-link to M1.) |
| Scheduled prompts (cron) | TODO | None. |
| File / time / manual / webhook triggers | TODO | None. |
| Activity feed (Settings → Activity) | TODO | None. |
| Quiet hours / batching / digest | TODO | None. |

### M7 — Editor & power UX

| Item | Status | Notes |
|---|---|---|
| Code blocks via CodeMirror 6 | DONE | `CodeEditor.vue`. |
| Markdown rendering (read-only) | DONE | (Cross-link.) |
| Monaco file viewer / editor | TODO | We use CodeMirror; user may prefer Monaco for diffs. |
| Diff viewer for fs.edit / write results | TODO | (Reuse `@codemirror/merge` available.) |
| Inline accept/reject hunks | TODO | None. |
| Workspace search panel (cross-session) | TODO | None. |
| Headless `browser.*` tool | TODO | None. |
| `self.*` tool surface | TODO | None. |
| Plugin / theme system | TODO | (Future.) |

### Cross-cutting

| Item | Status | Notes |
|---|---|---|
| A11y review pass | TODO | Components have aria-labels but no axe-core integration. |
| Perf benches | TODO | None. |
| Telemetry (OTel) opt-in | TODO | Settings field reserved; not wired. |
| End-user docs site | TODO | None. |
| Tier-2 E2E (Playwright + bun + fake SDK) | DONE | `bun run e2e` — 6 baseline flows over real chromium + real bun subprocess + mocked Copilot SDK + real temp-fs. Covers create+send, @-picker (happy / `@.` / path-nav), toggle persistence, permission flow with audit assertion. Architecture in [`plans/plan-e2e.prompt.md`](plans/plan-e2e.prompt.md). Runs on ubuntu-latest in CI. **Layout-restore + settings round-trip flows still TODO** — second pass. |
| Cross-platform CI matrix | DONE | electrobun build runs on Ubuntu + macOS + Windows (continue-on-error initially). |

---

## Re-organised phases (replaces M-numbered roadmap going forward)

The old M1–M7 milestones in `plans/plan-roadmap.prompt.md` are kept as
historical reference. Going forward we organise by **Phase** — coherent
chunks scoped to a single PR-ish unit of work, each with rough effort
estimates (1 d = ~1 working day of focused engineering).

### Phase 1 — Close M1's observability tail (~2 d) — DONE
- In-app log viewer (tail + filter + search). ✅
- Runtime log-level toggle (Active-level dropdown in the panel). ✅
- Diagnostics bundle export (logs + redacted recent + settings + README). ✅
- Log redaction snapshot tests (12 cases). ✅

### Phase 2 — Cross-platform CI + Tier-2 E2E (~2 d)
- CI matrix: Windows + macOS + Ubuntu jobs for `electrobun build`. ✅ (continue-on-error)
- Playwright CDP harness against the real Electrobun binary. ⏳ TODO

### Phase 3 — M2 closing (~2 d)
- Export conversation (Markdown + JSON). ✅
- Image generation (response_format = image) end-to-end. ⏳ TODO
- Metrics counters + histograms exposed in Settings → Diagnostics
  (depends on Phase 1's renderer plumbing). ⏳ TODO

### Phase 4 — Tools & policies (~4 d)
- Per-session tool allow/exclude UI in the gear popover (mirrors the
  existing skills section; wired to SDK `availableTools`/`excludedTools`).
- URL policy editor (Settings → URL Policy).
- Permission + URL audit log (`<userData>/audit/*.jsonl`) with Activity
  view. ✅

### Phase 5 — Projects + multi-account (~5 d)
- Project model + folder-picker promotion to "Open Project".
- Per-project settings overlay (model, system prompt, tool allow-list,
  MCP overlay, default account).
- Project sidebar in the Activity Bar; project chip in the chat header.
- Multi-account auth: Accounts UI + OS-keyring storage + per-session pin
  via OAuth (uses the existing URL elicitation path).

### Phase 6 — MCP UI (~5 d)
- MCP registry: install / start / stop / per-server settings.
- stdio vs HTTP config split.
- MCP OAuth toast (top-right) with status-update on `mcp_status_changed`.
- Per-project MCP overlay.
- Tools list grouped by source (built-in / MCP server / custom).

### Phase 7 — Skills library + agents (~4 d)
- Skill library UI: list / create / edit / delete + dry-run.
- `/skill <name>` invocation via the composer slash typeahead (already wired
  to local commands; extend to SDK skills).
- Agents / fleets: per-session agent picker (SDK `rpc.agent.*`) + sub-agent
  pane.
- Custom system message transforms toggle list.

### Phase 8 — Plans + Memory + self.* (~3 d)
- Plans API rendering (collapsible panel inside the pane).
- Memory backend (SQLite-vec or LanceDB) + `memory.*` tools.
- `self.*` tool surface (open file, switch project, run skill) — gated
  through the existing permission flow.

### Phase 9 — Automations (~5 d)
- Scheduler (cron-like) + manual triggers.
- File-change trigger.
- Activity feed (Settings → Activity).
- Quiet hours + batching + summary digest.
- Optional: webhook trigger.

### Phase 10 — Editor power-ups (M7) (~5 d)
- Diff viewer for `apply_patch` results (CodeMirror 6 `@codemirror/merge`).
- Inline accept/reject hunks.
- Workspace search panel (cross-session).
- Optional: Monaco evaluation if CodeMirror diff UX falls short.

### Phase 11 — Browser tool + telemetry + docs (~5 d)
- Headless browser tool (evaluate `mcp-server-playwright` vs embedded
  BrowserView; pick one).
- OTel telemetry opt-in (Settings → Privacy).
- End-user docs site (mdbook / vitepress).
- A11y pass with axe-core integration.
- Perf benches (`bench_event_dispatch`, render perf budgets in Playwright).

---

## Tests at a glance

| Surface | Runner | Count |
|---|---|---|
| Bun-side domain modules | `bun test` | ~50 |
| IPC wire-shape snapshots | `bun test` (`toMatchSnapshot`) | 23 snapshots |
| Pure renderer reducers / helpers | `bun test` | ~120 |
| Vue SFCs + Lexical custom nodes | `bun test` + `tools/bun-vue-loader.ts` | ~110 |
| Renderer boot smoke (Playwright + chromium) | `bun run smoke` | 2 (prod + HMR) |
| Real binary E2E | not yet wired | 0 |

Total: **487 `bun test`** passing as of 2026-05-22; **70/70 smoke**
green across prod + HMR.

---

## Conventions for agents

See [`AGENTS.md`](AGENTS.md). Highlights:
- Required reading on every session: `STATUS.md` → `DEVLOG.md` →
  `ARCHITECTURE.md` → the relevant `plans/*.prompt.md`.
- Anti-laziness rules are binding, not aspirational.
- `bun run check` is the gate before any push.
- Update `STATUS.md` / `DEVLOG.md` / `CHANGELOG.md` per session.

---

## Open questions / decisions to make

- Project name (still `dafman`; no rename planned).
- Editor: CodeMirror vs Monaco for M7 diff (current preference: CodeMirror;
  re-evaluate during Phase 10).
- MCP scope per release (full vs minimal — bias to ship minimal first in
  Phase 6, expand based on usage).
- Telemetry endpoint default (OTLP HTTP vs gRPC — Phase 11).

---

## Historical log (last completed items, newest first)

Kept here so the next agent can quickly orient on what shipped recently
without grepping `DEVLOG.md`. One-liner per item.

- **2026-05-22** — Phase 23a shipped: **Library Instructions +
  command wiring**. Library panel now includes a read-only
  Instructions tab listing global Copilot-instruction candidates plus
  active-workspace project sources (`AGENTS.md`,
  `.github/copilot-instructions.md`, nested `AGENTS.md` with heavy
  dirs skipped). Existing files expand inline and can be revealed in
  the OS file manager. Added local `/library [mcp|skills|agents|instructions]`
  command without shadowing SDK `/mcp` or `/skills`, and registered a
  non-colliding SDK `CommandDefinition` named `library` in session
  config. Fixed the stale `08-audit-rehydrate` smoke spec by removing
  a dangling fake permission request. **487 bun tests** (was 482),
  **70/70 smoke**.

- **2026-05-25** — Phase 22b shipped: **Tools section grouped view
  + per-tool allowlist**. Rail Tools section now groups by source
  (built-in first, then namespace prefixes from `namespacedName`)
  and replaces the on/off toggle with a tri-state SelectButton
  (Default / Only allow / Forbid). Backed by mutually-exclusive
  `tools.defaultAllowed` (new) + `tools.defaultExcluded` (existing)
  lists. The SDK's `availableTools` takes precedence over
  `excludedTools` — rubber-duck flagged this, so when the allowlist
  is non-empty the rail shows a banner and the registry omits
  `excludedTools` from the SDK config. Empty allowlist intentionally
  OMITS `availableTools` (passing `[]` would tell the SDK to allow
  no tools at all). Canonical key is `namespacedName ?? name` so
  multi-MCP setups don't collide on tool name. Critical built-ins
  (bash, shell, str_replace_editor, write_file, create_file,
  edit_file) get a warning badge — not blocked. Settings schema
  bumped v10 → v11. **482 bun tests** (was 478), 68/70 smoke (the
  pre-existing 08-audit-rehydrate flake also fails on plain main).
  Phase 22 complete; closes out Phases 18, 20, 21 in the audit's
  roadmap labelling.

- **2026-05-25** — Phase 22c shipped: **Remembered Permissions
  Settings tab**. New "Permissions" section in the Settings panel
  with a single toggle: "Default to approve all for new sessions"
  (off by default — explicit user opt-in). When ON, brand-new
  sessions start with the per-session approve-all toggle on. The
  per-session rail toggle continues to drive runtime state; existing
  sessions are unaffected by changes to the default. Settings schema
  bumped v9 → v10 with `permissions.defaultApproveAll`; existing
  users migrate cleanly (default falls back to false). The SDK
  doesn't expose a list-approvals RPC, so this is the only knob we
  can meaningfully surface globally — "reset approvals" lives in
  the per-session right rail. **478 bun tests** (was 476), lint
  clean.

- **2026-05-25** — Phase 22a shipped: **MCP OAuth toast**.
  `mcp.oauth_required` and `mcp.oauth_completed` events were
  previously in `IGNORED_EVENTS` and silently dropped, leaving users
  with no feedback when an MCP server needed sign-in. Now wired into
  `sessionsStore.applyToRecord` (next to the existing model-change
  toast — toasts are side-effectful, not part of the pure reducer):
  required→info toast naming the server with a hint to use the
  Library panel; completed→success toast. De-duplicated by SDK
  `requestId` so resume / replay doesn't fire stale notifications and
  stray `_completed` events from other clients are ignored. Doesn't
  auto-open URLs (the SDK already drives elicitation; auto-launching
  browsers on background events would be hostile). 4 new tests in
  `sessionsStore.mcpOauth.test.ts`. **476 bun tests** (was 472), 68/70
  smoke (08-audit-rehydrate flake on plain main, unrelated).

- **2026-05-22** — Phase 19c shipped: **Fleet + nested sub-agent
  rendering**. `/fleet [prompt]` slash command starts a fleet via
  the @experimental `session.rpc.fleet.start` surface (no count
  parameter — SDK-internal). Chat reducer refactored for scoped
  dispatch: per-buffer indices, `subagent.started/.completed/.failed`
  handled inline to drive nested `SubagentChatItem` lifecycle.
  Visual events (assistant/reasoning/tool/system notification) with
  envelope `agentId` matching an active sub-agent are routed into
  its nested `items[]`; non-visual events stay top-level so sub-
  agents can't mutate session-level state. New `SubagentBlock.vue`
  renders a collapsible card with status pill + elapsed + nested
  items. Rubber-duck'd before implementing — all 7 findings adopted
  (per-buffer indices, no recursive `processEvents`, no
  `parentToolCallId` gate on `subagent.started`, explicit visual
  event filter, etc.). 10 new reducer tests + 2 new bun tests
  cover lifecycle, routing, toolCallId disambiguation, and
  post-completion stale routing. **472 bun tests** (was 460),
  68/70 smoke (08-audit-rehydrate flake on plain main, unrelated).
  **Phase 19 complete** (19a + 19b + 19c shipped in 4 commits
  spread across the day).
- **2026-05-22** — Phase 19b.2 shipped: **Library Agents tab**.
  Third tab in Library with create/delete CRUD for filesystem-backed
  custom agents. New `src-bun/app/agentFiles.ts` module with strict
  name validation, scope-path resolution, minimal YAML frontmatter
  writer, atomic write, refuse-overwrite. 4 new bun RPCs
  (`listAgentFiles`, `listAgentFilesGlobal`, `writeAgentFile`,
  `deleteAgentFile`). Create + delete only in v1 — Edit deferred
  until we have a parse-and-preserve round-trip (the SDK accepts
  unknown frontmatter keys our writer would silently strip).
  Includes a small fix to `e2e/full/flows/18-library-mcp.pwtest.ts`
  for a `text=github` strict-mode collision (the new tab's hint
  text mentions `.github/agents/`). 16 new unit tests including
  path-traversal name attempts. **460 bun tests** (was 444), 68/70
  smoke (08-audit-rehydrate flake on plain main, unrelated).
- **2026-05-22** — Phase 19b.1 shipped: **Background tasks rail
  section**. Observational view of agent-delegated tasks via the
  @experimental `session.rpc.tasks.*` surface. 3 new bun RPCs
  (`listTasks`, `cancelTask`, `removeTask`), filtered to
  `type === "agent"`. Per-row Cancel/Remove buttons, color-coded
  status pills, elapsed time. Auto-refresh on `subagent.started`/
  `.completed`/`.failed` + `session.background_tasks_changed` via
  a per-record `tasksRefreshCounter`. Sequence-guarded loader.
  Followed the 19b rubber-duck plan: split into 19b.1 (this) +
  19b.2 (Library CRUD). 5 new unit tests. **444 bun tests** (was
  439), 68/70 smoke (pre-existing flake).
- **2026-05-22** — Phase 19a shipped: **Custom agent picker**. New
  rail section in `SessionDetailsPanel.vue` lists agents the SDK
  auto-discovered (workspace `.github/agents/` + user config dir)
  via the @experimental `session.rpc.agent.*` surface. Header chip
  in `SessionHeaderControls.vue` surfaces the current selection;
  hidden when default. 5 new bun RPCs (`listAgents`,
  `getCurrentAgent`, `selectAgent`, `deselectAgent`, `reloadAgents`),
  all session-scoped methods on `SessionRegistry`. `subagent.selected`
  / `.deselected` events drive `record.currentAgent` reactively; the
  reducer filters out transient delegation events (those with
  `parentToolCallId`) so per-turn sub-agent delegation doesn't get
  confused with session-level selection (delegation rendering
  arrives in 19c). Rubber-duck'd before writing code; 7 findings
  adopted — notably (a) kept methods on `SessionRegistry` instead
  of a new class, (b) no optimistic UI on Select, (c) path-based
  Project/User source disambiguation. **439 bun tests (was 428),
  68/70 E2E** (08-audit-rehydrate flake unrelated to 19a, also
  fails on plain main).
- **2026-05-22** — Phase 21d shipped: **D2 + D3 dep bumps** (Lexical
  0.38 → 0.44 and Katex 0.16 → 0.17). Lexical bump required a
  `package.json` `overrides` block because lexical-vue@0.14.1
  hard-pins transitive `@lexical/*` to 0.38.1; overrides force the
  entire tree to 0.44 and lexical-vue's compiled JS uses lexical
  core APIs that are backwards-compat. Katex 0.17's only breaking
  change is the private `__defineFunction` API which we don't
  consume. Also picked up: (a) restored `ensureDefaultWorkspace`
  in `src-bun/app/settings.ts` (knip flagged it as unused in 20b
  but missed the consumer in `index.ts`, broke
  `electrobun dev --watch`); (b) fixed a long-standing z-index
  regression where the typeahead file/slash menus appeared behind
  dockview's left sidebar — `transform` creates a new stacking
  context so the inner `z-index` was confined; moved it to the
  context root. Manual smoke walked by the user. **428 bun tests,
  70/70 E2E, lint clean.** Phase 21 is now fully closed (24 of 24
  catalogued items addressed; only 4 explicitly deferred with
  rationale: T2, U4, U5, G1-G3).
- **2026-05-22** — **Phase 21 closed (5 commits, 21a+21b+21c)**.
  Tech-debt burn-down across `sessions.ts` and the renderer hot
  paths. 5 PRs, 17 of 24 catalogued items shipped. Deferred:
  Lexical 6-version bump + Katex major (D2/D3 — both require
  manual interactive smoke checklists), T2 (synthetic-event union
  type widen — line noise vs. safety win), U5 (queue
  reject-on-emit — rubber-duck confirmed current shape is correct
  for the SDK contract), G1-G3 (test coverage gaps — investment
  exceeds regression value for these specific surfaces).
  Outstanding items still tracked in
  `plans/plan-tech-debt.prompt.md`. Receipts: `650acfb` (21a.1)
  → `7b395ce` (21c cleanup). **428 bun tests, 70/70 E2E smoke,
  boot verified, lint clean across all 5 commits.**
- **2026-05-22** — Phase 21c shipped: **type / UX / perf nits**. 6
  small UX fixes + 6 type cleanups. U1: SessionDetailsPanel now
  splits global (`builtinTools`, `quota` — load once on mount)
  from per-session loaders (`skills`, `usage`, `mcp`, `plan` —
  re-fetch on chat-tab switch). U2: quota-warning toast Set no
  longer resets on session switch (was re-firing constantly). U3:
  `openSessionsByDefault` warns on retry exhaustion instead of
  silently bailing. U6: `cwdFor` re-checks the entry after each
  await to avoid a concurrent-writer stale overwrite. U7:
  `removePending` resolves the target requestId from the ambient
  queue up front, then removes by requestId from both lists (was
  scanning both independently by kind, could remove different
  entries). U8: `messageHandlers.ts` backwards `for` loop with
  early break instead of `[...items].reverse().find(...)` array
  copy (was running on every `user.message` including the full
  history replay). T3: de-exported 6 internal-only types. T1/T2:
  reviewed and deferred — casts are guarded. **428 bun tests,
  70/70 E2E.**
- **2026-05-22** — Phase 21b shipped: **SessionRegistry correctness
  pass**.Five lifecycle fixes in `src-bun/app/sessions.ts`: (S1)
  bounded `shutdownAll` with 2s per-session timeout + SIGTERM
  handler so a hung SDK can't deadlock app exit; (S2) `create()`
  early-event buffer so SDK events that fire during `createSession`
  await get forwarded under the resolved id, not the literal
  "pending" placeholder; (S3) `entries.delete` moved AFTER
  `await session.disconnect()` in all three teardown paths so
  concurrent RPCs see the entry as live during the disconnect
  window; (S4) was already in place post-21a.1; (S5) history-replay
  cap at last 500 events, batched 50 at a time via `queueMicrotask`
  yields, so resume of a long-lived session doesn't flood IPC or
  block the event loop. 4 new regression tests (S1 hang + S2 race +
  S5 cap, plus the existing teardown tests still pass). **428 bun
  tests, 70/70 E2E, boot verified.**
- **2026-05-22** — Phase 21a shipped: **architectural extractions out
  of `sessions.ts`**.Three rubber-duck'd extractions in three
  separate commits (650acfb / 83335c4 / now):
  - **21a.1** `PendingRequestQueue` (`src-bun/app/pendingRequests.ts`,
    ~200 LoC). The SDK callback queue (enqueue / cancel / settle for
    session / settleAll / respond) now lives behind a focused class.
    Constructor-injected `recordPermission` for testability. Added
    `removeEntry` helper in `SessionRegistry` that always calls
    `pending.settleForSession` BEFORE deleting the entry (sets up
    21b's S3/S4 ordering fixes). 12 new unit tests.
  - **21a.2** `McpRegistry` (`src-bun/app/mcpRegistry.ts`). The 7
    server-scoped MCP methods (`listConfigs`, `addConfig`,
    `updateConfig`, `removeConfig`, `enable`, `disable`, `discover`)
    moved out. Constructor-injected `getClient` + a private
    `withClient` helper that lets `ClientNotStarted` escape unwrapped
    while wrapping everything else as `AppError.sdk`. 10 new unit
    tests.
  - **21a.3** `SkillsRegistry` (`src-bun/app/skillsRegistry.ts`).
    `discover` + `setGloballyDisabled` mirror the McpRegistry shape.
    7 new unit tests.
  Session-scoped methods (3 MCP + 2 skills) remain on `SessionRegistry`
  because they need entries-Map lookup. `sessions.ts` shrank from
  1451 → ~1100 LoC; clearer module boundaries for 21b correctness
  work. **425 bun tests (was 397), 70/70 E2E.**
- **2026-05-22** — Phase 20c shipped: **code review + dep audit +
  tech-debt doc**. Three `code-review` subagents covered
  `src-bun/app/sessions.ts`, the `chatEvents` reducer family, and
  the renderer's largest files (`sessionsStore`, `App.vue`,
  `SessionDetailsPanel`). Fixed 4 surgical bugs: incomplete
  `respondToPending` rollback (event now appends after RPC
  success), stale-record race in `setSessionWorkingDirectory`,
  O(N²) `upsert*` in the chatEvents streaming hot path (now uses
  per-call Map indices for O(1) lookup), arch doc + tech-debt
  doc refresh. Bumped 9 safe npm minors (Vue 3.5.34, vite 6.4.2,
  TypeScript 5.9.3, etc.); deferred Lexical 6-version + Katex
  major. **397 bun tests, 70/70 E2E, boot verified.** Outstanding
  findings live in `plans/plan-tech-debt.prompt.md` (3
  architectural / 5 correctness / 3 type / 8 UX-perf nits / 3
  test gaps / 2 dep deferrals).
- **2026-05-22** — Phase 20b shipped: **dead code + dep sweep**. Used
  knip to enumerate unused exports / files / deps; manually
  verified each (knip has false positives on .vue files +
  side-effect-import scripts). Deleted: `permissionsStore.ts`
  (orphan placeholder), 7 dead-export functions (`getAuditDir`,
  `exportDisplayName`, `readBundleFile`, `ensureDefaultWorkspace`,
  `MarkdownSync`, `CodeHighlightPlugin`, `hashString +
  accentForSession`); de-exported 3 internal-only consts
  (`SESSION_DETAILS_PANEL_ID`, `APP_ERROR_PREFIX`, `sep`); dropped
  duplicate `basename` in sessionsListStore (imports from
  layoutStore now); removed 6 unused npm deps
  (`@codemirror/commands`, `@codemirror/language`, `@lexical/utils`,
  `codemirror`, `@types/dompurify`, `@types/katex`). Trimmed
  noisy `[boot]` tracing to a 4-line timeline. **396 tests, 70/70
  E2E, boot verified.**
- **2026-05-22** — Phase 20a shipped: **RPC error-sweep**. Triggered
  by the Electrobun bridge fix uncovering that every RPC error since
  the bun migration had been silently swallowed (renderer await
  hung). Audited every `invokeCommand` caller across stores +
  components (~70 sites); fixed 1 real bug (respondToPending
  rollback on RPC failure) + 5 best-effort sites
  (revealPath/openUrl/pickAttachment) that now propagate errors
  properly. **396 bun tests (+7), 70/70 E2E** — and the boot finally
  completes cleanly with the splash watchdog never firing.
- **2026-05-22** — Phase 19b shipped: **Skills tab** in the Library
  panel (already rendered in 19a) is now reachable from the right-
  rail's Skills section via a "Manage globally →" link. Click
  writes `dafman.library.activeTab=skills` to localStorage AND
  dispatches a `dafman:library-activate-tab` custom event so an
  already-mounted Library panel re-focuses the tab. Skills tab
  groups by source (builtin / project / personal-copilot), per-row
  toggle pushes the full disabled-list via
  `setGloballyDisabledSkills`, reveal-in-folder button when the
  skill has a `path`. **F19** covers grouped render + toggle
  persistence + Manage-globally link. **70/70 E2E, 386 bun tests.**
- **2026-05-22** — Phase 19a shipped: **Library panel** (left-edge
  activity-bar sidebar, pi-book icon) hosting two tabs. **MCP** tab
  (this commit) has a Configured + Discovered server list; per-row
  enable/disable toggle (writes the SDK global allowlist via
  `mcp.config.enable/disable`), Edit/Remove buttons, and an inline
  "Sign in" action on http servers with OAuth that calls
  `mcp.oauth.login` and opens the returned URL. Add dialog includes
  a structured form (transport switch, command/args/env or url/
  headers/oauth fields) with a **View as JSON** toggle that
  round-trips. 8 new bun RPCs + fakeClient stubs.
  **F18** covers open / add / round-trip. **64/64 E2E, 386 bun
  tests.** Verified by launching dafman dev + screenshots.
- **2026-05-22** — Phase 18b post-fix: details rail refactored to a
  **singleton** bound to `layoutStore.activeSessionId` (was per-session,
  caused N rails stacked at boot + rail not updating on session switch).
  `recomputeActiveSession` now preserves the last bound chat when a
  non-chat panel becomes active (rail/settings/playground), so the
  rail no longer blanks when its own tab gets focus. Sections are
  collapsible with localStorage persistence (Tools collapsed by
  default, others expanded). Long tool/skill descriptions truncate
  to one line with a "Show more" expander. Toggle switches stay
  inside the panel (flex-shrink + min-width fix). Legacy
  `session-details-${id}` panels in persisted layouts are stripped
  on restore. New E2E F20 covers singleton invariant + collapse
  persistence; new unit suite covers the activeSessionId fallback
  (`layoutStore.activeSessionId.test.ts`). 58/58 E2E, 372 bun tests.
- **2026-05-22** — Phase 18b shipped: Tools / Plan / Account quota
  sections added to the right-rail. Built-in tool checklist edits
  `settings.tools.defaultExcluded` (SDK has no runtime mutation, so
  changes apply on next session create with a "Restart to apply" toast).
  Plan section reads/writes `rpc.plan.*`. Quota dashboard polls
  `rpc.account.getQuota` and fires 75/90% warning toasts (CLI 1.0.32
  parity). 6 new bun RPCs + settings v9. E2E F15/F16/F17.
  **52/52 E2E green** in 72 s, 367 bun tests.
- **2026-05-22** — Phase 18a shipped: per-session settings moved from
  gear popover into a dockview right-edge panel
  (`SessionDetailsPanel.vue`). Auto-opens with each session; cog
  toggles. Adds Fork button. Layout state persists via dockview JSON
  (no settings bump). E2E F14 covers it. 22/22 E2E in 28s.
- **2026-05-22** — Bug bash #2 (every MANUAL_TESTS ❌ fixed +
  locked): SDK perm-rule matcher uses `:*` (commands rule now
  actually allows follow-ups); pickAttachment/pickFolder force
  absolute path; revealPath stats path so file vs folder uses the
  right explorer args; CI tier-2 dropped `needs: check` so it
  always runs; Playground gets 1k/10k stress buttons; 11 new
  E2E flows. **21/21 E2E green in 28 s** (was 10/16s). All ❌
  items in MANUAL_TESTS.md flipped to ✅.
- **2026-05-22** — Bug bash from MANUAL_TESTS.md backlog: cwd now
  persists across restart (user-flagged MASSIVE); audit JSONL
  re-hydrates into the ring on bun startup; revealPath uses
  `explorer /select,...` on Windows; native picker split into
  File…/Folder… (Windows can't do mixed); shell perm summary now
  shows the actual command; reasoning-hidden suppresses its action
  bar; read/write blanket-only is now documented as an SDK limit.
  **10/10 E2E green in 16 s** (added F6 cwd-persist, F7
  export-items, F8 audit-rehydrate, F9 dir-pill). 367 bun tests.
  Deferred: SDK perm-rule matcher behavior (separate investigation).
- **2026-05-22** — Real E2E tier shipped: `bun run e2e` spawns the
  bun test-server with mocked Copilot SDK + real temp-fs per test,
  drives chromium via the new `wsBridge`. **6 baseline flows green
  in 12 s wall** (create+send, @-picker happy / `@.` trigger /
  path-nav, toggle persistence across reload, permission with
  audit log assertion). CI integrated on ubuntu-latest. Covers the
  v1 file-picker bug class. Architecture in
  [`plans/plan-e2e.prompt.md`](plans/plan-e2e.prompt.md).
- **2026-05-22** — File picker rebuild: `FilePicker.vue` powers both
  the `@`-trigger and the paperclip button. Fuzzy mode + CLI-style
  path-nav (`@/abs`, `@~/foo`, `@../path`); Show hidden / ignored
  toggle; native "Browse…" escape hatch via new `pickAttachment`
  RPC; directories attach as `directory` pills. 18 new tests
  (11 fileSearch, 7 FilePicker).
- **2026-05-22** — SDK + CLI deep audit: `plans/plan-sdk-audit.prompt.md`
  cross-references every supercharged RPC (`createServerRpc` +
  `createSessionRpc`), every config knob on `SessionConfig`, every CLI
  changelog "added" entry (436 across 212 versions), against current
  STATUS. Surfaces ~20 wire-ready RPCs we don't expose (skills /
  MCP / agents / tasks / fleet / plan / usage / quota / tools list /
  shell exec / workspace files / session metadata / fork / history
  truncate); ~14 unset `baseSessionConfig` knobs (system message
  customize mode, custom provider/BYOK, `gitHubToken`, idle timeout,
  infinite-sessions thresholds, OTel telemetry, hooks); 12 CLI-shipped
  features we haven't surfaced (fork / rewind / undo / diff / usage
  contribution graph / `#issue` autocomplete / background-task
  notifications / research / init / review / delegate / cross-session
  memory). Re-orders next four sessions into Phases 18–21.
- **2026-05-22** — Permission + URL audit log: append-only JSONL under
  `<userData>/audit/` + live tail in Diagnostics → Activity tab.
  Records permission decisions + scope; URL audits cover the
  scheme-allowlist gate.
- **2026-05-22** — Export conversation: per-session gear popover →
  Export Markdown / JSON. `src/lib/exportConversation.ts` builds the
  document from `ChatItem[]`; bun-side `saveExportFile` writes under
  `<userData>/exports/`; auto-reveals.
- **2026-05-21** — Phase 1 done: in-app log viewer (`LogViewer.vue` edge
  panel) + live `logEvent` fan-out + `setLogLevel` runtime toggle +
  `exportDiagnostics` bundle (logs + redacted recent + settings + README)
  + 12 redaction snapshot tests + cross-platform CI matrix (Ubuntu /
  macOS / Windows continue-on-error).
- **2026-05-21** — Audit pass: ARCHITECTURE.md + DEVLOG.md added; AGENTS.md
  rewritten with anti-laziness rules; STATUS.md re-organised into Phases.
- **2026-05-21** — Session popover gains skills toggle list + usage
  metrics (`a0a3886`).
- **2026-05-21** — Permission rule editor (per-kind: commands / read /
  write / mcp / url-domain / …) (`b015d68`).
- **2026-05-21** — Reasoning harvested from `assistant.message`
  (`reasoningText` / `reasoningOpaque` / `encryptedContent`) — proper fix
  for the `reasoning_opaque` "empty bubble" regression (`0812f9a`).
- **2026-05-21** — Bounded `record.events` ring buffer; consumers track
  absolute progress; centralised `appendEvent` helper (`38d42ca`).
- **2026-05-21** — Quick-win backlog: playground dark toggle, lazy mermaid
  (Settings v7 → v8), dafman brand mark + favicon (`52a2956`).
- **2026-05-21** — Composer attachments survive into the sent message;
  transcript pills clickable; SDK-history attachment restore (`7df0254`).
- **2026-05-21** — `AttachmentNode` rebuilt as DecoratorNode (atomic,
  clickable, icon-by-type); fixed Lexical proxy crash on click (`0d271ca`).
- **2026-05-21** — Inline attachment pills in the composer; send button
  repositioned to editor row (`323a305`, `92f772b`, `8957ca9`, `66dabb1`).
- Prior session log retained in [`DEVLOG.md`](DEVLOG.md) and git history.
