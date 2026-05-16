# Dafman — SDK & External Surfaces (Supercharged alignment)
Adds the bits the rest of the plan was missing once we accept that we''ll track the **Supercharged** distribution of the SDK (Rust), which is a superset of upstream `github-copilot-sdk` v0.3.x.
## SDK pinning strategy
- **Primary dependency:** `github-copilot-sdk` (lib name `github_copilot_sdk`) sourced from the Supercharged repo''s `rust/` subdir as a git dependency until the matching version is published on crates.io.
- `Cargo.toml`:
  ```toml
  github-copilot-sdk = { git = "https://github.com/jeremiahjordanisaacson/copilot-sdk-supercharged", rev = "<pinned-sha>", package = "github-copilot-sdk", path = "rust" }
  ```
  If `path` inside a git dep is unsupported by Cargo for sub-crates, switch to a workspace fork: vendor the `rust/` dir under `vendor/copilot-sdk` and reference via `path = "vendor/copilot-sdk"`.
- Pinned SHA recorded in `plan-overview.prompt.md` Decisions register.
- Migrate back to crates.io `github-copilot-sdk` >= matching version when published.
- Surface differences live in this doc so the migration is a one-line change.
## v2.0 feature map → Dafman modules
| Supercharged v2.0 feature | Where it lives in our app |
|---|---|
| `enableConfigDiscovery` (auto-detect `.mcp.json`, skill dirs in workspace) | `projects/`: when opening a project, enable discovery for sessions bound to it. Surface discovered MCP servers + skills in the project page. |
| Per-session GitHub auth (token per session) | `auth/` (new submodule of `sessions/`): a `SessionAuth { token: AccessToken, source: enum }` attached to `CreateSessionOpts`. Settings → Accounts UI to manage multi-account. |
| Session idle timeout | `sessions/manager.rs`: pass through; settings to tune defaults; UI shows the active timeout in the session header. |
| `sessionFs` (virtualized per-session storage) | `sessions/fs/`: provide a default in-memory + on-disk impl; pluggable for cloud back-ends. Used so per-session event logs land under our `<app-data>/sessions/<id>/` instead of the SDK''s default location. |
| Commands + UI elicitation (`session.ui.confirm/select/input`) | `ipc/commands/ui.rs` + frontend `features/elicitation/` (modal/inline elicitation). Slash commands live in `features/chat/composer.vue` + `commands/`. |
| URL-mode elicitation & OAuth flow | New section below: *Browser & external URLs*. |
| System prompt modes (`append` / `replace` / `customize`) | `features/settings/sections/SystemPrompt.vue` + per-session "System prompt" panel. Skill bundles can choose any mode. |
| Per-agent skills (preload skill content) | `skills/`: when running a skill, build the `SessionConfig` with the skill''s preloaded content. Sub-agents (Fleet) inherit skill subset. |
| Per-agent tool visibility (`excludedTools`) | `permissions/policy.rs` gains a per-skill / per-agent overlay; passes through to SDK. |
| Runtime request headers per turn | `MessageOptions` builder; UI hidden by default, exposed in Advanced send panel. |
| Model capabilities override | Settings → Models → "Capability overrides" per model id; merged into SDK config. |
| Sub-agent streaming events forwarding | `sessions/handler.rs`: configurable; default on so the child pane streams. Toggle in Settings → Performance. |
| `session.getMetadata` | Replaces "list-and-filter" in `sessionsStore` resume path. |
| MCP server config refactoring (stdio / HTTP) | `mcp/`: discriminated config type `McpServerKind::Stdio { … } | Http { … }`. Per-server settings panel renders the right form. |
| Image generation (response format + image options) | `features/chat/MessageBubble.vue` renders generated images; `MessageOptions` exposes image opts via Advanced send. |
| Bundled CLI in non-Node SDKs | We''re Rust; opt into `features = ["embedded-cli"]` for release builds (pin via `COPILOT_CLI_VERSION` in CI). |
## Browser & external URLs (the previously-missing module)
The SDK never opens a browser itself. **We** (the host) must open URLs the runtime requests. There are two cases:
1. **URL-mode elicitation** — the agent or an MCP server requests the user to visit a URL (consent, sign-in, payment, doc). The CLI emits an elicitation request with `ElicitationMode::Url` and an `url` field.
2. **MCP OAuth** — when adding/refreshing an MCP server, the runtime returns an `authorization_url` (or signals via `session.mcp_server_status_changed`) that the user must visit to complete OAuth. The runtime starts a callback listener; we only need to open the URL.
### Backend module
- New module: `external/` (or `sessions/external_urls.rs`).
- Trait:
  ```rust
  #[async_trait::async_trait]
  pub trait UrlOpener: Send + Sync {
      async fn open(&self, url: &Url, ctx: OpenUrlContext) -> Result<(), AppError>;
  }
  pub struct OpenUrlContext {
      pub origin: UrlOrigin,            // Elicitation | McpOAuth | UserClicked | ToolResult
      pub session_id: Option<SessionId>,
      pub mcp_server_id: Option<McpServerId>,
      pub reason: Option<String>,
  }
  ```
