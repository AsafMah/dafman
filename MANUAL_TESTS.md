# Manual tests — active

> Manual checks the user runs in `bun run dev` because no automated
> test can reach them with confidence (OS dialogs, native dialogs,
> visual rendering, real CLI side-effects, keyring, multi-window
> timing, focus management, accessibility, etc).
>
> **This file holds only ACTIVE pending-verification items** for
> features that have just shipped and need user dogfood. History
> lives in [`MANUAL_TESTS_archive.md`](MANUAL_TESTS_archive.md).
>
> **Failing manual-test items moved to GitHub Issues on 2026-05-28.**
> Browse the work list with:
>
> ```pwsh
> gh issue list --label manual-test-fail --state open
> ```
>
> See `AGENTS.md` `## Workflow — GitHub Issues + PRs` for the
> migration rationale.
>
> **Workflow (now):**
> 1. New feature ships → an agent appends a checklist below under
>    `## Pending verification` per AGENTS.md rule #10.
> 2. User dogfoods. For each item: tick its `- [ ]` box once tried, then
>    type a pass/fail mark and your note on the same `result:` line
>    (e.g. `- [x] result: v works` or `- [x] result: x <repro>`).
> 3. Failing items get an issue filed (use `.github/ISSUE_TEMPLATE/bug_report.yml`,
>    label `manual-test-fail`) and the row is removed from this file
>    (the issue body cites the archive line for history).
> 4. When the section's last item is verified, the agent moves the
>    whole section into `MANUAL_TESTS_archive.md`.
>
> **Format per pending item** (agents: match this so it stays fill-friendly):
> ````md
> #### 12.3 - One-line claim being verified
>
> - [ ] result: 
> - **Steps:** what to do.
> - **Expected:** what you should see.
> - **Why not automated:** the one-line reason.
> ````

---

## ❌ Failing — see GitHub Issues

```pwsh
gh issue list --label manual-test-fail --state open
```

