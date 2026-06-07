# Backend abstraction around ACP

**Status:** Researched — **implementation DEFERRED (2026-06-07).** The design + "don't reinvent the wheel" question are settled (reuse `@agentclientprotocol/sdk` + `vscode-acp` pattern; keep Copilot on its SDK; build only a thin adapter — see Decisive finding). Not on the near-term roadmap; tracked by #187. Revisit when a second provider is actually wanted.

## Summary

Dafman should add a thin backend `Provider` layer that keeps the current GitHub Copilot SDK integration first-class while allowing sessions to be backed by any ACP-compatible agent process. ACP is close enough to Dafman's current session/RPC model to make a generic ACP provider worthwhile, but not close enough to become the internal abstraction directly without either leaking protocol details into the renderer or flattening Copilot-specific features that already ship.

Recommended default: **thin internal Provider interface + adapters**. Keep Copilot native (on its richer `@github/copilot-sdk` transport) as provider `copilot` and add an `acp` provider that spawns configured ACP agents via `@agentclientprotocol/sdk`. **Don't reinvent:** the protocol is `@agentclientprotocol/sdk`; the multi-agent host pattern is the `formulahendry/vscode-acp` reference client; the capability vocabulary is ACP's own + Copilot's published per-session capability matrix (see ACP research notes). The only bespoke piece is a thin adapter — and §"Decisive finding" shows why it's irreducible.

## Motivation

Today the app is effectively a polished desktop client for one backend: `@github/copilot-sdk` plus Copilot's native CLI binary. That is valuable and should not be regressed, especially because Copilot exposes product-specific features Dafman already surfaces: permission rules, skills, custom agents, MCP discovery/config, task/fleet surfaces, audit hooks, and quota/model APIs.

At the same time, ACP is explicitly designed to avoid one-off agent/editor integrations. ACP describes itself as a protocol for editor/agent interoperability, similar in motivation to LSP, and supports local agents over JSON-RPC stdio plus emerging remote transports. Its v1 method surface covers initialization, auth, session creation/loading/resume/list/delete/close, prompt turns, cancellation, session updates, modes/config options, tool calls, permissions, filesystem access, terminals, slash commands, plans, usage updates, and MCP-related capabilities. That makes it the right *external* protocol target, but Dafman still needs an internal contract stable enough to preserve its current Copilot UX.

## Current state

### Architecture and wire shape

- Dafman is one Electrobun window with a Bun main process talking to the renderer via typed RPC and to the Copilot SDK/CLI underneath (`ARCHITECTURE.md:1-19`).
- The architecture doc calls out one typed IPC surface: `src-bun/rpc.ts`, mirrored in `src/ipc/types.ts`, with the renderer going through `src/ipc/invoke.ts` rather than raw Electrobun RPC (`ARCHITECTURE.md:97-105`, `ARCHITECTURE.md:270-306`).
- The current RPC contract is broad. `CommandMap` includes lifecycle/session commands, send/abort, workspace file search, model/mode/name/cwd/history/fork/approval commands, skills, agents, tasks/jobs, MCP, plans, terminals, command results, settings, diagnostics, audit, and export commands (`src/ipc/types.ts:570-863`, `src-bun/rpc.ts:645-1243`).
- Bun registers those handlers in one place. `createClient` starts the singleton client, `createSession` delegates to `SessionRegistry.create`, `resumeSession` returns cwd/model/approveAll/mode, and the rest mostly pass through `sessions`, `mcp`, `skills`, `terminals`, or diagnostics services (`src-bun/index.ts:149-260`, `src-bun/index.ts:259-523`).
- Bun-to-renderer provider activity currently flows through global messages: `sessionEvent`, `pendingRequest`, `logEvent`, and `auditEvent`/terminal/command-result peers. The comments explicitly say `pendingRequest` is emitted when SDK callback handlers block and is resolved later through `respondToRequest` (`src-bun/rpc.ts:1239-1268`).

### Copilot client lifecycle

- `src-bun/app/client/client.ts` owns a singleton `CopilotClient`; `ensureClient()` is idempotent and starts the SDK exactly once (`src-bun/app/client/client.ts:1-16`, `src-bun/app/client/client.ts:71-110`).
- It resolves the platform-native `@github/copilot-<platform>-<arch>` binary and passes it as a stdio runtime connection, avoiding the bundled JS entrypoint that needs Node >= 24 (`src-bun/app/client/client.ts:31-50`, `src-bun/app/client/client.ts:82-90`). This is a Copilot-native packaging constraint, not a generic provider constraint.
- All SDK imports are intentionally hidden behind `src-bun/app/client/copilotSdk.ts`, which already localizes future SDK/package churn (`src-bun/app/client/copilotSdk.ts:1-33`, `src-bun/app/client/copilotSdk.ts:67-112`). That file is the natural seam to replace with `providers/copilot` rather than spreading provider branches through the app.

### Session lifecycle and persistence

- `SessionRegistry` stores live `CopilotSession` entries and owns pending SDK callback promises for permission, user input, and elicitation (`src-bun/app/chat/sessions.ts:1-13`, `src-bun/app/chat/sessions.ts:139-157`).
- New sessions call `client.createSession` with the shared base config and optional working directory/model/reasoning effort; early SDK events are buffered until the real session id is known (`src-bun/app/chat/sessions.ts:248-326`).
- Resumed sessions call `client.resumeSession`, reapply Dafman-owned `approveAll` and `mode`, emit persisted title early, then hydrate history via `session.getEvents()` because `session.on()` does not replay history (`src-bun/app/chat/sessions.ts:352-459`, `src-bun/app/chat/sessions.ts:519-624`).
- Dafman keeps its own per-session metadata store for the pieces the SDK does not remember through resume: `approveAll` and run `mode` (`src-bun/app/chat/sessionMetadataStore.ts:1-18`, `src-bun/app/chat/sessionMetadataStore.ts:120-150`). This becomes provider metadata, not Copilot metadata.
- The renderer `SessionRecord` has fields for `model`, `reasoningEffort`, `mode`, `approveAll`, `workingDirectory`, pending requests, current custom agent, task/plan refresh counters, touched files, and deletion state, but no `providerId` or capabilities object today (`src/stores/chat/sessionsStore.ts:1-263`).
- Renderer session create/restore calls are Copilot-shaped: create applies global default model/reasoning, default approve-all, and then fire-and-forget hydrates `getSessionMode` and `getCurrentAgent`; restore expects `resumeSession` to return cwd/model/approveAll/mode (`src/stores/chat/sessionsStore.ts:259-623`).

