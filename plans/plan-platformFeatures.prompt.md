# Dafman — Platform Features
Projects, accounts, persistence, skills, agents, automations, memory, slash commands, plans, transforms, multi-project workflow, self-control surface.
## Projects
A Project is the unit of work context.
- `Project { id: Uuid, name: String, root_path: PathBuf, created_at, last_opened_at, settings_overlay: PartialSettings, allowed_tools, mcp_overlay }`.
- Open project → folder picker → creates project record → set active.
- Sessions are bound to a project. The SDK is given `workspace_path` and `enableConfigDiscovery: true` so `.mcp.json` and skill dirs are auto-loaded from the workspace.
- Projects can be open simultaneously; the top bar has a project switcher and each pane shows its project chip.
- Per-project state:
  - Recent sessions.
  - Pinned skills.
  - Tool & permission overlay (+ `excludedTools`).
  - MCP overlay (per-server enable/disable).
  - Custom system prompt (any mode).
  - Default account.
- UI: Projects sidebar (collapsible) with recent + pinned; "Open project" dialog (folder picker + name).
## Accounts (multi-auth)
- `Account { id, login, display_name, kind: GitHub | BYOK { provider, label }, default_for_project: Option<ProjectId> }`.
- Tokens stored in OS keyring (Windows Credential Manager, macOS Keychain, Secret Service on Linux).
- Add a GitHub account: opens the OAuth URL via the URL elicitation/policy flow; account appears in Accounts list when the callback completes.
- Per-session GitHub auth (supercharged v2.0) — the SDK accepts a token per `CreateSessionOpts`.
- Per-session pin via session header; per-project default; global default fallback.
- Settings → Accounts: list + add + remove + set default; surface scopes and expiry.
## Persistence & resume
On-disk layout (`<app data>/dafman/`):
- `settings.json` (versioned schema).
- `projects/<id>.json`.
- `sessions/<id>/`
  - `meta.json` — local metadata (model, project, last event id, account id).
  - `events.log` — SessionFsProvider-managed event log.
- `skills/<id>.json`.
- `automations/<id>.json`.
- `mcp/<id>.json`.
- `accounts.json` (public profile; tokens in OS keyring).
- `audit/` — permission + URL audit logs.
- `logs/`.
App startup:
1. Load settings (migrate if older).
2. Start CLI client.
3. Restore previously open projects + sessions (best-effort).
4. Resume each session via `Client::resume_session` (use `getSessionMetadata` to validate).
5. Reattach per-session event subscriptions.
Crash safety: writes use a temp-file + rename pattern; an autosave loop flushes hot state every 5 s.
## Skills
Reusable agent bundle (supercharged v2.0 supports preloading skill content):
```ts
Skill {
  id, name, description, tags,
  system_prompt?: SystemPromptConfig,  // append / replace / customize
  preload?: { content: string, files?: string[] },
  initial_user_prompt?: string,
  model?: string,
  capability_overrides?: ModelCapabilities,
  tools_allow_list?: string[],
  excluded_tools?: string[],
  variables?: SkillVariable[],
  scope: "global" | "project:<id>"
}
```
- Library view: cards with name/description, tags, scope.
- Editor: form for system prompt, model + capability overrides, tool selection, variables, dry-run with placeholder values.
- Invoke: from chat (`/skill name var=value`) or from a Skills launcher.
- Skills can produce a **new session** preconfigured, or **inject** into the current session as a system message + tool overlay.
## Slash commands
Use SDK `CommandDefinition`. Handlers live in `commands/` and emit chat-side messages or open dialogs.
Built-ins:
- `/skill <name>` — run a skill.
- `/model <id>` — switch model for the session.
- `/system <text>` — append to system prompt.
- `/export` — open export dialog.
- `/notes` — open notes sidebar.
- `/help` — list commands.
- `/account <login>` — switch session account.
- `/abort` — abort current turn.
## Agents & fleets
- Use SDK `session.rpc().fleet().start(...)`.
- UI: when a fleet starts, render a child pane below the parent for sub-agent activity.
- Sub-agent events (`agent_id` field) route to the child pane.
- Sub-agent streaming forwarding is configurable per supercharged v2.0; toggle in session settings.
- Cancel sub-agent independently.
## Automations
Automation types:
- **Schedule**: cron-like, run a skill or prompt against a project.
- **File trigger**: when a path matches, run X.
- **Manual**: run on demand; registered in the launcher.
- **Webhook** (M6.1): localhost listener.
Each automation has:
- Owner (global or project).
- Target (skill ref or inline prompt).
- Project context + account.
- Notification policy (silent / toast / OS notification).
- History view (last N runs with status and excerpts).
### Notifications
- Tauri notification plugin for OS notifications.
- In-app Activity feed (Settings → Activity) with filtering.
- Quiet hours and per-type opt-out.
## Custom system message transforms
- UI list of installed transforms; toggle on/off per session/project.
- Each transform = a small Rust module implementing `SystemMessageTransform`.
- User-authored transforms (M7) via WASM plugin or JS sandbox.
- Cross-reference to system prompt section editor in `plan-sdkAndExternalSurfaces.prompt.md` (`customize` mode with ten named sections).
## Plans (SDK Plan API)
- Render `session.rpc().plan().read()` as a structured panel inside the pane (collapsible).
- "Edit plan" opens a Markdown editor that calls `plan.update(...)`.
- Plan changes also surface as `session.plan_changed` events in the message stream.
## Idle timeout
- Per-session idle timeout (supercharged v2.0); default 30 min, configurable globally and overridable per session.
- When fired, disconnect the session cleanly, persist meta, and emit a desktop notification with "Reconnect" action.
## Memory (M5+)
- Pluggable memory backend interface: `MemoryStore { upsert, query, delete }`.
- Default impl: SQLite + sqlite-vss or LanceDB.
- Tools `memory.write`, `memory.query`, `memory.list`.
- Settings: memory scope (global vs per-project), retention.
## Image generation
- `MessageOptions` carries response format + image options (supercharged v2.0).
- Composer Advanced panel exposes them.
- Renderer in `MessageBubble.vue` shows generated images; multi-image responses render as a thumbnail row.
- Save As / Copy actions per image.
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
