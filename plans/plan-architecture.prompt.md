# Dafman — Architecture
## Goals
- Replace today''s single-file `src-tauri/src/lib.rs` with a layered, module-per-concern backend.
- Replace today''s flat `src/` with a feature-oriented frontend.
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
    state.rs                 # AppState aggregate
    error.rs                 # AppError enum, IntoTauriError impl
    events.rs                # canonical event payload types emitted to the frontend
    config.rs                # app-level config loader/saver (paths, defaults)
  ipc/
    mod.rs
    commands/
      client.rs              # create_client, stop_client, client_status
      session.rs             # create_session, disconnect_session, send_message, abort
      project.rs             # open_project, close_project, list_projects
      permission.rs          # respond_to_permission_request
      external.rs            # open_url, url_policy_get/set
      ui.rs                  # session_ui_respond (confirm/select/input)
      settings.rs            # get_settings, update_settings
      skills.rs              # list_skills, create_skill, run_skill
      automation.rs          # list_automations, create_automation, ...
      mcp.rs                 # list_mcp_servers, install_mcp_server, oauth_complete, ...
      auth.rs                # list_accounts, add_account, remove_account, pin_account
    types.rs                 # public IPC types (serde + ts-rs / specta)
  sessions/
    mod.rs
    manager.rs               # SessionManager trait + Tokio impl
    entry.rs                 # SessionEntry { session, event_task, project_id, account_id, ... }
    stream.rs                # background subscription -> per-session Tauri channel
    handler.rs               # DafmanSessionHandler: SessionHandler impl; routes permission/elicitation
    fs.rs                    # SessionFsProvider impl writing under <app-data>/sessions/<id>/
  client/
    mod.rs
    manager.rs               # ClientManager trait + Tokio impl, holds Arc<Client>
  external/
    mod.rs                   # UrlOpener trait + tauri-plugin-opener impl
    policy.rs                # UrlPolicy, UrlRule, evaluator
  projects/
    mod.rs
    project.rs               # Project struct (id, root_path, settings_overlay, mcp_overlay)
    registry.rs              # ProjectRegistry trait + on-disk impl
  permissions/
    mod.rs
    policy.rs                # PermissionPolicy: AlwaysAsk | ApproveAll | DenyAll | Rules
    rules.rs                 # rule engine
    service.rs               # PermissionService: pairs SDK requests with UI prompts
  tools/
    mod.rs
    registry.rs              # ToolHandlerRouter wiring + excludedTools overlay
    fs.rs                    # read, write, edit
    search.rs                # ripgrep-backed search
    shell.rs                 # bounded, permissioned shell exec
    http.rs                  # bounded, permissioned HTTP
    web_browser.rs           # M6 — headless browser tool (separate from URL-opener)
  mcp/
    mod.rs                   # MCP registry, lifecycle, OAuth coordination
    config.rs                # discriminated stdio/HTTP config types
  skills/
    mod.rs
  automation/
    mod.rs
    notify.rs
  auth/
    mod.rs                   # Accounts, token storage (OS keyring), per-session pinning
    keyring.rs
  settings/
    mod.rs
    schema.rs                # versioned settings schema
    store.rs
  logging.rs
  prelude.rs
