# Dafman — Architecture

## Goals

- Replace today's single-file `src-tauri/src/lib.rs` with a layered, module-per-concern backend.
- Replace today's flat `src/` with a feature-oriented frontend.
- Make a typed, versioned IPC contract that both sides import from one source of truth.
- Keep concurrency obvious: one CLI client, one event task per session, one Tauri channel per session for streaming.
- Make every layer testable without spawning the CLI.

## Backend module layout (`src-tauri/src/`)

```
src/
  main.rs                    # binary entry (calls lib::run)
  lib.rs                     # tauri::Builder setup, registers commands, manages state
  app/
    mod.rs
    state.rs                 # AppState aggregate; uses thin sub-states from each domain
    error.rs                 # AppError enum, IntoTauriError impl
    events.rs                # canonical event payload types emitted to the frontend
    config.rs                # app-level config loader/saver (paths, defaults)
  ipc/
    mod.rs                   # re-exports
    commands/
      client.rs              # create_client, stop_client, client_status
      session.rs             # create_session, disconnect_session, send_message, abort
      project.rs             # open_project, close_project, list_projects
      permission.rs          # respond_to_permission_request
      settings.rs            # get_settings, update_settings
      skills.rs              # list_skills, create_skill, run_skill
      automation.rs          # list_automations, create_automation, ...
      mcp.rs                 # list_mcp_servers, install_mcp_server, ...
    types.rs                 # public IPC types (serde + ts-rs / specta)
  sessions/
    mod.rs
    manager.rs               # SessionManager trait + Tokio impl
    entry.rs                 # SessionEntry { session, event_task, project_id, ... }
    stream.rs                # background subscription -> AppHandle.emit per session
    handler.rs               # DafmanSessionHandler: SessionHandler impl, routes to PermissionService
  client/
    mod.rs
    manager.rs               # ClientManager trait + Tokio impl, holds Arc<Client>
  projects/
    mod.rs
    project.rs               # Project struct (id, root_path, settings_overlay)
    registry.rs              # ProjectRegistry trait + on-disk impl
  permissions/
    mod.rs
    policy.rs                # PermissionPolicy enum: AlwaysAsk | ApproveAll | DenyAll | Rules
    rules.rs                 # rule engine (glob/regex over tool name + arguments)
    service.rs               # PermissionService trait + impl, pairs SDK requests with UI prompts
  tools/
    mod.rs
    registry.rs              # ToolHandlerRouter wiring
    fs.rs                    # read_file, write_file, edit_file
    search.rs                # ripgrep-backed search
    shell.rs                 # bounded, permissioned shell exec
    http.rs                  # bounded, permissioned HTTP
    web_browser.rs           # M5 — headless browser tool
  mcp/
    mod.rs                   # MCP client wrappers, registry, lifecycle
  skills/
    mod.rs                   # skill model, loader, runtime
  automation/
    mod.rs                   # scheduler, triggers
    notify.rs                # desktop notifications (tauri plugin)
  settings/
    mod.rs                   # global + per-project settings
    schema.rs                # versioned settings schema
    store.rs                 # on-disk persistence (JSON / TOML)
  logging.rs                 # tracing subscriber setup, file rotation
  prelude.rs                 # internal: common imports
```

### Key rules

- **No global state, no `static` mutables.** Each domain exposes a trait + an impl behind `Arc<dyn Trait>`. They go into a single `AppState` (Tauri managed).
- **Domain modules don't depend on Tauri.** Only `ipc/` and `app/` know about `tauri::*`. Domain types are testable in isolation.
- **Async-correct.** `tokio::sync::Mutex` for state shared across await boundaries; everything time-sensitive is non-blocking. No `std::sync::Mutex` across `.await`.
- **Cancellation-safe.** Background tasks store `JoinHandle`s; teardown aborts them and the SDK calls.
- **Errors are values.** A single `AppError` (with `thiserror`), converted to a structured payload at the IPC boundary.

### Trait sketches

