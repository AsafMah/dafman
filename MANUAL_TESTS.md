# Manual tests — active

> Manual checks the user runs in `bun run dev` because no automated
> test can reach them with confidence (OS dialogs, native dialogs,
> visual rendering, real CLI side-effects, keyring, multi-window
> timing, focus management, accessibility, etc).
>
> **This file holds only ACTIVE items.** History lives in
> [`MANUAL_TESTS_archive.md`](MANUAL_TESTS_archive.md).
>
> **Workflow:**
> 1. New feature ships → an agent appends a checklist below under
>    `## Pending verification` per AGENTS.md rule #10.
> 2. User dogfoods. Items get marked `✅` (verified) or `❌` (failing).
> 3. Failing items get moved to `## Failing` with a Note explaining
>    what's wrong. They live there until a fix ships.
> 4. When the section's last item is verified, the agent moves the
>    whole section into `MANUAL_TESTS_archive.md`.
>
> **Format per item:**
> - **Steps:** what to do.
> - **Expected:** what you should see.
> - **Why not automated:** the one-line reason.
> - **Note (if failing):** what's actually broken.

---

## ❌ Failing — work list

These have been dogfooded and are confirmed broken. Pick one to fix;
the fixing commit removes the item from this section. Cross-referenced
with `plans/TODO.md` "User-reported manual-test bugs" — both lists
stay in sync.

### Jobs panel — spinner + scroll bugs

_Source: archive line 285 (Phase 23c)_

- **Steps:** start a session, ask the agent to spawn a background
  task/fleet, then open the Jobs activity-bar panel.
- **Expected:** Jobs shows the active task with session label,
  elapsed time, latest response/progress; clicking `Go to session`
  scrolls to the relevant message.
- **Why not automated:** requires the live SDK task tool to spawn
  real background work.
- **Note:**
  - The spinner in the Jobs panel orbits around a center point
    instead of rotating in place.
  - The `Go to session` button scrolls all the way up instead of
    jumping to the relevant message.

### Skills tab — `.github/skills/` discovery

_Source: archive line 700 (Phase 19b)._
**(2026-05-27: user reported this as already fixed; re-verify on a
clean install.)**

- **Steps:** drop a skill markdown file into `<workspace>/.github/skills/`.
- **Expected:** appears in Library → Skills under the project source.
- **Why not automated:** filesystem walk + SDK discovery + reactive
  rendering.
- **Note:** "Doesn't recognize a skill from .github/skills".
  Re-verify after the SDK discovery path was updated.

### MCP — HTTP transport + OAuth login flow

_Source: archive line 776 (Phase 19a)_

- **Steps:** click `Add` → switch transport to `HTTP` → fill `url` +
  `oauthClientId` + grant type → submit → on the row, click `Sign in`.
- **Expected:** server appears in Configured with the `http` badge +
  a `Sign in` button. Clicking `Sign in` opens an OS browser to the
  OAuth URL. Callback completes; row reflects connected state.
- **Why not automated:** real OAuth flow requires a real provider.
- **Note (2026-05-27):** "You have to enter the values manually.
  No popout login oauth." The form fields exist; the popup login
  flow on `Sign in` doesn't fire.

### MCP — discovered server toggle + editability

_Source: archive line 791 (Phase 19a)_

- **Steps:** drop `.vscode/mcp.json`. Open Library → MCP.
- **Expected:** discovered server appears under `Discovered`. Toggle
  off → restart app → toggle still off. Discovered rows are
  editable / deletable and show the file path.
- **Why not automated:** persistence requires a full restart cycle.
- **Note:**
  - Toggling discovered MCPs doesn't work at all.
  - Discovered servers should be editable / deletable / show their
    location.

### MCP — Remove no longer "jumps to discovered"

_Source: archive line 800 (Phase 19a)_

- **Steps:** click the trash icon on a configured server.
- **Expected:** confirm prompt; on accept, server is removed and
  the user stays on the `Configured` view (empty state if last one).
- **Why not automated:** dialog + reactive list state.
- **Note:** "It removes it, but then it just jumps to discovered."

### MCP — `Sign in` button on HTTP servers

_Source: archive line 808 (Phase 19a)_

- **Steps:** with no chat session open, open Library → MCP → click
  `Sign in` on a configured HTTP server.
- **Expected:** warn toast: "No session to authenticate / Create a
  session first…". Sign-in does NOT proceed.
- **Why not automated:** OAuth surfaces requires real provider.
- **Note (2026-05-27):** "No sign in button at all." The conditional
  render (`entry.transport === 'http' && entry.hasOauth`) exists; the
  data flag may not be set on real entries.

### Slash `/agent <name>` actually selects

_Source: archive line 1107 (Phase 19a)_

