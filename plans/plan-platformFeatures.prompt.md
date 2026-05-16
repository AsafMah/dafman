# Dafman — Platform Features (Projects, Skills, Agents, Automations, Persistence)

## Projects

A Project is the unit of work context.

- `Project { id: Uuid, name: String, root_path: PathBuf, created_at, last_opened_at, settings_overlay: PartialSettings, allowed_tools, mcp_overlay }`.
- Open project → picks a folder, creates a project record, sets it as active.
- Sessions are bound to a project (workspace path passed to SDK via `InfiniteSessionConfig.workspace_path`).
- Projects can be open simultaneously — top bar has a project switcher + the active project chip on each pane.
- Per-project state:
    - Recent sessions.
    - Pinned skills.
    - Tool & permission overlay.
    - Custom system prompt.
- UI: Projects sidebar (collapsible) with recent + pinned; "Open project" dialog (folder picker + name).

## Persistence & resume

- On-disk layout (`<app data>/dafman/`):
    - `settings.json` (versioned schema).
    - `projects/<id>.json`.
    - `sessions/<id>.json` — local metadata (model, project, last event id) + a pointer to SDK's session-state dir.
    - `skills/<id>.json`.
    - `automations/<id>.json`.
    - `mcp/<id>.json`.
- App startup:
    1. Load settings (migrate if version older).
    2. Start client.
    3. Restore previously open projects + sessions (best-effort; fall back to empty workspace).
    4. Resume sessions via `Client::resume_session`.
- Crash safety: writes go through a temp-file + rename pattern.

## Skills

A Skill is a reusable bundle:

```ts
Skill {
  id, name, description,
  system_prompt?: string,
  initial_user_prompt?: string,
  model?: string,
  tools_allow_list?: string[],   // built-ins + MCP namespaces
  variables?: SkillVariable[],   // typed placeholders
  scope: "global" | "project:<id>"
}
```

- Library view: cards with name/description, tags, scope.
- Editor: form for system prompt, model, tool selection, variables, dry-run with placeholder values.
- Invoke: from chat (`/skill name var=value`) or from a Skills launcher.
- Skills can produce a **new session** preconfigured, or **inject** into the current session as a system message + tool overlay.

## Agents & fleets

- Use SDK `session.rpc().fleet().start(...)`.
- UI: when a fleet starts, render a child pane below the parent showing sub-agent activity.
- Sub-agent events (`agent_id` field) are routed to the child pane.
- Cancel sub-agent independently.

## Automations

Automation types:

- **Schedule**: cron-like, run a skill or prompt against a project.
- **File trigger**: when a path matches, run X.
- **Manual**: run on demand, but registered so it appears in the launcher.
- **Webhook** (M6.1): localhost listener for triggers.

Each automation has:

- Owner (global or project).
- Target (skill ref or inline prompt).
- Project context.
- Notification policy (silent / toast / OS notification).
- History view (last N runs with status and excerpts).

### Notifications

- Tauri notification plugin for OS notifications.
- In-app Activity feed (settings → activity) with filtering.
- Quiet hours and per-type opt-out.

## Slash commands

- Implement via SDK `CommandDefinition`. Handlers live in `commands/` and emit chat-side messages or open dialogs.
- Built-ins:
    - `/skill <name>` — run a skill.
    - `/model <id>` — switch model for the session.
    - `/system <text>` — append to system prompt.
    - `/export` — open export dialog.
    - `/notes` — open notes sidebar.
    - `/help` — list commands.

## Custom system message transforms

- UI list of installed transforms; toggle on/off per session/project.
- Each transform = a small Rust module implementing `SystemMessageTransform`.
- User-authored transforms (M7) via WASM plugin or JS sandbox.

## Plans (SDK Plan API)

- Render `session.rpc().plan().read()` as a structured panel inside the pane (collapsible).
- "Edit plan" opens a Markdown editor that calls `plan.update(...)`.

## Memory (M5+)

- Pluggable memory backend interface: `MemoryStore { upsert, query, delete }`.
- Default impl: SQLite + sqlite-vss or LanceDB.
- Tools `memory.write`, `memory.query`, `memory.list`.
- Settings: memory scope (global vs per-project), retention.

## Multi-project workflow

- Active pane shows project chip in header.
- Pane menu: "Move to project…" to retarget.
- Cross-project search (M7).

## Telemetry

- Opt-in OTel via SDK `TelemetryConfig`.
- Local-only logs always on; remote export opt-in.

## Self-control surface (`self.*` tools)

Carefully designed actions the agent can take **inside the app**:

- Open file in Monaco viewer/editor.
- Switch active project.
- Create a new session with provided config (skill ref, model, prompt).
- Show a toast / dialog.
- Create / update a note.

All `self.*` calls go through the permission system.