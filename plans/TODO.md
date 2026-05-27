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

## Top of stack (recommended next sprints)

Ranked by **(frequency-of-mention) × (user-visible impact) × (clear scope)**:

1. ⬜ **Real-Electrobun E2E harness** — would catch the v3 bug class in 5 min
2. ⬜ **GitHub `#` mentions + Issues/PRs/Gists Library tabs** (G1) — small, leverages existing `MentionPlugin`
3. ⬜ **Diff viewer: accept/reject hunks** — `ApplyPatchView.vue` is view-only today
4. ⬜ **Multi-account + BYOK** (OS-keyring) — internal demand
5. ⬜ **Projects model** — per-cwd settings overlay; unblocks per-session MCP overlay + per-project autopilot policy
6. ⬜ **Command palette polish** — searchable sub-menus, every toggleable setting, prefix groups
7. ⬜ **Plans API rendering panel** — SDK `rpc.plan.*` exists; no panel
8. ⬜ **Memory backend** (SQLite-vec or LanceDB)
9. ⬜ **Automations + scheduler** + HTTP hooks

---

## Shell & layout

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Real-Electrobun E2E harness (drive renderer + bun + fake SDK end-to-end) | ⬜ | ~3 d | See [`_archive/plan-e2e.prompt.md`](_archive/plan-e2e.prompt.md). Would have caught 4 v3 bugs this sprint. |
| 2 | Outer-fromJSON vs Vue unmount race | ⬜ | 0.5 d | Deferred from Groups v3 code review |
| 3 | Lazy-mount placeholder for unfocused groups | ⬜ | 1 d | Groups v3.1 (G4d) |
| 4 | Manual test pass on real data | ⬜ | user | Restore fix `c97b0a5` unblocks |
| 5 | Phase 26 boundingBox / layout-restore / settings-round-trip E2E | ⬜ | 1 d | |
| 6 | Tiling / layout commands (split / stack / focus-by-direction) | 🟦 | 1 d | `view.newGroup` etc. landed v3; more keyboard tiling missing |
| 7 | Dockview upstream `#1305` + `#1306` | ⏳ | — | Awaiting upstream |

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
| 1 | Skills as `/skill-name` slash typeahead | ⬜ | 1 d | Local-commands path exists; SDK skills not routed |
| 2 | Agents / fleets full panel | 🟦 | 2 d | Picker + sub-agent block exist; no fleet panel |
| 3 | Scheduled prompts (cron) | ⬜ | 2 d | None today |
| 4 | File / time / manual / webhook triggers | ⬜ | 3 d | |
| 5 | Activity feed (Settings → Activity) | ⬜ | 1 d | |
| 6 | Quiet hours / batching / digest | ⬜ | 1 d | Notifications polish |
| 7 | Background task notifications | ⬜ | 0.5 d | |
| 8 | `/research`, `/init`, `/review`, `/delegate` | ⬜ | — | |

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
| 1 | Cmd palette sub-menus searchable | ⬜ | 1 d | User-requested |
| 2 | Every toggleable setting reachable from palette | 🟦 | 1 d | Many today; not all |
| 3 | Prefix groups for cmd categories (display) | 🟦 | 0.5 d | `group` field present; no prefix display |
| 4 | Configurable shortcut system | ⬜ | 2 d | User-requested |
| 5 | Full search of sessions and content | ⬜ | 3 d | User-requested |
| 6 | `/changelog` viewer | ⬜ | 0.5 d | |
| 7 | `/instructions` toggle picker | ⬜ | 1 d | Library Instructions tab is read-only |
| 8 | `/statusline` config | ⬜ | 1 d | StatusBar exists; no per-statusline config |
| 9 | System prompt customize mode (10 named sections) | ⬜ | 2 d | |
| 10 | Custom request headers per turn | ⬜ | 1 d | |
| 11 | Model capabilities override | ⬜ | 1 d | |
| 12 | Sub-agent streaming events toggle | ⬜ | 0.5 d | |

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
| 1 | Real-Electrobun E2E harness (Tier-4) | ⬜ | 3 d | The high-leverage item |
| 2 | Real-DockviewComponent harness across all v3 tests | 🟦 | 1 d | Used in `composePersistLayout` tests only |
| 3 | Real-DockviewComponent in `bootLayout` tests | ⬜ | 1 d | |
| 4 | Layout-restore E2E | ⬜ | 1 d | |
| 5 | Settings round-trip E2E | ⬜ | 0.5 d | |
| 6 | Log-viewer tail E2E | ⬜ | 0.5 d | |
| 7 | Diagnostics-bundle export E2E | ⬜ | 0.5 d | |
| 8 | 14 RPC handlers in production missing from test-server | ⬜ | 2 d | Deferred from 20c |
| 9 | Test gap: SessionDetailsPanel compact-row item-expansion | ⬜ | 0.5 d | |
| 10 | Test gap: shutdown watchdog | ⬜ | 0.5 d | |

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