As of 2026-05-28 (migration commit) the failing-work list moved to
GH issues. See:
- [Sprint B (MCP UX)](https://github.com/AsafMah/dafman/milestone/1)
- [Sprint C (slash UX)](https://github.com/AsafMah/dafman/milestone/2)
- [Sprint D (Jobs + bottom bar)](https://github.com/AsafMah/dafman/milestone/3)
- [Sprint E (light mode)](https://github.com/AsafMah/dafman/milestone/4)

Historical failing-row text preserved in
[`MANUAL_TESTS_archive.md`](MANUAL_TESTS_archive.md). The issue
bodies cite the archive section heading so the back-link works.

---

## ⏳ Pending verification — new since last dogfood

These are checklist items added by recent feature commits but not yet
walked by the user. After dogfooding, items move to verified (then to
[`MANUAL_TESTS_archive.md`](MANUAL_TESTS_archive.md) when the whole
section is verified) or get a GitHub issue filed (with label
`manual-test-fail`) and removed from this file.

### Issue #127 — agent Select/Deselect transition (2026-06-01)

> Intent-gap follow-up to dogfood item 99.1: the literal no-spinner-flash check
> passed, but selecting one agent still flashed every row's button.

#### AST.1 - Selecting one agent does not flash the whole list

- [ ] result:
- **Steps:** Open Session Details → Agents with at least two agents visible. Click **Select** on a non-active agent, then click **Deselect** on the active agent.
- **Expected:** Only the clicked row shows the pending disabled state; the other rows' Select/Deselect buttons do not visibly flash. The active row's Select ↔ Deselect change fades smoothly without a hard flicker.
- **Why not automated:** The unit test covers disabled-state scoping and the concurrency guard, but visual transition timing and perceived flicker require a live WebView render.

### Issue #137 — chat transcript scroll anchoring (2026-06-01)

> All four verified PASS during the 2026-06-01 dogfood (live `bun run dev`).

#### SC.1 - At the bottom, streaming sticks to the bottom.

- [x] result: ✓ PASS (2026-06-01 dogfood) — stays pinned to the bottom as the reply streams.
- **Steps:** open a session, scroll to the bottom, send a prompt and let the reply stream in.
- **Expected:** the transcript stays pinned to the bottom, following the newest content.
- **Why not automated:** real streaming cadence + live scroll metrics; happy-dom reports 0 scroll dimensions so the unit test can't exercise the pinned-follow visually.

#### SC.2 - Scrolled up, streaming does NOT yank; a "Jump to latest" pill appears.

- [x] result: ✓ PASS (2026-06-01 dogfood) — position held; pill appeared.
- **Steps:** while a reply is streaming, scroll up to re-read an earlier message; keep watching.
- **Expected:** your scroll position is held (no yank to bottom); a floating **Jump to latest** pill appears once new content lands below.
- **Why not automated:** the no-yank guarantee depends on real DOM scroll events + frame timing.

#### SC.3 - The pill returns you to the latest on click.

- [x] result: ✓ PASS (2026-06-01 dogfood) — click landed at the bottom, pill dismissed.
- **Steps:** with the pill showing (from SC.2), click it.
- **Expected:** the transcript jumps to the bottom and the pill disappears; you're re-pinned.
- **Why not automated:** visual affordance + landing position.

#### SC.4 - Focusing a session restores position, never the top.

- [x] result: ✓ PASS (2026-06-01 dogfood) — pinned sessions reopen at bottom; scrolled-up sessions keep position; none jumped to top.
- **Steps:** open several sessions; in one scroll up, in another stay at the bottom; click between them.
- **Expected:** a pinned session reopens at the bottom; a scrolled-up session keeps its position; neither lands at the very top.
- **Why not automated:** multi-session focus timing + per-session scroll restore.

### Composer Enter keybindings — fixed chord scheme (2026-05-31)

> Plain Enter now sends. Full scheme: Enter=send (current mode),
> Shift+Enter=soft newline, Ctrl/Cmd+Enter=hard newline, Alt+Enter=steer,
> Ctrl+Shift+Enter=queue, Ctrl+Alt+Enter=interrupt. The e2e flows cover the
> happy send + @-pill path; these manual checks cover the keyboard/menu-timing
> interactions automation can't assert with confidence.

#### KB.1 - Plain Enter sends at the current mode

- [ ] result:
- **Steps:** In an empty chat, set the send-mode toggle to **Steer**, type `hello`, press **Enter**. Then set the toggle to **Queue**, type `world`, press **Enter** while a turn is running.
- **Expected:** First message sends immediately (steer). Second is queued behind the running turn (queue) — not interrupting.
- **Why not automated:** Mode-toggle + live-turn timing; the e2e fake doesn't model steer-vs-queue scheduling visibly.

#### KB.2 - Ctrl+Enter inserts a hard newline; Shift+Enter a soft one

- [ ] result:
- **Steps:** Type `line one`, press **Ctrl+Enter**, type `line two`. Then press **Shift+Enter** and type `line three`. Do NOT send.
- **Expected:** Nothing sends. You see three visible lines in the composer (Ctrl+Enter = block/paragraph break, Shift+Enter = soft break within). Caret stays in the editor.
- **Why not automated:** Visual caret/line rendering inside Lexical.

#### KB.3 - Enter selects a slash/mention menu item instead of sending

- [ ] result:
- **Steps:** Type `/` and wait for the slash menu; arrow to a **non-first** command; press **Enter**. Separately type `@READ`, wait for the file picker, press **Enter**.
- **Expected:** Enter runs the highlighted slash command (not the first row; no message sent) / inserts the highlighted file pill (no message sent). The message is NOT sent in either case.
- **Why not automated:** Flow 02 covers the @-pill case; the slash-run case and the "no accidental send" assertion are worth an eyeball.

#### KB.7 - Tab completes the highlighted slash command, not the first row

- [ ] result:
- **Steps:** Type `/` and wait for multiple slash-command results. Arrow to a **non-first** command and press **Tab**.
- **Expected:** The typed slash query is replaced with the highlighted command plus a trailing space so you can add args; the first row is not chosen unless it is highlighted, and the command is not executed until you explicitly send/select.
- **Why not automated:** The pure selection resolver is unit-tested, but the real keyboard highlight → Lexical command dispatch → rendered composer replacement path depends on live WebView2/Lexical focus timing.

#### KB.4 - Enter on a zero-match `/` or `@` SENDS the raw text

- [ ] result:
- **Steps:** Type `/notacommand` (no menu match), press **Enter**. Then type `@zzzznomatch`, wait for the picker to settle empty, press **Enter**.
- **Expected:** Each sends the raw text as a normal message (no menu was active to capture Enter).
- **Why not automated:** Depends on the async file-search settling to empty before the keystroke — timing-sensitive.

#### KB.5 - Modifier sends ignore the menu; Shift+Enter in a menu is a soft break

- [ ] result:
- **Steps:** With a `/` or `@` menu open: press **Alt+Enter** (steer), and in another attempt **Ctrl+Shift+Enter** (queue) and **Ctrl+Alt+Enter** (interrupt). Separately, with a menu open, press **Shift+Enter**.
- **Expected:** The three modifier chords send immediately (menu does not capture them). Shift+Enter inserts a soft newline (does NOT select the highlighted menu item).
- **Why not automated:** Menu-open + modifier-chord timing; the "Shift+Enter doesn't select" guard is the subtle one.

#### KB.6 - Enter on an empty composer does nothing; IME commit doesn't send

- [ ] result:
- **Steps:** With an empty composer, press **Enter** a few times. Then (if you have an IME) type with composition and press Enter to COMMIT a candidate.
- **Expected:** Empty Enter does nothing (no stray newline, no send). The IME-commit Enter commits the candidate and does NOT send the message.
- **Why not automated:** Native IME composition can't be driven reliably in CI.

### Single-instance guard + canary coexistence (2026-05-31)

#### SI.1 - Second instance on the same channel is blocked, not crashed.

- [x] result: ✓ PASS (2026-06-01 dogfood) — 2nd instance printed *"dafman is already
  running for this channel (pid 176084). Exiting this instance."*, emitted the
  `duplicate instance blocked` warn line (existingPid 176084), exited cleanly (code 0,
  `[stopEventLoop] clean event loop exit`), no 2nd window, first instance untouched.
  NOTE: a 2nd `bun run dev` can't reach the guard — `electrobun dev --watch` aborts at
  its rebuild step with `EACCES rm build/dev-win-x64` (the live instance locks the build
  dir) before bun-main runs. Validated instead via the already-built launcher
  `build/dev-win-x64/dafman-dev/bin/launcher.exe`, the faithful guard path (same bun-main +
  same channel lock a packaged 2nd instance hits).

- **Steps:** start dafman with `bun run dev`. With it still running, launch the
  already-built `build/dev-win-x64/dafman-dev/bin/launcher.exe` (a 2nd `bun run dev`
  instead dies at electrobun's rebuild on the locked build dir, never reaching the guard).
- **Expected:** the second invocation prints a loud note like *"dafman is already
  running for this channel (pid N). Exiting this instance."* and exits cleanly;
  no second app window appears, the first window keeps working, and the shared
  dev log contains a `duplicate instance blocked` warn line. (Before the fix, the
  webview of one or both instances would silently die.)
- **Why not automated:** spawning two real Electrobun windows against the live
  WebView2 user-data folder; the lock logic itself is unit-tested, but the
  webview-crash avoidance is only observable by running two real instances.

#### SI.2 - A force-killed instance's stale lock is reclaimed on next launch.

- [x] result: ✓ PASS (2026-06-01 dogfood) — verified the real reclaim path on a throwaway
  lock without disturbing the live instance: spawned + killed a process (pid 256784),
  confirmed it dead via the same `process.kill(pid,0)` probe the guard uses, wrote a real
  lock file owned by that dead pid, then ran the real `acquireSingleInstanceLock` (no
  injected seam) → `acquired:true`, lock rewritten to our own pid. Also unit-covered:
  `src-bun/__tests__/singleInstance.test.ts:54` ('takes over a stale lock left by a dead
  process', real fs).

- **Steps:** `bun run dev`, then force-kill it (`Stop-Process -Id <app-bun-pid>`,
  i.e. Task Manager / TerminateProcess — NOT a clean Ctrl-C). Immediately
  `bun run dev` again.
- **Expected:** the new instance starts normally (it detects the stale lock left
  by the dead PID and takes it over); it does NOT refuse to start.
- **Why not automated:** requires a real TerminateProcess that bypasses the JS
  exit handlers, leaving the on-disk lock behind.

#### SI.3 - A canary instance runs alongside the dev instance.

- [ ] result: ⏸ DEFERRED (2026-06-01) — canary build not dogfood-ready yet (user); revisit once it installs/launches cleanly.

- **Steps:** with `bun run dev` running, run `bun run install:canary` and complete
  the Setup installer (accept the UAC prompt), then launch the installed canary app.
- **Expected:** both windows run at the same time with no crash; they keep
  separate state (sessions/settings in dev do not appear in canary and vice
  versa), because each channel has its own WebView2 folder + JSON state.
- **Why not automated:** drives the interactive NSIS Setup GUI / UAC elevation
  and a second installed app coexisting with the dev build.

#### SI.4 - The installed canary can actually start a chat (SDK loads).

- [ ] result: ⏸ DEFERRED (2026-06-01) — depends on SI.3 (canary install); canary not dogfood-ready yet (user).

- **Steps:** after installing canary (SI.3), open a session and send a message.
- **Expected:** the agent responds normally — NO `Cannot find module
  '@github/copilot/sdk'` error. (The native `copilot.exe` is bundled at
  `…\canary\app\Resources\app\bun\copilot.exe` and resolved bundle-relative.)
- **Why not automated:** requires the elevated installer + a live SDK round-trip
  in the packaged app; `bun run dev` resolves the CLI from node_modules so it
  can't catch the packaged-resolution path.

### Channel indicator — StatusBar pill + OS window title (2026-05-31)

#### CI.1 - Non-stable channel pill shows in the StatusBar, tinted per channel.

- [ ] result:

- **Steps:** launch the `dev` build (`bun run dev`) and, separately, the
  installed `canary` build.
- **Expected:** the bottom StatusBar shows a small uppercase pill next to the
  `dafman` brand — `DEV` (violet) on the dev build, `CANARY` (amber) on the
  canary build. Hovering the pill shows a tooltip like `canary build · v0.1.0`.
  A `stable` build shows **no** pill.
- **Why not automated:** the channel comes from the bundled
  `Resources/version.json` (`Updater.getLocalInfo()`), which only exists in a
  packaged build; the smoke harness RPC stub returns nothing for `getAppInfo`,
  so the pill is intentionally hidden there. Pill render logic is unit-tested
  (`src/components/shell/__tests__/StatusBar.test.ts`) but the live tint/value
  needs eyes on a real channel build.

#### CI.2 - OS window title is suffixed on non-stable channels.

- [ ] result:

- **Steps:** look at the native OS window title bar (and the taskbar entry) for
  the dev and canary builds.
- **Expected:** the title reads `Dafman — dev` / `Dafman — canary` for those
  channels; a stable build keeps the bare `Dafman`. This makes a side-by-side
  dev+canary pair distinguishable in Alt-Tab / the taskbar.
- **Why not automated:** the OS-level window title is set by Electrobun's
  `BrowserWindow` (`src-bun/index.ts`) from the packaged channel; not reachable
  from the renderer test harness.

### Issue #99 — Session details agent Select/Deselect avoids instant loading flash (2026-05-31)

#### 99.1 - Instant agent Select/Deselect stays visually steady.

- [ ] result:
- **Steps:** in `bun run dev`, open a chat session with the Session Details right rail visible. Click **Select** on an agent that resolves quickly, then click **Deselect**.
- **Expected:** the buttons disable immediately while the IPC call is pending, but the spinner only appears if the operation is still pending after a short delay; instant/cached resolves do not flash a spinner.
- **Why not automated:** the composable timing is unit-tested, but the remaining claim is the visible PrimeVue button affordance in the live rail.

### Issue #103 — Sub-agent cards fold from bottom/header chrome (2026-05-31)

#### 103.1 - Tall sub-agent cards can be collapsed after scrolling to the bottom.

- [ ] result:

- **Steps:** in `bun run dev`, open a chat transcript with a long sub-agent card,
  scroll to the bottom of that card, click **Collapse sub-agent**, reopen it from
  the header row, then click a nested link/tool-card control inside the expanded
  body.
- **Expected:** the footer collapses the card without needing to scroll back to
  the top, the header row reopens/collapses it, keyboard focus rings appear on
  both affordances, and inner transcript controls do not collapse the parent
  card.
- **Why not automated:** the unit test covers event routing and ARIA state, but
  the remaining claim is the real scroll-position/visual affordance in the live
  browser.

### Issue #109 — Per-session "Allow all" + run mode survive reopen (2026-05-31)

#### 109.1 - "Allow all" and run mode persist across app restart.

- [ ] result: 

- **Steps:** open a session, toggle **"Allow all"** ON in the header and switch
  the run mode (e.g. to **autopilot** or **plan**). Fully quit and relaunch the
  app (`bun run dev`), then let the session restore (or reopen it).
- **Expected:** the restored session header shows **"Allow all" still ON** and
  the **same run mode** you left it in — not the global default. A
  `<userData>/session-metadata.json` file holds the per-session values.
- **Why not automated:** requires a real app quit + relaunch and the OS user-data
  directory; the registry-level close→reopen is unit-tested, but the full
  process-restart + renderer paint path is dogfood-only.

#### 109.2 - Permanently deleting a session clears its persisted flags.

- [ ] result: 

- **Steps:** enable "Allow all" on a session, then **delete** it from the CLI
  sidebar (permanent delete, not just close). Create a brand-new session.
- **Expected:** the new session starts at the global default posture; the deleted
  session's entry is gone from `session-metadata.json`.
- **Why not automated:** end-to-end delete + new-session creation against the real
  on-disk store and SDK catalog.

### Issue #81 — SDK-rejected custom agents are flagged (2026-05-31)

#### 81.1 - Bad `.agent.md` is visibly rejected and `/agent` reports the validation error.

- [ ] result:

- **Steps:**
  1. In `bun run dev`, open a session in any workspace.
  2. Create `~/.copilot/agents/broken-agent.agent.md` with frontmatter that has
     `description` but an invalid modeled key, e.g. `mcp-servers.github` without
     the required `tools: []`.
  3. Open Library → Agents and click **Refresh**.
  4. Try the row action for `broken-agent`, then run `/agent broken-agent` in the
     composer.
- **Expected:** the row is marked **SDK rejected**, displays the SDK validation
  message, the row action shows the same actionable message, and `/agent
  broken-agent` reports the load failure instead of "No agent named".
- **Why not automated:** the final confidence check depends on the real Copilot
  SDK/CLI discovery + reload path and live file locations outside the test fake.

### Issue #36 — `postToolUseFailure` hook → Activity log + Jobs panel (2026-05-31)

#### 36.1 - A failed tool execution appears in the Activity log with the SDK error.

- [ ] result: 
- **Steps:** `bun run dev`, open a session, and trigger a tool that fails (e.g.
  ask the agent to `str_replace` text that does not exist in a file, or run a
  shell command that exits non-zero). Open Diagnostics → Activity (the LogViewer
  audit tab).
- **Expected:** a red-tinted `TOOLFAILURE` row appears reading
  `<toolName> failed · <error message>`, where the error text is the SDK's
  failure message (not just "tool errored"). No raw argument VALUES appear.
- **Why not automated:** needs a real CLI tool execution + the SDK host firing
  the `failure` result; the renderer's audit-tab paint is visual.

#### 36.2 - A tool failure during an Autopilot run surfaces on the Jobs panel.

- [ ] result: 
- **Steps:** open the Jobs panel, Start Autopilot with a goal that will make the
  agent run a tool that fails. Watch the active Autopilot job row while the tool
  fails.
- **Expected:** the active job's latest-response line briefly shows
  `⚠ <toolName> failed: <error>` (the SDK error context) while the job is still
  running; it returns to the normal completion text once the turn completes. The
  Activity-log entry (36.1) persists regardless.
- **Why not automated:** depends on live Autopilot timing + a real failing tool;
  the transient job-row text is a visual/timing assertion.



#### 76.1 - Transcript fenced code blocks switch between light and dark CodeMirror themes.

- [ ] result: 

- **Steps:** set the app to light mode, open a session containing a top-level
  fenced code block in the transcript, then toggle the app to dark mode and back
  while the message remains visible.
- **Expected:** in light mode the CodeMirror-rendered block uses a light surface
  with dark, legible syntax; in dark mode it switches to the dark `oneDark`
  styling. The already-rendered block updates without needing to reload the
  session.
- **Why not automated:** the remaining assertion is rendered CodeMirror CSS
  cascade and perceived contrast; happy-dom does not compute the live custom
  property/theme styles.

### Issue #85 — Group-close confirmation polish (2026-05-30)

#### 85.1 - Empty groups close directly; non-empty close confirmation looks destructive.

- [ ] result:

- **Steps:**
  1. In `bun run dev`, create at least two groups.
  2. Close an empty group via the tab `×` and via right-click → **Close group**.
  3. Create/open a session in a group, then close that non-empty group via the tab `×`.
- **Expected:** empty groups close immediately with no dialog. The non-empty close
  opens a dialog titled **Close group**, the destructive action is styled as
  danger, **Cancel** is secondary, and keyboard focus defaults to Cancel.
- **Why not automated:** the unit test asserts the ConfirmDialog options, but the
  final PrimeVue dialog header/button rendering and focus ring are browser pixels.

### Issue #9 — Discovered MCP server toggle persistence (2026-05-30)

> Repro fixture: [`tools/manual-fixtures/mcp-discovery/`](tools/manual-fixtures/mcp-discovery/).
> Parts 2 (edit/delete discovered rows) & 3 (source path) of #9 are blocked at
> the SDK boundary — tracked upstream in `github/copilot-sdk` (see the #9 issue
> comment). This item verifies **only part 1 (toggle persistence)**.

#### 9.1 - Toggling a discovered MCP server off survives an app restart.

- [x] result: ⛔ WAS BLOCKED by #96 — step 3 failed: Library → MCP → Discovered showed
  only User-source servers (JetBrains intellij/rider), **never** the workspace
  `.mcp.json` servers (`fixture-memory`/`fixture-everything`), so there was
  nothing to toggle. Root-caused to a dafman bug (discovery `workingDirectory`
  keyed off `layoutStore.activeSessionId`, which diverges from the opened
  session) — NOT an SDK constraint: `copilot mcp list` run from the fixture cwd
  lists both workspace servers correctly. **✅ Fix merged in #97 (keys discovery
  off `lastFocusedSessionId`); ⏳ re-verify 9.1 live before promoting to passed.**

- **Steps:**
  1. `bun run dev`.
  2. Create a session whose **working directory** is
     `tools/manual-fixtures/mcp-discovery` (the folder with the fixture
     `.mcp.json`).
  3. Open Library → MCP → **Discovered**. Confirm `fixture-memory` and
     `fixture-everything` are listed.
  4. Toggle `fixture-memory` **off**.
  5. **Fully quit** Dafman (not just close the window) and relaunch.
  6. Reopen a session in the same folder and look at Library → MCP →
     Discovered.
- **Expected:** `fixture-memory` is still toggled **off**; `fixture-everything`
  is still **on**. (The toggle routes through the SDK's persisted disabled list
  via `mcp.config.disable` / `enable`.)
- **If it does NOT persist:** the bug is live — re-file under `manual-test-fail`
  with the app/SDK version. The code path is already correct, so a failure means
  the SDK's persisted-disabled-list write/read regressed; capture
  `~/.copilot` MCP state before/after if possible.
- **Why not automated:** needs a real app process restart + the SDK's on-disk
  persisted-disabled-list round-trip; not reachable from `bun test`.
- **Note:** use `.mcp.json` (the fixture does). `.vscode/mcp.json` is **no
  longer discovered** — Copilot CLI removed that support; a `.vscode`-based repro
  would show zero discovered servers and mislead the test.

### Issue #69 — Agent-driven MCP OAuth prompt (2026-05-30)

- **69.1** ⏳ **A mid-session MCP tool call that needs auth surfaces a sign-in prompt, not a silent failure.**
  - **Steps:** configure an HTTP MCP server that requires OAuth and is **not**
    yet authenticated (no cached token — sign out / use a fresh account). Open a
    session and ask the agent to use a tool from that server (so the *agent*, not a
    Library button, triggers the connection).
  - **Expected:** a **warn** toast appears naming the server ("… requires
    authorization. Open the Library panel and click Sign-in…"), and the server
    shows `needs-auth` in Library → MCP with a **Sign-in** button. Completing
    Sign-in (system browser) reconnects the server; you then see a **success**
    toast ("… connection established"). The warn toast does **not** repeat on every
    retry while it stays `needs-auth`.
  - **Why not automated:** needs a real OAuth-gated MCP server reached mid-session
    by the agent + real provider auth; can't be driven in CI.

### Issue #7 — MCP HTTP OAuth Sign-in flow (2026-05-30)

#### 7.1 - Sign-in opens the system browser and completes OAuth end-to-end.

- [ ] result: 

- **Steps:** add a real HTTP MCP server that requires OAuth (e.g. the GitHub
  remote MCP `{ type: 'http', url: … }`). With at least one session open, go to
  Library → MCP, find the server under Configured (http badge), click
  **Sign in**.
- **Expected:** an *OAuth started* toast appears, your **system browser** opens
  the provider consent page (not an in-app webview), and after you approve, the
  browser shows the loopback success page and the server reconnects in the app
  without re-entering token fields. If the server was already authenticated, no
  browser opens and an *Already signed in* toast shows instead.
- **Why not automated:** real provider auth + OS-keychain token persistence
  can't be driven in CI (the issue itself notes this).

#### 7.2 - The OAuth consent screen names the app "Dafman".

- [ ] result: 

- **Steps:** trigger 7.1 against a server that registers a **fresh** dynamic
  OAuth client (one that hasn't been authenticated from this machine before).
  Read the app-name on the provider consent screen.
- **Expected:** the consent screen shows *Dafman* as the requesting client.
- **Why not automated:** the displayed client name is rendered by the external
  provider. **Note:** the SDK applies `clientName` to *newly-registered* dynamic
  clients only — a server whose client was already registered under the old
  neutral fallback keeps that name until its registration is cleared (use a
  fresh server / forced re-auth to see the branded name).

### Issue #18 — Light-mode dock chrome follows the theme (2026-05-30)

#### 18.1 - All dockview chrome is light in light mode.

- [x] result: v PASS — chrome is light. New adjacent bug found: fenced code blocks in the transcript stay dark in light mode (CodeMirror `oneDark` hardcoded) → filed #76.

- **Steps:** set the app to light mode (or system on a light OS). Open a
  session. Open the edge panels: Jobs, Terminals, Session details, Library.
  Look at the group tab bar, the session tabs, the main panel background, and
  each edge panel's background + title.
- **Expected:** every dock surface is light (white / pale grey) with dark,
  legible text — no near-black panels, no dark group/tab bars. Switch to dark
  mode: everything inverts to the dark chrome cleanly (no light-on-light).
- **Why not automated:** dockview applies its theme className/vars to its own
  root at runtime; happy-dom resolves no CSS custom-property cascade, so the
  `--dv-*` → `--p-*` bridge can't be asserted in unit tests (only verified live
  via `bun run inspect`).

#### 18.2 - Library Tools "Enable all" / "Disable all" and the composer mode select read with good contrast in light mode.

- [x] result: v PASS

- **Steps:** in light mode, open Library → Tools (see the Enable all / Disable
  all buttons) and the composer toolbar's mode select.
- **Expected:** the buttons and the mode select have clearly legible text
  against their background — no washed-out / "weak" low-contrast controls.
- **Why not automated:** contrast-on-rendered-background is a visual judgement;
  the underlying tokens are invertible but the perceived weakness only shows
  against the real rendered chrome.
- **Measured baseline (light mode, post-#18, via `bun run inspect`):** *Enable
  all* `#475569` on `#f1f5f9` ≈ 6:1 (good); *Disable all* (text variant) andO
  the unselected composer mode select use `--p-text-muted-color` (slate-500
  `#64748b`) ≈ 4.5:1 — AA-passing but on the muted side. If these still read
  "weak" when dogfooding, file a follow-up to bump those muted controls to a
  higher-contrast token.

### Issue #19 — Instructions markdown respects theme tokens (2026-05-30)

#### 19.1 - Instruction file content inverts correctly in dark mode.

- [x] result: v PASS — markdown box/text/list/link/table/blockquote invert cleanly both ways. (Fenced code block staying dark in light mode is the known #76 bug, fix in flight — not a 19.1 regression.)

- **Steps:** open Library → Instructions, expand an instruction file that has
  rendered markdown (headings, paragraphs, a list, a code span/block, a link).
  Toggle the app between light and dark mode (theme switch) while the file is expanded.
- **Expected:** in **light** mode the content box is a subtle light surface with
  dark text; in **dark** mode the box is a subtle dark surface with light text.
  Code spans/blocks, links, blockquotes, table borders all stay legible and
  invert with the theme — no light-on-light or dark-on-dark, no stuck-light box.
- **Why not automated:** the bug is purely a computed-color inversion under
  `.app-dark`; happy-dom resolves no CSS custom-property cascade, so the
  inverted vs non-inverted token values can't be asserted in unit tests.

#### 19.2 - Raw HTML inside an instruction file also themes correctly.

- [x] result: v PASS — raw `<code>`/`<a>`/`<pre>`/`<blockquote>` theme identically to markdown equivalents, legible both modes.

- **Steps:** in an instruction file, include a literal raw `<code>inline</code>`
  and/or `<a href="…">link</a>` (HTML, not markdown). Expand it; toggle theme.
- **Expected:** the raw `<code>`/`<a>`/`<pre>` render with the same invertible
  token colors as the markdown-generated equivalents — legible in both themes.
- **Why not automated:** same computed-color-cascade limitation as 19.1.

### Issue #17 — composer mode selector compact form on narrow panes (2026-05-30)

#### 17.1 - Mode selector swaps to a compact icon Select on narrow panes.

- [x] result: v PASS

- **Steps:** open a session so the composer shows. Drag the chat pane (or window) from wide to narrow, watching the bottom-bar mode control on the left.
- **Expected:** while wide, the 3-icon segmented control (Interactive / Plan / Autopilot) shows. Once the composer toolbar drops below ~620px, it swaps to a single icon-only dropdown showing the current mode's icon; opening it lists all three modes with icon + label. The bottom bar reflows smoothly the whole way — no overflow, clipping, or jump.
- **Why not automated:** the swap is driven by a CSS `@container (max-width: 620px)` query; happy-dom has no layout so the query never matches in unit tests. Smoke boots the bundle but doesn't drive a session-active composer through a width sweep.

#### 17.2 - Compact Select changes mode and stays in sync.

- [x] result: v PASS

- **Steps:** at narrow width, pick a different mode from the compact dropdown. Widen back out.
- **Expected:** the selection persists, the wide segmented control reflects the same mode, and the per-mode accent color (blue / amber / purple) matches.
- **Why not automated:** depends on the live container-query swap being active (see 17.1).

### Issue #10 — MCP "Remove" no longer jumps to Discovered (2026-05-30)

#### 10.1 - Removing a configured MCP server doesn't bounce to Discovered.

- [x] result: v PASS — a uniquely-named configured server (not in any `.mcp.json`) disappears on Remove and does not reappear under Discovered.

- **Steps:** Library → MCP. Add/configure an MCP server so it appears under
  the **Configured** section. Click its Remove (trash) action.
- **Expected:** the server disappears from Configured and does **not**
  immediately re-appear under the **Discovered** section. (A server that's
  *also* defined in a workspace file may legitimately return after the next
  refresh — that's correct.)
- **Why not automated:** the unit test covers the in-memory list sync; this
  item confirms the live render of the two sibling sections matches.

### Issue #16 — Jobs "Go to session" scrolls to spawning tool call (2026-05-30)

#### 16.1 - Reveal scrolls to the spawning tool-call card (cross-session).

- [ ] result: 

- **Steps:** in session A with a long transcript, spawn a background task (a tool call early in the history that runs in the background). Switch to session B. Open the Jobs panel and click "Go to session" (the up-right arrow) on A's job.
- **Expected:** the app switches to session A and scrolls so the tool-call card that spawned the job is centered in view (not the top of the transcript), with a brief highlight flash on the card.
- **Why not automated:** real `scrollIntoView` geometry + dockview panel-mount timing with a live spawned background task isn't reproducible in happy-dom/smoke; the unit test stubs `scrollIntoView` and asserts it's called on the matching node, but can't verify actual scroll position.

#### 16.2 - Freshly-opened panel still reveals (timing path).

- [ ] result: 

- **Steps:** close session A's panel entirely (leave only B open). Spawn-and-track a job for A beforehand. From the Jobs panel click "Go to session" so A's panel opens fresh.
- **Expected:** A opens AND scrolls to the spawning card — the reveal is not lost to the async panel mount.
- **Why not automated:** the lost-intent race only manifests with the real dockview async mount; covered conceptually by the store-parked intent + onMounted consume, but needs the live panel lifecycle.

#### 16.3 - Autopilot job falls back to bottom.

- [ ] result: 

- **Steps:** start an autopilot session (no spawning tool call → job has no `toolCallId`). From another session, click "Go to session" on that autopilot job.
- **Expected:** switches to the session and scrolls to the bottom (latest work), no error.
- **Why not automated:** depends on the autopilot session lifecycle + live scroll geometry.

### Issue #51 — Library tabs auto-refresh on session switch (2026-05-28)

#### 51.1 - Agents tab auto-refreshes.

- [x] result: v PASS — project-agents section updates on session switch (demo-project-agent → empty) without Refresh.

- **Steps:** open two sessions A and B with different `workingDirectory` (one with project agents in `<cwd>/.github/agents/`, one without). Open Library → Agents while focused on A. Switch to B.
- **Expected:** the project-agent section updates (becomes empty if B has no project agents). No need to click Refresh.
- **Why not automated:** smoke stub can't simulate session-switch + IPC re-fetch flow without a full E2E harness; covered conceptually by the new `watch` but verification needs the live dockview event.

#### 51.2 - Skills tab auto-refreshes.

- [x] result: v PASS — skill list updates on switch.

- **Steps:** as above with Library → Skills.
- **Expected:** skill list updates when switching sessions whose `<cwd>/.github/skills/` differs.

#### 51.3 - MCP tab auto-refreshes.

- [x] result: v PASS — Discovered section updates on switch (fixture-memory via `.mcp.json` → none). Used `.mcp.json` (not `.vscode/mcp.json`, which is no longer discovered).

- **Steps:** as above with Library → MCP. Drop an `.vscode/mcp.json` under one session's cwd, none under the other.
- **Expected:** the Discovered section updates on switch.

#### 51.4 - No infinite loops / re-render storms.

- [x] result: v PASS — rapid switching reloads each tab once, no thrash, no error-level log entries. Minor: a split-second loading flash on each reload (same instant-resolution pattern as #78) → filed #93.

- **Steps:** switch sessions rapidly (5+ times in a few seconds).
- **Expected:** each switch triggers exactly one reload per tab; no console errors or visible spinner thrashing.

### Issue #22 — Library Agents refresh button (2026-05-28, second attempt)

#### 22.1 - Refresh button appears next to "New agent".

- [x] result: v PASS — Refresh works. Tab-header action affordances are inconsistent across Library tabs (deferred to Library redesign) → tracked #77.

- **Steps:** open Library → Agents.
- **Expected:** a `Refresh` button with `pi-refresh` icon sits in the
  tab header, to the left of `New agent`. Layout matches Library →
  Skills / MCP / Tools / Instructions which already have this affordance.
- **Why not automated:** visual placement / responsive layout in the
  real dockview right rail isn't reliably assertable from the smoke stub.

#### 22.2 - External agent file appears after Refresh click.

- [x] result: v PASS (literal) — a dropped `~/.copilot/agents/*.agent.md` appears after Refresh. BUT the feature intent is broken: the agent appears yet is NOT selectable until a create/edit/delete or restart triggers an SDK reload (Refresh is fs-scan only). Filed as bug #82. Separately, files the SDK rejects (e.g. invalid `mcp-servers`) appear selectable-looking but fail with a cryptic "not found" → #81.

- **Steps:** with the Agents tab open, drop a valid `.agent.md`
  file under `~/.copilot/agents/` (or `<cwd>/.github/agents/` with
  a session whose `workingDirectory` points there). Click `Refresh`.
- **Expected:** the new agent appears in the list without switching tabs.
- **Why not automated:** external filesystem mutation + real SDK
  listAgents call.

#### 22.3 - Rows still styled as cards (no E.8 regression).

- [x] result: v PASS

- **Steps:** look at any agent row in the list.
- **Expected:** bordered card with name + path stacked on the left,
  action buttons (Select/Edit/Reveal/Delete) on the right.
  Two-row CSS grid layout. NOT a plain HTML list.
- **Why not automated:** vue-tsc + smoke don't catch scoped-CSS-doesn't-match-child-element issues; this is the regression class that ate 2 PRs already this session.

### Sprint D — Jobs spinner center (issue #15, 2026-05-28)

#### D15.1 - Running job spinner rotates in place.

- [ ] result: 

- **Steps:** run `bun run dev`, start a chat session, ask the agent to spawn a background task, then open the Jobs panel while the job is `starting` or `running`.
- **Expected:** the spinner beside the active job rotates around its own center without orbiting an off-center point.
- **Why not automated:** the bug is a visual glyph/transform-origin artifact in the live browser compositor; unit tests cannot reliably assert the perceived rotation pivot.

### Sprint A1 — Library Agents Select / Deselect (commit `bca5704`, 2026-05-27)

#### A1.1 - Select button per row.

- [x] result: v PASS

- **Steps:** open Library → Agents → click `Select` on any row.
- **Expected:** header gets the agent chip; the clicked row turns
  green-tinted with a `Selected` chip and the button label becomes
  `Deselect`; other rows still show `Select`.
- **Why not automated:** filesystem + SDK + reactive header chip
  + custom CSS state across the full stack.

#### A1.2 - Deselect.

- [x] result: v PASS — toggle works, but on the common instant-select path it flashes a refresh affordance; smoothness polish → #78.

- **Steps:** click `Deselect` on the currently selected row.
- **Expected:** header chip disappears; row's button returns to
  `Select`; row tint clears.

#### A1.3 - Disabled state with no active session.

- [x] result: v PASS

- **Steps:** close every chat tab → open Library → Agents.
- **Expected:** Select button shows but is disabled. Hover gives a
  tooltip about needing a session.

#### A1.4 - Loading state during IPC.

- [x] result: v PASS — once the fixture was valid, selecting `reviewer` shows a brief loading state on the button. (The earlier failure was an invalid fixture, not a dafman bug — see A3.1.)

- **Steps:** click `Select` on a slow agent (e.g. one whose YAML
  is verbose so the SDK takes a moment).
- **Expected:** button shows a spinner during the IPC roundtrip;
  other rows' buttons are disabled (one-at-a-time semantics from
  `useSessionAgents`).

### Sprint A2 — Library Agents Edit button (2026-05-27)

#### A2.1 - Edit opens form prefilled.

- [x] result: v PASS — name/displayName/description/tools/skills/model all prefilled.

- **Steps:** click the pencil icon on any existing agent row.
- **Expected:** form opens with title `Edit <name>`. Name and Scope
  are disabled. Other fields show the parsed values from the file.
- **Why not automated:** form prefill + scope/name lock across all
  fields needs a full Vue mount + DOM read.

#### A2.2 - Edit save persists known fields + preserves unknown frontmatter.

- [x] result: v PASS — verified byte-for-byte on disk after save: `mcp-servers` (nested github http), `github.toolsets`, and `custom-plugin-key` all preserved intact.

- **Steps:** create an agent file by hand at
  `~/.copilot/agents/foo.agent.md` with a `mcp-servers:` block in
  the frontmatter that we don't model. Click Edit on the row.
  Change the description. Click Save.
- **Expected:** toast "Agent saved". File on disk: description
  updated, `mcp-servers:` block still present byte-for-byte.
- **Why not automated:** filesystem round-trip + SDK reload chain.

#### A2.3 - Preserved-keys hint shows when there are unknown frontmatter keys.

- [x] result: v PASS — hint shows and lists `mcp-servers`, `github`, `custom-plugin-key`.

- **Steps:** open Edit on the file above (which has `mcp-servers:`).
- **Expected:** blue info banner at the top of the form: "Unknown
  frontmatter keys preserved: edits won't strip `mcp-servers`,
  `github`, plugin keys, etc."

#### A2.4 - Preserved-keys hint hidden when there's nothing to preserve.

- [x] result: v PASS — hint hidden when editing plain `Stella` (name+description only).

- **Steps:** create an agent via `New agent`, save it. Then Edit.
- **Expected:** no preserved-keys banner.

### Sprint A3 — `/agent <name>` selects (2026-05-27)

#### A3.1 - `/agent reviewer` selects the agent.

- [x] result: v PASS — `/agent reviewer` and Library Select both work. ROOT CAUSE of the earlier "custom agent reviewer not found": the fixture's `mcp-servers.github` block was missing the SDK-required `tools` array, so the SDK's `.agent.md` schema (`safeParse`) rejected the whole file and silently dropped the agent. Adding `tools: []` fixed it. dafman's own create→select flow was never broken (form-created `tester` always worked). The real dafman gap this surfaced — dafman doesn't flag SDK-rejected agent files — is filed as #81.

- **Steps:** type `/agent reviewer` (with a real agent name) in
  composer → Enter.
- **Expected:** header chip flips to `reviewer`; toast "Agent
  selected: Reviewer"; an in-stream system note appears under the
  last message.
- **Why not automated:** SDK roundtrip + reactive header chip.

#### A3.2 - `/agent unknown` warns + lists available.

- [x] result: v PASS — warns and lists available agents. Two follow-ups raised: no inline autocomplete/typeahead → #80; the unknown is only surfaced after submit, not before.

- **Steps:** type `/agent unknown-name` → Enter.
- **Expected:** warn toast "No agent named 'unknown-name'.
  Available: foo, bar, baz". Chip does NOT change.

#### A3.3 - `/agent` with no argument opens Library.

- [x] result: v PASS — opens Library → Agents. Follow-up: running it again while already open toggles it CLOSED; should focus instead (applies to sibling slash commands) → #79.

- **Steps:** type `/agent` → Enter (or pick from slash menu).
- **Expected:** right-edge Library panel opens to the Agents tab.

### Issue #110 — Dropped text/code files are seen by the agent (2026-05-31)

#### 110.1 - Drag-and-drop an out-of-cwd `.ts`/`.md` file, agent reads its content.

- [ ] result:

- **Steps:** start a session whose working directory is some folder A. Create a
  text/code file (e.g. `notes.ts` with a unique sentinel line like
  `// SENTINEL-12345`) in a DIFFERENT folder B that is NOT under A. Drag that
  file from the OS file manager onto the composer; an attachment pill appears.
  Send "What does the attached file say? Quote the sentinel line."
- **Expected:** the agent quotes `// SENTINEL-12345` (it actually read the
  content). It must NOT say it "can't find the file".
- **Why not automated:** confirming the real bundled host CLI ingests the staged
  file and surfaces it to the model requires the live CLI + a model round-trip;
  the staging transform itself is unit-tested at the `SessionRegistry.send`
  boundary (`src-bun/__tests__/sessions.test.ts`, `attachmentStaging.test.ts`).

#### 110.2 - "Attach command result" pill content reaches the agent.

- [ ] result:

- **Steps:** run a command in the integrated terminal that prints a unique
  sentinel, use the "attach result" affordance to add it to the composer, then
  ask the agent to summarize the command output and quote the sentinel.
- **Expected:** the agent quotes the sentinel from the command output (the
  markdown result is staged to a file and read, not dropped).
- **Why not automated:** same as 110.1 — needs the live host CLI + model.

#### 110.3 - Dropped image still inlines (regression guard).

- [ ] result:

- **Steps:** drag a `.png`/`.jpg` onto the composer and ask the agent to
  describe it.
- **Expected:** the agent describes the image (images stay inline blobs; the fix
  only re-routes non-inlinable blobs).
- **Why not automated:** needs the live host CLI + a vision round-trip.

---

## How to use this list

Walk the `## ⏳ Pending verification` items above. For each one: follow its
**Steps**, then record the outcome on that item's `result:` line —

- **Pass:** tick the `- [x]` box and write a pass mark + note, e.g.
  `- [x] result: v fixture servers persisted across restart`.
- **Fail:** tick the box and write a fail mark + one-line repro, e.g.
  `- [x] result: x toggle reset to on after relaunch`. I'll file it
  under `manual-test-fail` and remove the row.
- **N/A** ("I don't care about this case"): say so — I'll remove it (with a
  note in the relevant commit message).
