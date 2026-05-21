> **Stack note (audited 2026-05-21):** The runtime is **Electrobun + Bun + TypeScript everywhere**. `src-tauri/` is gone, replaced by `src-bun/`. References below to Tauri / Rust / `cargo` are historical context only — the design intent maps cleanly onto the TS stack (single typed IPC surface, domain modules behind traits/interfaces, JSON-RPC under the hood). For the **current reality**, read [`ARCHITECTURE.md`](../ARCHITECTURE.md) at the repo root first, then this doc for direction.
# Dafman — App Overview & Vision
## Elevator pitch
Dafman is a desktop replacement for the GitHub Copilot CLI built on Tauri (Rust backend + Vue 3 frontend). It keeps the speed and resource profile of a Rust process while giving humans a real UI: multiple panes, simultaneous projects, visible reasoning and tool calls, settings, automations, MCP integrations, and an editor for diffs and files. Conversations and configuration persist across restarts.
## Product principles
1. **Real-time, never blocking.** Streaming is the default. The UI must always show what the agent is doing right now — no opaque spinners.
2. **Many things at once.** Multiple sessions, projects, panes, and automations run side by side. Concurrency must be natural, not bolted on.
3. **Visible by default, collapsible by choice.** Tools, reasoning, intermediate artifacts are first-class UI. Users decide how much to see.
4. **Permissioned, never silent.** Every privileged action (fs write, shell, network, browser-opens) goes through a clear permission flow.
5. **Configurable but sane.** Sensible defaults, opinionated layout, every knob reachable from a settings UI — not just config files.
6. **Modular and testable.** Backend split into focused modules behind traits; frontend split into typed feature modules.
7. **Crash-safe and resumable.** Sessions survive restart; the app resumes where you left off.
8. **Themed, accessible, keyboard-first.** PrimeVue tokens for theme; keyboard shortcuts for everything common.
## Tech stack
| Layer       | Choice |
|---|---|
| Shell       | Tauri 2 (Windows/macOS/Linux) |
| Backend     | Rust (tokio), `github-copilot-sdk` via the **Supercharged** distribution (git pin) — superset of upstream v0.3.x |
| Frontend    | Vue 3 + Vite + TypeScript |
| UI kit      | PrimeVue (Aura preset, custom green primary) |
| Icons       | PrimeIcons |
| FE state    | Pinia (introduced in M1) |
| IPC types   | `tauri-specta` (evaluated in M1) for end-to-end typed commands/events |
| Logging     | `tracing` + `tracing-subscriber` (backend), minimal logger (frontend) |
| Editor      | Monaco (web build) for source/diff views |
| Markdown    | `markdown-it` + `shiki` for code blocks |
| URL opener  | `tauri-plugin-opener` (host-side browser opens for OAuth + URL elicitation) |
| Testing     | Backend: `cargo test`, `mockall`, `insta`. Frontend: Vitest, `@vue/test-utils`, Playwright. |
## Document index
| Doc | Contents |
|---|---|
| `plan-overview.prompt.md` | Vision, principles, decisions register, glossary. |
| **`plan-frontend-shell.prompt.md`** | **Current Vue + Bun frontend shell (dockview body, layoutStore, sessionsStore, settings v3, IPC, SDK gotchas). Read this first for frontend work — supersedes `plan-architecture.prompt.md` for the post-Bun-port reality.** |
| `plan-architecture.prompt.md` | Legacy Rust/Tauri layout — historical context only. |
| `plan-roadmap.prompt.md` | Milestones M0–M7 with definition-of-done. |
| `plan-messagingAndUx.prompt.md` | Chat UX, reasoning, tools display, markdown, settings UI, inline elicitation. |
| `plan-toolsAndPermissions.prompt.md` | Built-in tools, permission system, URL policy, MCP. |
| `plan-platformFeatures.prompt.md` | Skills, agents, automations, projects, persistence, multi-account auth. |
| `plan-sdkAndExternalSurfaces.prompt.md` | Supercharged SDK pinning, URL/browser surface, session.ui, image generation, MCP OAuth. |
| `plan-observability.prompt.md` | Logging, tracing, metrics, audit, perf budgets, in-app Log Viewer, privacy controls. |
| `plan-testingStrategy.prompt.md` | Test pyramid, fakes, snapshot tests, e2e, CI. |
## Decisions register
- `[2026-05-16]` Tauri 2 — cross-platform and lightweight.
- `[2026-05-16]` PrimeVue Aura — fast prototyping with theme tokens.
- `[2026-05-16]` Track **Supercharged** distribution of `github-copilot-sdk` (Rust) via git pin until parity version is on crates.io. Migration is a one-line change. See `plan-sdkAndExternalSurfaces.prompt.md`.
- `[2026-05-16]` Sessions are per-pane; one shared CLI client.
- `[2026-05-16]` Streaming is on by default.
- `[2026-05-16]` Permissions default to "ask the user" (no `ApproveAllHandler` in production). Browser/URL opens go through the URL policy.
- `[2026-05-16]` Tokens stored in OS keyring; multi-account supported from M4.
- `[2026-05-16]` Adopt `tracing` + `tracing-subscriber` with JSON file appender + dev-stderr; OTLP export is opt-in. Audit logs are separate from diagnostic logs and never auto-deleted. See `plan-observability.prompt.md`.
- **Open:** product name, MCP scope per release, Monaco vs CodeMirror 6.
## Glossary
- **Client** — one `github_copilot_sdk::Client` (one CLI process).
- **Session** — one chat thread (history, model, system prompt, tools, account).
- **Pane** — UI tile bound to a session.
- **Project** — a workspace folder + per-project config.
- **Skill** — named, reusable prompt + tool bundle.
- **Agent / Fleet** — sub-agent setup via SDK''s fleet API.
- **Automation** — schedule/trigger that runs a session prompt unattended.
- **URL elicitation** — runtime asks the host to open a URL in the user''s default browser (OAuth, consent, docs).



