# Dafman — Roadmap

Milestones are sized to ship in days–weeks, not months. Each one ends with a runnable demo and tests.

## M0 — Foundations (DONE)

- Tauri + Vue 3 + PrimeVue scaffold.
- Single CLI client.
- Create/disconnect sessions.
- Streaming chat (deltas) per session.
- Multi-session grid layout with per-session accent color.

## M1 — Make it solid

Goal: take the prototype and make it a base we can grow on.

- **Backend refactor** to the module layout in `plan-architecture.prompt.md`. Introduce traits + impls + `AppError`.
- **Per-session Tauri channel** (`tauri::ipc::Channel`) instead of a global event.
- **Pinia stores** on the frontend; remove ad-hoc `ref` collections.
- **Typed IPC** (hand-mirror first; specta candidate evaluated).
- **Settings store** on disk (JSON + schema version). Settings dialog (General, Appearance).
- **Real permission UX** replacing `ApproveAllHandler`: SDK request → UI modal → answer.
- **Dark mode** fully token-driven; switch persisted.
- **Tracing logs** to file with rotation; log viewer in settings.
- **Tests**: backend unit tests for managers (with SDK trait fakes), frontend Vitest for stores, one Playwright smoke test.

**Definition of done:** All current features work, but every domain is testable in isolation, no `unwrap` in command paths, settings persist, dark mode is consistent.

## M2 — Messaging power-ups

- Reasoning blocks (collapsed/expanded/hidden) with per-message + global setting.
- Tool call blocks (status, arguments, result, expand/collapse).
- Markdown rendering with syntax-highlighted code blocks; copy-code button.
- Message actions: copy, retry, edit-and-resend, delete.
- Per-session header controls: model picker, system prompt, request_elicitation toggle.
- Export conversation (Markdown, JSON).
- Abort in-flight turn.
- Keyboard shortcuts (`Cmd/Ctrl+Enter` send, `Esc` abort, `Cmd+K` command palette).

**Definition of done:** Chat experience is at parity (or better) with CLI for read-only purposes; tools/reasoning are first-class UI elements.

## M3 — Tools & permissions

- Built-in tool registry (fs read, fs write, edit, search via `grep`, shell with timeout, http).
- Each tool is permissioned through `PermissionService` with a clear UI prompt.
- Permission policies: ask, allow-once, allow-for-session, allow-for-project, deny.
- Rule-based policies (glob/regex over tool + args), editable in settings.
- Tool call visualization (diffs for fs.edit; output preview for shell/http).

**Definition of done:** Sessions can read/write project files, search, shell out, hit the web, with full visibility and control.

## M4 — Projects & resumability

- Project picker (open folder → becomes a project).
- Sessions are scoped to a project (workspace path passed to SDK).
- Per-project settings overlay (model, system prompt, tools allow-list, MCP).
- Resume sessions across restart via SDK `resume_session`.
- Recent projects + recent sessions in a sidebar.
- Crash recovery: restart picks up open panes (best-effort).

**Definition of done:** Close the app mid-conversation, reopen, conversations are back. Multiple projects open in parallel.

## M5 — Integrations: skills, MCP, agents

- **Skills**: named bundle of (instructions + tools subset + model + starter prompt). Library UI + editor.
- **MCP servers**: install/start/stop, surface their tools, wire to permission system.
- **Agents / Fleets**: leverage SDK `fleet.start`, render sub-agent activity in a child pane.
- Slash commands UI (registered via SDK `CommandDefinition`).
- Custom system message transforms via UI.

**Definition of done:** User can install an MCP server and a skill, then invoke them from chat.

## M6 — Automations & notifications

- Scheduled prompts (cron-style + SDK `session.scheduled` if applicable).
- Triggers: file changed, time, manual, webhook (M6.1).
- Background runs surface as desktop notifications + an Activity feed.
- Quiet hours, batching, summary digest.

**Definition of done:** "Every morning, run X in project Y and notify me" works end-to-end.

## M7 — Editor & power UX

- Monaco-based file viewer/editor for tool-touched files.
- Diff viewer for fs.edit/write tool results.
- Inline code apply (preview → accept/reject hunks).
- Workspace search panel (cross-session).
- Command palette (`Cmd+K`).
- Plugin/theme system (later).

**Definition of done:** Dafman feels like an IDE-companion for prompt-driven editing.

## Cross-cutting / continuous

- A11y review at every milestone.
- Bench: cold start, message latency, memory.
- Telemetry opt-in (OTel via SDK's `TelemetryConfig`).
- Docs: a `docs/` site for end-users, plus `CONTRIBUTING.md` for developers.

## Priority table

| Priority | Items |
|---|---|
| P0 (M1) | Module refactor, per-session channel, error model, Pinia, settings persistence, real permissions, dark mode polish, logging, baseline tests. |
| P1 (M2) | Reasoning UI, tool call UI, markdown + code highlight, message actions, model picker, system prompt, abort, shortcuts, export. |
| P2 (M3) | Built-in tools, permission policies, diff/preview for tool results. |
| P3 (M4) | Projects, resume, multi-project, crash recovery. |
| P4 (M5) | Skills, MCP, sub-agents, slash commands. |
| P5 (M6) | Automations, notifications. |
| P6 (M7) | Monaco editor, diffs, command palette. |