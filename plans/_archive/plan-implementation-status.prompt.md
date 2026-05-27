# Master implementation-status audit (2026-05-27)

> Cross-referenced sweep of EVERY feature/idea in the project against
> the current codebase. Sources: `plans/plan-backlog-audit.prompt.md`,
> `plans/plan-roadmap.prompt.md`, `plans/plan-sdk-audit.prompt.md`,
> `STATUS.md`, this session's conversation, all 50+ DEVLOG entries.
>
> Status legend:
>
> - ✅ **DONE** — shipped and exercised in code; one file path cited as receipt
> - 🟦 **PARTIAL** — code exists for the core but a documented sub-feature is missing
> - 🟨 **STARTED / PLANNED** — design exists; some scaffolding shipped; not user-visible yet
> - ⬜ **NOT STARTED** — listed in plans, no code yet
> - 🟥 **REVERTED** — was shipped and rolled back; counts as not-started until re-attempted

---

## Foundations (M0–M2) — mostly done

| Feature | Status | Receipt |
|---|---|---|
| Tauri → Electrobun port | ✅ | No `src-tauri/`; only `src-bun/` |
| SDK pinned `@github/copilot@1.0.54` | ✅ | `package.json` |
| Single Client lifecycle | ✅ | `src/stores/app/clientStore.ts` |
| Multi-session create / resume / disconnect / delete | ✅ | `src-bun/app/sessions.ts` |
| Streaming chat (rAF-coalesced) | ✅ | `src/lib/chatEvents.ts` |
| Per-session accent color | ✅ | `src/lib/color.ts` |
| Pinia stores (11+) | ✅ | `src/stores/` |
| Settings file + migration | ✅ | v14 schema; `src/stores/app/settingsStore.ts` |
| Dark mode | ✅ | `src/style.css` + PrimeVue Aura |
| Boot splash + phased startup | ✅ | `src/components/shell/BootSplash.vue` + `bootStore` |
| Reasoning visibility (hidden/compact/expanded) | ✅ | per-session + global pref |
| Per-session model + reasoning effort | ✅ | `src/components/session/SessionHeaderControls.vue` |
| Tool-call visibility (per-tool renderers) | ✅ | `src/components/chat/ToolCallBlock.vue` |
| Real permission UX | ✅ | `src/components/permissions/` |
| URL elicitation + `openUrl` RPC | ✅ | `src-bun/app/observability/audit.ts` allow-listed |
| Layout persistence (300 ms debounced) | ✅ | `src/lib/persistScheduler.ts` (v3) |
| Workspace MRU + native folder picker | ✅ | `pickFolder` RPC |
| Sessions Manager edge panel | ✅ | `src/components/session/SessionsManager.vue` |
| Command palette (Ctrl+K) | ✅ | `vue-command-palette` |
| Notifications (turn-end + waiting-input) | ✅ | `notificationsStore` |
| Markdown rendering (markdown-it + Prism + DOMPurify + KaTeX) | ✅ | Full HTML subset safe |
| Mermaid diagrams (opt-in, lazy) | ✅ | `MermaidBlock.vue` |
| File / image attachments in composer | ✅ | `AttachmentNode.ts` (Lexical DecoratorNode) |
| `@file` / `@folder` picker | ✅ | `MentionPlugin.vue` + `FilePicker.vue` |
| Slash commands (local) | ✅ | `SlashCommandPlugin.vue` + `sessionCommands.ts` |
| Steering / queue / interrupt (Ctrl+Enter etc.) | ✅ | composer SplitButton |
| Message actions (copy/quote/retry/edit/fork) | ✅ | `MessageActions.vue` |
| Per-session gear popover | ✅ | `SessionHeaderControls.vue` |
| Bounded `record.events` ring buffer (5000) | ✅ | `sessionsStore` |
| Reasoning on `assistant.message` | ✅ | `lib/chatEvents` reducer |
| Brand favicon | ✅ | `public/dafman.svg` |
| Dev playground (`?dev` or wrench) | ✅ | `Playground.vue` |
| Playwright renderer smoke (prod + HMR) | ✅ | `e2e/smoke.pwtest.ts` |

## Observability (Phase 1 close)

