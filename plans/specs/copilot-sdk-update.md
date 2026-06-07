# Copilot SDK Update + Feature Audit

**Status:** Draft  
**Date:** 2026-06-06

---

## Summary

Bump `@github/copilot-sdk` from `1.0.0-beta.9` to `1.0.0` stable (and `@github/copilot` CLI from `^1.0.54` to `^1.0.55`). In parallel, audit the SDK/CLI feature surface against what dafman actually uses today and derive a prioritized list of features worth surfacing next.

---

## Motivation

dafman pins `@github/copilot-sdk` exactly at `1.0.0-beta.9` (`package.json:54`). The stable `1.0.0` release is available and is the first non-preview version, eliminating the "may change in breaking ways" caveat in the README. The CLI package (`@github/copilot`) is already on a caret range (`^1.0.54`, `package.json:53`), but the installed beta.9 SDK internally requires `@github/copilot: "^1.0.55-5"` (see `node_modules/@github/copilot-sdk/package.json:59`) — meaning the current lockfile already has a latent peer-version mismatch.

A full SDK/CLI feature audit is overdue. The installed beta.9 types expose capabilities — SDK-registered slash commands, per-session hook surface, code-defined custom agents, workspace diff, quota access — that dafman either partially uses or does not surface at all.

---

## Current State

### Version pins

