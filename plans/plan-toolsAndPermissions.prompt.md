> **Stack note (post-Electrobun port, 2026-05-17):** This document still references the old Tauri (Rust) backend in places. The runtime is now Electrobun + Bun + TypeScript everywhere; src-tauri/ is gone, replaced by src-bun/. 	racing is replaced by `src-bun/app/logging.ts`, `cargo test`/`insta` are replaced by `bun test`/`toMatchSnapshot`, and Tauri's per-session `Channel<T>` is replaced by a single `sessionEvent` RPC message keyed by `sessionId`. The architecture in spirit (domain modules don't touch the shell, single typed IPC surface, JSON-RPC under the hood) is unchanged. Full diff lives in `CHANGELOG.md` under `## [Unreleased]`. Plan rewrites are tracked as follow-up tasks.
# Dafman — Tools & Permissions
## Goals
- Provide tools that match (and exceed) the Copilot CLI baseline: file ops, search, shell, web.
- Every privileged action — tool calls AND browser opens — runs behind an explicit, auditable permission flow.
- Tools are typed, schema-defined (JSON Schema), and individually testable.
- Easy to add new tools; easy to plug in external tool providers via MCP.
## Built-in tools (initial set)
| Name | Description | Args (schema) | Permission category |
|---|---|---|---|
| `fs.read` | Read a file in the project. | `{ path, max_bytes? }` | `fs.read` |
| `fs.list` | List a directory. | `{ path, depth? }` | `fs.read` |
| `fs.write` | Overwrite or create a file. | `{ path, content }` | `fs.write` |
| `fs.edit` | Apply edits (search/replace or unified diff). | `{ path, edits[] }` | `fs.write` |
| `search.grep` | Ripgrep across the project. | `{ pattern, glob?, max_matches? }` | `fs.read` |
| `shell.exec` | Run a shell command with timeout. | `{ command, cwd?, timeout_ms?, env? }` | `shell` |
| `http.fetch` | Fetch a URL (GET/POST). | `{ method, url, headers?, body?, timeout_ms? }` | `network` |
| `clipboard.read` / `clipboard.write` (M5) | Read/write clipboard. | … | `clipboard` |
| `notify.show` (M6) | Send a desktop notification. | `{ title, body }` | `notifications` |
| `browser.*` (M7) | Headless browser ops (navigate, snapshot, click, type). | … | `browser`, `network` |
| `self.*` (M7) | App-introspection (open file, switch project, run skill). | … | `self` |
| `memory.*` (M5) | Long-term memory store. | … | `memory` |
| `lsp.*` (M7) | Talk to LSP servers in the project. | … | `lsp` |
## Tool implementation
- Each tool is a Rust type implementing `ToolHandler` in `tools/`.
- `ToolHandlerRouter` registers them; the router is wrapped by the permission policy at session creation.
- Tools use domain types only; no Tauri imports.
- Long-running tools report progress via `ToolInvocation.tool_call_id` events.
- Resource caps:
  - `fs.read`: configurable max bytes (default 2 MiB).
  - `shell.exec`: timeout (default 30 s), stdout/stderr cap (default 1 MiB).
  - `http.fetch`: timeout, response cap, redirect cap.
  - `search.grep`: result count cap.
- Errors are typed and surface in the tool call card.
### `excludedTools` overlay
- Per-skill and per-agent overlays carry an `excludedTools: Vec<ToolPattern>` that the registry honors before dispatch (per supercharged v2.0).
- Settings UI lets users build allow/exclude lists.
### Sandboxing
- Path arguments are normalized and confined to the active project root unless the project allow-list extends them.
- `shell.exec` runs as the user''s account by default; an "isolated" mode (M6+) may run via a sandbox subprocess (Windows: Job Object; macOS: `sandbox-exec`; Linux: `bwrap`).
- `http.fetch` has a configurable allow/deny list of hosts.
## Permission system
### Model
```rust
pub struct PermissionRequest {
    pub session_id: SessionId,
    pub project_id: Option<ProjectId>,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub reason: Option<String>,
}
pub enum PermissionDecision {
    Allow,
    AllowOnce,
    AllowForSession,
    AllowForProject,
    AllowAlways,
    Deny,
    DenyAlways,
}
pub enum PermissionPolicy {
    AlwaysAsk,
    ApproveAll,         // demo/dev only; persistent warning banner
    DenyAll,
    Rules(Vec<Rule>),
}
pub struct Rule {
    pub name: String,
    pub when: RuleMatch,    // tool-name glob/regex + JSON path predicates on args
    pub effect: RuleEffect, // Allow | Deny
    pub scope: RuleScope,   // Global | Project(id) | Session(id)
}
```
### Flow
1. SDK calls `SessionHandler::on_permission_request` → forwarded to `PermissionService::request(req)`.
2. Service evaluates: session → project → global rules → default (`AlwaysAsk`).
3. If a rule decides, return immediately. Otherwise:
   - Allocate a `PermissionTicket`.
   - Emit `permission_requested` event with `{ ticket, request }`.
   - Wait on a `oneshot::Receiver<PermissionDecision>`.