| Feature | Status | Receipt |
|---|---|---|
| JSON-lines logger + daily rotation | ✅ | `src-bun/app/logging.ts` |
| Log redaction (12 snapshot tests) | ✅ | `src-bun/app/redact.ts` |
| In-app log viewer | ✅ | `src/components/observability/LogViewer.vue` |
| Runtime log-level toggle | ✅ | `setLogLevel` RPC + panel header |
| Diagnostics bundle export | ✅ | `src-bun/app/observability/exports.ts` |
| Metrics counters / histograms in Settings | ⬜ | M2 def-of-done; not started |
| Bench harness | ⬜ | None wired |

## CI / E2E

| Feature | Status | Receipt |
|---|---|---|
| Tier-1 lint + bun test + smoke | ✅ | `bun run check` |
| Tier-2 electrobun build matrix (Ubuntu/macOS/Windows) | ✅ | `.github/workflows/ci.yml` (continue-on-error) |
| Tier-3 real E2E (Playwright + bun + fake SDK) | ✅ | `bun run e2e` — 6 baseline flows |
| Tier-4 real Electrobun harness | ⬜ | TODO. The Playwright CDP harness against real Electrobun binary remains open. Would have caught all 4 of the user-found v3 bugs in 5 min. |
| Probe-tier (`tools/probe-*.ts`) | 🟨 | Pattern established this sprint (`probe-groups-bugs.ts`); not yet generalized |
| Real-DockviewComponent test harness | 🟦 | Used in `composePersistLayout` tests; NOT yet in groupsStore/useGroupsActions tests |
| Real-DockviewComponent in `bootLayout` tests | ⬜ | Not started |

## M3 — Tools & permissions

| Feature | Status | Receipt |
|---|---|---|
| Permission UX with rule editor (per-kind shapes) | ✅ | `PermissionRuleEditor.vue` |
| Permission audit log (JSONL) | ✅ | `<userData>/audit/permissions.jsonl` + `urls.jsonl` |
| Audit Activity tab (Diagnostics) | ✅ | DEVLOG 2026-05-22 |
| **Per-session tool allow/exclude UI** | ✅ | `src/components/library/LibraryToolsTab.vue` (Phase 22b — tri-state grouped view) |
| **Permissions Settings tab** | ✅ | DEVLOG 2026-05-25 "Phase 22c"; somewhere in Settings — need to verify rendering |
| **URL policy editor UI** | ⬜ | Today: allowlist regex baked in; no rule UI |
| Built-in Dafman tool registry (`fs/shell/http/clipboard/notify`) | ⬜ | We rely entirely on SDK + MCP tools |
| Diff viewer for `fs.edit` / `apply_patch` | 🟦 | `src/components/details/ApplyPatchView.vue` + `DiffEditor.vue` exist — view only, no accept/reject hunks |
| Sandboxing for `shell.exec` | ⬜ | Not started |
| `http.fetch` allow/deny host list | ⬜ | Not started |
| Policy presets (Strict/Workshop/Trusted/Demo) | ⬜ | Not started |

## M4 — Projects, accounts, resumability

| Feature | Status | Receipt |
|---|---|---|
| Resume sessions across restart | ✅ | layout-driven |
| Workspace path per session (cwd) | ✅ | MRU + picker |
| Sessions Manager panel | ✅ | `SessionsManager.vue` |
| **Project model + per-project settings overlay** | ⬜ | The "Projects" concept; per-project cwd/model/MCP overlay |
| Multi-account auth | ⬜ | One account; no OS-keyring; no per-session pin |
| Idle timeout configurable per session | ⬜ | SDK supports; no UI |
| `SessionFsProvider` impl writing under `<app-data>` | ⬜ | SDK uses its own default location |

## M5 — Integrations: skills, MCP, agents

