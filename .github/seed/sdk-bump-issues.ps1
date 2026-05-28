# Files SDK new-surface issues from the @github/copilot-sdk beta.7 → beta.9
# analysis pass per AGENTS.md rule 23. Source: SDK release notes
# https://github.com/github/copilot-sdk/releases for v1.0.0-beta.8 and v1.0.0-beta.9.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..\..

$existingTitles = (gh issue list --state all --limit 200 --json title | ConvertFrom-Json).title

$issues = @(
  @{
    title = 'feat(sdk): wire `agentMode` per-message to fix plan/autopilot mode requests'
    labels = 'enhancement,area:chat,area:backend,prio:p1'
    milestone = 'M1 - Features'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.9 release notes:
> All six SDKs now expose an agentMode field on MessageOptions to set the per-message UI mode (interactive, plan, autopilot, shell). Previously there was no correct way to request plan/autopilot mode from the SDK.

## Why this matters

We had no canonical way to request plan/autopilot mode per-message. The current plan-mode toggle (commit history references "plan-mode-fix") sets it session-wide; the SDK now lets us scope it to the next user message.

## Acceptance

- [ ] sessions.ts `session.send()` call passes through `agentMode` from MessageOptions
- [ ] Renderer composer can specify mode per send (defaults to session mode)
- [ ] Test: send a message with `agentMode: "plan"` from a non-plan session, assert SDK receives it
- [ ] Confirm whether this lets us drop the session-wide plan-mode toggle entirely

## SDK citation

- `node_modules/@github/copilot-sdk/dist/types.d.ts` → `MessageOptions.agentMode` (after bump)
'@
  },
  @{
    title = 'feat(sdk): wire `postToolUseFailure` hook into jobs panel'
    labels = 'enhancement,area:shell,area:backend,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.9 release notes:
> A new postToolUseFailure / OnPostToolUseFailure hook lets SDK users observe failed tool executions and inject follow-up guidance, separate from the existing success-only postToolUse hook.

## Why this matters

The Jobs panel and the in-session tool-call block currently show tool failures only via error events; the hook gives us a structured callback we can use for retry suggestions, audit logging, or jobs-panel status transitions.

## Acceptance

- [ ] sessionConfigBuilder.ts wires `postToolUseFailure`
- [ ] Jobs panel renders failed tool result with the SDK-provided error context (not just our parsed event)
- [ ] Failed tool calls show up in `auditStore` for the activity log

## SDK citation

- copilot-sdk PR #1421
- `node_modules/@github/copilot-sdk/dist/hooks.d.ts` → `postToolUseFailure` (after bump)
'@
  },
  @{
    title = 'feat(sdk): wire `preMcpToolCall` hook for MCP UX'
    labels = 'enhancement,area:mcp,area:backend,sprint-b,prio:p1'
    milestone = 'Sprint B'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.8 release notes:
> A new preMcpToolCall hook fires before every MCP tool invocation, giving your application the chance to inspect, modify, or block MCP tool calls. This is useful for adding authorization, logging, or stripping sensitive metadata from tool call arguments.

## Why this matters for Sprint B

Sprint B (MCP UX repair) is in progress. preMcpToolCall is the right hook for the planned MCP permission flow: today we get permission requests for shell/edit/etc. but MCP tool calls are largely passed through. With this hook we can:
- Surface MCP tool invocations as discrete permission requests
- Strip / inject metadata per-server (audit headers, redaction)
- Block specific MCP tools (companion to Sprint B `excludedTools`)

## Acceptance

- [ ] sessionConfigBuilder.ts wires `preMcpToolCall`
- [ ] McpPermissionFlow design (or fold into the existing permission flow)
- [ ] Test: real MCP tool invocation triggers the hook before the SDK forwards to the MCP server

## SDK citation

- copilot-sdk PR #1366
- `node_modules/@github/copilot-sdk/dist/hooks.d.ts` → `preMcpToolCall` (after bump)
'@
  },
  @{
    title = 'feat(sdk): remote sessions — shareable URL for monitoring agents'
    labels = 'enhancement,area:backend,area:chat,needs-spec,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.8 release notes:
> Remote sessions connect a local Copilot session to GitHub's backend services, producing a shareable URL that lets users access the session from GitHub web or mobile - useful for monitoring a locally-running agent from your phone, or sharing a session with a teammate. Enable it globally or toggle it per-session with session.rpc.remote.enable().

## Why this matters

This is brand new and unlocks "background tasks I can check on from my phone" workflow. Pairs with the Jobs panel.

## Spec questions (needs-spec)

1. Default: opt-in per session, or off entirely until UX is designed?
2. Where does the remote URL surface? (Session details panel? Jobs panel? Both?)
3. Auth requirement: user must be GH-authenticated AND session cwd must be a GH repo — how do we degrade gracefully?
4. Privacy: this sends session traffic to GitHub backend. Need an explicit toggle + warning.

## Acceptance (once spec'd)

To be filled.

## SDK citation

- copilot-sdk PR #1192
- `session.rpc.remote.enable()` / `session.rpc.remote.disable()`
- Listen for `session.info` events with `infoType === "remote"`
'@
  },
  @{
    title = 'feat(sdk): cloud sessions — agent runs entirely in the cloud'
    labels = 'enhancement,area:backend,needs-spec,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.8 release notes:
> Cloud sessions go a step further — the session runs entirely in the cloud rather than on the local machine. Pass a cloud option with repository metadata when creating a session.

## Why this matters

This is the "Codespaces for Copilot" surface — agent runs on GH infrastructure, no local CLI process needed. Big for users who don't want to run the CLI locally / want long-running agents that don't tie up their laptop.

## Spec questions

1. Does dafman become a viewer for cloud sessions, or does it also drive them?
2. Switching between cloud and local — same session id or different?
3. Cost / quota implications? Need user warning?

## Acceptance (once spec'd)

To be filled.

## SDK citation

- copilot-sdk PR #1306
- `SessionConfig.cloud = { repository: { owner, name, branch } }`
'@
  },
  @{
    title = 'feat(sdk): `onExitPlanModeRequest` + `onAutoModeSwitchRequest` handlers'
    labels = 'enhancement,area:backend,area:chat,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.8 release notes:
> onExitPlanModeRequest and onAutoModeSwitchRequest handlers let your app handle plan-approval flows and automatic mode switching (e.g., rate-limit recovery).

## Note

The bump to beta.9 renames our existing `onExitPlanMode` and `onAutoModeSwitch` to the `Request`-suffixed forms. That's a small mechanical migration (covered in the bump PR itself).

The new opportunity is that we now have an explicit "user approval needed before exiting plan mode" + "rate-limit-driven mode switch" surface — both of which today happen invisibly.

## Acceptance

- [ ] Plan mode exit: surface to user via the existing pendingRequests modal pattern, not just silent acceptance
- [ ] Auto-mode-switch: log to auditStore + show a toast so the user knows mode changed

## SDK citation

- copilot-sdk PR #1228
'@
  },
  @{
    title = 'feat(sdk): per-message `agentMode` flow + composer mode picker'
    labels = 'enhancement,area:chat,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.9 release notes (and partial duplicate of the wire-up issue above, kept separate for the UX side).

## Why this matters

With per-message `agentMode` (separate issue), the composer can offer a per-send mode override without changing the session-level mode. UX question is how to expose it without cluttering the composer.

## Spec questions

1. Default visibility: hidden behind a `⋯` menu, or always-visible chip next to the send button?
2. Does the override "stick" for the next send, or reset every time?
3. Keyboard: `Ctrl+Shift+P` for plan-mode send?

## Acceptance (once spec'd)

To be filled.
'@
  },
  @{
    title = 'feat(sdk): provider model + token-limit overrides for BYOK'
    labels = 'enhancement,area:backend,needs-spec,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.8 release notes:
> ProviderConfig now supports modelId, wireModel, maxInputTokens, and maxOutputTokens, letting BYOK users decouple the model ID visible to agents from the wire model sent to the provider.

## Why this matters

When BYOK lands (existing M4 backlog), users will want to route specific agent invocations to specific provider models without showing the wire-model name to the agent.

## Acceptance

- [ ] Defer until BYOK design starts; revisit then.

## SDK citation

- `ProviderConfig.modelId`, `wireModel`, `maxInputTokens`, `maxOutputTokens`
'@
  },
  @{
    title = 'feat(sdk): `runtime_instructions` system-message section'
    labels = 'enhancement,area:backend,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Source

@github/copilot-sdk v1.0.0-beta.7+ release notes:
> A new section in the system message customization API for runtime-generated instructions, giving you another hook to inject or transform prompt content.

## Why this matters

We currently inject instructions via per-session agent files + the system message. `runtime_instructions` is a dedicated section the runtime treats separately — useful for context like "current working directory" or "user is screen-sharing" that we don't want baked into static agent files.

## Acceptance (once design lands)

- [ ] Decide what content goes in runtime_instructions vs static agent-file system content
- [ ] Wire from sessionConfigBuilder.ts

## SDK citation

- copilot-sdk PR #1377
'@
  }
)

Write-Host "Filing $($issues.Count) issues..."

foreach ($i in $issues) {
  if ($existingTitles -contains $i.title) {
    Write-Host "skip (exists): $($i.title)"
    continue
  }
  $bodyFile = New-TemporaryFile
  Set-Content -Path $bodyFile -Value $i.body -NoNewline
  $url = gh issue create `
    --title $i.title `
    --body-file $bodyFile `
    --label $i.labels `
    --milestone $i.milestone 2>&1
  Remove-Item $bodyFile -Force
  if ($LASTEXITCODE -eq 0) {
    Write-Host "created: $url"
  } else {
    Write-Host "FAILED: $($i.title)"
    Write-Host $url
  }
}

Write-Host "Done."