| Package | Spec in `package.json` | Currently installed | SDK's peer dep |
|---|---|---|---|
| `@github/copilot-sdk` | `1.0.0-beta.9` (exact) | `1.0.0-beta.9` | — |
| `@github/copilot` (CLI) | `^1.0.54` | `1.0.54` | `^1.0.55-5` (from SDK's own `package.json:59`) |

The latent mismatch: the installed beta.9 SDK wants `@github/copilot >= 1.0.55-5` but dafman installs `1.0.54`. This has not surfaced as a runtime error because the SDK doesn't validate the CLI version at startup — it spawns whatever binary is resolved — but it means new features added in 1.0.55+ may be silently absent.

### Where the SDK is touched in dafman

**`src-bun/app/client/copilotSdk.ts`** — SDK import facade. Re-exports `CopilotClient`, `RuntimeConnection`, `approveAll`, `convertMcpCallToolResult`, `defineTool`, `createSessionFsAdapter`, `CopilotSession`, and ~15 types. Derives unexported types by structural extraction (e.g. `UserInputRequest` from `SessionConfig['onUserInputRequest']`, `ReasoningEffort`, `PreMcpToolCallInput` added beta.8, `PostToolUseFailureInput` added beta.9).

**`src-bun/app/client/client.ts`** — singleton `CopilotClient` lifecycle. Resolves native binary via `import.meta.resolve`; passes to SDK via `connection: RuntimeConnection.forStdio({ path })`.

**`src-bun/app/chat/sessionConfigBuilder.ts`** — builds `SessionConfig` shared by `create()` and `resume()`. Currently passes:
- `enableConfigDiscovery: true` — auto-discover `.mcp.json`, skill dirs from cwd
- `tools: deps.tools` — dafman built-in tools
- `commands: [{ name: 'library', ... }]` — only one SDK-registered slash command (`/library`)
- `onPermissionRequest` — full permission handler routing to pending queue
- `onUserInputRequest` — routes to pending queue
- `onElicitationRequest` — routes to pending queue
- `onExitPlanModeRequest` — routes to pending queue
- `onAutoModeSwitchRequest` — routes to pending queue
- `hooks.onPreMcpToolCall` — observe-only audit hook (beta.8)
- `hooks.onPostToolUseFailure` — observe-only audit hook (beta.9)
- `streaming: deps.streamingResolver()` — from settings
- `availableTools` / `excludedTools` — from settings

**NOT passed** (SDK defaults apply): `systemMessage`, `customAgents`, `defaultAgent`, `infiniteSessions`, `canvases`, `requestCanvasRenderer`, `requestExtensions`, `skipCustomInstructions`, `remoteSession`, `gitHubToken`, `agent`, `provider`, `enableSessionTelemetry`. None of the remaining `SessionHooks` are registered: `onPreToolUse`, `onPostToolUse`, `onSessionStart`, `onSessionEnd`, `onErrorOccurred`, `onUserPromptSubmitted`.

**`src/lib/sessionCommands.ts`** — 15 local slash commands handled client-side: `/mcp`, `/skill`, `/skills`, `/agent`, `/model`, `/autopilot`, `/compact`, `/fork`, `/rename`, `/cd`, `/close`, `/fleet`, `/library`, `/plan`, `/?`, `/help`. These live entirely in Vue/Pinia; none (except `/library`) are registered as `CommandDefinition[]` with the SDK. The CLI TUI therefore sees only `/library` from dafman.

**`src-bun/__tests__/wire-contract.test.ts`** — Snapshot tests for dafman's own IPC wire types (`DafmanRPC`, `Settings`, etc.). Does not snapshot SDK types, but any SDK type rename that propagates through dafman's type graph will cause a `bun run lint:tsc-bun` failure.

---

## Design

### 1. Version bump

#### `@github/copilot-sdk` — `1.0.0-beta.9` → `^1.0.0`

Switch from exact pin to caret. The stable series has committed to semantic versioning; pinning exact is only warranted for pre-release tags where every minor increment may break. Use `^1.0.0` to accept patch releases automatically.

**Migration steps:**

1. In `package.json:54`, change `"@github/copilot-sdk": "1.0.0-beta.9"` → `"@github/copilot-sdk": "^1.0.0"`.
2. Bump `@github/copilot` to `^1.0.55` in `package.json:53`.
3. Run `bun install` to update `bun.lock`.
4. Run `bun run lint:tsc-bun` — this is the primary type-break detector. The key risk areas are:
   - **Derived types in `copilotSdk.ts`**: `UserInputRequest`, `UserInputResponse`, `ReasoningEffort`, `PreMcpToolCallInput`, `PostToolUseFailureInput` are all structurally derived. If the SDK promotes these to first-class exports (likely in 1.0.0 stable), the derivation becomes redundant but still compiles. If any parameter shape changes, the extractor produces a different type and the consumer sites break visibly.
   - **`PermissionRequestResult` / `PermissionApprovalRule`**: `respondToRequest` in `rpc.ts` accepts a `PermissionApprovalRule` union. If the SDK adds new union members, `switch` exhaustiveness in dafman's handler might need updating.
   - **`ElicitationContext`**: `context.mode` and `context.elicitationSource` are used in `sessionConfigBuilder.ts:171-172`. If the SDK renames these fields, the builder silently omits them (optional spread) — check that `mode` and `elicitationSource` exist in the stable types.
5. Run `bun test` (full suite). Primary risk: `src-bun/__tests__/sessions.test.ts` exercises `SessionRegistry` create/resume paths. Any SDK behavior change in `createSession`/`resumeSession` will surface here.
6. Update the comment in `copilotSdk.ts:8` from `beta.7`/`beta.9` historical notes to `1.0.0`.

**Expected breaking changes beta.9 → 1.0.0 (HIGH confidence — grounded in the type files):**

- None observed from the installed types. The stable 1.0.0 appears to be a promotion of the beta.9 line without structural renames. The SDK README still carries "in public preview" language in beta.9 (`README.md:5`) but the package.json version is the release signal.
- The zod `^4.3.6` dependency in the SDK's own `package.json:61` was already present in beta.9. dafman has no direct zod dep, so this is internal to the SDK and not a consumer break.

**LOW confidence / verify by running tsc:**

- `getSessionMetadata()` may have been added in stable (it appears in beta.9 types as a client method but verify presence). Already in `client.d.ts:351`.
- `session.capabilities` — property was present in beta.9 types; verify it remains the same shape in stable.

#### `@github/copilot` (CLI) — `^1.0.54` → `^1.0.55`

The CLI changelog shows no breaking changes from 1.0.54 to 1.0.55 (only bug fixes). Bump to unblock the SDK's peer dep requirement. The caret range already means a clean `bun install` on a fresh checkout will pick up 1.0.55+ automatically once `^1.0.55` is specified.

### 2. SDK/CLI capability audit

#### Feature inventory table

Source grounding: `node_modules/@github/copilot-sdk/dist/types.d.ts`, `client.d.ts`, `session.d.ts`, `generated/rpc.d.ts`, `docs/agent-author.md`, `docs/examples.md`, `node_modules/@github/copilot/changelog.json`, dafman source files listed above.

| # | SDK/CLI Capability | Dafman today | Opportunity / Gap |
|---|---|---|---|
| 1 | **SDK slash-command registration** (`CommandDefinition[]` in `SessionConfig`) | Only `/library` registered (`sessionConfigBuilder.ts:329`) | ❌ **Rejected (see OQ3).** dafman's local commands are *renderer-side UI actions*; the SDK handler runs bun-side with no renderer access, so registering them would mean re-implementing each command bun-side for no value. The useful direction is the reverse (#2). |
| 2 | **`session.rpc.commands.list()`** — returns `SlashCommandInfo[]` (`kind: builtin\|skill\|client`) for ALL live commands incl. CLI built-ins (`/compact`, `/usage`, `/restart`, `/skills`, `/statusline`) | Never called | Enumerate on session create/resume; feed CLI-native commands into the composer typeahead as a second source. **Execution exists** — invoke a selected built-in via `session.rpc.commands.enqueue({ command: '/compact' })` or `.execute(...)` (`rpc.d.ts:10847`/`10839`). This is the *reverse* of #1 (we trigger the CLI's own commands, not register ours). Belongs to #34. |
| 3 | **`hooks.onPreToolUse`** — fires before every built-in tool execution; can allow/deny/modify args | Not registered | Add observe-only audit hook (log `toolName` + `argKeys`); complements the existing MCP-only audit. Can also inject `additionalContext` or deny specific commands without a permission prompt (e.g. pattern-match `rm -rf`). |
| 4 | **`hooks.onPostToolUse`** — fires after successful tool executions | Not registered | Audit hook to capture tool result summaries in the observability panel. |
| 5 | **`hooks.onSessionStart`** — fires on `"startup" \| "resume" \| "new"` with `source` and optional `initialPrompt` | Not registered | Telemetry; also opportunity to inject `additionalContext` (e.g. workspace-level custom instructions that go beyond AGENTS.md). |
| 6 | **`hooks.onSessionEnd`** — fires on session end with `reason` and optional `finalMessage` | Not registered | Capture `sessionSummary` output to seed the tab title; also cleanup actions hook. |
| 7 | **`hooks.onErrorOccurred`** — fires on `model_call \| tool_execution \| system \| user_input` errors; output controls retry/skip/abort | Not registered | Enable automatic retry on transient model errors (return `{ errorHandling: "retry", retryCount: 2 }`). Surfaces as a settings option. |
| 8 | **`hooks.onUserPromptSubmitted`** — fires before each user message; can rewrite prompt or inject `additionalContext` | Not registered | Foundation for workspace-level context injection (e.g. auto-prepend repo summary on first message), prompt templates, or per-session system context without full `systemMessage` replace. |
| 9 | **`InfiniteSessionConfig`** — `backgroundCompactionThreshold` (default 0.80) and `bufferExhaustionThreshold` (default 0.95) | Not explicitly set (SDK default enabled) | Expose thresholds in `SessionDetailsPanel` settings. Currently dafman offers `/compact` manually; tuning the background threshold lets power users control auto-compaction aggressiveness. |
| 10 | **`session.workspacePath`** + workspace RPC (`workspace.diff`, `workspace.listFiles`, `workspace.listCheckpoints`) | Unused | Expose workspace diff in `SessionDetailsPanel` to show what the agent has changed since session start. `workspace.diff({ mode: "unstaged" })` returns file-level changed/added/deleted. |
| 11 | **`CustomAgentConfig` in `SessionConfig`** — define agents in code with `name`, `prompt`, `tools`, `skills`, `mcpServers`, `model` | YAML `.github/agents/` only | Allow dafman to define "ephemeral" agents from the Library UI without a file on disk. Also enables pinning a specific model per agent from dafman's settings. |
| 12 | **`DefaultAgentConfig.excludedTools`** — hide tools from the default agent while keeping them available to sub-agents | Not set | Clean up the default agent's tool list in "task-only" configurations; pairs with custom-agent delegation patterns. |
| 13 | **`SystemMessageConfig` customize mode** — `mode: "customize"` with per-section overrides (`tone`, `guidelines`, `identity`, etc.) | Not used | Add a "System Prompt" editor in `SessionDetailsPanel` that lets users append or customize specific sections. Less risky than `mode: "replace"` since the SDK maintains its guardrails. |
| 14 | **`client.onLifecycle()`** — push events: `session.created`, `session.deleted`, `session.updated`, `session.foreground`, `session.background` | Not used | Replace the polling approach in `sessionsListStore` with push-based updates; reduces RPC traffic and enables instant session-list refresh when another window modifies sessions. |
| 15 | **`client.getSessionMetadata(id)`** — O(1) single-session lookup | `listSessions()` used everywhere | Use for single-session status checks (e.g. session name polling in `SessionEventForwarder.pollTitleFromMetadata`). Already in the installed SDK types (`client.d.ts:351`). |
| 16 | **`account.getQuota()` via `session.rpc`** — returns quota snapshots by type (chat, completions, premium interactions) | Not surfaced | Add a quota indicator to `SessionDetailsPanel` or the status bar. The existing `getSessionUsageMetrics` gives per-session totals; this gives account-level budget. |
| 17 | **`ToolSet` builder** — fluent API for constructing `availableTools`/`excludedTools` filter strings with `addBuiltIn()`, `addMcp()`, `addCustom()` | Raw string arrays | Replace raw arrays in `buildBaseSessionConfig` with `ToolSet` for type-safety and readability. Low risk, pure refactor. |
| 18 | **`RemoteSessionMode = "export" \| "on"`** — export session events to GitHub, optionally enable remote steering | Not surfaced | Add a toggle in `SessionDetailsPanel` to enable remote session steering (links the session to GitHub Copilot web UI). Gated on user understanding of what remote export means. |
| 19 | **Context window tier selection** (CLI 1.0.52: 200K vs 1M tokens) — enforced end-to-end in compaction/truncation | Not surfaced | Expose tier selector in `SessionDetailsPanel`. Currently dafman shows context usage but doesn't let users constrain the window. |
| 20 | **CLI built-in slash command arguments** (`SlashCommandInfo.inputs`, `SlashCommandInput.completion = "directory"`) — completion hints for tab completion | Not used | Feed `inputs` into the composer typeahead argument hint. E.g. `/cd` with `completion: "directory"` could trigger a file picker. |
| 21 | **`ProviderConfig` (BYOK)** — custom API endpoint/key instead of Copilot API | Not surfaced | Add BYOK section to `SettingsPanel`. Requires model to be specified explicitly when BYOK is active. |
| 22 | **Extension management** (`requestExtensions: true`, `extensions.list()`, `extensions.enable/disable()`) — manage `.github/extensions/` programmatically | Not used | Surface installed extensions in Library panel. Allow enable/disable without editing files. |

---

### 3. Recommended priorities

**Phase A — Immediate (low risk, high value, can ship together):**

- **[#17] `ToolSet` refactor** in `sessionConfigBuilder.ts`: pure type refactor, zero behavioral change. Verifiable in one `bun run lint:tsc-bun`.
- ~~**[#1] Register all local slash commands**~~ — **dropped** (OQ3): they're renderer-UI actions, pointless to register SDK-side. The slash value is #2 (surface CLI built-ins) + the unified-slash-routing spec (#34).
- **[#15] `getSessionMetadata(id)`** for single-session title polling: replace the `listSessions()` call in `SessionEventForwarder.pollTitleFromMetadata` with a targeted lookup. One-line change per callsite.

**Phase B — Medium term (moderate complexity, clear value):**

- **[#2] `commands.list()` → typeahead enrichment**: query on session create/resume; merge CLI-native commands into the typeahead. Requires a new RPC call and a store mutation. The `SlashCommandInfo[]` result includes `description`, `inputs`, `kind` — enough to render a row.
- **[#3] `onPreToolUse` audit hook**: wire into `sessionConfigBuilder.ts` alongside `onPreMcpToolCall`. Observe-only; extend `recordMcpToolCall`-like audit path.
- **[#4] `onPostToolUse` audit hook**: parallel to `onPostToolUseFailure`, which is already wired.
- **[#9] Expose `InfiniteSessionConfig` thresholds**: add two number fields to `SessionConfig`-level settings (or per-session settings in `SessionDetailsPanel`). The defaults (0.80/0.95) are already in use; this just exposes them.
- **[#14] `client.onLifecycle()` for session list push**: subscribe in `clientStore` on client boot; notify `sessionsListStore` on `session.created`/`session.deleted`/`session.updated`. Replaces polling interval or manual refreshes.

**Phase C — Larger investment (design decisions required):**

- **[#5–8] Additional session hooks** (`onSessionStart`, `onSessionEnd`, `onErrorOccurred`, `onUserPromptSubmitted`): these interact with user-visible behavior (auto-retry, prompt rewriting, lifecycle telemetry). Design open questions #4, #5, and #6 below must be resolved first.
- **[#10] Workspace diff**: needs a new panel component. The data is available via `session.rpc`; rendering a file-diff view is the work.
- **[#11] Code-defined custom agents**: requires extending the Library Agents tab UI to support agent definitions without a file on disk. Moderate frontend work.
- **[#13] System message customization editor**: a CodeMirror panel in `SessionDetailsPanel`. The SDK section IDs are well-defined (`SYSTEM_MESSAGE_SECTIONS`).
- **[#16] Account quota indicator**: needs a new RPC surface on the dafman side.
- **[#18] Remote session mode**: high UX risk (users may not understand remote export implications); needs explicit consent UI.

---

## Open Questions

1. **Which CLI version to target for the bump?** The installed beta.9 SDK declares a peer requirement of `@github/copilot: "^1.0.55-5"`, but the repo pins `1.0.54`. The CLI must be bumped to satisfy the SDK. **Decision needed**: exact lower bound (`^1.0.55` vs `^1.0.55-5` vs `^1.0.56`). Recommend `^1.0.55` for stability.

2. **Pin strategy** — ✅ **RESOLVED (2026-06-07): caret `^1.0.0`** for the SDK (+ `@github/copilot ^1.0.55`). The stable series commits to semver; gate deliberately only if churn bites.

3. **SDK-registered slash commands** — ✅ **RESOLVED (2026-06-07): do NOT register dafman's local slash commands with the SDK.** They are renderer-side UI actions; the SDK handler runs bun-side with no renderer access, so making them *do* anything means re-implementing each command bun-side — pointless. CLI-TUI parity isn't worth it. The valuable slash work is the **reverse** and is genuinely feasible: `commands.list()` discovers the CLI's *own* built-ins and `commands.enqueue`/`execute` invokes them (`rpc.d.ts:10847`/`10839`) — i.e. surface + trigger the CLI's commands in dafman's typeahead. Tracked by the unified-slash-routing spec (#34).

4. **`onUserPromptSubmitted` hook** — ⏸ **DEFERRED → #192** (2026-06-07): no use case. Fires before each user message and can silently rewrite it; risky, no concrete need. Revisit only if a real use case emerges.

5. **`onErrorOccurred` auto-retry** — ⏸ **DEFERRED → #193** (2026-06-07): runaway-retry risk on billing/rate-limit errors, no demand. Revisit behind an explicit setting + the `recoverable` gate.

6. **`onSessionEnd` + `sessionSummary`:** The hook's output allows returning a `sessionSummary` string. This could power automatic tab title generation (without waiting for the next `session.idle` poll). However, it fires on every session end — including on `/compact` clears. **Decision needed**: pipe the summary to dafman's title-polling mechanism or handle separately?

7. **`InfiniteSessionConfig.enabled`:** The SDK default is `enabled: true` (infinite sessions on). dafman does not explicitly pass this. Should dafman explicitly set `infiniteSessions: { enabled: true }` to be declarative, or leave it as an implicit default? Relevant because if someone adds `infiniteSessions: { enabled: false }` by mistake, workspace persistence silently disappears. **Decision needed**: explicit or implicit.

8. **`RemoteSessionMode` consent UX:** Enabling `"export"` sends session events to GitHub. This needs a clear user-facing disclosure. Should the toggle live in per-session settings, global settings, or require a one-time consent dialog? **Decision needed.**

---

## Alternatives / Options

### Version pin strategy

| Option | Tradeoffs | Recommendation |
|---|---|---|
| Exact pin `1.0.0` | Maximum predictability; deliberate upgrades | Only if team has been burned by SDK churn before |
| Caret `^1.0.0` | Auto-picks patches; minor/major gated by semver | **Recommended** — stable API commitment |
| Caret `^1.0.0-beta.9` | Pre-release range (not semver-stable) | Do not use; pre-release range semantics are non-obvious |

### Slash command registration strategy (Phase A #1)

| Option | Tradeoffs |
|---|---|
| Register all 15 commands | Full feature parity from CLI TUI; some handlers need stubs |
| Register navigation/session commands, stub UI commands | Realistic balance; avoids confusing "open panel" commands from CLI |
| Enumerate dafman commands via `commands.list()` instead | CLI already knows the full list if we register them; `list()` is for querying, not replacing registration |

Recommended: Register navigation/session commands that have meaningful CLI-side behavior (`/agent`, `/compact`, `/fork`, `/plan`, `/cd`, `/rename`); stub pure-UI commands (`/model`, `/close`) with a notification.

### Hook adoption order

| Option | Tradeoffs |
|---|---|
| Ship all hooks in one PR | Single integration point; harder to review and revert individual hooks |
| One hook per PR, audit-only first | Incremental; each hook's behavior is isolated and testable | **Recommended** |
| Hold until Phase C | Safe but misses observability wins in `onPreToolUse`/`onPostToolUse` | Not recommended |

---

## Implementation Phases

**Phase 0 — Version bump (prerequisite for all other phases)**

1. Update `package.json` pins: `@github/copilot-sdk` → `^1.0.0`, `@github/copilot` → `^1.0.55`.
2. `bun install` to regenerate `bun.lock`.
3. `bun run lint:tsc-bun` — fix any type errors in `copilotSdk.ts` derived types.
4. `bun test` — validate `sessions.test.ts` and `wire-contract.test.ts` pass.
5. Update version comment in `src-bun/app/client/copilotSdk.ts:8`.
6. CHANGELOG entry.

**Phase 1 — Quick wins (no design decisions needed)**

- `ToolSet` refactor in `sessionConfigBuilder.ts` (open question #2 resolved as caret).
- `getSessionMetadata(id)` for title polling in `SessionEventForwarder`.
- (`/compact` etc. are CLI built-ins surfaced via #2 — not dafman registering its own; see OQ3.)

**Phase 2 — Typeahead enrichment**

- `session.rpc.commands.list()` on session create/resume → feed CLI-native commands into typeahead.
- Audit hooks: `onPreToolUse` + `onPostToolUse` (observe-only, extend audit pipeline).

**Phase 3 — Session lifecycle hooks**

- `onSessionEnd` → session summary capture.
- `onSessionStart` → context injection (requires open question #4 resolved).
- `onErrorOccurred` → configurable retry policy (requires open question #5 resolved).
- `client.onLifecycle()` → push-based session list updates.

**Phase 4 — Workspace and agent surfaces**

- `InfiniteSessionConfig` threshold exposure in `SessionDetailsPanel`.
- Workspace diff panel.
- Account quota indicator.
- Code-defined custom agents in Library UI.

**Phase 5 — Advanced / high-risk**

- `SystemMessageConfig` customize editor.
- `onUserPromptSubmitted` prompt augmentation.
- Remote session mode toggle + consent UI.
- BYOK `ProviderConfig`.

---

## References

- `package.json:53-54` — current version pins
- `node_modules/@github/copilot-sdk/package.json` — installed SDK metadata, peer deps
- `node_modules/@github/copilot/package.json` — installed CLI version
- `node_modules/@github/copilot-sdk/dist/client.d.ts` — `CopilotClient` full API
- `node_modules/@github/copilot-sdk/dist/session.d.ts` — `CopilotSession` full API
- `node_modules/@github/copilot-sdk/dist/types.d.ts` — `SessionConfigBase`, `CustomAgentConfig`, `InfiniteSessionConfig`, `CommandDefinition`, `SessionHooks`, `ToolSet`, hook handler types
- `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts` — full generated JSON-RPC surface; `SlashCommandInfo`, `createSessionRpc`, `AccountQuotaSnapshot`, workspace RPCs
- `node_modules/@github/copilot-sdk/dist/toolSet.d.ts` — `ToolSet`, `BuiltInTools`
- `node_modules/@github/copilot-sdk/docs/agent-author.md` — extension authoring, hook reference
- `node_modules/@github/copilot-sdk/docs/examples.md` — `CommandDefinition` example, hook examples
- `node_modules/@github/copilot/changelog.json` — CLI changelog 1.0.52–1.0.54 (slash commands, `/usage`, `/statusline`, context window tier)
- `src-bun/app/client/copilotSdk.ts` — SDK facade, derived types
- `src-bun/app/client/client.ts` — singleton client lifecycle
- `src-bun/app/chat/sessionConfigBuilder.ts` — `buildBaseSessionConfig`, `buildRegisteredCommands`
- `src-bun/app/chat/sessions.ts` — `SessionRegistry.create()`, `SessionRegistry.resume()`
- `src/lib/sessionCommands.ts` — 15 local slash commands (`SESSION_COMMANDS`)
- `src-bun/__tests__/wire-contract.test.ts` — IPC wire-shape snapshots (break risk on type changes)
- `src-bun/__tests__/sessions.test.ts` — `SessionRegistry` integration tests (break risk on SDK behavior changes)