| Feature | Status | Receipt |
|---|---|---|
| Skills enable/disable per session | ✅ | gear popover |
| **Library panel** (single edge panel with tabs) | ✅ | `LibraryPanel.vue` (Phase 19) |
| Library → Skills tab | ✅ | `LibrarySkillsTab.vue` (read-only list) |
| Library → MCP servers tab | ✅ | `LibraryMcpTab.vue` (Phase 19) |
| Library → Instructions tab | ✅ | `LibraryInstructionsTab.vue` (Phase 23a, read-only) |
| Library → Custom agents tab | ✅ | `LibraryAgentsTab.vue` (Phase 19b.2) |
| Library → Tools tab | ✅ | `LibraryToolsTab.vue` (Phase 22b) |
| Skill library CRUD (create / edit / delete + dry-run) | ⬜ | Only SDK-discovered list |
| MCP server install / start / stop | 🟦 | List + enable/disable; no install flow |
| MCP OAuth toast | ✅ | Phase 22a (DEVLOG 2026-05-25) |
| Per-session MCP overlay | ⬜ | Project model dependency |
| Agents / fleets UI | 🟦 | Agent picker + sub-agent block exists; no fleet panel |
| Nested sub-agent rendering | ✅ | `SubagentBlock.vue` (Phase 19c) |
| Background tasks rail section | ✅ | `JobsPanel.vue` (Phase 19b.1) |
| Custom system message transforms | ⬜ | SDK supports; no editor |
| Plans API rendering | ⬜ | SDK `rpc.plan.*`; no panel |
| Memory backend (SQLite-vec or LanceDB) | ⬜ | M5+ |
| Skills as `/skill-name` slash commands | ⬜ | Local-commands path exists; SDK skills not wired into typeahead |

## M6 — Automations & notifications

| Feature | Status | Receipt |
|---|---|---|
| OS notifications + per-channel toggles | ✅ | turn-end + waiting-input |
| Scheduled prompts (cron) | ⬜ | None |
| File / time / manual / webhook triggers | ⬜ | None |
| Activity feed (Settings → Activity) | ⬜ | None |
| Quiet hours / batching / digest | ⬜ | None |

## M7 — Editor & power UX

| Feature | Status | Receipt |
|---|---|---|
| Code blocks via CodeMirror 6 | ✅ | `CodeEditor.vue` |
| Markdown rendering (read-only) | ✅ | (above) |
| `apply_patch` diff viewer | 🟦 | `ApplyPatchView.vue` exists (view-only) |
| Inline accept/reject hunks | ⬜ | Not started |
| Workspace search panel | ⬜ | Not started |
| Headless `browser.*` tool | ⬜ | Not started |
| `self.*` tool surface (open file / switch project / run skill) | ⬜ | Not started |
| Plugin / theme system | ⬜ | Future |

## Cross-cutting

| Feature | Status | Receipt |
|---|---|---|
| A11y axe-core integration | ⬜ | aria-labels present; no axe-core run |
| Perf benches | ⬜ | None |
| Telemetry (OTel) opt-in | ⬜ | Settings field reserved; not wired |
| End-user docs site | ⬜ | None |

## Major themes from `plan-backlog-audit` §A

| # | Theme | Status | Receipt |
|---|---|---|---|
| A1 | Terminal integration (PTY + per-session pane) | ✅ | `src/components/terminal/`; `Bun.spawn` with PTY (commit `d94b838+`) |
| A2 | App shell redesign — sidebar + status bar | ✅ | StatusBar.vue + activity-bar v2 (Phase 25, v2 close) |
| A3 | Groups — workspaces of layout state | ✅ | v3 (2026-05-27) |
| A4 | Server mode (dafman over browser) | 🟨 | `src/ipc/wsBridge.ts` exists from E2E harness; no server wrapper yet |
| A5 | Long jobs registry | ✅ | `src/stores/observability/jobsStore.ts` + `JobsPanel.vue` |
| A6 | Composer toolbar (WYSIWYG buttons) | ✅ | `src/composables/composerFormat.ts` + `MessageComposer.vue` (Phase D.4) |
| A7 | Autopilot UI (pre-checks / halt / diff summary) | 🟦 | Mode toggle done (Phase 23b); pre-checks + halt + commit/PR handoff NOT |
| A8 | Library panel | ✅ | 5 tabs shipped (above) |
| A9 | M365 integration | ⬜ | Not started |
| A10 | Teams bot | ⬜ | Depends on A4 |
| A11 | Tools: Desktop Control | ⬜ | Not started |
| A12 | Tools: Bun shell / script runner | ⬜ | Not started; we use SDK shell |
| A13 | Tools: Browser control | ⬜ | Not started |
| A14 | Per-session settings as right-rail panel | ✅ | `SessionDetailsPanel.vue` (Phase 18a/18b) |

## Smaller items §B (sample, not exhaustive)

