# Backlog audit — what's missing (2026-05-22)

> User asked: "figure out first where all the missing stuff is — terminal
> integration, automations, more tools and tons more". This doc walks every
> `plans/*.prompt.md` + the `plan-roadmap.prompt.md` Backlog section + the
> `plan-sdk-audit.prompt.md` findings and lists every feature/idea documented
> across the project that's NOT in the current STATUS.md Phase plan (Phases
> 1–11 + 18–24).
>
> Source-of-truth grep methodology: I read every plan doc end-to-end. Items
> are categorised by **theme**, not by which plan doc mentioned them, so the
> board reflects what we *want to do*, not where it's mentioned.

---

## What's currently in STATUS Phases 1–11 + 18–24

For reference, the explicitly-planned items (most of M1+M2 done; M3+M4
partial; M5+ unstarted):

- Phase 1 (DONE): observability tail
- Phase 2 (DONE except real-CLI tier of E2E): CI matrix + Tier-2 E2E
- Phase 3 (partial): export DONE; image-gen + metrics counters TODO
- Phase 4 (partial): audit log DONE; tool toggle UI + URL policy editor TODO
- Phase 5: Projects + multi-account
- Phase 6: MCP UI
- Phase 7: Skills library + agents
- Phase 8: Plans + Memory + self.*
- Phase 9: Automations
- Phase 10: Editor power-ups (diff viewer)
- Phase 11: Browser tool + telemetry + docs
- Phase 18–23 (from SDK audit): Skills+MCP MVP, Agents+tasks, Power UX, Image gen, Multi-account, Lifecycle
- Phase 24: Session workspace files surface

---

## A. Major themes NOT yet in the Phase list

### A1. Terminal integration

From `plan-roadmap.prompt.md` Backlog (lines 131):

> "Terminal integration — `Bun.shell` backend + per-session terminal pane.
> Two surfaces: (a) standalone Terminal panels added to dockview like chat
> panels; (b) a per-session terminal docked alongside each chat pane,
> sharing the session's `workingDirectory`. Backend: `Bun.shell` (or
> `Bun.spawn` with PTY when needed) wrapped behind a `TerminalRegistry`
> analogous to `SessionRegistry`. Frontend: xterm.js (default), investigate
> ghostty's web-embeddable build."

**Effort:** ~3 d.
**Cross-reference:** SDK already has `rpc.shell.exec/kill` (audit §A) for
shell calls; that's separate from a user-facing terminal pane.

### A2. App shell redesign — sidebar + status bar

From `plan-roadmap.prompt.md` Backlog (lines 133):

> "Promote the slim topbar to a full app-chrome layout: persistent left
> sidebar (collapsible, dockview-aware) hosting Sessions Manager / Library /
> Notifications-feed shortcuts, plus a status bar at the bottom for global
> state (active client, model in use, log level, in-flight automations,
> telemetry status)."

**Effort:** ~2–3 d.
**Companion to:** A1 Terminal (status bar shows active terminals too).

### A3. Groups — workspaces of layout state

From `plan-roadmap.prompt.md` Backlog (lines 135):

> "Each 'group' is a named, persistent layout snapshot (its own dockview
> JSON + its own resumed sessions). Switching groups swaps the whole pane
> tree. Manual create + dynamic mode (auto-create per workspace path).
> Persisted as `settings.layout.groups`."

**Effort:** ~2 d.
**Supersedes/merges:** the Projects model from M4 / Phase 5. Should be
designed together.

### A4. Server mode — Dafman over the browser

From `plan-roadmap.prompt.md` Backlog (lines 143):

> "Run bun headless + expose RPC over WebSocket. Vue app stays identical,
> only the IPC bridge swaps. Hard parts: auth, server-side path
> semantics, CSP, Electrobun-API shims, multi-user (out of v1)."

**Effort:** ~4 d for the v1 (single-user, bearer token).
**Note:** we already have `src/ipc/wsBridge.ts` from the E2E harness — half
the work is done.

### A5. Long jobs — tracking + observability

From `plan-roadmap.prompt.md` Backlog (lines 141):

> "Cross-cutting infra for any operation that outlives a single chat turn
> (autopilot run, multi-step tool call, MCP install, background script).
> New `JobsRegistry` keyed by `jobId`; status-bar pill with active-job
> count; Jobs edge-panel with progress + cancel."

**Effort:** ~2 d. Required infra for autopilot UI + automations.