4. Frontend shows a modal (or inline card) with tool name, args preview, reason, and choices.
5. User answers → `permissions.respond(ticket, decision)` command → service maps to SDK result + persists "always" choices.
### UI
- Modal/inline card shows:
  - **What** (tool name + icon).
  - **Why** (model-provided reason).
  - **Where** (project + session).
  - **Arguments** (pretty-printed JSON, collapsible).
  - **Risk hints** (e.g., "writes to disk", "runs shell command", "fetches network").
- Choices: Allow · Allow once · Allow for this session · Allow for this project · Always allow · Deny · Always deny.
### Policy presets
- **Strict**: ask for every write/shell/network; auto-allow read within project root.
- **Workshop** (default for dev): allow reads + searches; ask for everything else.
- **Trusted project**: pre-approved list per project.
- **Demo**: approve-all with a persistent banner warning.
### Audit log
- Every request + decision logged with timestamp, session id, project, tool, arguments hash, decision, source (rule vs user).
- Visible in Settings → Permissions → Activity. Exportable.
## URL / browser policy (cross-reference)
URL opens (from URL-mode elicitation, MCP OAuth, or user-clicked links) flow through a parallel **URL policy** documented in `plan-sdkAndExternalSurfaces.prompt.md`. Same UX patterns: ask, allow-once, allow-for-session, allow-always, deny. Rules match by host pattern + scheme + origin.
## MCP integration
- MCP server registry: list, install (URL/Git/local path), update, remove.
- Discriminated config (supercharged v2.0):
  ```rust
  pub enum McpServerKind {
      Stdio { command: String, args: Vec<String>, env: HashMap<String, String>, cwd: Option<PathBuf> },
      Http  { base_url: Url, auth: Option<McpAuth> },
  }
  ```
- Each server runs as a child process (stdio) or as an HTTP client; output captured for logs.
- Discovered tools appear in the global tool registry, namespaced (e.g., `mcp://my-server/search`).
- Permissions apply identically; rules can target MCP namespaces.
- Per-project MCP overlay: enable/disable specific servers per project.
- Settings UI shows status, logs, last error, tool list per server.
- **OAuth**: when an MCP server needs auth, the runtime emits a URL → we route via the URL elicitation/policy flow → toast updates on `mcp_status_changed`.
### Config discovery
- With `enableConfigDiscovery: true` on a session (auto when a project is active), the runtime auto-loads `.mcp.json`, `.vscode/mcp.json`, and skill dirs from the workspace.
- Discovered entries appear in the per-project MCP and Skills panels and can be promoted/overridden.
## Future tools
- `browser.*` — headless Chromium/Firefox via CDP (M7).
- `lsp.*` — language servers for hovers, refs, diagnostics (M7).
- `memory.*` — vector-backed long-term store (M5+).
- `self.*` — let the agent invoke app actions safely (open file, switch project, run skill).
- `task.*` — project task list backed by JSON store.
## Testing
- Unit-test each tool with temp dir / mock HTTP client.
- Property-test path normalization & confinement.
- Snapshot-test JSON Schemas (`insta`).
- Integration: a fake `SessionHandler` requests permissions; assert flow ends with the right decision under each policy.
- Integration: simulated MCP OAuth → URL policy decision → toast finalizes on status change.

