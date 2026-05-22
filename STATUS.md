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

**Active milestone:** **M2 — Messaging power-ups** (closing the tail).
Most of M1 + M2 shipped; remaining tail is the in-app log viewer, export
conversation, and the rough edges noted under "Observability tail" below.

---

## Next concrete steps

**2026-05-22:** wrote a full backlog audit covering every feature documented
across plans/ that's NOT in the current Phase plan — see
**[`plans/plan-backlog-audit.prompt.md`](plans/plan-backlog-audit.prompt.md)**.
14 major themes were missing from the phased ordering:

- Terminal integration (`Bun.spawn` PTY + xterm.js panes)
- App shell redesign (sidebar + status bar)
- Layout groups (workspace-of-pane-trees switcher)
- Server mode (dafman over the browser)
- Long jobs registry + Autopilot UI
- Composer toolbar (WYSIWYG + slash picker)
- Library panel (Skills + MCP + Instructions + Agents)
- M365 + Teams bot
- Desktop control / Bun shell / Browser-control tools
- Per-session settings as right-rail panel (user explicitly asked for it)

A fresh Phase 18–40 ordering is proposed in §C of the audit doc. Awaiting
user pick.

After the 2026-05-22 SDK + CLI audit (see
**[`plans/plan-sdk-audit.prompt.md`](plans/plan-sdk-audit.prompt.md)** —
exhaustive cross-reference of every `copilot-sdk-supercharged` RPC +
every `@github/copilot` 1.0.48 changelog entry against what we ship),
the ordering changed. Picked from the new Phase 18–23 ordering in the
audit doc.

**Most recently shipped (2026-05-22):** rebuilt the composer's `@file`
picker (and unified the paperclip path). New `FilePicker.vue` with
fuzzy + path-nav (`@/abs`, `@~/`, `@../`) modes, hidden / ignored
toggle, native "Browse…" escape hatch via new `pickAttachment` RPC.
Single-pick per popup. Directories attach as `directory` pills.

1. **Phase 18 — Skills library + MCP registry MVP** (~3 d).
   `rpc.skills.list/enable/disable/reload` + `rpc.mcp.config.*` +
   per-session `rpc.mcp.enable/disable/reload`. Settings panes for
   each. MCP OAuth status toast wired into the existing URL
   elicitation path.
2. **Phase 19 — Custom agents + tasks/fleet** (~3 d).
   `rpc.agent.*` picker; `rpc.tasks.*` panel; `rpc.fleet.start`
   runner.
3. **Phase 20 — Power UX** (~2 d). Tool allow/exclude UI +
   `rpc.tools.list`; plans panel via `rpc.plan.*`; usage dashboard +
   `rpc.account.getQuota`; fork session via `rpc.sessions.fork`.
4. **Phase 21 — Image generation + remembered permissions** (~2 d).
   Image gen un-deferred per audit §E — `responseFormat: "image"` +
   `assistant.image` event renderer. Settings → Remembered Permissions
   via `rpc.permissions.setApproveAll` / `resetSessionApprovals`.

Older candidates (Tier-2 E2E, metrics counters / histograms) stay in
the backlog but get displaced by the higher-ROI items the audit
surfaced.

---

## Audit snapshot (2026-05-21)

Authoritative map of what's in the code, grouped by area. DONE / PARTIAL /
TODO reflects current state against the M0–M7 ambitions in
`plans/plan-roadmap.prompt.md`.

### Foundations (M0–M1)

| Area | Status | Notes |
|---|---|---|
| Tauri → Electrobun port | DONE | `src-tauri/` deleted; one TS+Bun stack. |
| SDK pinned to `copilot-sdk-supercharged` | DONE | npm; prebuilt platform binary resolved in `src-bun/app/client.ts` to dodge the Node 24 floor. |
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

Total: **347 `bun test`** passing as of 2026-05-22; smoke green on both
prod and HMR.

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
