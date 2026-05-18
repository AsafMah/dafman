> **Stack note (post-Electrobun port, 2026-05-17):** This document still references the old Tauri (Rust) backend in places. The runtime is now Electrobun + Bun + TypeScript everywhere; src-tauri/ is gone, replaced by src-bun/. 	racing is replaced by `src-bun/app/logging.ts`, `cargo test`/`insta` are replaced by `bun test`/`toMatchSnapshot`, and Tauri's per-session `Channel<T>` is replaced by a single `sessionEvent` RPC message keyed by `sessionId`. The architecture in spirit (domain modules don't touch the shell, single typed IPC surface, JSON-RPC under the hood) is unchanged. Full diff lives in `CHANGELOG.md` under `## [Unreleased]`. Plan rewrites are tracked as follow-up tasks.
# Dafman — Roadmap
Milestones are sized to ship in days–weeks. Each one ends with a runnable demo and tests.
## M0 — Foundations (DONE)
- Tauri + Vue 3 + PrimeVue scaffold.
- Single CLI client.
- Create/disconnect sessions.
- Streaming chat (deltas) per session.
- Multi-session grid layout with per-session accent color.
## M1 — Make it solid
Goal: take the prototype and make it a base we can grow on.
- **Switch SDK dependency** to git-pinned **Supercharged** distribution (`plan-sdkAndExternalSurfaces.prompt.md`).
- **Backend refactor** to the module layout in `plan-architecture.prompt.md`. Introduce traits + impls + `AppError`.
- **Per-session Tauri channel** (`tauri::ipc::Channel`) instead of a global event.
- **Pinia stores** on the frontend; remove ad-hoc `ref` collections.
- **Typed IPC** (hand-mirror first; specta candidate evaluated).
- **Settings store** on disk (JSON + schema version). Settings dialog (General, Appearance).
- **Real permission UX** replacing `ApproveAllHandler`: SDK request → UI modal → answer.
- **URL elicitation** card + opener policy (defaults only; full editor in M3).
- **Dark mode** fully token-driven; switch persisted.
- **Tracing logs** to file with rotation; in-app Log Viewer (basic tail + level filter); first `criterion` bench (`bench_event_dispatch`). See `plan-observability.prompt.md`.
- **Tests**: backend unit tests for managers (with SDK trait fakes), frontend Vitest for stores, one Playwright smoke test.
**Definition of done:** All current features work, every domain is testable in isolation, no `unwrap` in command paths, settings persist, dark mode is consistent, URL opens go through policy.
## M2 — Messaging power-ups
- Reasoning blocks (collapsed/expanded/hidden) with per-message + global setting.
- Tool call blocks (status, arguments, result, expand/collapse).
- Markdown rendering with syntax-highlighted code blocks; copy-code button.
- Inline session.ui blocks: confirm / select / input.
- Image generation rendering (response_format = image).
- Message actions: copy, retry, edit-and-resend, delete.
- Per-session header controls: model picker (with capability overrides), system prompt (append/replace/customize), request_elicitation toggle.
- Export conversation (Markdown, JSON).
- Abort in-flight turn.
- Keyboard shortcuts (`Cmd/Ctrl+Enter` send, `Esc` abort, `Cmd+K` command palette).
- **Observability:** `#[instrument]` on chat/send/permission paths; metrics counters + histograms exposed in Settings → Diagnostics; Playwright perf snapshot.
**Definition of done:** Chat experience is at parity (or better) with CLI; tools/reasoning/elicitation/images are first-class UI.
## M3 — Tools & permissions
- Built-in tool registry (fs read, fs write, edit, search via `grep`, shell with timeout, http).
- Each tool is permissioned through `PermissionService` with a clear UI prompt.
- Permission policies: ask, allow-once, allow-for-session, allow-for-project, deny.
- Rule-based policies (glob/regex over tool + args), editable in settings.
- URL policy editor (Settings → URL Policy).
- Tool call visualization (diffs for fs.edit; output preview for shell/http).
- `excludedTools` overlay surfaces per skill / per agent.
- **Observability:** permission + URL audit logs wired; `bench_permission_eval` and `bench_url_policy_eval` benches.
**Definition of done:** Sessions can read/write project files, search, shell out, hit the web, with full visibility and control.
## M4 — Projects, accounts & resumability
- Project picker (open folder → becomes a project).
- Sessions are scoped to a project (workspace path passed to SDK; `enableConfigDiscovery` on).
- Per-project settings overlay (model, system prompt, tools allow-list, MCP).
- **Multi-account auth**: Accounts UI; per-session GitHub token pinning; OS-keyring storage.
- Resume sessions across restart via `resume_session` (using `getSessionMetadata`).
- Idle timeout configurable per session; auto-cleanup with notification.
- `SessionFsProvider` writes session state under `<app-data>/sessions/<id>/`.
- Recent projects + recent sessions in a sidebar.
- Crash recovery: restart picks up open panes (best-effort).
- **Observability:** OTLP exporter (opt-in) wired through Settings → Privacy; multi-account redaction snapshot tests.
**Definition of done:** Close mid-conversation, reopen, conversations are back. Multiple projects + multiple accounts in parallel.
## M5 — Integrations: skills, MCP, agents
- **Skills**: named bundle (instructions + tools subset + model + starter prompt + variables). Library UI + editor.
- **MCP servers**: install/start/stop (stdio + HTTP kinds), surface their tools, wire to permission + URL flow for OAuth.
- **Agents / Fleets**: leverage SDK `fleet.start`, render sub-agent activity in a child pane (forwarding configurable).
- Slash commands UI (registered via SDK `CommandDefinition`).
- Custom system message transforms via UI.
- **Observability:** sub-agent + MCP span propagation; per-MCP-server metrics.
**Definition of done:** User can install an MCP server (with OAuth via the URL flow), build a skill, then invoke it from chat.
## M6 — Automations & notifications
- Scheduled prompts (cron-style).
- Triggers: file changed, time, manual, webhook (M6.1).
- Background runs surface as desktop notifications + an Activity feed.
- Quiet hours, batching, summary digest.
- **Observability:** automations emit audit + metric events; quiet hours respect.
**Definition of done:** "Every morning, run X in project Y and notify me" works end-to-end.
## M7 — Editor & power UX
- Monaco-based file viewer/editor for tool-touched files.
- Diff viewer for fs.edit/write tool results.
- Inline code apply (preview → accept/reject hunks).
- Workspace search panel (cross-session).
- Command palette (`Cmd+K`).
- Headless `browser.*` tool (separate from URL opener), with screenshot/snapshot capabilities.
- Plugin/theme system (later).
- **Observability:** diagnostics bundle export; `tokio-console` feature flag; full perf dashboard.
**Definition of done:** Dafman feels like an IDE-companion for prompt-driven editing.
## Cross-cutting / continuous
- A11y review at every milestone.
- Perf bench: cold start, message latency, memory.
- Telemetry opt-in (OTel via SDK''s `TelemetryConfig`).
- Docs: `docs/` site for end-users; `CONTRIBUTING.md` for developers.
## Priority table
| Priority | Items |
|---|---|
| P0 (M1) | SDK pin to Supercharged, module refactor, per-session channel, error model, Pinia, settings persistence, real permissions, URL policy minimal, dark mode polish, logging, baseline tests. |
| P1 (M2) | Reasoning UI, tool call UI, markdown + highlight, message actions, model picker, system prompt modes, image rendering, abort, shortcuts, export, session.ui inline. |
| P2 (M3) | Built-in tools, permission policy editor, URL policy editor, diff/preview for tool results, excludedTools overlay. |
| P3 (M4) | Projects, accounts, resume, multi-project, idle timeout, SessionFsProvider, crash recovery. |
| P4 (M5) | Skills, MCP (stdio+HTTP+OAuth), sub-agents, slash commands. |
| P5 (M6) | Automations, notifications. |
| P6 (M7) | Monaco editor, diffs, command palette, headless browser tool. |

