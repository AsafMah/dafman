# TODO — what Dafman doesn't ship yet

> One file. Every open feature, gap, and known piece of tech debt,
> organized by topic and ranked within each topic.
>
> When you ship something: move it from here to [`DONE.md`](DONE.md).
> When the design is unclear, open a short spec interview (per AGENTS.md
> rule 9) — *don't* spawn another plan file.
>
> Last refreshed 2026-05-27 (post Groups v3.1).

Legend:

- 🟦 partial — core shipped, sub-feature missing
- 🟨 started — design exists, scaffolding shipped, not user-visible
- ⬜ not started
- ⏳ blocked on upstream

---

## By User (unsorted intake)

> Inbox for raw user feedback. Anything actionable here should be
> sorted into the relevant section below in the next cleanup pass.
> Lines that have been sorted are deleted from this list.

_(Empty — 2026-05-27 pass sorted all 14 prior items into the canonical
sections. See §"User-reported bugs — sorted" below + §Messaging & UX +
§Skills/agents/automations for where each landed.)_

## Top of stack (recommended next sprints)

Ranked by **(frequency-of-mention) × (user-visible impact) × (clear scope)**:

**Immediate bug-sprint queue (continuation of the 2026-05-27 plan):**

0a. ⬜ **Sprint B — MCP UX repair** (~2.5 d) — OAuth popup login flow, Sign-in button, discovered toggle persistence, Remove UX. Highest-impact bug cluster left.
0b. ⬜ **Sprint C — `/skill <name>` runs the skill** (~1 d) — Mirror of Sprint A3's pattern.
0c. ⬜ **Sprint D — Jobs panel + bottom bar polish** (~1 d) — Spinner centering, Go-to-session scroll, bottom-bar resize regression.
0d. ⬜ **Sprint E — Light mode visual audit** (~1 d) — Plus instructions-markdown theme fix as a sibling.

**Feature backlog (top-of-stack after bug sprints clear):**

1. ⬜ **Configurable shortcut system** — user-flagged as the next priority after palette polish
2. ⬜ **GitHub `#` mentions + Issues/PRs/Gists Library tabs** (G1) — small, leverages existing `MentionPlugin`
3. ⬜ **Diff viewer: accept/reject hunks** — `ApplyPatchView.vue` is view-only today
4. ⬜ **Multi-account + BYOK** (OS-keyring) — internal demand
5. ⬜ **Projects model** — per-cwd settings overlay; unblocks per-session MCP overlay + per-project autopilot policy
6. ⬜ **Plans API rendering panel** — SDK `rpc.plan.*` exists; no panel
7. ⬜ **Memory backend** (SQLite-vec or LanceDB)
8. ⬜ **Automations + scheduler** + HTTP hooks
9. ⬜ **Cmd palette prefix syntax** (deferred from palette polish sprint)
10. ⬜ **Real-Electrobun (CDP) harness, Tier-4** — Hard (no CDP debug ports exposed by default); Tier-3 catches the v3 bug class so downranked.

---

## Shell & layout

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Real-Electrobun (Tier-4) CDP harness | ⬜ | ~3 d | Drive the actual built binary via CDP. Hard — webviews don't expose debug ports by default. Tier-3 extensions (flows 21–24) already cover the v3 restart-restore bug class. |
| 2 | Outer-fromJSON vs Vue unmount race | ⬜ | 0.5 d | Deferred from Groups v3 code review |
| 3 | Lazy-mount placeholder for unfocused groups | ⬜ | 1 d | Groups v3.1 (G4d) |
| 4 | Manual test pass on real data | ⬜ | user | Restore fix `c97b0a5` unblocks |
| 5 | Tiling / layout commands (split / stack / focus-by-direction) | 🟦 | 1 d | `view.newGroup` etc. landed v3; more keyboard tiling missing |
| 6 | Dockview upstream `#1305` + `#1306` | ⏳ | — | Awaiting upstream |
| 7 | Bottom bar resize regression + responsive mode selector on small sizes | ⬜ | 0.5 d | User-flagged 2026-05-27: "Bottom bar resizing is ruined again, probably because you brought the modes icon back, but not the small select version on small sizes". The composer-footer mode selector lost its narrow-mode form. Pairs with §"User-reported bugs — sorted" §12 (Sprint D). |