### A6. Composer toolbar — WYSIWYG buttons

From `plan-roadmap.prompt.md` Backlog (lines 151):

> "Toggleable toolbar above the input: WYSIWYG buttons (bold / italic /
> strikethrough / inline code / link / list / quote / heading), explicit
> attachments + paperclip, image paste/drop, slash-command picker
> drop-down, emoji/mention (later)."

**Effort:** ~1 d.

### A7. Autopilot UI

From `plan-roadmap.prompt.md` Backlog (lines 129):

> "First-class 'Autopilot' mode beyond the existing `SessionMode ===
> 'autopilot'` flag: pre-run sanity checks (clean working tree? branch?),
> explicit goal entry, configurable iteration cap, progress timeline, halt
> button. Per-step audit log. On completion, show diff summary + offer to
> commit/PR."

**Effort:** ~2 d. Depends on A5 (Long jobs).

### A8. Skills/MCPs/Instructions library — single Library panel

From `plan-roadmap.prompt.md` Backlog (lines 125):

> "Single dockview edge-group panel ('Library') with tabs: Skills, MCP
> servers, Instructions, Custom agents. For each: view definition, enable
> / disable, edit (Monaco editor for prompt/config), delete. Stored under
> `<userData>/library/`."

**Effort:** ~3 d. Subsumes parts of Phase 6 (MCP UI), Phase 7 (Skills),
and the Custom agent picker in Phase 19.

### A9. M365 integration

From `plan-roadmap.prompt.md` Backlog (lines 147):

> "Surface M365 as a first-class data plane: WorkIQ, Graph, SharePoint,
> Outlook, Loop, Excel, Word, PowerPoint. Start as MCP servers; auth via
> the existing multi-account model but with MS Entra ID. Deeper-than-MCP:
> rich previews, 'current meeting' pinned context, drag-and-drop of M365
> links."

**Effort:** v1 via MCP servers — ~3 d (mostly wiring + Entra auth flow).
v2 deep previews — ~5+ d.

### A10. Teams bot

From `plan-roadmap.prompt.md` Backlog (lines 149):

> "Expose Dafman as a Teams chat bot. Personal-bot mode (depends on A4
> Server mode) or shared multi-tenant. Permission UX over Adaptive Cards."

**Effort:** ~4 d. Depends on A4 Server mode.

### A11. Tools — Desktop Control

From `plan-roadmap.prompt.md` Backlog (lines 137):

> "Capability for the agent to see and drive the host desktop: list
> windows, capture screenshots, move/click/type into other apps. MCP
> wrapper around `nut.js` / `robotjs` / `pyautogui`. Permission UX critical
> — deny-by-default + screenshot preview in every permission prompt."

**Effort:** ~3 d once permission UX supports image previews.

### A12. Tools — Bun shell / script runner

From `plan-roadmap.prompt.md` Backlog (lines 139):

> "Built-in tool that executes against `Bun.shell` / `Bun.$` — gives the
> agent Bun's batteries (glob, fetch, parsing, sqlite, ffi). Lets the
> agent prefer Bun one-liners over PowerShell on Windows."

**Effort:** ~1 d. Same permission gates as `shell.execute`.

### A13. Tools — Browser control

From `plan-roadmap.prompt.md` Backlog (lines 145):

> "Drive a real browser: navigate, click selectors, fill forms, extract
> DOM, screenshot. Two paths: (a) existing MCP server
> (`mcp-server-playwright`), (b) embedded BrowserView in dockview panel.
> Decision criteria: visible vs. headless; auth handoff; user wants to
> watch."

**Effort:** v1 via existing MCP server — ~1 d.

### A14. Per-session settings as a right-rail panel

From your message just now ("I think we should move the session settings
to a panel on the right"). Not yet documented anywhere.

**Effort:** ~1 d. Reuses the current `SessionHeaderControls` content — move
into a dockview right-edge panel + add a body slot per session.

---

## B. Smaller items individually below threshold but real

These each take an hour to a day. Pulled from various plan docs.

### B1. From `plan-roadmap.prompt.md` Backlog (lines 108–123)

- **Steering / message queueing** — queue messages while a turn is in
  flight, edit/reorder/cancel pending ones, "steer" inject into live turn.
  Maps to SDK `pending_messages.modified`.
- **Notifications — turn-end + waiting-input.** Mostly DONE; missing
  quiet hours range + sound on/off + per-trigger toggle UI.
- **GPT-5.5 `reasoning_opaque` decryption.** Open question; CLI displays
  reasoning we can't decode. One focused session.
- **Make the dev playground a button** — `?dev` is awkward to type. Hidden
  corner button shown only in DEV.
- **Active tools control from the menu** — covered by Phase 20 + a14.
- **Agents — discover, edit, select** — covered by Phase 19 + A8.

### B2. From `plan-messagingAndUx.prompt.md`

- **Inline session.ui rendering** — `confirm` / `select` / `input` cards in
  the chat thread (`session.ui.elicitation` is shipped per audit; the
  confirm/select/input variants are separate methods).
- **Image messages — embedded with zoom** (companion to image gen).
- **Time travel** — `session.snapshot_rewind` for rewinding to earlier
  events. Cross-references CLI's `/rewind` (audit §C).
- **Snapshots** — save current session as a Skill template (cross-references
  CLI's `/fork`).
- **Pin to Notes sidebar** — entirely new feature; deferred.
- **Notes sidebar** itself — deferred.
- **Per-session settings panel** content list (model + capability overrides;
  system prompt mode + sections; allow/exclude; reasoning visibility; mode;
  streaming; elicitation on/off; account pin; idle timeout). Many of these
  are already in the popover; A14 reorganises them.

### B3. From `plan-toolsAndPermissions.prompt.md`

- **`clipboard.read/write` tool** (M5 mark).
- **`notify.show` tool** (M6 mark — agent-initiated OS notifications).
- **`lsp.*` tools** (M7 — talk to language servers).
- **`task.*` tools** — project task list backed by JSON.
- **Sandboxing for `shell.exec`** (Job Object / sandbox-exec / bwrap).
- **`http.fetch` allow/deny host list.**
- **Policy presets** (Strict / Workshop / Trusted project / Demo).
- **Permissions Activity view** in Settings (we have audit JSONL; no
  Settings → Permissions UI).

### B4. From `plan-platformFeatures.prompt.md`

- **Slash commands** — `/skill /model /system /export /notes /help
  /account /abort`. The composer plugin exists; SDK CommandDefinition
  routing doesn't.
- **Per-project MCP overlay** (depends on Projects model).
- **Custom system message transforms** with toggle list (Phase 7).
- **Plans `Edit plan` Markdown editor** — covered by Phase 8.
- **Memory `query / write / list` tools + scope settings** (Phase 8).
- **Self-control surface** (open file in editor, switch project, run skill,
  show toast/dialog, create/update note) — Phase 8.
- **Per-project memory scope** + retention.

### B5. From `plan-sdkAndExternalSurfaces.prompt.md`

- **System prompt customize mode** with 10 named sections editor (identity,
  tone, tool_efficiency, environment_context, code_change_rules,
  guidelines, safety, tool_instructions, custom_instructions,
  last_instructions). Covered by Phase 7 (transforms) loosely.
- **Custom request headers per turn** in composer Advanced panel.
- **Model capabilities override** in Settings → Models.
- **Sub-agent streaming events toggle** (per-session or Settings).
- **MCP OAuth toast** with status-change update.

### B6. From `plan-observability.prompt.md`

- **OTel exporter (opt-in)** — Phase 11.
- **Per-MCP-server metrics**.
- **`tokio-console` feature flag** — N/A on bun (Rust legacy mention).
- **`bench_event_dispatch` / `bench_permission_eval` / `bench_url_policy_eval`
  / `bench_markdown_render`** — benches. Tracked as "Bench harness TODO"
  in STATUS.
- **Permissions Activity view in Settings**.

### B7. From `plan-sdk-audit.prompt.md` Section B (config knobs)

Still un-set on `baseSessionConfig`:
- `infiniteSessions.{backgroundCompactionThreshold, bufferExhaustionThreshold}`
- `sessionIdleTimeoutSeconds`
- `systemMessage` (covered by transforms feature)
- `provider` (BYOK / Azure / Ollama) — Phase 22
- `gitHubToken` per-session — Phase 22
- `includeSubAgentStreamingEvents`
- `streaming` (debug toggle)
- `disabledSkills`
- `mcpServers` / `skillDirectories` / `customAgents` explicit overrides
- `hooks.onUserPromptSubmitted` (inject project context)
- `hooks.onSessionStart` (telemetry)
- `telemetry` config — Phase 11
- `onGetTraceContext` (nest spans under CLI)
- `cliUrl` / `useStdio` — connect to existing CLI server
- `Symbol.asyncDispose` (cosmetic)

### B8. From `plan-sdk-audit.prompt.md` Section C (CLI features)

Worth wiring (skipping the TUI-only items):
- **`/fork` session** via `rpc.sessions.fork` — Phase 20.
- **`/rewind` + double-Esc timeline** via `rpc.history.truncate`.
- **`/undo` last turn + revert file changes**.
- **`/diff` session changes**.
- **`/usage` contribution graph** in Settings.
- **`/share html` self-contained HTML export** — companion to Markdown/JSON.
- **`#issue / #PR` autocomplete** in composer (extend MentionPlugin).
- **Background task notifications** when async tools complete.
- **`/research` deep research**.
- **`/init` instructions generator**.
- **`/review` code review**.
- **`/delegate` to Copilot coding agent**.
- **Cross-session memory** (experimental).
- **`/restart` hot restart preserving session**.
- **`/instructions` toggle picker**.
- **`/statusline` config** — companion to A2 status bar.
- **`/changelog` viewer**.
- **`/skill-name` direct invocation** in composer.
- **MCP sampling** (LLM-inference requests from MCP servers).
- **`gh` read-only auto-approve** baked permission rule pattern.
- **Theme picker with colorblind variants** — already partially shipped via
  dark mode; CLI shipped more variants.