### Permissions, tools, MCP, skills, agents

- Base session config enables Copilot config discovery for `.mcp.json`, `.vscode/mcp.json`, skills, and instructions; registers built-in tools and local slash commands; and wires callbacks for permissions, user input, elicitation, exit-plan-mode, and auto-mode-switch (`src-bun/app/chat/sessionConfigBuilder.ts:69-180`).
- Copilot permission handling is richer than ACP's generic permission option model: Dafman supports per-session approve-all, autopilot decline paths, pending-request queues, and typed approval rules such as commands/read/write/mcp/mcp-sampling/memory/custom-tool (`src-bun/app/chat/sessionConfigBuilder.ts:86-124`, `src-bun/rpc.ts:526-568`).
- Audit today is partly Copilot-hook-specific. `onPreMcpToolCall` and `onPostToolUseFailure` record sanitized MCP/tool-failure audit events and must never throw (`src-bun/app/chat/sessionConfigBuilder.ts:215-307`). ACP exposes tool-call updates and permission requests, but not these exact Copilot hooks.
- Model, mode, history, permissions, quota, and built-in tool APIs are SDK passthroughs under `SessionMetadataService` (`src-bun/app/chat/sessionMetadataService.ts:1-16`, `src-bun/app/chat/sessionMetadataService.ts:70-260`).
- MCP config/discovery and skills discovery are top-level Copilot client calls, separate from session entries (`src-bun/app/library/mcpRegistry.ts:1-15`, `src-bun/app/library/mcpRegistry.ts:40-115`, `src-bun/app/library/skillsRegistry.ts:1-10`, `src-bun/app/library/skillsRegistry.ts:40-81`). These are not ACP-standard library surfaces.
- Custom agents and tasks wrap Copilot experimental `session.rpc.agent.*` and `session.rpc.tasks.*`; comments explicitly call these experimental and Copilot SDK-shaped (`src-bun/app/chat/sessions.ts:1068-1085`, `src-bun/app/chat/sessions.ts:1108-1145`).

### Renderer assumptions that need capability gating

- `clientStore` owns a single boolean `ready` and a single `createClient()` call; there is no provider registry or per-provider auth state (`src/stores/app/clientStore.ts:1-42`).
- `modelsStore` is a single global cache over `listModels`; ACP's preferred model surface is session config options, not a global `listModels` method (`src/stores/library/modelsStore.ts:1-48`).
- `settingsStore` stores global default model, reasoning effort, streaming, default excluded/allowed tools, and default approve-all, but no provider default or provider-specific config (`src/stores/app/settingsStore.ts:17-55`).
- The run-mode UI binds directly to Dafman's three-value `SessionMode` and calls `sessionsStore.setSessionMode`, assuming the provider supports interactive/plan/autopilot (`src/components/chat/ModeButtonGroup.vue:1-29`). ACP v1 says session config options supersede legacy modes, so this UI must become capability/config driven.

## ACP research notes