## Messaging & UX

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | `#issue / #PR / #gist` autocomplete trigger (parallel to `@file`) | ⬜ | 2 d | G1 / B8. Builds on `MentionPlugin.vue` |
| 2 | Library → Issues tab | ⬜ | 1 d | `gh` CLI adapter; G1 |
| 3 | Library → Pull Requests tab | ⬜ | 1 d | G1 |
| 4 | Library → Gists tab | ⬜ | 1 d | G1; pairs with `/share gist` |
| 5 | Diff viewer with accept/reject hunks | ⬜ | 3 d | `ApplyPatchView.vue` is view-only |
| 6 | Image messages embedded with zoom | ⬜ | 1 d | Companion to image gen |
| 7 | Inline `session.ui` rendering (confirm / select / input variants) | ⬜ | 2 d | `elicitation` variant ships today |
| 8 | `/share html` export | ⬜ | 1 d | We have Markdown + JSON |
| 9 | `/usage` contribution graph | 🟦 | 1 d | `getQuota` exposed; no graph |
| 10 | `/diff` session changes panel | ⬜ | 1 d | |
| 11 | Pin to Notes sidebar / Notes sidebar | ⬜ | — | Deferred |
| 12 | Theme picker (colorblind variants) | 🟦 | 1 d | Light/dark only today |
| 13 | Fix light mode (visual bugs / contrast / unstyled areas) | ⬜ | 1 d | User-flagged 2026-05-27. Dark is the default-tested path; light mode has not been audited recently. Also: instructions markdown doesn't render in dark mode either (so the markdown renderer respects neither). |
| 14 | Instructions markdown renderer respects theme tokens | ⬜ | 0.5 d | User-flagged 2026-05-27: "The instructions markdown doesn't support darkmode". Could be a `prose` / `prose-invert` Tailwind / PrimeVue token miss. Pairs with row 13 light-mode sweep. |
| 15 | Library Instructions: create + edit instruction files | ⬜ | 1 d | User-flagged 2026-05-27: "The instructions should support creating and editing". Today Library Instructions tab is read-only. Mirror the Agents tab's New + Edit + Delete shape. |
| 16 | Rich UI for sub-agent related tool calls (`task`, `read_agent`, `report_intent`, `powershell`, `ask_user` in-history view) | ⬜ | 2 d | User-flagged 2026-05-27: "Many tools don't have nice ui". Current `ToolCallBlock` falls back to generic args+output. Each named tool should get a per-renderer (like `apply_patch` / `fs.edit` already have). |
| 17 | Background tasks UI parity between in-session strip and Library | ⬜ | 1 d | User-flagged 2026-05-27: "Background tasks in sessions looks worse and is less useful than library". Reuse the same component or share rendering. |
| 18 | Collapsed menus use space to display something useful (preview / mini view / count badge) | ⬜ | 0.5 d | User-flagged 2026-05-27: "Collapsed menus, in general, should use the space to display something useful". |
| 19 | Sessions sometimes resume with `thinking…` stuck and never resolve | ⬜ | 1.5 d | User-flagged 2026-05-27: "Sessions may resume with the agent 'thinking…' and never get resolved". Probably an SDK event not replayed during resume → `isThinking` ref never clears. |
| 20 | Agent chip + selector in the bottom bar | ⬜ | 1 d | User-flagged 2026-05-27: "Probably need chip + selector for agent in the bottom bar". Companion to the A1 Library Select button. |

## Tools & permissions

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | URL policy editor UI | ⬜ | 1 d | Allowlist regex baked in today; no rule UI |
| 2 | Built-in Dafman tool registry (`fs.*` / `shell.*` / `http.*` / `clipboard.*` / `notify.*`) | ⬜ | 3 d | Rely entirely on SDK + MCP today |
| 3 | Permanent permission rules persisted | ⬜ | 1 d | `setApproveAll` not persisted |
| 4 | `gh` read-only auto-approve permission rule | ⬜ | 0.5 d | |
| 5 | Sandboxing for `shell.exec` | ⬜ | 2 d | Not started |
| 6 | `http.fetch` allow/deny host list | ⬜ | 1 d | Not started |
| 7 | Policy presets (Strict / Workshop / Trusted / Demo) | ⬜ | 1 d | |
| 8 | `clipboard.read/write` tool | ⬜ | 0.5 d | |
| 9 | `notify.show` tool | ⬜ | 0.5 d | |
| 10 | `lsp.*` tools | ⬜ | 3 d | |
| 11 | `task.*` tools | ⬜ | 2 d | |
| 12 | Headless `browser.*` tool | ⬜ | 3 d | |
| 13 | `self.*` tool surface (open file / switch project / run skill) | ⬜ | 2 d | |
| 14 | Desktop Control tools (A11) | ⬜ | — | |
| 15 | Bun shell / script-runner tools (A12) | ⬜ | — | |
| 16 | Browser-control tools (A13) | ⬜ | — | |