- **Steps:** with no chip showing, run `/agent reviewer` in the
  composer (the SDK's slash command). Watch the header.
- **Expected:** chip flips to `reviewer` reactively — no full page
  reload, no refetch needed.
- **Why not automated:** SDK slash + event stream + Vue reactivity.
- **Note:** "Doesn't seem to do anything — no indication of what's my
  agent, no way to choose from the agent library, and `/agent <name>`
  doesn't seem to do anything except opening the tab."
  Partially addressed by commit `bca5704` (Select / Deselect button
  in Library Agents tab). Slash command argument parsing still
  pending (Sprint A3).

### Slash `/skill <name>` actually runs the skill

_Source: implied by `/agent` issue + TODO.md §Skills/agents §2_

- **Steps:** with a userInvocable skill `foo` discovered, type
  `/skill foo` in the composer → press Enter.
- **Expected:** skill runs in the active session (or template loads,
  per the spec).
- **Why not automated:** SDK slash routing.
- **Note:** Today `/skill` just opens the Library Skills tab.

### Slash `/mcp <server>` operations

_Source: TODO.md §Skills/agents §3_

- **Steps:** decide what subcommands are useful (`/mcp enable foo`,
  `/mcp disable foo`, `/mcp restart foo`) — spec interview required.
- **Note:** Today `/mcp` just opens the Library MCP tab. May be the
  right UX; defer until B (MCP UX repair) is closer.

### Bottom bar resize regression

_Source: 2026-05-27 user feedback after plan-mode fix_

- **Steps:** with the app open, try to resize the bottom bar (drag
  the splitter between it and the chat / terminal pane above).
- **Expected:** bottom bar resizes smoothly as it did pre-regression.
- **Note:** Needs scoping — what "bottom bar" means (StatusBar /
  edge group bottom strip / composer footer resize handle) and
  exact repro steps.

### Sub-agent block — `<system_notification>` text leak

_Source: archive line 1205 (Phase 19c)._
**(2026-05-27: user reported this as already fixed; re-verify after
the next sub-agent run.)**

- **Steps:** wait for the first `subagent.started` event after a
  `/fleet` run.
- **Expected:** chat shows a bordered card with status pill RUNNING
  (blue), the sub-agent's display name, elapsed time. Body indented
  with a left border. No raw `<system_notification>` text anywhere
  in the card.
- **Why not automated:** the reducer routing has unit-test coverage
  but the visual nesting needs a human check.
- **Note (2026-05-27):** Was: "Getting tons of unparsed messages:
  `<system_notification>Agent X (task) has finished processing…`".
  User reports this is now fixed — re-run a fleet to confirm and
  move into the archive.

### Light mode visual audit

_Source: TODO.md §Messaging & UX §13_

- **Steps:** toggle theme to light. Walk through chat, palette,
  library (all tabs), settings, statusbar, sessions manager,
  jobs panel, terminal, composer toolbar, dialog/popover overlays.
- **Expected:** every surface readable, no contrast / unstyled
  regions / hard-coded dark colors.
- **Why not automated:** visual audit; no axe-core integration yet.
- **Note:** "Light mode has issues" — needs a sweep + catalog.

---

## ⏳ Pending verification — new since last dogfood

These are checklist items added by recent feature commits but not yet
walked by the user. After dogfooding, they move to ✅ (then to archive
when the whole section is verified) or ❌ (into Failing above).

### Sprint A1 — Library Agents Select / Deselect (commit `bca5704`, 2026-05-27)

- **A1.1** ⏳ **Select button per row.**
  - **Steps:** open Library → Agents → click `Select` on any row.
  - **Expected:** header gets the agent chip; the clicked row turns
    green-tinted with a `Selected` chip and the button label becomes
    `Deselect`; other rows still show `Select`.
  - **Why not automated:** filesystem + SDK + reactive header chip
    + custom CSS state across the full stack.

- **A1.2** ⏳ **Deselect.**
  - **Steps:** click `Deselect` on the currently selected row.
  - **Expected:** header chip disappears; row's button returns to
    `Select`; row tint clears.

- **A1.3** ⏳ **Disabled state with no active session.**
  - **Steps:** close every chat tab → open Library → Agents.
  - **Expected:** Select button shows but is disabled. Hover gives a
    tooltip about needing a session.

- **A1.4** ⏳ **Loading state during IPC.**
  - **Steps:** click `Select` on a slow agent (e.g. one whose YAML
    is verbose so the SDK takes a moment).
  - **Expected:** button shows a spinner during the IPC roundtrip;
    other rows' buttons are disabled (one-at-a-time semantics from
    `useSessionAgents`).

---

## How to use this list

Pick any ❌ item to fix or any ⏳ item to verify, then come back with
one of:
- ✅ → I'll mark verified and date it.
- ❌ + repro → I'll move it down to Failing.
- N/A "I don't care about this case" → I'll remove (with a note in
  the relevant commit message).