- **Permanent permission rules per location** — `rpc.permissions.setApproveAll`
  + persistence across sessions.

### B9. From `plan-sdk-audit.prompt.md` Section D (truly new)

- **`rpc.commands.handlePendingCommand`** — agent emits a slash command we
  render natively.
- **MCP server instructions** injected into system message.
- **`subagentStart` hook** — inject context into sub-agent prompt.
- **`preCompact` hook**.
- **`agentStop` / `subagentStop` hooks**.
- **`PermissionRequest` hook** — programmatic approve/deny layer above the
  modal.
- **`postToolUseFailure` hook** — retry-with-different-args loop.
- **Tool search (Claude only)** — model dynamically discovers tools per
  turn. Documentation item.
- **HTTP hooks** — POST JSON to URL (powers webhook integrations without a
  scheduler).
- **OTel "GenAI" semantic conventions** — when telemetry lands.
- **Plugin hook env vars** (`PLUGIN_ROOT`, `COPILOT_PLUGIN_ROOT`).

### B10. Manual-test items deferred or still open

From `MANUAL_TESTS.md`:
- **Layout-restore E2E** (deferred to next pass).
- **Settings round-trip E2E**.
- **Log-viewer tail E2E**.
- **Diagnostics-bundle export E2E**.
- **A11y axe-core integration**.