## SDK surface (wire-ready RPCs not yet wired)

| # | Item | Status | Effort | SDK call |
|---|---|---|---|---|
| 1 | Plans API rendering panel | ⬜ | 1 d | `rpc.plan.read/update/delete` |
| 2 | Background tasks / fleet panel | ⬜ | 3 d | `rpc.tasks.*`, `rpc.fleet.start` |
| 3 | Usage metrics dashboard (per-model / per-day rollup) | ⬜ | 1 d | `rpc.usage.getMetrics` |
| 4 | Account quota in Settings → Account | ⬜ | 0.5 d | `rpc.account.getQuota` |
| 5 | Skill library CRUD (create / edit / delete + dry-run) | ⬜ | 1 d | `rpc.skills.config.setDisabledSkills` |
| 6 | MCP server install flow | ⬜ | 1 d | `rpc.mcp.config.add/update/remove` |
| 7 | History truncate-to-message (pairs with `/rewind`) | 🟦 | 0.5 d | `rpc.history.truncate` |
| 8 | Extension list + enable/disable | ⬜ | 1 d | `rpc.extensions.*` |
| 9 | Plugin list (read-only) | ⬜ | 0.5 d | `rpc.plugins.list` |
| 10 | SDK-registered slash commands | ⬜ | 1 d | `commands` config + `rpc.commands.handlePendingCommand` |
| 11 | `session.auth.getStatus` chip + BYOK form | ⬜ | 2 d | G2 |
| 12 | Remote-session attach | ⬜ | 2 d | G3 / `sessions.connect` |
| 13 | Skill / agent search paths editor (`customAgents` / `skillDirectories`) | ⬜ | 0.5 d | config |
| 14 | Custom system message transforms | ⬜ | 1 d | SDK supports; no editor |
| 15 | MCP sampling (LLM requests from MCP servers) | ⬜ | — | SDK supports |
| 16 | MCP server instructions injected into system message | ⬜ | — | |

## SDK hooks (not yet wired)

| # | Hook | Status | Notes |
|---|---|---|---|
| 1 | `subagentStart` | ⬜ | |
| 2 | `subagentStop` | ⬜ | |
| 3 | `agentStop` | ⬜ | |
| 4 | `preCompact` | ⬜ | |
| 5 | `PermissionRequest` | ⬜ | |
| 6 | `postToolUseFailure` | ⬜ | |
| 7 | HTTP hooks (POST JSON to URL) | ⬜ | |
| 8 | Plugin hook env vars | ⬜ | |
| 9 | `rpc.commands.handlePendingCommand` (agent emits slash we render) | ⬜ | |

## Projects, accounts, persistence

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Project model + per-project settings overlay | ⬜ | 3 d | "Projects" concept; unblocks 2 + 3 + per-project autopilot policy |
| 2 | Multi-account auth (OS-keyring) | ⬜ | 3 d | One account today; no per-session pin |
| 3 | Per-session MCP overlay | ⬜ | — | Depends on project model |
| 4 | Per-project MCP overlay | ⬜ | — | Depends on project model |
| 5 | Idle timeout configurable per session | ⬜ | 0.5 d | SDK supports; no UI |
| 6 | `SessionFsProvider` writing under `<app-data>` | ⬜ | 1 d | SDK uses its own default location |
| 7 | Snapshots (`/fork` to skill) | ⬜ | 1 d | |
| 8 | Time travel (`/rewind`) + double-Esc timeline | ⬜ | 2 d | SDK `snapshot_rewind`; no UI |
| 9 | `/undo` last turn | ⬜ | 1 d | |
| 10 | `/restart` hot restart | ⬜ | 1 d | |
| 11 | Cross-session memory | ⬜ | — | M5+ |
| 12 | Memory backend (SQLite-vec or LanceDB) + `memory.query/write/list` tools | ⬜ | 5 d | |

