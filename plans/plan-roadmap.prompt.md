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