---

## C. Proposed re-ordering

This is one possible ordering. Items chosen to bundle related work +
unlock dependencies + ship visible value early.

### Phase 18 — Power UX (small wins, ~2 d)
The user explicitly asked for this next. Includes:
- Per-session tool allow/exclude UI (B1 + audit §A).
- Plans panel via `rpc.plan.*` (Phase 8 partial).
- Usage dashboard + `rpc.account.getQuota` + warning thresholds (audit §A + §C).
- Fork session button via `rpc.sessions.fork` (B8).
- **Per-session settings as right-rail panel (A14).** Was originally
  bundled with the gear popover; user explicitly asked for the move.

### Phase 19 — Skills library + MCP registry MVP (~3 d)
Phase 18 from the original audit doc, just renumbered. Subsumes much
of A8 (Library panel) — start the Library panel here for skills + MCP,
add agents + instructions in Phase 21.

### Phase 20 — Custom agents + Background tasks / fleet (~3 d)
Audit Phase 19. Subsumes A8 (Library) tab for agents.

### Phase 21 — Library tab consolidation + slash commands (~2 d)
Add the Instructions + Custom agents tabs to A8; wire SDK
`CommandDefinition` slash commands (Phase 7 carryover + audit §A); SDK
hooks (`onUserPromptSubmitted`, `onSessionStart`) (audit §B).

**2026-05-22 status:** initial slice shipped. Library already had MCP,
Skills, and Agents tabs; added read-only Instructions tab (global +
project instruction sources), local `/library [tab]` command, and a
non-colliding SDK `CommandDefinition` named `library`. Remaining
optional work: unified item grid, permissioned instruction editor, and
concrete hook-backed features.