## Skills, agents, automations

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | ~~`/agent <name>` actually selects the agent~~ | ✅ | — | Shipped 2026-05-27 (`a529ef5`). |
| 2 | Inline typeahead for `/agent <name>` | ⬜ | 1 d | Deferred from row 1. Composer slash menu lists agents when user types `/agent ` (trailing space). Needs custom Lexical typeahead beyond the single-token slash matcher. |
| 3 | `/skill <name>` actually runs the skill | ⬜ | 1 d | Today `/skill` / `/skills` just open Library. Route through `rpc.skills.list` then invoke. Pairs with row 7. |
| 4 | `/mcp <server>` subcommands | ⬜ | 1 d | Today `/mcp` just opens Library. Scope (`/mcp enable/disable/restart <server>` vs. drop the slash entirely) — decide in Sprint B spec interview. |
| 5 | ~~Library Agents `Select` / `Deselect` button~~ | ✅ | — | Shipped 2026-05-27 (`bca5704`). |
| 6 | ~~Library Agents `Edit` button~~ | ✅ | — | Shipped 2026-05-27 (`a529ef5`). Safe-subset edit + preserves unknown frontmatter (mcp-servers / github / plugin keys). |
| 7 | Skills as `/skill-name` slash typeahead | ⬜ | 1 d | Local-commands path exists; SDK skills not routed. |
| 8 | Agents / fleets full panel | 🟦 | 2 d | Picker + sub-agent block exist; no fleet panel. |
| 9 | Library Agents refresh button | ⬜ | 0.25 d | User-flagged 2026-05-27: "No refresh button on library agents". Today the tab loads on mount; if the user drops a file at the path, they have to switch tabs to re-trigger. |
| 10 | Library Agents shows project agents (`.github/agents/`) | ⬜ | 0.5 d | User-flagged 2026-05-27: "Library agents doesn't show project agents". The composable already filters by `activeSession?.id`; verify project files in `<workspace>/.github/agents/` are actually listed when a session has a `workingDirectory`. |
| 11 | MCP creator: pick user vs project scope | ⬜ | 0.5 d | User-flagged 2026-05-27: "MCP creator doesn't let you choose between user or project". `McpServerForm` has no scope picker; today everything writes to user config. Mirror the Agents form's Scope toggle. |
| 12 | Unify MCP creator UX with Agent creator (modal vs inline) | ⬜ | 0.5 d | User-flagged 2026-05-27: "MCP creator is a modal, but agent creator is inline". Pick one shape (inline preferred for consistency since Agents already has it). |
| 13 | Library replaces SessionDetailsPanel as the source of truth for per-session mcp/tools/skills/agents/instructions | ⬜ | 3 d | User-flagged 2026-05-27 as a design question, not a clear bug. "I think we should use the library to set mcp/tools/skills/agents/instructions things for the session, instead of duplicating it with the session settings (need to think about design)." Needs spec interview before implementation. Tagged as design-decision. |
| 14 | Scheduled prompts (cron) | ⬜ | 2 d | None today. |
| 15 | File / time / manual / webhook triggers | ⬜ | 3 d | |
| 16 | Activity feed (Settings → Activity) | ⬜ | 1 d | |
| 17 | Quiet hours / batching / digest | ⬜ | 1 d | Notifications polish. |
| 18 | Background task notifications | ⬜ | 0.5 d | |
| 19 | `/research`, `/init`, `/review`, `/delegate` | ⬜ | — | |

## Autopilot

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Pre-checks (lint / typecheck / test before-after) | ⬜ | 2 d | Mode toggle done (Phase 23b) |
| 2 | Halt button + diff summary | ⬜ | 1 d | |
| 3 | Commit / PR handoff | ⬜ | 2 d | |
| 4 | Choose session from dialog + toggles for mode/model/auto-approve | ⬜ | 1 d | User-requested |

## Power UX

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Cmd palette prefix syntax (`>` / `@` / `:` / `category:query`) | ⬜ | 0.5 d | Deferred from 2026-05-27 palette polish sprint; user chose to ship sub-menus + settings coverage first |
| 2 | Configurable shortcut system | ⬜ | 2 d | User-requested; up next after palette polish |
| 3 | Full search of sessions and content | ⬜ | 3 d | User-requested |
| 4 | `/changelog` viewer | ⬜ | 0.5 d | |
| 5 | `/instructions` toggle picker | ⬜ | 1 d | Library Instructions tab is read-only |
| 6 | `/statusline` config | ⬜ | 1 d | StatusBar exists; no per-statusline config |
| 7 | System prompt customize mode (10 named sections) | ⬜ | 2 d | |
| 8 | Custom request headers per turn | ⬜ | 1 d | |
| 9 | Model capabilities override | ⬜ | 1 d | |
| 10 | Sub-agent streaming events toggle | ⬜ | 0.5 d | |