- Default impl wraps `tauri-plugin-opener` (already a dependency).
- All opens are subject to the **URL policy** (see Permissions, below).
### URL policy (extension of Permissions)
Add to `PermissionPolicy` rule effects:
```rust
pub enum UrlEffect { OpenAlways, AskOnce, AskAlways, Deny }
pub struct UrlRule {
    pub host_match: HostPattern,         // exact, suffix, glob
    pub scheme: SchemeMatch,             // https-only by default
    pub origin: UrlOrigin,               // optional scope
    pub effect: UrlEffect,
}
```
Defaults:
- `https://github.com/login/*` → AllowAlways (OAuth happy path).
- `https://*.githubcopilot.com/*` → AllowAlways.
- Anything else → AskOnce, remembered per session if the user picks "Allow for session".
- `http://localhost:*` → AllowAlways (OAuth callbacks).
- `data:`, `javascript:`, `file:` → Deny.
### Frontend UX
- **URL elicitation card** (inline in chat):
  - Title: "Open a link in your browser?"
  - Source label (which agent / MCP server requested it).
  - Visible URL (full, monospace) + host badge with risk indicator.
  - Reason text from the elicitation.
  - Actions: **Open**, **Open and don''t ask again for this host**, **Copy URL**, **Cancel**.
- **MCP OAuth toast** (top-right):
  - "Authorize the **GitHub MCP** server."
  - Buttons: **Open** / **Copy URL** / **Dismiss**.
  - When OAuth completes (next `mcp_server_status_changed` event), the toast updates to "Connected".
- **Audit**: every open is logged with origin, decision, ts.
### IPC additions
```
external.open_url      (url, origin, sessionId?, mcpServerId?, reason?) -> ()
external.url_policy.get / set
```
Events:
```
url_open_requested  (request_id, url, origin, ...)   // for ask flow
url_open_decided    (request_id, decision)
mcp_oauth_required  (server_id, url)
mcp_status_changed  (server_id, status)
```
### Threading & lifecycle
- The session handler reacts to elicitation events on the per-session task; URL elicitation is forwarded to the UI as a regular `permission_request`-style modal but typed as `url_open_requested`.
- MCP OAuth is initiated from the MCP manager; same UI surface; we don''t need a callback server (the SDK runs it).
## Session UI helpers (`session.ui.*`)
We surface these as **inline UI requests** in the chat thread, **not** as modals (so the agent can interleave them with messages):
- `session.ui.confirm` → InlineConfirm card with Yes/No/Cancel.
- `session.ui.select` → InlineSelect with options (single/multi).
- `session.ui.input` → InlineInput with format hints (email, etc.).
Each renders an `assistant_request` row keyed by `request_id`; on user response we call `session.ui.respond(...)` (typed RPC) via an IPC command `session.ui_respond`.
## Slash commands
Use `CommandDefinition` (already in upstream). UI behaviour:
- Composer detects leading `/` and shows a popover of registered commands.
- Built-in commands live in `commands/` (Rust); user-defined commands come from skills.
- Selected command preview is shown in the composer; pressing Enter executes (or fills args).
## System prompt customization UI
For each session/skill the user can pick a mode:
- **Append** — type text appended after Copilot''s defaults.
- **Replace** — full custom system prompt.
- **Customize** — section editor: ten named sections from upstream (identity, tone, tool_efficiency, environment_context, code_change_rules, guidelines, safety, tool_instructions, custom_instructions, last_instructions). For each: `Replace | Append | Prepend | Remove | Transform (advanced)`.
Render as PrimeVue `Tabs`: per-section card with editor; "Preview rendered prompt" button calls a backend dry-run that asks the SDK to render the final prompt.
## Image generation
- Add response-format selector in the composer''s Advanced panel: `Text`, `Image`, `Mixed`.
- When image options chosen, `MessageOptions` carries them through.
- Renderer: `MessageBubble.vue` detects image attachments in assistant messages and renders them with PrimeVue `Image` for zoom; right-click → Save As.
## MCP — concrete shape
- Registry persisted at `<app-data>/dafman/mcp/`.
- Discriminated config:
  ```ts
  type McpServerConfig =
    | { kind: "stdio"; command: string; args: string[]; env?: Record<string,string>; cwd?: string }
    | { kind: "http"; baseUrl: string; auth?: McpAuth };
  ```
- Per-project overlay enabled/disabled toggles.
- Server status events drive the panel; failures show a "View logs" link.
- OAuth integrates with the URL/browser flow above.
## Auth (multi-account)
- Account list under Settings → Accounts.
- Each account stores: GitHub token (via OS keyring), profile metadata.
- Each session can pin a specific account via the per-session header.
- BYOK credentials live alongside (encrypted at rest); see `plan-platformFeatures.prompt.md` updates.
## Cookbook references
When implementing, reference these examples from the Supercharged repo:
- `rust/examples/` — quick patterns.
- `rust/cookbook/` — common recipes.
- `docs/` for cross-language conceptual docs.