### Phase 22 — App shell redesign (sidebar + status bar) (~2 d)
A2. Makes Phases 18/19/20's panels feel native instead of bolted on. Also
hosts Jobs pill (A5).

### Phase 23 — Long jobs infra + Autopilot UI (~3 d)
A5 + A7. Required for visible autopilot AND for automations down the
line.

### Phase 24 — Terminal integration (~3 d)
A1. xterm.js + `Bun.spawn`/PTY + per-session terminal pane.

### Phase 25 — Composer toolbar + steering/queueing (~2 d)
A6 + B1.

### Phase 26 — Image generation + remembered permissions (~2 d)
Audit Phase 21. Image gen end-to-end + Settings → Remembered Permissions
via `setApproveAll` + `resetSessionApprovals` + persistence.

### Phase 27 — Multi-account + provider (BYOK) (~3 d)
Audit Phase 22.

### Phase 28 — Groups (workspaces of layout state) (~2 d)
A3. Designed together with Projects.

### Phase 29 — Projects + multi-project workflow (~3 d)
Original Phase 5. Re-spec'd to mesh with A3 Groups.

### Phase 30 — Plans + Memory + self.* tools (~3 d)
Original Phase 8.

### Phase 31 — Editor power-ups (diff viewer + accept/reject hunks) (~3 d)
Original Phase 10.

### Phase 32 — Server mode (~4 d)
A4. Unlocks Teams bot (A10).

### Phase 33 — Automations + scheduler + HTTP hooks (~5 d)
Original Phase 9 + audit's HTTP hooks (B9).

### Phase 34 — Notifications polish (~1 d)
Quiet hours range + sound on/off + per-trigger toggles. Companion to
Phase 33.

### Phase 35 — Tools: Bun shell + browser MCP (~2 d)
A12 + A13 (v1 via existing MCP server).

### Phase 36 — Telemetry + OTel + benches + docs site (~5 d)
Original Phase 11. Includes B6 + B9 (HTTP hooks already covered in 33).

### Phase 37 — M365 integration v1 (~3 d)
A9 via MCP servers.

### Phase 38 — Tools: Desktop Control + a11y review + UI polish (~3 d)
A11 + B6 (axe-core).

### Phase 39 — Teams bot (~4 d)
A10. Depends on Phase 32 (Server mode).

### Phase 40 — Plugin / theme system (later)
Original M7 backlog.

### Smaller items folded into "running" backlog (no dedicated phase)
- B1 (Notifications polish, etc.) bundled into Phase 34.
- B3 (clipboard, notify, lsp, task, sandbox, http allow-list) — file
  individually as 1-day tickets.
- B5 (custom request headers, model capabilities override, sub-agent
  streaming toggle) — surface in Phase 18.
- B6 (perf benches) — Phase 36.
- B7 (config knobs) — sprinkle into the relevant phase that needs the
  knob.
- B8 CLI alias commands (`/research`, `/init`, `/review`, `/delegate`,
  `/restart`, `/changelog`, etc.) — bundle as Phase 25's composer
  toolbar or a one-off CLI-feature-parity sprint.

---

## D. Critical open questions

1. **Projects vs. Groups (A3).** Same problem, different framings. Pick
   ONE before either Phase 28 or 29 starts.
2. **Library panel scope (A8).** Includes Skills + MCP + Instructions +
   Agents. Built tab-by-tab across Phases 19+20+21, OR as one bigger
   commit?
3. **Server mode v1 auth.** Bearer token vs. OAuth vs. localhost-only.
4. **Terminal: xterm.js vs ghostty embed.** Investigation needed.
5. **Browser tool: MCP server vs embedded BrowserView.** Investigation.
6. **Memory backend: SQLite-vec vs LanceDB.** Investigation.
7. **Desktop control library: nut.js vs robotjs vs pyautogui.**
   Investigation.

---

## E. Reading this doc

When you pick the next phase:
1. Open this doc + `plan-sdk-audit.prompt.md` (for SDK details).
2. Pick a Phase. If it has cross-references (e.g. Phase 21 depends on
   Library panel started in Phase 19), make sure the dependency is in
   place.
3. Spec-interview the user (AGENTS rule #9) before touching code.
4. Manual-test list (AGENTS rule #10) after.
5. Move the item out of this doc into the appropriate `plan-*.prompt.md`
   when shipped — keep this list lean.