| Item | Status | Receipt |
|---|---|---|
| B1 Steering / message queueing | ✅ | composer SplitButton + queueSend |
| B1 Notifications turn-end + waiting | ✅ | done |
| B1 Quiet hours / sound / per-trigger toggle | ⬜ | Notifications polish item |
| B1 GPT-5.5 `reasoning_opaque` decryption | ⬜ | Open question |
| B1 Dev playground as button | 🟦 | Status-bar wrench in DEV exists |
| B2 Inline `session.ui` rendering (confirm/select/input) | ⬜ | `session.ui.elicitation` shipped; the other variants are separate |
| B2 Image messages embedded with zoom | ⬜ | Companion to image gen |
| B2 Time travel (`/rewind`) | ⬜ | SDK `snapshot_rewind`; no UI |
| B2 Snapshots (`/fork` to skill) | ⬜ | Not started |
| B2 Pin to Notes sidebar / Notes sidebar | ⬜ | Deferred |
| B3 `clipboard.read/write` tool | ⬜ | Not started |
| B3 `notify.show` tool | ⬜ | Not started |
| B3 `lsp.*` tools | ⬜ | Not started |
| B3 `task.*` tools | ⬜ | Not started |
| B3 Sandboxing for `shell.exec` | ⬜ | Not started |
| B3 `http.fetch` allow/deny | ⬜ | Not started |
| B4 Slash commands (`/skill /model /system /export /notes /help /account /abort`) | 🟦 | Local slash plugin exists; SDK CommandDefinition not yet routed |
| B4 Per-project MCP overlay | ⬜ | Project dep |
| B4 Plans `Edit plan` MD editor | ⬜ | Not started |
| B4 Memory `query/write/list` tools | ⬜ | Not started |
| B4 Self-control surface | ⬜ | Not started |
| B5 System prompt customize mode (10 named sections) | ⬜ | Not started |
| B5 Custom request headers per turn | ⬜ | Not started |
| B5 Model capabilities override | ⬜ | Not started |
| B5 Sub-agent streaming events toggle | ⬜ | Not started |
| B5 MCP OAuth toast | ✅ | Phase 22a |
| B6 OTel exporter | ⬜ | Phase 11 |
| B6 Per-MCP-server metrics | ⬜ | Not started |
| B6 Perf benches | ⬜ | Not started |
| B7 Config knobs (15 un-set) | ⬜ | Sprinkle into relevant phases |
| B8 `/fork` session | ✅ | Composer fork button — `useMessageActions.ts` |
| B8 `/rewind` + double-Esc timeline | ⬜ | Not started |
| B8 `/undo` last turn | ⬜ | Not started |
| B8 `/diff` session changes | ⬜ | Not started |
| B8 `/usage` contribution graph | 🟦 | `getQuota` exposed in SessionDetails; no graph |
| B8 `/share html` export | ⬜ | We have Markdown + JSON, no HTML |
| B8 `#issue/#PR` autocomplete | ⬜ | This sprint's GitHub deep-dive; see G1 |
| B8 Background task notifications | ⬜ | Not started |
| B8 `/research`, `/init`, `/review`, `/delegate` | ⬜ | Not started |
| B8 Cross-session memory | ⬜ | M5+ |
| B8 `/restart` hot restart | ⬜ | Not started |
| B8 `/instructions` toggle picker | ⬜ | Library Instructions tab exists (read-only) |
| B8 `/statusline` config | ⬜ | StatusBar exists; no per-statusline config |
| B8 `/changelog` viewer | ⬜ | Not started |
| B8 Skills as `/skill` typeahead | ⬜ | Not started |
| B8 MCP sampling (LLM requests from MCP servers) | ⬜ | SDK supports |
| B8 `gh` read-only auto-approve permission rule | ⬜ | Not started |
| B8 Theme picker (colorblind variants) | 🟦 | Light/dark only |
| B8 Permanent permission rules per location | ⬜ | `setApproveAll` not persisted |
| B9 `rpc.commands.handlePendingCommand` (agent emits slash command we render) | ⬜ | Not started |
| B9 MCP server instructions injected into system message | ⬜ | Not started |
| B9 `subagentStart` hook | ⬜ | Not started |
| B9 `preCompact` hook | ⬜ | Not started |
| B9 `agentStop` / `subagentStop` hooks | ⬜ | Not started |
| B9 `PermissionRequest` hook | ⬜ | Not started |
| B9 `postToolUseFailure` hook | ⬜ | Not started |
| B9 HTTP hooks (POST JSON to URL) | ⬜ | Not started |
| B9 Plugin hook env vars | ⬜ | Not started |
| B10 Layout-restore E2E | ⬜ | Open |
| B10 Settings round-trip E2E | ⬜ | Open |
| B10 Log-viewer tail E2E | ⬜ | Open |
| B10 Diagnostics-bundle export E2E | ⬜ | Open |
| B10 A11y axe-core | ⬜ | Open |