- ACP uses JSON-RPC 2.0 methods and notifications; a typical flow is `initialize`, optional `authenticate`, `session/new` or session load/resume, `session/prompt`, `session/update` notifications, optional file/permission requests, and `session/cancel` for interruption (https://agentclientprotocol.com/protocol/v1/overview.md).
- Initialization negotiates protocol version, client capabilities (`fs.readTextFile`, `fs.writeTextFile`, `terminal`) and agent capabilities (`loadSession`, prompt capabilities, MCP capabilities, auth, session capabilities). Omitted capabilities are unsupported (https://agentclientprotocol.com/protocol/v1/initialization.md).
- Session setup covers `session/new`, `session/load` with replay, `session/resume` without replay, and `session/close` when advertised (https://agentclientprotocol.com/protocol/v1/session-setup.md).
- `session/list` and `session/delete` are advertised under `sessionCapabilities`; list supports cwd filtering and cursor pagination, while delete only specifies future list behavior (https://agentclientprotocol.com/protocol/v1/session-list.md, https://agentclientprotocol.com/protocol/v1/session-delete.md).
- Prompt turns stream user/agent content, plans, tool calls, permission requests, usage updates, and finish with a `stopReason` response (https://agentclientprotocol.com/protocol/v1/prompt-turn.md).
- Session config options are the preferred generic model/mode/reasoning selector surface; categories include `mode`, `model`, and `thought_level`, and `session/set_config_option` returns the complete option state so dependent selectors can change together (https://agentclientprotocol.com/protocol/v1/session-config-options.md).
- Legacy ACP session modes still exist (`session/set_mode`, `current_mode_update`) but are explicitly transitional and expected to be removed in favor of config options (https://agentclientprotocol.com/protocol/v1/session-modes.md).
- ACP lets agents request client filesystem reads/writes and terminals only if the client advertises those capabilities (https://agentclientprotocol.com/protocol/v1/file-system.md, https://agentclientprotocol.com/protocol/v1/terminals.md).
- Tool calls have normalized kinds (`read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `other`), status, content, diffs, terminal refs, raw input/output, and permission options (`allow_once`, `allow_always`, `reject_once`, `reject_always`) (https://agentclientprotocol.com/protocol/v1/tool-calls.md).
- Slash commands are advertised by `available_commands_update` and invoked as normal prompt text (https://agentclientprotocol.com/protocol/v1/slash-commands.md).
- Plans are full-replacement `session/update` notifications with entries and statuses (https://agentclientprotocol.com/protocol/v1/agent-plan.md).
- Auth is negotiated through `authMethods` on initialize; clients call `authenticate(methodId)`, and `logout` is gated by `agentCapabilities.auth.logout` (https://agentclientprotocol.com/protocol/v1/authentication.md).
- The official TypeScript package is `@agentclientprotocol/sdk`, with `ClientSideConnection` for clients and `AgentSideConnection` for agents (https://agentclientprotocol.com/libraries/typescript.md). The protocol repo reports Apache-2.0 licensing and stable wire protocol version `1` (https://github.com/agentclientprotocol/agent-client-protocol).
- ACP-compatible agents are already broad: the ACP docs list Claude Agent, Codex CLI, Gemini CLI, GitHub Copilot public preview, OpenCode, Qwen Code, Cursor, Kiro, Goose, and many more (https://agentclientprotocol.com/get-started/agents.md). A VS Code ACP client repo ships defaults for Copilot, Claude, Gemini, Qwen, Codex, OpenCode, Kiro, Hermes, and others, and demonstrates per-agent session list, config options, filesystem, terminals, permissions, slash commands, and traffic logging (https://github.com/formulahendry/vscode-acp).
- `@mcpc-tech/acp-ai-provider` bridges ACP agents into Vercel AI SDK `LanguageModelV3`/`LanguageModelV2` and can spawn agents, but it exposes a language-model abstraction rather than Dafman's full agent/session/client protocol surface (https://www.npmjs.com/package/@mcpc-tech/acp-ai-provider, https://github.com/mcpc-tech/mcpc/tree/main/packages/acp-ai-provider).
- **The Copilot CLI you already spawn (`@github/copilot` 1.0.60) is itself an ACP server.** `sdk/index.d.ts` documents "the CLI is driven by another editor over ACP", lists `ACP server` as a top-level entry point, and treats `SessionClientKind = "cli" | "acp" | "sdk"` as a first-class behavior gate (`sdk/index.d.ts:503, 1856, 22778`). So Copilot could in principle be driven as "just another ACP agent."

## Decisive finding: don't reinvent — but Copilot-over-ACP is a regression vs Copilot-over-SDK

Because Copilot ships an ACP server, the maximal "one wheel" play would be to go **pure ACP** (drop `@github/copilot-sdk`, talk to Copilot over ACP like Claude/Gemini). The CLI's own **session-capability matrix** (`sdk/index.d.ts:22705`) proves that loses capability — and that the SDK and ACP surfaces are **not even subsets of each other**:

| Session capability | CLI TUI | SDK | ACP |
|---|:--:|:--:|:--:|
| `ask-user` (user-input prompts Dafman relies on) | ✓ | ✓ | **✗** |
| `plan-mode` | ✓ | ✗ | ✓ |
| `session-store` | ✓ | ✗ | ✓ |
| `interactive-mode` | ✓ | ✓ | ✓ |
| `system-notifications` | ✓ | ✓ | ✓ |
| `memory`, `cli-documentation`, `elicitation`, `tui-hints` | ✓ | ✗ | ✗ |

And that is only *session* capabilities. The rich **RPC surface** Dafman depends on (skills, custom agents, MCP config/discovery, quota, approval rules, fork, compact/truncate, task/fleet) is `@github/copilot-sdk`-specific and **not standardized in ACP**, so it does not ride the ACP transport at all. Driving Copilot over ACP would therefore *lose* `ask-user`/elicitation **plus** skills/agents/MCP-config/quota/approval-rules — a downgrade of the product's strongest backend. No library can paper over that gap because it is a product decision (keep Copilot's richness), which is exactly what the thin adapter encodes.

### What to reuse vs build

| Layer | Reuse (don't reinvent) | Build |
|---|---|---|
| Wire protocol | `@agentclientprotocol/sdk` (`ClientSideConnection`) for ACP; `@github/copilot-sdk` for Copilot | — |
| Multi-agent host architecture + agent presets | mirror `formulahendry/vscode-acp` (Copilot/Claude/Gemini/Qwen/Codex/OpenCode/Kiro defaults; session list/config/fs/terminal/permissions/logging); Zed as canonical reference | — |
| Capability vocabulary | ACP `agentCapabilities`/`clientCapabilities` + Copilot's published per-session capability matrix | a thin Dafman mapping onto UI gates |
| Provider adapter glue | — | the only bespoke layer: §1–§9 (keeps Copilot on SDK, ACP agents on ACP, normalizes events, gates UI) |

This *strengthens* Option B (below) and makes Option A provably wrong **even for Copilot itself**.

## Design

### 1. Provider registry and internal interface

Add a backend-only provider registry under `src-bun/app/providers/`:

- `providers/types.ts` — internal contracts and normalized event/capability types.
- `providers/registry.ts` — starts/stops providers, resolves sessions by provider, exposes provider metadata to RPC handlers.
- `providers/copilot/` — adapter around today's `client/`, `chat/`, `library/`, and Copilot-specific services.
- `providers/acp/` — generic ACP client provider that spawns configured ACP agents.

Do **not** expose ACP's raw schema directly to the renderer. The renderer should see Dafman concepts: provider metadata, session capabilities, session config options, normalized pending requests, and normalized timeline events. ACP method names remain adapter details.

A concrete first-pass interface:

```ts
export interface AgentProvider {
  readonly id: ProviderId;
  readonly kind: 'copilot-native' | 'acp';
  readonly displayName: string;

  start(): Promise<ProviderStartResult>;
  stop(): Promise<void>;
  getStatus(): ProviderStatus;
  getCapabilities(): ProviderCapabilities;
  getAuthState(): Promise<ProviderAuthState>;
  authenticate(methodId?: string): Promise<ProviderAuthState>;
  logout?(): Promise<ProviderAuthState>;

  listSessions(opts?: { cwd?: string; cursor?: string }): Promise<ProviderSessionList>;
  createSession(opts: ProviderCreateSessionOptions): Promise<ProviderSessionHandle>;
  loadSession?(opts: ProviderLoadSessionOptions): Promise<ProviderSessionHandle>;
  resumeSession(opts: ProviderResumeSessionOptions): Promise<ProviderSessionHandle>;
  closeSession?(sessionKey: ProviderSessionKey): Promise<void>;
  deleteSession?(sessionKey: ProviderSessionKey): Promise<void>;
  forkSession?(sessionKey: ProviderSessionKey, opts?: { toEventId?: string }): Promise<ProviderSessionHandle>;

  sendPrompt(sessionKey: ProviderSessionKey, prompt: ProviderPrompt): Promise<ProviderPromptResult>;
  abort(sessionKey: ProviderSessionKey): Promise<void>;
  respondToRequest(params: ProviderPendingResponse): Promise<boolean>;

  getSessionConfig?(sessionKey: ProviderSessionKey): Promise<SessionConfigState>;
  setSessionConfigOption?(sessionKey: ProviderSessionKey, id: string, value: string): Promise<SessionConfigState>;
  listModels?(): Promise<ModelSummary[]>;

  listTools?(): Promise<ToolSummary[]>;
  listSessionMcpServers?(sessionKey: ProviderSessionKey): Promise<McpServerSummary[]>;
  listProviderLibrary?(opts: ProviderLibraryQuery): Promise<ProviderLibraryResult>;
}
```

`ProviderCapabilities` should be boring and explicit. Suggested shape:

- `lifecycle`: `create`, `list`, `load`, `resume`, `close`, `delete`, `fork`.
- `prompt`: `text`, `image`, `audio`, `embeddedContext`, `resourceLinks`, `fileAttachments`, `directoryAttachments`, `deliveryModes` (`enqueue`, `immediate`, `interrupt`).
- `timeline`: `streamingText`, `reasoning`, `toolCalls`, `diffs`, `plans`, `usage`, `sessionInfo`, `slashCommands`, `subagents`, `backgroundTasks`.
- `config`: `sessionConfigOptions`, `legacyModes`, `modelSelector`, `reasoningEffort`, `copilotThreeModeSemantics`.
- `permissions`: `requestPermission`, `rememberDecisions`, `approveAll`, `dafmanApprovalRules`, `elicitation`, `userInput`, `exitPlanMode`, `autoModeSwitch`.
- `clientServices`: `fsRead`, `fsWrite`, `terminal`, `terminalEmbedding`, `mcpServers`, `mcpOverAcp`.
- `library`: `copilotSkills`, `copilotAgentFiles`, `copilotMcpConfig`, `instructionSources`, `builtInTools`, `quota`.
- `auth`: `methods`, `logout`, `externalCliManaged`.
- `persistence`: `providerOwnsHistory`, `loadReplaysHistory`, `resumeWithoutReplay`, `dafmanLocalReplayRequired`, `providerSessionIdsMayCollide`.

These are intentionally feature flags, not a hierarchy of optional methods discovered by trial and error. UI gates should read capabilities before rendering controls.

### 2. Session identity and provider selection

Provider selection should be **immutable per session**. Users can choose a provider when creating a session; existing sessions resume through the provider that created them.

Recommended storage model:

- Add `providerId` and `providerSessionId` to Dafman's persisted session metadata.
- Keep a Dafman-owned `sessionId` for the renderer/panel id invariant. For existing Copilot sessions, migrate by setting `providerId: 'copilot'` and `providerSessionId: <current session id>`, while preserving the renderer id for compatibility.
- For new non-Copilot providers, generate a Dafman session id such as `acp:<providerConfigId>:<base64url(providerSessionId)>` or a UUID mapped in metadata. Prefer the mapped UUID if ACP session ids can contain path-hostile or UI-hostile characters.
- Store provider selection in three scopes: global default, optional workspace default, immutable per-session value. Resolve create-session default as explicit selection > workspace default > global default > Copilot.

Do not mutate `Layout.dockview` with provider state. The architecture rule says `SessionRecord` is runtime source of truth and dockview JSON remains opaque UI shape (`ARCHITECTURE.md:259-268`). Provider/session metadata belongs in the backend metadata store and renderer `SessionRecord`.

### 3. Copilot native provider

Keep Copilot native as the first provider, implemented by moving today's singleton client and `SessionRegistry` orchestration behind `providers/copilot`.

Why keep it native:

- It already solves packaged binary resolution and Node >= 24 avoidance (`src-bun/app/client/client.ts:31-50`).
- It exposes Copilot-specific SDK APIs that ACP does not standardize: skills, agent files, global MCP config/discovery, quota, task/fleet, history compact/truncate, permission approval rules, and audit hooks (`src-bun/app/chat/sessionMetadataService.ts:70-260`, `src-bun/app/library/mcpRegistry.ts:40-115`, `src-bun/app/library/skillsRegistry.ts:40-81`).
- Wrapping Copilot through ACP immediately would risk losing UX and behavior that Dafman already depends on.

The Copilot provider should report capabilities that match today's behavior, including `library.copilotSkills`, `library.copilotAgentFiles`, `library.copilotMcpConfig`, `permissions.dafmanApprovalRules`, `permissions.approveAll`, `config.copilotThreeModeSemantics`, and `lifecycle.fork`.

### 4. Generic ACP provider

The ACP provider should be a process-spawning provider for configured agents:

```ts
export interface AcpProviderConfig {
  id: string;
  title: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  defaultCwd?: string;
  authMethodId?: string;
}
```

Lifecycle:

1. Spawn the configured command over stdio with `@agentclientprotocol/sdk` `ClientSideConnection`.
2. Call `initialize` with Dafman client info and only the client capabilities Dafman is prepared to enforce safely.
3. If `authMethods` are returned and the first session call fails auth, surface an auth-required provider state and let the user choose an auth method; do not silently run arbitrary login flows without UI state.
4. Translate ACP agent capabilities into `ProviderCapabilities`.
5. On create, call `session/new` with `cwd`, MCP server declarations, and optional config defaults.
6. On resume/history restore, prefer `session/load` when transcript replay is needed. Use `session/resume` only when Dafman already has local transcript state or the UI explicitly accepts no replay.
7. Convert `session/update` notifications into Dafman's normalized timeline events.
8. Implement `session/cancel` for abort and `session/close`/`session/delete` only when advertised.

Initial safety posture:

- Start with `fs.readTextFile=false`, `fs.writeTextFile=false`, and `terminal=false` unless the adapter also implements permission/audit gates for those client methods.
- Support plain text prompts and resource links first. Add embedded resources/images only when `promptCapabilities` says the agent supports them.
- Treat ACP permission requests as generic pending requests with provider-supplied options. Only expose "remember" controls when an option kind is `allow_always`/`reject_always` and the provider reports stable semantics.
- Do not claim Copilot-style `approveAll` or typed `PermissionApprovalRule` support for ACP providers unless the adapter is mapping those rules to provider-specific policy.

### 5. Normalized event model

Short term, adapters can emit current `SessionEventPayload` because the renderer reducer already consumes it. Long term, add a provider-neutral event layer and keep Copilot SDK event names in the Copilot adapter only.

Minimum normalized event families:

- `session.started`, `session.infoChanged`, `session.idle`, `session.error`.
- `message.user`, `message.assistant.delta`, `message.assistant.complete`.
- `reasoning.delta`, `reasoning.complete`, with opaque/encrypted fields allowed.
- `tool.started`, `tool.updated`, `tool.completed`, `tool.failed`, including kind, locations, raw input/output redaction state, and terminal refs.
- `plan.updated` as full replacement.
- `usage.updated` with provider-specific raw payload preserved under `_meta`.
- `config.updated` for ACP config options and Copilot model/mode changes.
- `slashCommands.updated`.
- `pending.requested` / `pending.completed`.

The adapter should preserve provider raw payloads only under a namespaced `_meta.providerRaw` field for diagnostics; renderer UI should not depend on them.

### 6. Capability-driven renderer gates

Add RPCs before adding a second provider:

- `listProviders`: provider id/title/kind/status/auth summary/default marker.
- `getProviderCapabilities`: exact `ProviderCapabilities` for a provider.
- `authenticateProvider`, `logoutProvider`.
- `createSession` gains `providerId?: string` and returns provider metadata.
- `resumeSession` response gains `providerId`, provider display name, capabilities, and session config options.
- `listSessions` can return mixed-provider history or `providerId`-filtered history.

Renderer changes:

- `clientStore.ready` becomes provider-registry readiness: app can be ready while one provider is unauthenticated or failed.
- `SessionRecord` gains `providerId`, `providerTitle`, `capabilities`, and `configOptions`.
- Mode controls render from `configOptions` category `mode` when present, then legacy ACP modes, then Copilot's three-mode UI only when `config.copilotThreeModeSemantics` is true.
- Model picker renders from `configOptions` category `model` for ACP sessions; global `listModels` remains Copilot-provider-scoped or becomes `listProviderModels(providerId)`.
- Library tabs show provider availability. Copilot Skills/Agents/MCP config remain visible for Copilot sessions; ACP sessions either hide them or render an "unsupported by this provider" empty state. Do not show broken controls that call Copilot-only RPCs.
- Approve-all and permission-rule UI render only when `permissions.approveAll` / `permissions.dafmanApprovalRules` are true. Generic ACP permission requests render provider-supplied options instead.
- Terminal/file client capabilities are not advertised to ACP agents until UI/audit gates are implemented; when advertised, their activity must produce the same audit/activity records as Copilot tool hooks.

### 7. Auth model

Provider auth should be per provider, not per session.

- Copilot native: `auth.externalCliManaged=true`; `authenticateProvider('copilot')` should trigger or explain the Copilot CLI login flow but not store secrets in Dafman.
- ACP: read `authMethods` from initialize; UI lets the user choose a method. Store only method preference/provider config, not credentials, unless a specific provider requires a token and the user approves a secure storage design.
- A provider can be `notStarted`, `starting`, `ready`, `authRequired`, `authInProgress`, `failed`, or `stopped`.
- Auth failures during prompt/session operations should update provider/session state and show a targeted re-auth action. ACP docs do not guarantee what happens to active sessions after logout, so the UI must tolerate active session operations failing after logout.

### 8. MCP, filesystem, terminals, and audit

ACP and Copilot split responsibilities differently:

- Copilot native owns MCP config/discovery through SDK calls today.
- ACP session setup accepts MCP server declarations, and the MCP-over-ACP RFD adds an ACP transport for client-provided tools, but this is still a capability-dependent path.
- ACP agents may call Dafman's client filesystem/terminal methods if Dafman advertises them.

Recommended sequence:

1. Keep Copilot MCP registry as Copilot-only.
2. For ACP v1, allow provider config to declare MCP servers in settings and pass them to `session/new`/`session/load`.
3. Do not advertise `fs.writeTextFile` or `terminal` until permission prompts and audit entries are wired for those exact client-side operations.
4. When adding fs/terminal, route through existing filesystem/terminal services where possible, but add provider/session attribution and audit records. ACP requires absolute paths and 1-based lines; enforce that at the adapter boundary.
5. Treat MCP-over-ACP as a later enhancement for Dafman-provided tools, not as a dependency for initial ACP sessions.

### 9. RPC mapping table

| Dafman current RPC / event group | Current owner | ACP equivalent | Provider design decision |
|---|---|---|---|
| `createClient` | Copilot singleton `ensureClient()` (`src-bun/index.ts:176-180`, `src-bun/app/client/client.ts:71-110`) | Spawn/initialize ACP agent; optional `authenticate` | Replace with provider registry `startProvider`/`ensureProvider`. Keep `createClient` as compatibility alias for Copilot during migration. |
| `createSession` | `SessionRegistry.create` using `client.createSession` (`src-bun/app/chat/sessions.ts:273-326`) | `session/new` | Provider `createSession(providerId, cwd, config)`; adapter returns Dafman session id + provider session id + config state. |
| `resumeSession` | `client.resumeSession` + Dafman metadata restore + `getEvents()` replay (`src-bun/app/chat/sessions.ts:352-459`) | `session/load` for replay, `session/resume` for no replay | ACP adapter should use `session/load` for restored panes unless Dafman has local transcript. Preserve resume response cwd/model/approveAll/mode as provider-config state. |
| `disconnectSession` | Live `session.disconnect()` / entry removal | `session/close` when advertised; otherwise local detach/process lifecycle | Provider `closeSession` should be capability-gated; local detach is allowed only if provider lacks close. |
| `listSessions` | `client.listSessions()` (`src-bun/app/chat/sessions.ts:624-650`) | `session/list` | Provider-scoped list with `providerId`; mixed list merges pages and carries provider metadata. |
| `deleteSession` | `client.deleteSession()` plus Dafman metadata cleanup (`src-bun/app/chat/sessions.ts:652-699`) | `session/delete` when advertised | Capability-gated; if unsupported, disable delete or delete only Dafman local record after explicit warning. |
| `sendMessage` | `session.send({ prompt, agentMode, mode, attachments })` (`src-bun/app/chat/sessions.ts:849-934`) | `session/prompt` with `ContentBlock[]` | Normalize prompt attachments to ACP text/resource/image/audio/resource_link according to prompt capabilities. Copilot delivery modes remain provider-specific. |
| `abortSession` | `session.abort()` (`src-bun/app/chat/sessionMetadataService.ts:77-82`) | `session/cancel` notification | Provider `abort`; renderer interrupt action enabled only when supported. |
| `sessionEvent` | Copilot SDK event passthrough (`src-bun/rpc.ts:1248-1250`) | `session/update` notifications | Add adapter normalizer. Avoid renderer dependence on raw ACP or raw Copilot event names long-term. |
| `pendingRequest` / `respondToRequest` | SDK callbacks via `PendingRequestQueue` (`src-bun/app/chat/sessionConfigBuilder.ts:86-180`, `src-bun/rpc.ts:1183-1194`) | Client method `session/request_permission`; ACP elicitation RFD/agent-specific requests as applicable | Normalize provider pending requests. Copilot typed approval rules stay Copilot-only; ACP renders provider options. |
| `getSessionMode`, `setSessionMode` | `session.rpc.mode.get/set` (`src-bun/app/chat/sessionMetadataService.ts:100-130`) | Legacy `session/set_mode`; preferred `session/set_config_option` category `mode` | UI should prefer config options. Copilot three-mode selector only for Copilot capability. |
| `listModels`, `setSessionModel` | `client.listModels`, `session.setModel` (`src-bun/index.ts:241-248`, `src-bun/app/chat/sessionMetadataService.ts:84-98`) | Config option category `model`; no required global list | Make models provider/session scoped. Keep Copilot global cache for Copilot provider only. |
| `compactSessionHistory`, `truncateSessionHistory`, `forkSession` | Copilot `rpc.history.*`, `client.rpc.sessions.fork` (`src-bun/app/chat/sessionMetadataService.ts:140-207`) | No stable direct ACP v1 equivalent for compact/truncate; fork appears as ACP RFD, not baseline | Keep Copilot-only; capability-gate controls. Do not emulate by mutating local transcript. |
| `setSessionApproveAll`, `resetSessionApprovals`, `PermissionApprovalRule` | Copilot permission APIs and Dafman mirror (`src-bun/app/chat/sessionMetadataService.ts:217-260`, `src-bun/rpc.ts:526-568`) | ACP permission options with allow/reject once/always | Generic ACP provider can auto-answer based on user policy, but Copilot rule editor is Copilot-specific until an ACP extension exists. |
| `listSessionSkills`, `setSessionSkillEnabled`, `discoverSkills`, `setGloballyDisabledSkills` | Copilot skills SDK surfaces (`src-bun/app/library/skillsRegistry.ts:1-81`) | No standard ACP skills surface; slash commands partially overlap | Treat skills as Copilot library capability. ACP slash commands can populate composer commands but not Library Skills. |
| `listAgents`, `selectAgent`, `listAgentFiles`, `writeAgentFile`, `startFleet`, `listTasks` | Copilot experimental `session.rpc.agent.*`, `tasks.*`, `fleet.*` (`src-bun/app/chat/sessions.ts:1068-1145`) | Tool calls/plans/subagent events may approximate display; no standard CRUD/select agent surface | Copilot-only unless an ACP agent advertises custom `_meta` capability. Hide or replace with provider-specific extensions. |
| `listMcpConfigs`, `discoverMcpServers`, `loginToMcpServer`, `listSessionMcpServers`, `setSessionMcpEnabled` | Copilot client/session MCP RPCs (`src-bun/app/library/mcpRegistry.ts:1-115`, `src-bun/rpc.ts:977-1027`) | Session `mcpServers`, `mcpCapabilities`, auth through provider; MCP-over-ACP RFD | Keep global MCP registry Copilot-only initially. ACP provider config may pass MCP servers per session; add MCP-over-ACP later. |
| `createTerminal`, `writeTerminal`, `resizeTerminal`, `killTerminal`, `listTerminals` | Dafman user-facing terminal registry (`src-bun/rpc.ts:1109-1131`) | Client-side `terminal/*` methods called by agent | Existing terminal UI is not enough. ACP terminal capability needs agent-call handlers, permission/audit, and terminal content embedding. |
| `searchWorkspaceFiles`, `pickFolder`, `pickAttachment`, `browseDirectory`, `revealPath` | Dafman UI helpers (`src-bun/rpc.ts:662-727`, `src-bun/rpc.ts:1140-1166`) | ACP `fs/read_text_file`, `fs/write_text_file` only for agent file access | Keep UI helpers outside provider. ACP fs methods are provider client-services and must be permission/audit gated. |
| `readSessionPlan`, `writeSessionPlan`, `deleteSessionPlan` | Dafman plan file service (`src-bun/rpc.ts:951-975`) | ACP `plan` session updates | Copilot plan file stays Copilot/Dafman feature. ACP plans render from `session/update`; editing provider-owned plan needs custom capability. |
| `getAccountQuota`, `listBuiltinTools`, `getSessionUsageMetrics` | Copilot SDK quota/tools/usage (`src-bun/app/chat/sessionMetadataService.ts:248-317`) | ACP `usage_update`; tool lists are not global baseline | Normalize usage display; keep quota/built-in tool catalog capability-gated. |
| Settings, logs, diagnostics, audit, exports | Dafman app services (`src-bun/rpc.ts:1132-1243`) | Outside ACP; audit can be enriched from ACP events | Stay app-level. Add provider/session fields to logs/audit records. |

## Alternatives / options

### A. Adopt ACP as Dafman's internal abstraction directly

**Shape:** Replace `SessionRegistry`/`CommandMap` concepts with ACP client/server concepts. Renderer state models ACP `session/update`, `configOptions`, `request_permission`, etc.

**Pros**

- Lowest impedance for ACP agents.
- Less adapter code for generic ACP provider.
- ACP docs and schemas become the product contract.

**Cons**

- Copilot-native features become protocol extensions or `_meta` blobs: skills, custom agent files, MCP config/discovery, quota, task/fleet, history compact/truncate, approval rules, audit hooks.
- Renderer becomes tied to ACP churn and legacy/next-version distinctions such as modes vs config options.
- The current Copilot integration would need a Copilot-to-ACP shim even though the SDK already gives richer native APIs.

**Recommendation:** Do not choose this now. It optimizes for ACP purity at the expense of Dafman's existing differentiated Copilot UX.

### B. Thin internal Provider interface + per-SDK adapters

**Shape:** Add a stable Dafman provider contract. Implement `copilot` with today's SDK and `acp` with `@agentclientprotocol/sdk`. Renderer sees provider capabilities and normalized events, not raw SDK/ACP protocols.

**Pros**

- Preserves current Copilot behavior and packaging work.
- Lets ACP agents come online incrementally.
- Capability negotiation becomes a first-class UI input rather than exception-driven control hiding.
- Leaves room for future provider-specific native SDKs if one offers better UX than ACP.

**Cons**

- Requires adapter and normalizer code.
- Requires careful session identity migration.
- Some features need two implementations or explicit "unsupported" UI.

**Recommendation:** Choose this. It is the boring, maintainable cutover that avoids both protocol leakage and Copilot regression.

### C. Use `@mcpc-tech/acp-ai-provider` / Vercel AI SDK provider

**Shape:** Treat ACP agents as AI SDK `LanguageModel` implementations and route Dafman prompts through `generateText`/`streamText`-style APIs.

**Pros**

- Fast path for simple chat/text generation.
- Existing package handles spawning ACP agents and lazy authentication.
- Useful reference for auth/retry and tool bridging patterns.

**Cons**

- Dafman is an agent client, not just a language-model caller. It needs sessions, list/resume/delete/close, session config options, permission prompts, tool-call timeline, terminal/file client services, slash command updates, plans, usage, and provider auth state.
- AI SDK `tools` and `LanguageModel` abstractions flatten the exact agentic control plane Dafman is trying to expose.
- Would likely force reimplementing lost ACP surfaces around the provider, defeating the shortcut.

**Recommendation:** Do not use as the main integration. Keep it as a reference or possible sandbox for non-agent chat experiments.

## Open questions

1. **Session identity format:** Should Dafman session ids stay equal to provider ids for Copilot and use a metadata mapping for non-Copilot, or should all sessions move to Dafman UUIDs with `providerSessionId` hidden? Recommended default: migrate to Dafman UUIDs for new non-Copilot sessions while preserving existing Copilot ids.
2. **Provider default scope:** Should provider default be global only, workspace override, or last-used per workspace? Recommended default: global default plus optional workspace default; session create can override; existing sessions are immutable.
3. **Copilot ACP vs native Copilot:** Should Copilot eventually be driven through ACP for parity testing, or remain native permanently? Recommended default: keep native until ACP Copilot proves it can cover skills/agents/MCP/permissions/audit/history parity.
4. **Initial ACP client capabilities:** Should v1 ACP provider advertise filesystem/terminal at all? Recommended default: start with no fs/write/terminal advertisement; add each only with permission/audit gates.
5. **Capability flag granularity:** Is a static boolean tree enough, or should capabilities carry provider-supplied UI descriptors? Recommended default: boolean tree for gates plus `configOptions` descriptors for model/mode/reasoning.
6. **Auth UX:** Should provider auth live in Settings, a provider picker modal, or a per-session blocking card? Recommended default: Settings owns provider accounts/config; session actions surface targeted re-auth cards.
7. **ACP history strategy:** For agents with `session/resume` but no `session/load`, should Dafman keep a local normalized transcript store? Recommended default: yes, but only after the normalized event model exists; otherwise disable transcript restore for those providers.
8. **Copilot Library tabs:** For non-Copilot providers, should Library hide Copilot-only tabs or show disabled explanatory states? Recommended default: disabled explanatory states when a session is active, hidden from global Library views if no provider supports them.
9. **MCP source of truth:** Should Dafman's MCP library become provider-neutral or remain Copilot config plus ACP per-provider config? Recommended default: keep Copilot MCP registry as-is; add ACP provider config for session MCP servers; revisit provider-neutral MCP after MCP-over-ACP work.
10. **Model defaults:** Should global default model be provider-qualified? Recommended default: yes: `{ providerId, modelId, reasoningEffort/configValues }`, with legacy `defaultModelId` treated as Copilot-only during migration.
11. **Provider installation:** Should Dafman ship default ACP agent commands or only let users configure installed commands? Recommended default: ship presets but never auto-install; show command/path validation and docs.
12. **Remote transports:** ACP docs mention HTTP/WebSocket remote scenarios as work in progress. Should Dafman design for remote now? Recommended default: provider interface should not assume stdio, but initial ACP adapter should be stdio-only.

## Implementation phases

1. **Provider contract without behavior change**
   - Add backend provider types/capabilities and a Copilot-only registry facade.
   - Keep old RPC names working by delegating to `providerRegistry.get('copilot')`.
   - Add tests around provider capability serialization and legacy RPC compatibility.

2. **Copilot adapter extraction**
   - Move `client.ts`, `SessionRegistry`, Copilot library registries, and metadata services under `providers/copilot` or wrap them behind adapter classes.
   - No renderer behavior change.
   - Add `providerId: 'copilot'` to session metadata and resume responses.

3. **Renderer capability plumbing**
   - Add `listProviders`, `getProviderCapabilities`, provider auth status, and provider-aware `createSession`/`resumeSession` responses.
   - Add `providerId`, `providerTitle`, `capabilities`, and `configOptions` to `SessionRecord`.
   - Gate mode/model/approval/Library controls from capabilities while keeping Copilot controls unchanged.

4. **ACP provider minimal path**
   - Add `@agentclientprotocol/sdk` and an `acp` provider implementation that spawns one configured stdio agent.
   - Implement initialize/auth/session-new/session-prompt/session-cancel/session-update translation.
   - Support text prompts and basic assistant/tool/plan updates.
   - Do not advertise fs/write/terminal yet.

5. **ACP persistence and session list**
   - Implement `session/list`, `session/load`, `session/resume`, `session/delete`, and `session/close` when advertised.
   - Add provider-qualified session metadata and local normalized transcript storage for agents that cannot replay history.

6. **ACP config options and slash commands**
   - Render ACP `configOptions` for model/mode/thought level.
   - Render `available_commands_update` into composer slash suggestions.
   - Deprecate direct assumptions that every provider supports Copilot `interactive | plan | autopilot`.

7. **Permissions, filesystem, terminals, and audit**
   - Normalize ACP `session/request_permission` into `PendingRequestPayload`.
   - Add ACP client fs/terminal handlers only with permission prompts and audit records.
   - Map ACP terminal refs into Dafman terminal/tool UI.

8. **Provider-neutral cleanup**
   - Move renderer reducer from raw Copilot event names to normalized event names.
   - Keep raw provider payloads only in diagnostics.
   - Add docs/manual test entries for provider setup and capability differences.

## Verification

For this spec file: read the file back and verify the required sections, current-state citations, RPC/ACP mapping table, alternatives, open questions, and implementation phases are present.

For implementation later:

- Unit-test provider registry resolution, provider capability gating, and session id/provider id mapping.
- Keep existing Copilot session tests passing through the provider facade.
- Add wire-contract snapshot coverage for new provider fields in `src-bun/__tests__/wire-contract.test.ts`.
- Add a fake ACP agent integration test that exercises initialize, auth-required, session/new, prompt/update, permission request, cancel, session/list/load/delete capability branches.
- Add renderer tests for mode/model/approve-all/Library controls hidden or disabled by capabilities.
- Manually smoke-test at least Copilot native plus one ACP agent with `session/new`, prompt, cancel, permission denial, and resume/list if advertised.

## References

### Dafman files

- `ARCHITECTURE.md:1-19` — current Bun/renderer/Copilot process diagram.
- `ARCHITECTURE.md:97-105` — typed IPC and main-process rules.
- `ARCHITECTURE.md:270-333` — current RPC/message surface and reducer families.
- `ARCHITECTURE.md:400-451` — Copilot SDK gotchas.
- `src-bun/rpc.ts:645-1243` — Bun RPC request schema.
- `src-bun/rpc.ts:1239-1268` — renderer message channels.
- `src/ipc/types.ts:570-863` — renderer `CommandMap` mirror.
- `src-bun/index.ts:149-260`, `src-bun/index.ts:259-523` — concrete RPC handler wiring.
- `src-bun/app/client/client.ts:1-143` — singleton Copilot client and native binary resolution.
- `src-bun/app/client/copilotSdk.ts:1-112` — SDK import facade.
- `src-bun/app/chat/sessions.ts:1-13`, `src-bun/app/chat/sessions.ts:139-157`, `src-bun/app/chat/sessions.ts:248-459`, `src-bun/app/chat/sessions.ts:519-934`, `src-bun/app/chat/sessions.ts:1068-1145` — session lifecycle and Copilot-specific session services.
- `src-bun/app/chat/sessionConfigBuilder.ts:69-330` — Copilot session config, callbacks, permissions, MCP/tool audit hooks.
- `src-bun/app/chat/sessionMetadataService.ts:1-260` — model/mode/history/permissions/quota/tool passthroughs.
- `src-bun/app/chat/sessionMetadataStore.ts:1-150` — Dafman-owned session metadata persistence.
- `src-bun/app/library/mcpRegistry.ts:1-115` — Copilot MCP config/discovery registry.
- `src-bun/app/library/skillsRegistry.ts:1-81` — Copilot skills discovery/config registry.
- `src/stores/app/clientStore.ts:1-42` — single-client renderer readiness.
- `src/stores/app/settingsStore.ts:17-55` — current global defaults.
- `src/stores/library/modelsStore.ts:1-48` — global model cache.
- `src/stores/chat/sessionsStore.ts:1-263`, `src/stores/chat/sessionsStore.ts:259-983` — renderer session record and actions.
- `src/components/chat/ModeButtonGroup.vue:1-29` — Copilot-shaped mode control.
- `package.json:1-143` — current dependencies include Copilot SDK but no ACP SDK.

### External references

- ACP docs index: https://agentclientprotocol.com/llms.txt
- ACP introduction: https://agentclientprotocol.com/get-started/introduction.md
- ACP overview: https://agentclientprotocol.com/protocol/v1/overview.md
- ACP initialization/capabilities: https://agentclientprotocol.com/protocol/v1/initialization.md
- ACP session setup/load/resume/close: https://agentclientprotocol.com/protocol/v1/session-setup.md
- ACP prompt turn: https://agentclientprotocol.com/protocol/v1/prompt-turn.md
- ACP session config options: https://agentclientprotocol.com/protocol/v1/session-config-options.md
- ACP session modes: https://agentclientprotocol.com/protocol/v1/session-modes.md
- ACP session list/delete: https://agentclientprotocol.com/protocol/v1/session-list.md, https://agentclientprotocol.com/protocol/v1/session-delete.md
- ACP tool calls/permissions: https://agentclientprotocol.com/protocol/v1/tool-calls.md
- ACP filesystem/terminals: https://agentclientprotocol.com/protocol/v1/file-system.md, https://agentclientprotocol.com/protocol/v1/terminals.md
- ACP slash commands/plans/content/auth: https://agentclientprotocol.com/protocol/v1/slash-commands.md, https://agentclientprotocol.com/protocol/v1/agent-plan.md, https://agentclientprotocol.com/protocol/v1/content.md, https://agentclientprotocol.com/protocol/v1/authentication.md
- ACP TypeScript SDK: https://agentclientprotocol.com/libraries/typescript.md
- ACP protocol repository/license: https://github.com/agentclientprotocol/agent-client-protocol
- ACP agents list: https://agentclientprotocol.com/get-started/agents.md
- VS Code ACP reference client: https://github.com/formulahendry/vscode-acp
- Vercel AI SDK ACP provider package: https://www.npmjs.com/package/@mcpc-tech/acp-ai-provider
- ACP provider repository README: https://github.com/mcpc-tech/mcpc/tree/main/packages/acp-ai-provider
- MCP-over-ACP RFD: https://agentclientprotocol.com/rfds/mcp-over-acp.md