```
### Key rules
- **No global state.** Each domain exposes a trait + an impl behind `Arc<dyn Trait>` in `AppState`.
- **Domain modules don''t depend on Tauri.** Only `ipc/` and `app/` know about `tauri::*`.
- **Async-correct.** `tokio::sync::Mutex` for shared state across await; no `std::sync::Mutex` across `.await`.
- **Cancellation-safe.** Background tasks store `JoinHandle`s; teardown aborts them.
- **Errors are values.** Single `AppError` (with `thiserror`); structured payload at IPC boundary.
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
#[async_trait::async_trait]
pub trait UrlOpener: Send + Sync {
    async fn open(&self, url: &Url, ctx: OpenUrlContext) -> Result<(), AppError>;
}
```
### Event channel
- Per-session Tauri channel (`tauri::ipc::Channel<T>`) returned from `create_session` so each pane only receives events for its own session. Removes filtering on the frontend.
- App-level events (client status, permission queue, MCP/OAuth, automations) use named global events.
## Frontend module layout (`src/`)
```
src/
  main.ts
  style.css                  # token-anchored globals only
  app/
    App.vue                  # shell: top bar + main view
    routes.ts
    composables/
      useTheme.ts
      useKeybindings.ts
      useToast.ts
  features/
    chat/
      ChatGrid.vue           # responsive grid of ChatPane
      ChatPane.vue           # one session pane (replaces ChatWindow.vue)
      MessageList.vue
      MessageBubble.vue
      ReasoningBlock.vue
      ToolCallBlock.vue
      ImageBlock.vue         # generated image rendering
      InlineConfirm.vue      # session.ui.confirm
      InlineSelect.vue       # session.ui.select
      InlineInput.vue        # session.ui.input
      UrlElicitationCard.vue # URL-mode elicitation
      Composer.vue
      useChatSession.ts      # per-pane composable: channel listener + send + abort
    projects/
      ProjectPicker.vue
      ProjectSettings.vue
      useProjects.ts
    permissions/
      PermissionPrompt.vue
      usePermissionQueue.ts
    elicitation/
      ElicitationQueue.vue   # central queue (form mode)
      OAuthToast.vue         # MCP OAuth toast
    settings/
      SettingsDialog.vue
      sections/
        General.vue
        Models.vue
        Tools.vue
        Mcp.vue
        Permissions.vue
        Appearance.vue
        Accounts.vue         # multi-account
        UrlPolicy.vue        # URL/browser policy editor
        SystemPrompt.vue     # append/replace/customize section editor
      useSettings.ts
    skills/
      SkillLibrary.vue
      SkillEditor.vue
    automations/
      AutomationList.vue
      AutomationEditor.vue
    editor/
      MonacoEditor.vue
      DiffViewer.vue
    sessions/
      SessionList.vue
  stores/                    # Pinia
    clientStore.ts
    sessionsStore.ts
    projectsStore.ts
    settingsStore.ts
    permissionsStore.ts
    elicitationStore.ts
    accountsStore.ts
    toastStore.ts
  ipc/
    invoke.ts                # typed wrappers around invoke()
    events.ts                # typed listeners
    types.ts                 # shared/generated types
  lib/
    color.ts                 # session-id -> accent (hsl)
    markdown.ts
    keyboard.ts
  dev/                       # DEV-only surfaces, dynamically imported in main.ts
    Playground.vue           # exercise chat components without a real SDK turn
```
### Key rules
- **Components are dumb.** Data + actions come from composables / stores.
- **No raw `invoke()` in components.** Always via `ipc/invoke.ts`.
- **Strict TypeScript.** `strict: true`, `noUncheckedIndexedAccess: true`.
- **No hardcoded hex colors** — `var(--p-*)` tokens only (unless a per-session accent color).
## IPC contract
Defined once, shared. M1: hand-mirrored. M2: promote to `tauri-specta`.
### Commands (initial set)
```
client.start | stop | status
session.create   (opts) -> { sessionId, channel }
session.send     (sessionId, text, attachments?, mode?, headers?, response_format?) -> MessageId
session.abort | disconnect | snapshot
session.ui_respond  (sessionId, requestId, response)
session.set_model    (sessionId, modelId, capabilityOverrides?)
session.set_system_prompt (sessionId, config)
permissions.respond | set_policy
external.open_url  (url, origin, sessionId?, mcpServerId?, reason?) -> ()
external.url_policy.get | set
projects.list | open | close
settings.get | update
skills.list | create | update | delete | run
automations.list | create | update | delete | run_now
mcp.list | install | remove | start | stop | oauth_completed (manual fallback)
auth.list | add | remove | pin_to_session
```
### Events
- Per-session channel: `assistant_message_start/delta/message`, `assistant_reasoning_start/delta`, `tool_call_start/progress/complete`, `permission_request`, `elicitation_request`, `url_open_requested`, `session_ui_request`, `session_idle`, `session_error`, `model_change`, `usage_info`.
- App-level: `client_status_changed`, `mcp_status_changed`, `mcp_oauth_required`, `notification`, `automation_fired`.
## State model
### Backend
```rust
pub struct AppState {
    pub client: Arc<dyn ClientManager>,
    pub sessions: Arc<dyn SessionManager>,
    pub projects: Arc<dyn ProjectRegistry>,
    pub permissions: Arc<dyn PermissionService>,
    pub url_opener: Arc<dyn UrlOpener>,
    pub settings: Arc<dyn SettingsStore>,
    pub mcp: Arc<dyn McpRegistry>,
    pub skills: Arc<dyn SkillRegistry>,
    pub automations: Arc<dyn AutomationScheduler>,
    pub accounts: Arc<dyn AccountStore>,
}
```
### Frontend (Pinia)
Stores mirror backend domains; only stores call IPC; components are read-only consumers + action dispatchers.
## Error model
```rust
#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum AppError {
    #[error("client not started")] ClientNotStarted,
    #[error("session {0} not found")] SessionNotFound(String),
    #[error("permission denied: {0}")] PermissionDenied(String),
    #[error("url blocked: {0}")] UrlBlocked(String),
    #[error("sdk: {0}")] Sdk(String),
    #[error("io: {0}")] Io(String),
    #[error("invalid argument: {0}")] InvalidArgument(String),
    #[error("internal: {0}")] Internal(String),
}
```
## Threading & concurrency
- One tokio runtime (Tauri''s).
- One `Client` (background CLI process).
- Per session: one `Arc<Session>`, one event-forwarding task, one cancel token.
- Permission and elicitation flows use `oneshot` channels: SDK request → frontend prompt → user answer → channel → SDK reply.
- All blocking I/O (shell, fs) on tokio''s blocking pool; async clients (reqwest, tokio::fs) elsewhere.
- Cleanup on exit: stop scheduler → abort tasks → disconnect sessions → stop client → flush logs.
## Configuration & paths
App data root: `dirs::data_dir() / "dafman"`.
```
dafman/
  settings.json
  projects/<id>.json
  sessions/<id>/             # SessionFsProvider target
    meta.json
    events.log
  skills/<id>.json
  automations/<id>.json
  mcp/<id>.json
  accounts.json              # public profile; tokens in OS keyring
  logs/
  audit/                     # url + permission audit logs
```
## Observability modules
Lives across these backend modules (see `plan-observability.prompt.md` for the full design):
- `logging.rs` — `tracing` subscriber, file appender (daily JSON), dev-stderr layer, runtime `EnvFilter` handle, redaction helpers, OTLP layer toggle.
- `metrics/` — counters/histograms behind an `Arc<dyn MetricsRecorder>` so it''s easy to swap implementations and to no-op in tests.
- `audit/` — append-only writers for `permissions.log`, `urls.log`, `accounts.log` (separate from diagnostic logs).
- `ipc/commands/diagnostics.rs` — IPC for the in-app Log Viewer:
  - `diagnostics.tail` (subscribe to live log lines via a Tauri channel),
  - `diagnostics.set_level`, `diagnostics.snapshot_metrics`,
  - `diagnostics.export_bundle` (zip logs + redacted settings + recent events).
Frontend mirror:
- `src/lib/logger.ts` — typed logger; high-severity entries forwarded to the backend.
- `src/features/settings/sections/Diagnostics.vue` — log tail, level controls, metrics dashboard, "Export diagnostics bundle" button.
- `src/features/settings/sections/Privacy.vue` — toggles for OTLP exporter and crash reports.

## Build & release
- Single crate today; if `tools`, `mcp`, `skills` grow, split into workspace: `dafman-core`, `dafman-tools`, `dafman-mcp`, `dafman-app` (binary).
- Frontend bundled by Vite; Tauri bundles per OS.
- CI matrix: `cargo test`, `cargo clippy`, `vue-tsc`, `vitest`, Playwright e2e against `tauri build`.
- Pinned `github-copilot-sdk` (Supercharged) SHA per release; CI verifies the lockfile.
- Release builds use SDK `embedded-cli` feature for self-contained binaries.