```rust
#[async_trait::async_trait]
pub trait ClientManager: Send + Sync {
    async fn start(&self) -> Result<(), AppError>;
    async fn stop(&self) -> Result<(), AppError>;
    fn handle(&self) -> Option<Arc<Client>>;
    fn status(&self) -> ClientStatus;
}

#[async_trait::async_trait]
pub trait SessionManager: Send + Sync {
    async fn create(&self, opts: CreateSessionOpts) -> Result<SessionId, AppError>;
    async fn send(&self, sid: &SessionId, msg: UserMessage) -> Result<MessageId, AppError>;
    async fn abort(&self, sid: &SessionId) -> Result<(), AppError>;
    async fn disconnect(&self, sid: &SessionId) -> Result<(), AppError>;
    fn snapshot(&self, sid: &SessionId) -> Option<SessionSnapshot>;
}

#[async_trait::async_trait]
pub trait PermissionService: Send + Sync {
    async fn request(&self, req: PermissionRequest) -> PermissionResult;
    async fn answer(&self, ticket: PermissionTicket, decision: PermissionDecision);
    fn policy(&self) -> PermissionPolicy;
    fn set_policy(&self, policy: PermissionPolicy);
}
```

### Event channel

- One global Tauri event named `session-event` carrying `{ sessionId, eventType, data }` works today but doesn't scale. M1 introduces per-session Tauri channels (`tauri::ipc::Channel<T>`) returned from `create_session` so each pane only receives events for its own session.

## Frontend module layout (`src/`)

```
src/
  main.ts                    # PrimeVue init, theme, mounts <App/>
  style.css                  # token-anchored globals only (font, body, scroll lock)
  app/
    App.vue                  # shell: top bar + main view
    routes.ts                # if/when we add multiple top-level views
    composables/
      useTheme.ts            # dark-mode toggle bound to PrimeVue darkModeSelector
      useKeybindings.ts      # registers and dispatches shortcuts
      useToast.ts            # wrapper around PrimeVue toast
  features/
    chat/
      ChatGrid.vue           # grid container for ChatPane
      ChatPane.vue           # one session pane (replaces ChatWindow.vue)
      MessageList.vue
      MessageBubble.vue
      ReasoningBlock.vue
      ToolCallBlock.vue
      Composer.vue
      useChatSession.ts      # composable: events listener + send + abort
    projects/
      ProjectPicker.vue
      ProjectSettings.vue
      useProjects.ts
    permissions/
      PermissionPrompt.vue   # modal that surfaces SDK permission requests
      usePermissionQueue.ts
    settings/
      SettingsDialog.vue
      sections/
        General.vue
        Models.vue
        Tools.vue
        Mcp.vue
        Permissions.vue
        Appearance.vue
      useSettings.ts
    skills/
      SkillLibrary.vue
      SkillEditor.vue
    automations/
      AutomationList.vue
      AutomationEditor.vue
    editor/
      MonacoEditor.vue       # thin wrapper
      DiffViewer.vue
    sessions/
      SessionList.vue        # global session manager (resume, search)
  stores/                    # Pinia
    clientStore.ts           # client status, model list
    sessionsStore.ts         # session entities, per-session message log
    projectsStore.ts
    settingsStore.ts
    permissionsStore.ts
    toastStore.ts
  ipc/
    invoke.ts                # typed wrappers around invoke() per command (or generated by specta)
    events.ts                # typed listeners for app-emitted events
    types.ts                 # shared with backend (specta-generated or hand-mirrored)
  lib/
    color.ts                 # session-id -> accent (hsl)
    markdown.ts              # markdown-it config + shiki highlighter
    keyboard.ts              # key combo helpers
```

### Key rules

- **Components are dumb.** Data + actions come from composables / stores. Components only render.
- **No raw `invoke()` in components.** Always go through `ipc/invoke.ts`.
- **Strict TypeScript.** `strict: true`, `noUncheckedIndexedAccess: true`.
- **No hardcoded hex colors except token fallbacks.** Use `var(--p-*)` for everything that should adapt to theme.

## IPC contract

Every command and event is defined once and shared across Rust ↔ TS:

- Hand-mirror in M1: `ipc/types.ts` matches `src-tauri/src/ipc/types.rs` (small surface; easy to maintain).
- Promote to `tauri-specta` in M2 once the surface stabilizes — it generates TS definitions from Rust types/commands so they can't drift.