## Editor & power workspace

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Workspace search panel | ⬜ | 2 d | |
| 2 | Plans `Edit plan` Markdown editor | ⬜ | 1 d | |
| 3 | Plugin / theme system | ⬜ | — | Future |

## Integrations

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | GitHub Issues / PRs / Gists Library tabs + `#` autocomplete | ⬜ | 3 d | G1 (covered in Messaging & UX above; separate work item here) |
| 2 | Azure DevOps work items / PRs | ⬜ | 3 d | User-requested |
| 3 | M365 integration | ⬜ | — | A9 |
| 4 | Teams bot | ⬜ | — | A10; depends on Server mode |
| 5 | Server mode (Dafman over browser) | 🟨 | 4 d | `wsBridge.ts` exists; no server wrapper |

## Observability

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Metrics counters / histograms in Settings | ⬜ | 1 d | M2 def-of-done |
| 2 | Per-MCP-server metrics | ⬜ | 1 d | |
| 3 | OTel exporter opt-in | ⬜ | 2 d | Settings field reserved; not wired |
| 4 | Perf bench harness | ⬜ | 2 d | None wired |
| 5 | A11y axe-core integration | ⬜ | 1 d | aria-labels present; no axe-core run |

## Testing & CI

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Real-Electrobun Tier-4 (CDP) harness | ⬜ | 3 d | Drive the actual built binary. Hard. Tier-3 extensions shipped 2026-05-27 cover the v3 bug class. |
| 2 | Real-DockviewComponent harness across all v3 tests | 🟦 | 1 d | Used in `composePersistLayout` tests only |
| 3 | Real-DockviewComponent in `bootLayout` tests | ⬜ | 1 d | |
| 4 | Layout-restore E2E | ✅ | — | Shipped (flow 21) |
| 5 | Settings round-trip E2E | ✅ | — | Shipped (flow 22) |
| 6 | Groups v3 create + move-session E2E | ✅ | — | Shipped (flows 23 + 24) |
| 7 | Log-viewer tail E2E | ⬜ | 0.5 d | |
| 8 | Diagnostics-bundle export E2E | ⬜ | 0.5 d | |
| 9 | Pre-existing flake: `14-details-rail`, `15-tools-toggle`, `16-plan-panel`, `17-quota-warning`, `18-library-mcp`, `19-library-skills`, `20-details-singleton` | ⬜ | 1-2 d | Fail on `bun run e2e` against clean main; not included in `bun run check`. Investigate timing/race causes. |
| 10 | 13 RPC handlers in production still missing from test-server | ⬜ | 2 d | 1 fixed during 2026-05-27 sprint (`updateSettings` param parity); 13 remain. |
| 11 | Test gap: SessionDetailsPanel compact-row item-expansion | ⬜ | 0.5 d | |
| 12 | Test gap: shutdown watchdog | ⬜ | 0.5 d | |

## Tech-debt remaining

These are the items left after the 20c / 21a / 21b / 21c / 21d sprints.
History in `_archive/plan-tech-debt.prompt.md`.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `dafman.pending_request` event payload cast (T2) | ⏸️ deferred | Line noise vs. safety win |
| 2 | SessionDetailsPanel cohesion (U4) | ⏸️ deferred | ~1100 LoC, threshold 1500 |
| 3 | `enqueuePending` silent cancel on emit failure (U5) | ⏸️ deferred | Rubber-duck confirmed current shape is correct |
| 4 | Dev-only suspicious deps (D3) | flag-only | |
| 5 | Native Go type-checker (typescript-go) (D4) | ⏳ upstream | |

## User-reported bugs — sorted (2026-05-27)

Canonical list of bugs the user has manually verified during dogfooding.
Auto-merged from prior `Note:` lines in `MANUAL_TESTS.md` + new
2026-05-27 reports. Sorted by sprint assignment from `plans/_archive/`
post-triage planning so the work order is explicit.

Status legend: ⬜ open · ✅ shipped (move to DONE.md on next sweep) ·
🟦 partial · ⏸️ deferred (with a real reason)

### Already shipped this sprint (2026-05-27 — pending user dogfood)

| # | Bug | Status | Commit | Verification |
|---|---|---|---|---|
| 1 | No way to choose an agent on the Library Agents screen | ✅ | `bca5704` | MANUAL_TESTS.md A1.1–A1.4 |
| 2 | Agent card missing an Edit button | ✅ | `a529ef5` | MANUAL_TESTS.md A2.1–A2.4 |
| 3 | `/agent <name>` doesn't actually select | ✅ | `a529ef5` | MANUAL_TESTS.md A3.1–A3.3 |