## §G — surfaced 2026-05-27

| # | Item | Status |
|---|---|---|
| G1 | `#` autocomplete + Issues/PRs/Gists tabs + `/share gist` | ⬜ |
| G2 | `session.auth.getStatus` chip + BYOK form | ⬜ |
| G3 | Remote-session attach (`sessions.connect`) | ⬜ |
| G4a | Right-click "Move to group…" menu | ✅ (`5dbf2b3`) — ChatTab.vue ContextMenu with #item slot for color dots |
| G4b | Tab rename inline (dblclick) + color picker | ✅ (`5dbf2b3` + `5a066f3`) — GroupTab.vue inline rename + Popover ColorPicker |
| G4c | Native cross-group drag (`onUnhandledDragOverEvent`) | ✅ (`5dbf2b3`) — GroupPanel.vue onUnhandledDragOverEvent + onDidDrop |
| G4d | Lazy-mount placeholder | ⬜ |
| G5a | Phase 26 manual test verification on real data | ⬜ (user owns; restore fix `c97b0a5` unblocks) |
| G5b | Drop legacy `persistLayout(dockview)` | ✅ (`5dbf2b3`) — only `persistGroupedLayout` remains |
| G5c | Boot-cost regression check | ✅ (`5dbf2b3`) |
| G11 | `coerceLayout` strips v3 fields → restore broken | ✅ (`c97b0a5`) — bun-side validator now passes through all v3 fields |
| G6a | `bun run inspect` | ✅ (shipped 2026-05-26) |
| G6b | `tools/probe-*.ts` pattern | 🟨 |
| G6c | `window.__DAFMAN_TEST__` | ✅ |
| G6d | Smoke screenshot pattern | ✅ |
| G7 | Real-DockviewComponent harness across all v3 tests | 🟦 |
| G8 | Dockview upstream `#1305` + `#1306` | ⏳ awaiting upstream |
| G9 | Outer-fromJSON vs Vue unmount race | ⬜ (deferred from code-review) |
| G10 | Test gaps (boundingBox, settings round-trip, layout restore, log viewer, axe) | ⬜ |

## User-requested ideas (problems.md 2026-05-23)

| Item | Status |
|---|---|
| Autopilot UX: choose session from dialog, toggles for auto-approve/model/mode | ⬜ |
| Cmd palette sub-menus searchable | ⬜ |
| Every toggleable setting in palette | 🟦 (many are; not all) |
| Prefix groups for cmd categories | 🟦 (uses `group` field; no prefix display) |
| Full search of sessions and content | ⬜ |
| Tiling / layout commands | 🟦 (`view.newGroup` etc. landed v3) |
| Configurable shortcut system | ⬜ |
| Skills as `/skill-name` slash typeahead | ⬜ |
| GitHub issues/PRs | ⬜ (see G1) |
| Azure DevOps work items/PRs | ⬜ |

---

## Quick stats

- ✅ DONE: 70+
- 🟦 PARTIAL: ~12
- 🟨 STARTED / PLANNED: ~4
- ⬜ NOT STARTED: ~80
- 🟥 REVERTED: 2 (groups v1 + v2 — both superseded by v3 ✅)

**Highest-value gaps right now (by frequency-of-mention × user-visible-impact):**

1. ⬜ Real-Electrobun E2E harness (would catch the v3 bug class)
2. ✅ ~~G4 — Groups v3.1 polish~~ shipped 2026-05-27 (`5dbf2b3` + `5a066f3` + `c97b0a5`)
3. ⬜ Phase 27 — Multi-account + BYOK (lots of internal demand)
4. ⬜ Phase 29 — Projects (resolves the "groups vs projects" open question)
5. ⬜ Phase 31 — Diff viewer with accept/reject hunks
6. ⬜ G1 — GitHub `#` mentions + Issues/PRs/Gists tabs
7. ⬜ Phase 30 — Memory backend
8. ⬜ Phase 33 — Automations + scheduler