### Commands (initial set)

```
client.start  () -> ClientStatus
client.stop   () -> ()
client.status () -> ClientStatus

session.create   (opts: CreateSessionOpts) -> { sessionId, channel }
session.send     (sessionId, text, attachments?) -> MessageId
session.abort    (sessionId) -> ()
session.disconnect (sessionId) -> ()
session.snapshot (sessionId) -> SessionSnapshot

permissions.respond (ticket, decision) -> ()
permissions.set_policy (policy) -> ()

projects.list   () -> Project[]
projects.open   (path) -> Project
projects.close  (id) -> ()

settings.get    () -> Settings
settings.update (patch) -> Settings

skills.list/create/update/delete/run
automations.list/create/update/delete/run_now
mcp.list/install/remove/start/stop
```

### Events

- Per-session channel events (preferred): `assistant_message_start/delta/message`, `reasoning_start/delta`, `tool_call_start/progress/complete`, `permission_request`, `session_idle`, `session_error`, `model_change`, `usage_info`.
- App-level events: `client_status_changed`, `permission_requested`, `notification`, `automation_fired`, `mcp_status_changed`.

## State model

### Backend

`AppState` is small and aggregates managers:

```rust
pub struct AppState {
    pub client: Arc<dyn ClientManager>,
    pub sessions: Arc<dyn SessionManager>,
    pub projects: Arc<dyn ProjectRegistry>,
    pub permissions: Arc<dyn PermissionService>,
    pub settings: Arc<dyn SettingsStore>,
    pub mcp: Arc<dyn McpRegistry>,
    pub skills: Arc<dyn SkillRegistry>,
    pub automations: Arc<dyn AutomationScheduler>,
}
```

Each manager owns its own internal mutability. Commands take `tauri::State<'_, AppState>` and call domain methods.

### Frontend (Pinia)

Stores mirror backend domains. Each store handles its own `listen()` subscriptions and exposes computed views to components. Only stores call IPC; components are read-only consumers + action dispatchers.

## Error model

```rust
#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum AppError {
    #[error("client not started")] ClientNotStarted,
    #[error("session {0} not found")] SessionNotFound(String),
    #[error("permission denied: {0}")] PermissionDenied(String),
    #[error("sdk: {0}")] Sdk(String),
    #[error("io: {0}")] Io(String),
    #[error("invalid argument: {0}")] InvalidArgument(String),
    #[error("internal: {0}")] Internal(String),
}
```

- Implement `From<github_copilot_sdk::Error> for AppError` so SDK transport failures are typed.
- Tauri commands return `Result<T, AppError>`; frontend gets a discriminated union it can pattern-match.

## Threading & concurrency

- One tokio runtime (Tauri's).
- One `Client` (background CLI process).
- Per session: one `Arc<Session>`, one event-forwarding task, one cancel token.
- Permission flow uses an `oneshot` channel: SDK request → frontend prompt → user answer → channel → SDK reply.
- Tools that block (shell, fs, http) spawn on tokio's blocking pool or use native async clients (reqwest, tokio::fs).
- All cleanup on app exit: stop scheduler → abort session tasks → `session.disconnect()` for each → `client.stop()`.

## Configuration & paths

- App data root: `dirs::data_dir() / "dafman"`.
- Sub-paths:
    - `settings.json` — global settings (schema-versioned).
    - `projects/` — per-project overlays.
    - `sessions/` — resumable session metadata (separate from SDK's own session-state dir).
    - `skills/` — user-defined skills.
    - `automations/` — schedules.
    - `mcp/` — installed MCP server configs.
    - `logs/` — rotating log files.

## Build & release

- `cargo` workspace stays single-crate for now; if `tools`, `mcp`, `skills` grow, split into a workspace with `dafman-core`, `dafman-tools`, `dafman-mcp`, `dafman-app` (binary).
- Frontend bundled by Vite; Tauri bundles for win/mac/linux.
- CI matrix runs `cargo test`, `cargo clippy`, frontend `vitest`, frontend `vue-tsc`, Playwright e2e against `tauri build`.
- Versioning: semver; pinned `github-copilot-sdk` version per release.