### Sprint B — MCP UX (4 bugs, ~2.5 d)

| # | Bug | Status | Effort | Source |
|---|---|---|---|---|
| 4 | MCP HTTP transport has no OAuth popup login flow — values entered manually only | ⬜ | 1 d | 2026-05-27 user feedback (MANUAL_TESTS.md "MCP — HTTP transport + OAuth login flow") |
| 5 | `Sign in` button on configured HTTP MCP servers is broken / doesn't appear | ⬜ | 0.5 d | MANUAL_TESTS.md "MCP — `Sign in` button on HTTP servers" |
| 6 | Toggling discovered MCPs doesn't persist; discovered rows should be editable / deletable and show file path | ⬜ | 1 d | MANUAL_TESTS.md "MCP — discovered server toggle + editability" |
| 7 | MCP `Remove` jumps to `Discovered` view instead of staying in `Configured` | ⬜ | 0.5 d | MANUAL_TESTS.md "MCP — Remove no longer 'jumps to discovered'" |

### Sprint C — Slash command UX (1 bug, ~1 d)

| # | Bug | Status | Effort | Source |
|---|---|---|---|---|
| 8 | `/skill <name>` only opens Library; should run the skill (pairs with row 5 in §Skills) | ⬜ | 1 d | MANUAL_TESTS.md "Slash `/skill <name>` actually runs the skill" |
| 9 | `/mcp <server>` only opens Library; subcommand shape TBD (decide in Sprint B spec interview) | ⬜ | 0.5 d | MANUAL_TESTS.md "Slash `/mcp <server>` operations" |

### Sprint D — Jobs panel + bottom bar (3 bugs, ~1 d)

| # | Bug | Status | Effort | Source |
|---|---|---|---|---|
| 10 | Jobs panel spinner orbits an off-center point (visual jank — CSS `transform-origin`) | ⬜ | 0.25 d | MANUAL_TESTS.md "Jobs panel — spinner + scroll bugs" |
| 11 | `Go to session` in Jobs panel scrolls to top instead of the relevant message | ⬜ | 0.5 d | Same as #10 |
| 12 | Bottom bar resize regressed (after plan-mode fix) — needs scoping which "bottom bar" + repro | ⬜ | 0.25 d | 2026-05-27 user feedback |

### Sprint E — Light mode (1 bug, ~1 d)

| # | Bug | Status | Effort | Source |
|---|---|---|---|---|
| 13 | Light mode has visual issues across the app — needs audit + token / contrast / unstyled-region sweep | ⬜ | 1 d | MANUAL_TESTS.md "Light mode visual audit" |

### Deferred / split out

| # | Item | Status | Why deferred |
|---|---|---|---|
| 14 | Inline typeahead for `/agent <name>` (list agents in slash menu) | ⏸️ | Spec'd `inline_typeahead` but requires custom Lexical extension beyond the single-token slash matcher. Named-select path (Sprint A3 ✅) already fixes the user-reported "can't choose an agent" issue. Promote when Lexical typeahead work is in scope. |
| 15 | `Sub-agent block emits raw <system_notification>` | ✅ | User reports already fixed (2026-05-27). Kept in MANUAL_TESTS.md "Pending verification" until re-run confirms. |
| 16 | Plan-mode toggle doesn't switch | ✅ | User reports already fixed (2026-05-27). |
| 17 | Skills tab doesn't recognize `.github/skills` | ✅ | User reports already fixed (2026-05-27). Kept in MANUAL_TESTS.md "Failing" until re-verified on clean install. |
| 18 | `/fleet` Tab key shouldn't commit immediately | ✅ | User reports already fixed (2026-05-27). |

## Open product questions

- GPT-5.5 `reasoning_opaque` decryption — what does the wire payload contain after decryption?
- Groups vs Projects boundary — Projects is now spec'd as "per-cwd settings overlay" but the boundary needs a final stake driven during Projects implementation
- Plugin / theme system surface
- End-user docs site

---

## What to do when you finish something

1. Move the row from here to [`DONE.md`](DONE.md) under the matching topic.
2. If you changed architecture or an invariant: also update [`ARCHITECTURE.md`](../ARCHITECTURE.md).
3. If a manual test was relevant: append a section to `MANUAL_TESTS.md`.
4. Update `STATUS.md` if it was a milestone item.
5. Update `CHANGELOG.md` under `## [Unreleased]` if user-visible.