## Observability per milestone

See detailed list in `plan-observability.prompt.md` (`Definition of done per milestone`). Each milestone explicitly ships its observability deliverables alongside features.

## Backlog (user-flagged, not yet milestoned)

Ideas raised mid-M1 that need design before slotting into a milestone. Tracked here so they don''t evaporate. When you pick one up, move it into the relevant milestone above and into the appropriate per-domain plan.

- **Steering & message queueing** — let the user queue multiple messages while a turn is in flight, edit/reorder/cancel pending ones, and steer (inject context into) the live turn. Needs a queue model (FIFO? draggable?), per-message status (pending/sent/cancelled), and a backend pipeline that maps to SDK `pending_messages.modified`. Cross-references: `plan-messagingAndUx.prompt.md` (Composer + per-session settings), `plan-sdkAndExternalSurfaces.prompt.md` (pending message events).
- **File & image attachments** — drag-and-drop and paste into the composer; render image messages inline; surface as attachment chips. Needs a backend `attachments` module that hands paths/bytes to the SDK''s message-options surface, an attachment store on the frontend (per-pane), and per-format previews. Cross-references: `plan-messagingAndUx.prompt.md` (Message types — `image`, Composer drag-and-drop), `plan-sdkAndExternalSurfaces.prompt.md` (SDK attachment API).
- **More session settings exposed in the UI** — session compaction toggles + thresholds, reasoning summary on/off, system prompt mode (append/replace/customize), idle timeout, sub-agent forwarding. Most are already in `plan-sdkAndExternalSurfaces.prompt.md`; needs a per-session "Session settings" panel reachable from the chat header kebab (`plan-messagingAndUx.prompt.md` already sketches this).
- **Make the dev playground a button** — `?dev` is awkward to type. Add a discoverable entry point: either a hidden corner button shown only when `import.meta.env.DEV`, or a tray menu item. Keep production builds clean (tree-shake must still drop the playground module). Cross-references: `src/dev/Playground.vue`, `src/main.ts`.
- **Markdown rendering + message QoL** — proper markdown for assistant + reasoning content (code fences with syntax highlight, copy-code button, links, lists). Plus message actions called out in M2: copy whole message, retry, edit-and-resend, delete. Sanitization is mandatory — assistant output is untrusted. Cross-references: `plan-messagingAndUx.prompt.md` (Message types).
- **GPT-5.5 `reasoning_opaque` decryption mystery** — the upstream CLI displays reasoning for GPT-5.5, but the SDK only ships an empty `content` + ~500-char base64 `reasoningId` to us. Worth one focused session to figure out how the CLI decodes/renders it (probably a separate provider call or a CLI-internal post-process). Cross-references: `src/lib/chatEvents.ts`, `plan-sdkAndExternalSurfaces.prompt.md`.

