# Files 22 initial issues into GitHub. Idempotent: skips titles already
# present in `gh issue list`. Run from repo root.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..\..

$existingTitles = (gh issue list --state all --limit 200 --json title | ConvertFrom-Json).title

$issues = @(
  @{
    title = 'bug(mcp): HTTP transport has no OAuth popup login flow'
    labels = 'bug,sprint-b,area:mcp,manual-test-fail,prio:p1'
    milestone = 'Sprint B'
    body = @'
## Summary

Configured HTTP MCP servers require manually entering OAuth token values into form fields. There's no popup-based login flow to obtain a token.

## Steps to reproduce

1. Library -> MCP -> Add.
2. Switch transport to HTTP.
3. Fill `url` and try to authenticate.

## Expected behavior

Server appears in Configured with the http badge + a Sign-in button that opens a real OAuth popup, completes the flow, persists the token.

## Actual behavior

Values must be entered manually. No popup flow exists.

## Source

- MANUAL_TESTS_archive.md "MCP - HTTP transport + OAuth login flow" (2026-05-27)
- plans/TODO_archive.md User-reported bugs sorted - Sprint B row 4

## Notes

Real OAuth flow requires a real provider - not automatable in CI; verification via manual dogfood.
'@
  },
  @{
    title = 'bug(mcp): Sign-in button broken / missing on configured HTTP servers'
    labels = 'bug,sprint-b,area:mcp,manual-test-fail,regression,prio:p1'
    milestone = 'Sprint B'
    body = @'
## Summary

Sign-in button on configured HTTP MCP servers does not appear or, when present, does nothing useful.

## Steps to reproduce

1. With no chat session open, Library -> MCP -> click Sign in on a configured HTTP server.

## Expected

Warn toast: "No session to authenticate / Create a session first" - or the button is disabled in this state.

## Actual

The button is missing entirely. The conditional that hides it when there is no active session also hides it when there IS one.

## Source

- MANUAL_TESTS_archive.md "MCP - Sign in button on HTTP servers" (2026-05-27)
- plans/TODO_archive.md User-reported bugs sorted - Sprint B row 5
'@
  },
  @{
    title = 'bug(mcp): toggling discovered MCP servers does not persist; rows not editable / deletable'
    labels = 'bug,sprint-b,area:mcp,manual-test-fail,prio:p1'
    milestone = 'Sprint B'
    body = @'
## Summary

Discovered MCP servers (e.g. from .vscode/mcp.json) appear under Discovered but toggling them on/off doesn't persist across restart. Rows should also be editable / deletable and show the source file path.

## Steps to reproduce

1. Drop .vscode/mcp.json in the workspace.
2. Library -> MCP -> toggle a discovered server.
3. Restart Dafman.

## Expected

Toggle persists. Discovered rows show source file path. Each row has Edit / Delete affordances.

## Actual

Toggle state lost on restart. No path shown. No edit / delete.

## Source

- MANUAL_TESTS_archive.md "MCP - discovered server toggle + editability" (2026-05-27)
- plans/TODO_archive.md User-reported bugs sorted - Sprint B row 6
'@
  },
  @{
    title = 'bug(mcp): Remove jumps to Discovered view instead of staying in Configured'
    labels = 'bug,sprint-b,area:mcp,manual-test-fail,prio:p2'
    milestone = 'Sprint B'
    body = @'
## Summary

Removing a configured MCP server (trash icon) succeeds but the view jumps to the Discovered tab instead of staying on Configured.

## Steps to reproduce

1. Library -> MCP -> Configured tab.
2. Click trash on a configured server.
3. Confirm removal.

## Expected

Server is removed; view stays on Configured.

## Actual

> It removes it, but then it just jumps to discovered.

## Source

- MANUAL_TESTS_archive.md "MCP - Remove no longer jumps to discovered" (2026-05-27)
- plans/TODO_archive.md User-reported bugs sorted - Sprint B row 7
'@
  },
  @{
    title = 'feat(mcp): scope picker (user vs project) in MCP creator'
    labels = 'enhancement,sprint-b,area:mcp,area:library,prio:p2'
    milestone = 'Sprint B'
    body = @'
## Problem

McpServerForm has no scope picker; today everything writes to the user config. Project-scoped MCP servers (under .github/ or workspace-local config) are not creatable from the UI.

## Proposed shape

Mirror the Agents form's Scope toggle: User / Project radio, writes to user config root or workspace .github/mcp/.

## Acceptance items

- [ ] Form shows User / Project radio
- [ ] Project scope writes to <cwd>/.github/mcp.json (or the canonical project MCP config path)
- [ ] Created server appears in Configured tab regardless of scope
- [ ] Tests: round-trip user-scoped + project-scoped creation

## Source

- plans/TODO_archive.md Skills, agents, automations row 11 (2026-05-27 user report)
'@
  },
  @{
    title = 'refactor(library): unify MCP creator UX with Agent creator (inline vs modal)'
    labels = 'tech-debt,sprint-b,area:mcp,area:library,prio:p2'
    milestone = 'Sprint B'
    body = @'
## Current state

McpServerForm is a modal. LibraryAgentsTab form is inline (under the row list). Inconsistent UX - users have to learn two patterns.

## Target state

Pick one shape. Inline preferred (Agents already has it, and inline is more keyboard-friendly).

## Build-vs-buy check

- [x] PrimeVue has both Dialog (modal) and inline rendering
- [x] Either shape is already in repo; no new lib needed

## Verification

- LibraryMcpTab.vue form opens inline, not as a Dialog
- Visual diff matches Agents form shape
- All MCP creator E2E tests still pass after the layout shift

## Source

- plans/TODO_archive.md Skills, agents, automations row 12
'@
  },
  @{
    title = 'feat(palette): /skill <name> actually runs the skill'
    labels = 'enhancement,sprint-c,area:palette,area:library,manual-test-fail,prio:p1'
    milestone = 'Sprint C'
    body = @'
## Problem

Today /skill / /skills only opens the Library Skills tab. The user expects /skill <name> to run a userInvocable skill in the active session.

## Proposed shape

Mirror the Sprint A3 /agent <name> shape:
- Parse the argument from composer
- Look up via rpc.skills.list
- Invoke via the SDK skill path
- Unknown name -> warn toast with first 5 available

## Acceptance items

- [ ] /skill foo with discovered userInvocable foo runs the skill
- [ ] /skill bogus shows warn toast with available names
- [ ] /skill with no argument opens Library -> Skills (unchanged)
- [ ] Unit test for the routing
- [ ] MANUAL_TESTS.md C1.x checklist added

## Source

- MANUAL_TESTS_archive.md "Slash /skill <name> actually runs the skill"
- plans/TODO_archive.md User-reported bugs sorted - Sprint C row 8
- plans/TODO_archive.md Skills, agents, automations row 3
'@
  },
  @{
    title = 'feat(palette): /mcp <server> subcommand operations'
    labels = 'enhancement,sprint-c,sprint-b,area:palette,area:mcp,needs-spec,prio:p2'
    milestone = 'Sprint C'
    body = @'
## Problem

Today /mcp only opens Library -> MCP. Want /mcp enable foo, /mcp disable foo, /mcp restart foo, etc., for keyboard-driven MCP management.

## Proposed shape (needs-spec)

Subcommand shape to be decided in Sprint B spec interview (since the MCP UX work is the prerequisite). Possible shapes:
- /mcp <subcommand> <server> - e.g. /mcp enable github
- /mcp <server> <subcommand> - e.g. /mcp github enable
- Drop the slash entirely; do it from MCP tab only

## Source

- MANUAL_TESTS_archive.md "Slash /mcp <server> operations"
- plans/TODO_archive.md Skills, agents, automations row 4

## Notes

Marked needs-spec - do not implement until Sprint B spec interview answers the shape question.
'@
  },
  @{
    title = 'bug(jobs): spinner orbits an off-center point'
    labels = 'bug,sprint-d,area:shell,manual-test-fail,prio:p2'
    milestone = 'Sprint D'
    body = @'
## Summary

Jobs panel spinner rotation pivot is off-center - visible CSS transform-origin bug.

## Steps to reproduce

1. Start a session.
2. Ask the agent to spawn a background task.
3. Watch the Jobs panel spinner.

## Expected

Spinner rotates around its own center.

## Actual

Spinner orbits an off-center point.

## Source

- MANUAL_TESTS_archive.md "Jobs panel - spinner + scroll bugs"
- plans/TODO_archive.md User-reported bugs sorted - Sprint D row 10
'@
  },
  @{
    title = 'bug(jobs): "Go to session" scrolls to top instead of the relevant message'
    labels = 'bug,sprint-d,area:shell,area:chat,manual-test-fail,prio:p1'
    milestone = 'Sprint D'
    body = @'
## Summary

Clicking Go to session on a job in the Jobs panel switches to that session but scrolls to the top of the transcript instead of the message that spawned the job.

## Steps to reproduce

1. Spawn a background task from session A.
2. Switch to session B.
3. Jobs panel -> click Go to session on the task.

## Expected

Switch to session A, scroll to the message that spawned the task.

## Actual

Switch happens, transcript scrolls to top.

## Source

- MANUAL_TESTS_archive.md "Jobs panel - spinner + scroll bugs"
- plans/TODO_archive.md User-reported bugs sorted - Sprint D row 11
'@
  },
  @{
    title = 'bug(shell): bottom bar resize regression + small-mode selector missing'
    labels = 'bug,sprint-d,area:shell,area:layout,regression,manual-test-fail,prio:p1'
    milestone = 'Sprint D'
    body = @'
## Summary

Bottom bar resizing regressed after the plan-mode fix landed. The composer-footer mode selector also lost its narrow-mode form.

## Steps to reproduce

1. Open the app.
2. Try to resize the bottom bar (drag).
3. Make the window narrow.

## Expected

- Bottom bar resizes smoothly as it did pre-regression
- Mode selector switches to its compact (icon-only / select-box) form at small widths

## Actual

> Bottom bar resizing is ruined again, probably because you brought the modes icon back, but not the small select version on small sizes.

## Source

- MANUAL_TESTS_archive.md "Bottom bar resize regression"
- plans/TODO_archive.md User-reported bugs sorted - Sprint D row 12
- plans/TODO_archive.md Shell & layout row 7
'@
  },
  @{
    title = 'bug(theme): light mode visual audit - contrast / unstyled regions'
    labels = 'bug,sprint-e,area:shell,manual-test-fail,prio:p1'
    milestone = 'Sprint E'
    body = @'
## Summary

Light mode has visual issues across the app: contrast failures, unstyled regions, panels that assume dark backgrounds.

## Steps to reproduce

1. Toggle theme to light.
2. Walk through chat, palette, settings, library, terminal, jobs, logs, agent picker, instructions panel.

## Expected

Every surface readable. No contrast / unstyled region issues. Reasonably equivalent UX to dark mode.

## Actual

> Light mode has issues - needs a sweep + catalog.

## Approach

Audit pass: catalog every offending surface in a sub-issue list (one per panel). Fix in a single PR or split per surface depending on what the audit finds.

## Source

- MANUAL_TESTS_archive.md "Light mode visual audit"
- plans/TODO_archive.md User-reported bugs sorted - Sprint E row 13
- plans/TODO_archive.md Messaging & UX row 13

## Notes

No axe-core integration yet; verification is manual visual audit.
'@
  },
  @{
    title = 'bug(theme): instructions markdown renderer does not respect theme tokens'
    labels = 'bug,sprint-e,area:library,area:chat,prio:p2'
    milestone = 'Sprint E'
    body = @'
## Summary

Instructions markdown renderer ignores theme tokens - light mode AND dark mode both look wrong (dark mode does not invert correctly either).

## Source quote

> The instructions markdown does not support darkmode.

## Likely cause

Missing prose-invert / PrimeVue token usage in the markdown wrapper. Should pair with the Sprint E light-mode sweep.

## Source

- plans/TODO_archive.md Messaging & UX row 14
'@
  },
  @{
    title = 'bug(chat): sessions sometimes resume with thinking stuck and never resolve'
    labels = 'bug,area:chat,area:backend,regression,prio:p0'
    milestone = 'M1 - Features'
    body = @'
## Summary

After resume, the isThinking indicator sometimes stays on indefinitely. Likely an SDK event not replayed during resume -> isThinking ref never clears.

## Steps to reproduce

1. Have an in-progress streaming session.
2. Restart the app (resume kicks in).
3. Observe the session - thinking chip never resolves.

## Expected

Resume reconstructs all stateful flags; if the session was idle when persisted, isThinking is false on resume.

## Actual

> Sessions may resume with the agent thinking and never get resolved.

## Likely path

src-bun/app/chat/sessions.ts resume + src/stores/chat/sessionsStore.ts flag derivation. The completed / interrupted event may not be replayed during persisted-event replay.

## Source

- plans/TODO_archive.md Messaging & UX row 19 (2026-05-27 user report)

## Priority

Marked prio:p0 because it makes affected sessions unusable until the user kills + recreates.
'@
  },
  @{
    title = 'feat(library): Instructions tab - create + edit + delete'
    labels = 'enhancement,area:library,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Problem

Library -> Instructions is read-only. User cannot create or edit instruction files from the UI.

## Source quote

> The instructions should support creating and editing.

## Proposed shape

Mirror the Agents tab's New + Edit + Delete shape. Both are markdown-file-backed library entries, so the same form patterns apply.

## Acceptance items

- [ ] New button on Instructions tab opens an inline form (same shape as Agents form)
- [ ] Edit pencil per row opens the form prefilled
- [ ] Delete with confirm
- [ ] Scope picker (user vs project) mirrors Agents
- [ ] Preserved unknown frontmatter shape (per the Sprint A2 pattern in agentFiles.ts)
- [ ] Unit tests for the create/read/edit paths

## Source

- plans/TODO_archive.md Messaging & UX row 15
'@
  },
  @{
    title = 'bug(library): Agents tab missing refresh button'
    labels = 'bug,area:library,area:agents,good-first-task,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Summary

Library -> Agents loads on mount. If the user drops a file at the path while the tab is open, they have to switch tabs to re-trigger the load.

## Source quote

> No refresh button on library agents.

## Proposed fix

Add a refresh icon button in the Library Agents header. Calls useAgentsLibrary().load() (or whatever the composable exposes). Spinner during load.

## Source

- plans/TODO_archive.md Skills, agents, automations row 9
'@
  },
  @{
    title = 'bug(library): Agents tab does not show project agents'
    labels = 'bug,area:library,area:agents,prio:p1'
    milestone = 'M1 - Features'
    body = @'
## Summary

User-reported: Library Agents tab doesn't surface project-scoped agents from <workspace>/.github/agents/.

## Source quote

> Library agents does not show project agents.

## Investigation needed

The composable already filters by activeSession.id. Verify:
- Do project files in <cwd>/.github/agents/ actually get listed when a session has a workingDirectory?
- Is the listAgents IPC enumerating the project path?
- Is the path resolution correct on Windows?

## Acceptance

- [ ] Reproduce: drop <cwd>/.github/agents/foo.agent.md, open Library Agents with that session active -> file appears in Project section
- [ ] Project section row count > 0 when project agents exist
- [ ] Path shown in row tooltip matches the actual file location

## Source

- plans/TODO_archive.md Skills, agents, automations row 10
'@
  },
  @{
    title = 'feat(chat): rich UI for sub-agent related tool calls'
    labels = 'enhancement,area:chat,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Problem

ToolCallBlock falls back to generic args + output for sub-agent tools (task, read_agent, report_intent, powershell, ask_user in-history view). Each one would benefit from a per-tool renderer like apply_patch / fs.edit already have.

## Source quote

> Many tools do not have nice ui.

## Proposed shape

Per-tool renderer in the existing messageHandlers chain:
- task - show spawned sub-agent card with status pill, message count, link to job
- read_agent - show captured turn(s) in a compact frame
- report_intent - show as a callout block
- powershell - show command + output with terminal styling (we already have xterm)
- ask_user - historical record of the form fields shown

## Acceptance items

- [ ] Each of the 5 tools above has a dedicated renderer
- [ ] Generic fallback preserved for unknown tools
- [ ] Snapshot tests per renderer

## Source

- plans/TODO_archive.md Messaging & UX row 16
'@
  },
  @{
    title = 'feat(jobs): UI parity between in-session strip and Library Background tasks'
    labels = 'enhancement,area:shell,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Problem

Background tasks in sessions look worse and are less useful than in the Library Background tasks view.

## Source quote

> Background tasks in sessions looks worse and is less useful than library.

## Proposed shape

Either:
- Reuse the same component in both places (preferred)
- Share underlying rendering (cards / status / actions) and let each surface decide the layout (strip vs list)

## Acceptance items

- [ ] In-session strip and Library Background tasks render the same task data
- [ ] Same actions available (Go-to-session, cancel, retry)
- [ ] No double-state-divergence between the two views

## Source

- plans/TODO_archive.md Messaging & UX row 17
'@
  },
  @{
    title = 'feat(shell): collapsed menus / panels show useful info in the space'
    labels = 'enhancement,area:shell,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Problem

Collapsed activity-bar panels show only an icon + name. Wasted vertical space could show a preview, mini view, or count badge.

## Source quote

> Collapsed menus, in general, should use the space to display something useful.

## Proposed shape per panel

- Sessions: total session count badge
- Terminals: live terminal count + spinner if any is running
- Jobs: active job count
- Logs: error/warn count since last viewed
- Library: nothing (passive)

## Acceptance items

- [ ] Each collapsed panel surfaces something useful (or explicitly nothing)
- [ ] Does not break the 44px collapsed-width invariant
- [ ] Adapts to theme tokens (dark + light)
'@
  },
  @{
    title = 'feat(shell): agent chip + selector in the bottom bar'
    labels = 'enhancement,area:shell,area:agents,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Problem

The currently-selected agent for a session is not visible in the bottom bar. User has to open Session Details panel or Library Agents to see / change it.

## Source quote

> Probably need chip + selector for agent in the bottom bar.

## Proposed shape

Companion to the Sprint A1 Library Select button (commit bca5704):
- Bottom-bar chip showing current agent (or Default if none)
- Click -> small menu listing user + project agents -> select switches the session's agent
- Same selectAgent IPC path as Library

## Acceptance items

- [ ] Chip shows current agent name for the active session
- [ ] Chip click opens an agent picker with the same data Library shows
- [ ] Selection persists across reload
- [ ] Shows nothing / disabled when no active session

## Source

- plans/TODO_archive.md Messaging & UX row 20
'@
  },
  @{
    title = 'design: Library replaces SessionDetailsPanel as source of truth for per-session config'
    labels = 'enhancement,area:library,area:agents,area:mcp,needs-spec,prio:p2'
    milestone = 'M1 - Features'
    body = @'
## Question

User-flagged as a design question, not a clear bug:

> I think we should use the library to set mcp/tools/skills/agents/instructions things for the session, instead of duplicating it with the session settings (need to think about design).

## Status

needs-spec. Do not implement until the design is locked.

## Open spec questions

1. Does Library become the ONLY surface, or does SessionDetailsPanel stay as a read-only view?
2. How do per-session overrides differ from project / user defaults?
3. Is the per-session-selected agent shown in the bottom bar (#agent-chip issue) the canonical UX?
4. What happens to existing per-session state on migration?

## Acceptance (once specd)

To be filled in after spec interview.

## Source

- plans/TODO_archive.md Skills, agents, automations row 13
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

Write-Host "---summary---"
foreach ($m in @('Sprint B', 'Sprint C', 'Sprint D', 'Sprint E', 'M1 - Features')) {
  $count = (gh issue list --milestone $m --state open --limit 50 --json number | ConvertFrom-Json).Count
  Write-Host "$m`: $count open issues"
}