- **Notifications — turn-end and elicitation/waiting.** Surface a desktop notification (and/or sound) when a long-running turn completes or when the session is waiting on user input (permission, elicitation, `user_input.requested`). Should respect quiet hours and pane focus — never notify for the active pane. Wire to OS notification surface (Electrobun `Notification` API once available; until then, fall back to PrimeVue toast + tab-title flash). Settings → Notifications: per-trigger on/off, sound on/off, quiet hours range. Cross-references: `plan-messagingAndUx.prompt.md` (turn states), `plan-platformFeatures.prompt.md` (M6 notifications).

- **Command palette (`Cmd/Ctrl+K`).** PrimeVue `Dialog`-or-OverlayPanel + filterable list, fuzzy match across: settings entries, registered commands (slash commands + skills + custom agents), global search results (sessions by id/title/workspace/transcript), recent files (M7). Backed by a single `commandRegistry` Pinia store where each domain registers contributions (settings → `commands.register({ id, title, group, run })`). Keyboard-first: ↑/↓/Enter, group headers, recent-first ordering. Cross-references: `plan-roadmap.prompt.md` M7 ("Command palette"), `plan-messagingAndUx.prompt.md` (Keyboard shortcuts).

- **Sessions manager — resume / delete / group by workspace.** Dockview left edge-group panel (`layoutStore.openEdgePanel("left", …)`) listing every CLI-side session from `listSessions`. Top-level groups: each known workspace path (basename + tooltip with full path), with sessions sorted by `modifiedTime`. A fallback "Other" group for sessions without a `cwd`. Per-session row: title (or short id), last-modified relative time, message count if available, ▶ resume (drops into new panel via `addPanel`), 🗑 delete (calls a new `deleteSession` RPC backed by the SDK's session deletion RPC). Live updates when a new session is created in the active app, no auto-refresh otherwise. Cross-references: `plan-platformFeatures.prompt.md` (Recent sessions sidebar — supersedes), `plan-roadmap.prompt.md` M4 ("Recent projects + recent sessions").

- **Tool rendering — summaries + syntax-highlighted args & results.** Each tool gets a one-line summary derived per-tool (`shell` → `${command}`; `read_file` → basename; `apply_patch` → file count; …) shown next to the toolName in collapsed `ToolCallBlock`. Expanded view: args + result/diff blocks get syntax highlighting (Shiki / highlight.js) using a tool-by-tool language map (`shell` → bash, `read_file`/`write_file` → infer from extension, `apply_patch` → diff). Mirror the CLI's renderer where it's already proven (cite `@github/copilot` repo as reference). Falls back to plain `<pre>` for unknown tools. Per-tool renderer registry in `src/lib/toolRenderers/`. Cross-references: `src/components/ToolCallBlock.vue`, `plan-toolsAndPermissions.prompt.md`.

- **Active tools control from the menu.** Per-session and global "Tools" panel listing every tool available to the agent (built-ins, MCP-provided, custom). Toggle individual tools on/off → maps to SDK `availableTools` / `excludedTools` on session create + a `setSessionTools` RPC for live updates (verify SDK supports mid-session). Group by source (built-in, MCP server name, custom). Search + bulk toggle. Cross-references: `plan-toolsAndPermissions.prompt.md` (allowlists), `plan-sdkAndExternalSurfaces.prompt.md` (tool registry hooks).

- **Skills / MCPs / instructions library.** Single dockview edge-group panel ("Library") with tabs: Skills, MCP servers, Instructions, Custom agents. For each item: view definition, enable / disable, edit (Monaco editor for prompt/config), delete. Skills + instructions stored under `<userData>/library/{skills,instructions}/`; MCP server configs under `<userData>/library/mcp.json`. Live changes hot-apply to new sessions; existing sessions get a "Restart to apply" hint. Cross-references: `plan-platformFeatures.prompt.md` (Skills library), `plan-toolsAndPermissions.prompt.md` (MCP install).

- **Agents — discover, edit, select.** Surface SDK `customAgents` + `defaultAgent` config in the Library panel (above). Per-session: agent picker in `SessionHeaderControls` next to the model select, fed by `session.rpc.agent.list()` (verify). Selecting an agent calls `session.rpc.agent.select({ name })`. Authoring a new agent: name + system prompt + allowed tools + skill set + sub-agent forwarding. Cross-references: `plan-sdkAndExternalSurfaces.prompt.md` (agent RPCs), `plan-roadmap.prompt.md` M5.

- **Autopilot integration.** First-class "Autopilot" mode beyond the existing `SessionMode === "autopilot"` flag: pre-run sanity checks (clean working tree? branch?), explicit goal entry, configurable iteration cap, progress timeline, halt button. Per-step audit log (every tool call, every permission auto-approve). On completion, show diff summary + offer to commit/PR. Inherits the `autopilot` SessionMode plumbing but adds a UI layer that makes the "run until done" workflow safe. Cross-references: `plan-toolsAndPermissions.prompt.md` (auto-approval policies), `plan-platformFeatures.prompt.md` (M6 automations).

- **Terminal integration — `Bun.shell` backend + per-session terminal pane.** Two surfaces: (a) standalone Terminal panels added to dockview like chat panels; (b) a per-session terminal docked alongside each chat pane, sharing the session's `workingDirectory`, for one-off commands (matches the CLI's inline shell affordance). Backend: `Bun.shell` (or `Bun.spawn` with PTY when needed; spec out node-pty fallback) wrapped behind a `TerminalRegistry` analogous to `SessionRegistry`, exposing `createTerminal({ cwd })` + `writeTerminal` + `resizeTerminal` + `disconnectTerminal` RPCs. Frontend renderer: xterm.js is the safe default; investigate ghostty's web-embeddable build before committing. Output streams over a `terminalEvent` webview RPC message keyed by `terminalId`. Cross-references: `plan-toolsAndPermissions.prompt.md` (shell permission policy still applies inside session-attached terminals), `plan-architecture.prompt.md` (new domain module).


