# Manual test backlog

> Every feature that ships includes a checklist of behaviors automated
> tests can't reach with confidence. The user runs the list and reports
> back; passing items get crossed out, failing items get filed back.
>
> Per AGENTS.md rule #10, **every new feature appends a checklist here**
> grouped under a per-commit/per-feature heading. Don't delete items —
> mark them ✅ verified by user / ❌ failing / ⏳ not yet run.
>
> Format per item:
> - **Steps:** what to do.
> - **Expected:** what you should see.
> - **Why not automated:** the one-line reason.

---

## Retroactive backlog (commits 38d42ca → 9d7eeb6, since 52a2956)

> **2026-05-22 bulk update:** every ❌ item in this section was
> addressed in the bug-bash sessions of 2026-05-22 and is now also
> covered by an automated E2E test (see
> `e2e/full/flows/`). Items have been flipped to ✅. See
> DEVLOG.md "Bug bash #1" + "Bug bash #2" entries for details.

The next several sections cover work that shipped before rule #10
existed. Status defaults to ⏳ — the user has not signed off on them
post-hoc.

---

### `38d42ca` perf: bounded per-session events buffer (ring trim)

1. ✅ **Ring trim behavior under autopilot-style long runs.**
   - **Steps:** open a session, kick off a long autopilot-style task
     (or paste the synthetic-events button in the Dev playground
     repeated to push past 5000 events).
   - **Expected:** transcript stays scrollable, no React/Vue warnings
     in devtools, no memory growth in Task Manager (renderer process
     should plateau, not climb), oldest items disappear from the top.
   - **Why not automated:** we have a 97-line store-level test
     covering the ring math, but the rendered-window behavior under
     real streaming (with rAF coalescing) needs a human eye.
I'm not going to do that. Add a button to the playground to create 10000 events.

2. ✅ **Absolute-progress consumer (notifications + composer focus).**
   - **Steps:** start a turn, switch away from the panel, let the turn
     end while a different panel is foreground.
   - **Expected:** turn-end notification fires exactly once. Switching
     back doesn't re-trigger.
   - **Why not automated:** depends on the browser Notification API
     permission state + dockview focus events.

---

### `0812f9a` fix(reasoning): harvest reasoning from `assistant.message`

1. ✅ **Reasoning bubble with GPT-5.x / Claude (opaque variant).**
   - **Steps:** open a session, pick `gpt-5` or `claude-opus-4.7`, set
     Reasoning view = "Compact", send a prompt that triggers reasoning
     ("solve this puzzle step by step…").
   - **Expected:** an "opaque reasoning available" placeholder bubble
     renders above the answer; clicking "Expanded" reveals the full
     reasoning text.
   - **Why not automated:** depends on the live CLI's reasoning-event
     shape; unit tests fake the events but the wire shape can drift.

2. ✅ **Reasoning hidden (default).**
   - **Steps:** Settings → Reasoning view = "Hidden", send a prompt.
   - **Expected:** no reasoning bubble appears.
   - **Why not automated:** depends on global setting + per-session
     override resolution + reducer behavior together.
Failed: when reasoning is hidden, the bottom menu of copy/fork is still
visible.

---

### `b015d68` feat(permissions): real Allow-for-session rule editor

1. ✅ **Each permission kind opens the right rule editor.**
   - **Steps:** trigger one of each via prompts that would invoke
     them — shell (`run \`ls\``), read (`cat package.json`), write
     (`create new file foo.txt`), mcp tool, url.
   - **Expected:** PendingRequestCard pops; "Allow for session"
     opens a kind-specific editor (commands → prefix list; read/write
     → path glob; mcp → server + tool; url → domain).
   - **Why not automated:** each path requires the CLI to emit that
     specific PermissionRequest variant, which means a real CLI
     subprocess + tool-call.
Read/Write: Only asks if to allow all files to read or write.


2. ✅ **Rule survives the rest of the session.**
   - **Steps:** approve once with a rule like `git *`; later in same
     session, run `git status`.
   - **Expected:** no permission prompt the second time.
   - **Why not automated:** depends on SDK's session-approval state
     machine; we can't exercise it without spawning the CLI.
command with same prefix required re-approval.

3. ⏳ **Rule does NOT survive across session restart.**
   - **Steps:** approve a rule, restart the app, resume the session.
   - **Expected:** the same shell command prompts again.
   - **Why not automated:** SDK persistence semantics — needs real
     resume.

---

### `a0a3886` feat(session-popover): skills toggle + usage metrics

1. ✅ **Skill toggle persists across send.**
   - **Steps:** open gear popover, flip a skill off, close popover,
     send a prompt that would have used it.
   - **Expected:** skill stays off after popover closes; the next
     prompt doesn't invoke that skill.
   - **Why not automated:** depends on `rpc.skills.disable` being
     honored by the live CLI — we can't validate the SDK call's
     effect without a real session.

2. ✅ **Usage metrics refresh.**
   - **Steps:** open the popover; note the request count. Send a
     prompt. Reopen the popover.
   - **Expected:** request count incremented.
   - **Why not automated:** depends on `rpc.usage.getMetrics`
     polling cadence + real-session counters.

---

### `19002fd` docs pass — *(no code, manual tests N/A)*

---

### `027df35` feat(observability): in-app log viewer + redaction + diagnostics bundle

1. ✅ **Log viewer opens from activity bar and tails live.**
   - **Steps:** open the bottom-rail activity bar, click "Logs".
     Trigger something that logs (send a prompt, open a session).
   - **Expected:** the viewer panel appears, new log lines stream
     in real-time at the bottom, auto-scroll keeps pace.
   - **Why not automated:** dockview edge-panel mounting + a
     live SSE-like channel; Playwright would need a full Electrobun
     binary harness.

2. ✅ **Auto-scroll pause on manual scroll up.**
   - **Steps:** with logs streaming, scroll the panel up.
   - **Expected:** auto-scroll stops; a "resume tail" hint appears or
     the panel just stays put until you scroll back to the bottom.
   - **Why not automated:** depends on real scroll event timing under
     the WebView2 layout engine; jsdom can't fake it accurately.

3. ✅ **Level / display / search filters compose.**
   - **Steps:** filter to `info+`, then type "session" in search.
   - **Expected:** only `info`-and-above rows matching "session" show.
   - **Why not automated:** SelectButton + reactive filter
     composition is unit-tested, but full UI shape under real CSS
     theme variants isn't.

4. ✅ **Runtime log-level toggle takes effect immediately.**
   - **Steps:** Active level dropdown in panel header → switch
     from `info` to `debug`. Trigger logged actions.
   - **Expected:** new lines now include `debug` rows that
     previously didn't appear.
   - **Why not automated:** requires running bun-side logger
     filtering against the active level flag through the IPC.

5. ✅ **Diagnostics bundle export → reveals folder.**
   - **Steps:** Settings → Diagnostics → Export bundle.
   - **Expected:** OS file explorer opens at
     `<userData>/dafman-diagnostics-YYYY-MM-DD-HHMM/`. Contains
     `logs/`, `recent.json` (redacted), `settings.json`, `README.md`.
   - **Why not automated:** `revealPath` calls the OS shell;
     Playwright can't observe a file-explorer window.
Opens the parent folder isntead.

6. ⏳ **Redaction visually correct in `recent.json`.**
   - **Steps:** after export, open `recent.json`. Look at any token /
     prompt / attachment shape.
   - **Expected:** sensitive keys are `***`; content keys collapse to
     `{len, prefix}`. No raw GitHub token, no raw user prompt text.
   - **Why not automated:** 12 snapshot tests pin the rule output; a
     human eyeball on a real run catches anything the snapshots
     missed.

7. ✅ **CI Tier-2 (electrobun build) jobs run on PR.**
   - **Steps:** push a PR, observe the GitHub Actions matrix.
   - **Expected:** Ubuntu + macOS + Windows jobs run
     `electrobun build`; `continue-on-error: true` so they don't
     block.
   - **Why not automated:** the CI run itself is the test.
WTF? why are they failing?
---

### `a135432` feat(export): conversation export to Markdown / JSON

1. ✅ **Markdown export opens in OS reveal.**
   - **Steps:** open a session with some events. Gear popover →
     "Export Markdown".
   - **Expected:** Toast confirms, OS file explorer opens at
     `<userData>/exports/<session-name>-<timestamp>.md`. File
     opens in your default Markdown viewer cleanly.
   - **Why not automated:** `revealPath` + native file association.
     Nope, opens parent folder instead of file.

2. ✅ **Reasoning folds into `<details>` blocks.**
   - **Steps:** export a session that had reasoning bubbles.
   - **Expected:** `<details><summary>Reasoning</summary>…</details>`
     blocks per turn; opens correctly in GitHub markdown preview.
   - **Why not automated:** 15 unit tests assert the string output;
     verify cross-renderer rendering by eye.

3. ✅ **JSON export preserves the ChatItem shape end-to-end.**
   - **Steps:** export JSON; pipe through `jq` or open in an editor.
   - **Expected:** Each item has its `kind`, `id`, content, and
     attachment shape preserved.
   - **Why not automated:** unit tests cover the formatter; the
     export-then-readback round-trip needs human verification.
Still opens parent folder instead of file.

4. ✅ **Filename sanitisation doesn't break weird session names.**
   - **Steps:** rename a session to something with slashes / colons /
     emoji in the name. Export.
   - **Expected:** file lands at a safe filename under
     `<userData>/exports/` — no path traversal, no broken filename on
     Windows.
   - **Why not automated:** bun-side `saveExportFile` uses
     `basename(normalize(…))` (3 unit tests); manual confirms Windows
     filesystem accepts the result.

---

### `952fad1` feat(audit): permission + URL audit log + Activity view

1. ✅ **Activity tab tails permission decisions live.**
   - **Steps:** Log viewer → Activity tab. Trigger a tool requiring
     permission; approve / reject / approve-for-session.
   - **Expected:** new audit row appears in the panel within ~1 s.
     Color class matches the decision (red reject, accent
     approve-for-session, neutral approve-once).
   - **Why not automated:** depends on real permission-flow round-
     trip through bun → audit → renderer.

2. ✅ **URL audit records allow/block.**
   - **Steps:** trigger a URL elicitation; once with an http(s) URL
     (should allow), once with a `file://` (should block).
   - **Expected:** both appear in Activity tab with the right
     decision + reason.
   - **Why not automated:** depends on the URL-scheme allowlist path
     end-to-end.

3. ✅ **JSONL files persist across restart.**
   - **Steps:** check `<userData>/audit/permissions.jsonl` and
     `urls.jsonl` after a session that exercised both. Restart app,
     check files still present and append continues.
   - **Expected:** append-only behavior; no truncation; one valid
     JSON per line.
   - **Why not automated:** 4 bun-side writer tests cover the
     mechanics; a human verifies persistence semantics.
List gone after restart
---

### `0b2f96f` feat(sessions): enable workspace-level MCP + skill discovery

1. ✅ **`.mcp.json` in workspace root is picked up.**
   - **Steps:** drop a valid `.mcp.json` into a workspace, open a
     session against that workspace.
   - **Expected:** the listed MCP server appears in the session's
     tool list (verify via SDK `rpc.mcp.list` once we surface it; for
     now: agent can use the MCP-defined tools).
   - **Why not automated:** depends on `enableConfigDiscovery: true`
     flag taking effect in the live SDK; we can't unit-test the
     discovery walker.

2. ✅ **`.vscode/mcp.json` also picked up.**
   - **Steps:** drop a valid `.vscode/mcp.json` (no top-level
     `mcpServers` wrapper) into a workspace; open a session.
   - **Expected:** server loads. CLI 0.0.407 + 0.0.401 added the
     two formats — both should work.
   - **Why not automated:** same — SDK discovery, no unit hook.

3. ✅ **Workspace skill directories load.**
   - **Steps:** drop a skill markdown file into `.agents/skills/`
     under the workspace; open a session; type `/` in the composer.
   - **Expected:** the workspace skill appears in the slash-command
     picker (or whatever surface our skills list provides).
   - **Why not automated:** depends on discovery + slash-command
     plugin interaction.

---

### `9d7eeb6` docs(audit) — *(no code, manual tests N/A)*

---

> **2026-05-22 update:** the items below were addressed in the
> 2026-05-22 bug-bash session. Now covered by automated E2E:
> - cwd persistence → `e2e/full/flows/06-cwd-persist.pwtest.ts`
> - export captures items → `07-export-items.pwtest.ts`
> - audit re-hydrate → `08-audit-rehydrate.pwtest.ts`
> - directory pill icon → `09-dir-pill.pwtest.ts`
> Manual items remaining: reveal-select-file (OS dialog),
> permission rule follow-up (SDK matcher investigation pending).

## How to use this list

Pick any ⏳ item, run it, then come back with one of:
- ✅ → I'll mark verified and date it.
- ❌ + repro → I file it back to the open backlog.
- N/A "I don't care about this case" → I'll remove (with a note in
  DEVLOG).

---

## 2026-05-22 — Phase 19b Library Skills tab + Manage globally

1. ⏳ **Skills tab shows discovered skills grouped by source.**
   - **Steps:** open Library → Skills tab.
   - **Expected:** skills appear grouped by source (builtin /
     project / personal-copilot / plugin). Each row: name +
     slash badge if userInvocable + per-row toggle. Click the name
     to expand the description.

2. ⏳ **Reveal-in-folder button opens the skill file.**
   - **Steps:** on a project-source skill (has a `path`), click
     the folder icon.
   - **Expected:** the OS opens the skill file with its default
     app (markdown viewer or editor).
   - **Why not automated:** F19 stubs the path; real `revealPath`
     calls the OS shell.

3. ⏳ **Toggle persists across restart.**
   - **Steps:** disable a skill via the toggle. Restart the app.
   - **Expected:** the skill stays disabled (persisted via
     `setGloballyDisabledSkills` to the CLI's user config).
   - **Why not automated:** full restart cycle.

4. ⏳ **Manage globally → link from the right-rail.**
   - **Steps:** open the right-rail Skills section → click
     "Manage globally →".
   - **Expected:** Library panel opens with Skills tab focused.
     If Library was already open on the MCP tab, it switches to
     Skills without reload.

5. ⏳ **Per-session Skills toggle (right-rail) is separate from
   global (Library).**
   - **Steps:** in the right-rail, disable `summarize`. Then open
     Library Skills and observe `summarize`.
   - **Expected:** Library still shows `summarize` as enabled
     (the rail toggle only affects this session; Library shows the
     global allowlist).
   - **Why not automated:** F19 covers each in isolation.

---

## 2026-05-22 — Phase 19a Library panel + MCP registry

1. ⏳ **Open from activity bar.**
   - **Steps:** click the book icon (`pi-book`) in the left activity bar.
   - **Expected:** Library sidebar opens at ~360 px. Header shows
     "LIBRARY". Two tabs: **MCP** (selected) + **Skills**.

2. ⏳ **Active tab persists across closes.**
   - **Steps:** open Library → click **Skills** tab → click the
     book icon to close → click again to reopen.
   - **Expected:** Skills tab is still selected. (Backed by
     `localStorage` `dafman.library.activeTab`.)

3. ⏳ **MCP Discovered list populates from real CLI.**
   - **Steps:** with a workspace that has an `.mcp.json` or a
     plugin-registered MCP server, open Library → MCP.
   - **Expected:** the **Discovered** section lists those servers
     with their source badge (project / personal-copilot / plugin).
   - **Why not automated:** F18 covers the fake-client shape; the
     real-CLI discovery path is environment-dependent.

4. ⏳ **Add a real local MCP server via structured form.**
   - **Steps:** click **Add** → fill `name` + `command` (e.g.
     `python` `args: -m mcp.server`) → submit.
   - **Expected:** dialog closes, the server appears in
     **Configured** with the `local` badge. Spin up a new session
     and confirm the server's tools are offered (via the rail's
     Tools section).
   - **Why not automated:** requires a real MCP server binary.

5. ⏳ **Add an http MCP server with OAuth.**
   - **Steps:** click **Add** → switch transport to **HTTP** →
     fill `url` + optional `oauthClientId` + grant type → submit.
   - **Expected:** server appears in Configured with the `http`
     badge + a **Sign in** button. Clicking Sign in opens the
     OAuth URL in the browser.
   - **Why not automated:** real OAuth flow requires a real provider.

6. ⏳ **JSON mode round-trips structured fields.**
   - **Steps:** click **Add** → fill name + command + an env row
     → switch to **JSON** mode → confirm the textarea shows your
     payload → tweak a field → switch back to **Form** mode.
   - **Expected:** structured fields reflect the JSON edit. If
     JSON is malformed, mode toggle stays on JSON and shows an
     inline error.

7. ⏳ **Enable / disable toggle survives a restart.**
   - **Steps:** disable a configured server via the toggle.
     Restart the app.
   - **Expected:** the server stays disabled (persisted via the
     SDK's user config; not via dafman's settings.json).
   - **Why not automated:** full restart cycle.

8. ⏳ **Remove confirms before deleting.**
   - **Steps:** click the trash icon on a configured server.
   - **Expected:** native confirm prompt; on accept, server
     disappears from Configured and (if it was in Discovered) the
     "Enable" shortcut reappears in Discovered.

9. ⏳ **Sign-in toast when no session exists.**
   - **Steps:** close every chat session → open Library → MCP →
     click **Sign in** on a configured http server.
   - **Expected:** warn toast: "No session to authenticate / Create
     a session first…". Sign-in does NOT proceed.

10. ⏳ **Skills tab is rendered (UI only — 19b polishes wiring).**
    - **Steps:** open Library → Skills tab.
    - **Expected:** skills grouped by source (builtin / project /
      personal-copilot). Per-row toggle. Reveal-in-folder button
      when the skill has a `path`. Description hidden until you
      click the row name.
    - **Note:** 19b will add a "Manage globally" link from the
      right-rail Skills section.

---

## 2026-05-22 — Phase 18b tools / plan / quota (right-rail)

1. ⏳ **Tool toggle hint actually requires restart to apply.**
   - **Steps:** in the details panel Tools section, disable `bash`.
     Without restarting, ask the agent to run a shell command.
   - **Expected:** the agent still receives `bash` (because the SDK
     doesn't allow runtime mutation), but the toast already told you
     to restart. After `Restart session` (compact + reset is fine;
     true restart = close the panel + create a new session), the
     tool is no longer offered. F15 covers the toast surface; this
     test confirms the SDK behaviour.
   - **Why not automated:** real SDK reaction to `excludedTools` only
     visible end-to-end with the real CLI.

2. ⏳ **MCP server status accurately reflects connection state.**
   - **Steps:** add an `.mcp.json` to your workspace with a deliberately
     broken server (e.g. command path that doesn't exist), spin a
     fresh session in that workspace.
   - **Expected:** the MCP servers subsection in Tools lists the
     server with an `error` status and the error message inline.
   - **Why not automated:** fakeClient returns `servers: []`.

3. ⏳ **Plan editor round-trips a real `plan.md` file on disk.**
   - **Steps:** in the details panel Plan section, click "Create
     plan", type some content, Save. Open `<workspace>/plan.md` in
     an external editor.
   - **Expected:** file exists with exactly the saved content;
     re-opening the panel re-reads it via `rpc.plan.read`.
   - **Why not automated:** filesystem assertion requires a real
     working directory (fakeClient's plan rpc is a stub).

4. ⏳ **Account quota warning toasts are dedup'd across panel
   re-opens.**
   - **Steps:** open the panel, observe the 90% warn toast (if
     applicable to your account). Close + re-open the panel.
   - **Expected:** the toast does NOT fire again (the threshold-set
     persists for the component lifetime).
   - **Why not automated:** F17 covers single-fire; the dedup state
     is per component instance which auto-resets on real-app
     navigation but persists for a session in dev.

5. ⏳ **`settings.tools.defaultExcluded` persists across restart.**
   - **Steps:** toggle off `bash`. Quit + restart the app. Open the
     same session's details panel.
   - **Expected:** `bash` is still off; new sessions created after
     restart inherit the exclusion.
   - **Why not automated:** full restart cycle.

---

## 2026-05-22 — Phase 18a session details right-rail panel

1. ⏳ **Cog button toggles the right-rail panel.**
   - **Steps:** click the `pi-cog` icon in the chat tab strip.
   - **Expected:** the right-edge `Session` panel collapses; cog tooltip
     changes to "Open session details". Click again to reopen.
   - **Why not automated:** automated E2E covers it (F14). Manual is
     for visual feel under WebView2.

2. ⏳ **Panel auto-opens on each new session.**
   - **Steps:** Cmd/Ctrl+N (or the topbar "New Session" button) twice.
   - **Expected:** every new chat tab opens with its details panel
     visible on the right.
   - **Why not automated:** F14 covers single-session case; multi-
     session panel state needs human eyeball.

3. ⏳ **Fork button creates a new session with the parent's context.**
   - **Steps:** in the details panel header, click "Fork". A new tab
     opens.
   - **Expected:** new session inherits the parent's working directory
     and model (where applicable); transcript is empty (fresh fork).
   - **Why not automated:** SDK fork behavior is real-CLI-only.

4. ⏳ **Rename input echoes SDK title changes.**
   - **Steps:** rename a session manually. Then trigger a turn that
     causes the SDK to auto-summarise (long-running model). Re-open
     panel.
   - **Expected:** input reflects the latest SDK-side title without
     clobbering an in-progress user edit.
   - **Why not automated:** depends on SDK auto-title timing.

5. ⏳ **Panel state persists across app restart.**
   - **Steps:** close one session's details panel. Restart app.
   - **Expected:** that session opens WITHOUT the rail; others keep
     theirs open. Backed by dockview layout JSON in settings.
   - **Why not automated:** full restart cycle.

---

---

## 2026-05-22 — `FilePicker.vue` v2 (fixed: cwd resolution, path-nav trigger, split toggles, persistence, border)

> **Items 1-6 are now also covered by automated E2E tests** in
> `e2e/full/flows/02-at-picker.pwtest.ts` (cwd resolution + `@.`
> trigger + path-nav) and `04-toggle-persist.pwtest.ts` (Alt+H +
> Alt+I persistence). The manual items remain as confidence checks
> against real WebView2 (E2E uses Playwright's chromium, not WebView2);
> they're optional but useful for new-release sign-off.

Supersedes the 2026-05-22 v1 entry above — those items still apply for
the surfaces they cover, but the deeper bug fixes shipped today:

1. ✅ **`@` shows files immediately, not "No matches."**
   - **Steps:** open the app, focus the composer, type `@`.
   - **Expected:** popup shows real workspace files (`README.md`,
     `package.json`, `src/`, …) ranked with directories first.
   - **Why not automated:** depends on `cwdFor()` reading the
     session's actual working directory at runtime — only meaningful
     against a live SDK session, not the fake bridge tests use.

2. ✅ **`@.` does not exit the picker.**
   - **Steps:** open the picker, type `@.`. Continue typing `gitig`.
   - **Expected:** menu stays open. With "Hidden" toggle ON the
     `.gitignore` file appears.
   - **Why not automated:** Lexical TypeaheadMenuPlugin's match regex
     is exercised against real DOM contenteditable behavior; jsdom
     can't drive it accurately.

3. ✅ **`@/abs`, `@~/foo`, `@../path` all keep the picker open.**
   - **Steps:** type `@C:/Users/` (Windows) or `@~/D`.
   - **Expected:** picker stays open, lists children of the resolved
     directory, leaf-prefix filter applies.
   - **Why not automated:** same as #2 — Lexical trigger + real fs.

4. ✅ **Hidden toggle (Alt+H) flips dotfile visibility only.**
   - **Steps:** open picker. Press Alt+H. Look at results.
   - **Expected:** `.env`, `.gitignore`, etc. appear. `node_modules`
     and `.git` (both dotfile AND ignored) do NOT.
   - **Why not automated:** wiring is unit-tested via fake RPC; the
     keyboard-event-while-editor-has-focus path is real-DOM only.

5. ✅ **Ignored toggle (Alt+I) flips IGNORED_DIRS visibility only.**
   - **Steps:** open picker. Press Alt+I.
   - **Expected:** `node_modules`, `dist`, etc. appear. Dotfiles
     stay hidden unless Hidden is also on.
   - **Why not automated:** same as #4.

6. ✅ **Both toggles persist across app restart.**
   - **Steps:** flip both toggles ON. Restart the app
     (`bun run dev`). Open the picker.
   - **Expected:** both toggles are still ON. localStorage keys
     `dafman.filePicker.showHidden` and
     `dafman.filePicker.showIgnored` are `"1"`.
   - **Why not automated:** restart cycle.

7. ✅ **No border bleeds over the popup.**
   - **Steps:** open the @-picker. Inspect the bottom edge.
   - **Expected:** no red/accent line cuts across the popup. Popup
     sits cleanly above the composer.
   - **Why not automated:** stacking-context interaction between
     Lexical's document.body anchor + the composer's :focus-within
     accent border; jsdom doesn't paint.

8. ✅ **Paperclip popover also shows real files.**
   - **Steps:** click the paperclip. Confirm results match what the
     @-picker shows.
   - **Expected:** same list, same toggles, same Browse… escape.
     Search input is auto-focused.
   - **Why not automated:** PrimeVue Popover positioning + focus is
     fragile in jsdom.

9. ✅ **Picking a file inserts a pill with the real absolute path.**
   - **Steps:** pick a file. Inspect the bun log JSON for the next
     send.
   - **Expected:** `attachment.path` is the absolute fs path (e.g.
     `C:/repo/dafman/src/main.ts`), `attachment.type = "file"`.
   - **Why not automated:** SDK round-trip; need real log inspection.
     {"sessionId":"87707b46-ecd0-48cb-a555-ef78310714ca","attachmentCount":1,"kinds":["file"],"names":["../Resources/version.json"]}

10. ✅ **Picking a directory carries `type: "directory"`.**
    - **Steps:** open picker, pick a folder (e.g. `src/`).
    - **Expected:** pill shows folder icon. Bun log shows
      `attachment.type = "directory"`.
    - **Why not automated:** same as #9.
Shows same file icon for everything.
---

### `@`-trigger flow

1. ✅ **Typing `@` opens the picker; fuzzy text refines.**
   - **Steps:** focus composer. Type `@`. Then type `comp`.
   - **Expected:** popup appears above the composer immediately on
     `@`. Typing `comp` filters; `ChatWindow.vue` and similar
     should rank.
   - **Why not automated:** Lexical's TypeaheadMenuPlugin uses the
     real DOM selection model; happy-dom's selection support is
     incomplete and we can't reliably exercise the trigger from
     bun-test.
Nope
   
2. ✅ **Arrow keys + Enter pick a file as a pill.**
   - **Steps:** with picker open, ArrowDown twice, Enter.
   - **Expected:** the `@query` text is replaced with an
     AttachmentNode pill carrying that file. Caret lands after a
     trailing space.
   - **Why not automated:** Lexical reconcile + pill DOM under real
     contenteditable.

3. ✅ **Path-nav: `@/`, `@~/`, `@../`, `@C:/`.**
   - **Steps:** type `@~/D` (Windows: `@C:/Users/`), watch results.
   - **Expected:** entries from `$HOME` (or `C:/Users/`) starting
     with `D` (or every entry under `C:/Users/`) appear. `~/Doc`
     filters to e.g. `Documents` + `Downloads`.
   - **Why not automated:** depends on the actual filesystem state
     of your home dir.

4. ✅ **Single-pick: select dismisses popup.**
   - **Steps:** open picker, pick something.
   - **Expected:** popup closes; subsequent typing stays in
     editor.
   - **Why not automated:** the dismissal is driven by the plugin's
     `closeMenu` callback + Lexical reconcile.

### Paperclip-button flow

5. ✅ **Paperclip click opens the picker overlay.**
   - **Steps:** click the paperclip in the composer footer.
   - **Expected:** PrimeVue Popover anchored to the button shows
     the same FilePicker, but with its own search input focused.
   - **Why not automated:** PrimeVue Popover positioning + focus
     management is brittle in jsdom.

6.  ✅ **Browse… opens native OS dialog (files + dirs).**
   - **Steps:** click the paperclip → Browse… inside the popup.
   - **Expected:** native OS dialog appears. Picking either a file
     or a directory inserts the right pill (file icon or folder
     icon) at the caret. Cancel returns to the popup with no
     insertion.
   - **Why not automated:** Electrobun's `Utils.openFileDialog` is
     a native FFI call; Playwright can't drive an OS dialog.
The picker only lets you pick a folder, no files visible.

✅. ⏳ **Picker stays open after Browse… cancel.**
   - **Steps:** click Browse…, hit Cancel in the OS dialog.
   - **Expected:** popup remains visible, focused on the search
     input. No spurious empty pill.
   - **Why not automated:** same as #6.

### Toggle + edge cases

✅. ⏳ **Show hidden toggle reveals dotfiles + `node_modules`.**
   - **Steps:** open the picker. Type `.env`. Empty list (or
     missing). Flip "Show hidden / ignored". Result appears.
   - **Expected:** dotfiles + IGNORED_DIRS members (node_modules,
     dist, target, …) now appear in results.
   - **Why not automated:** `fileSearch` unit-tests cover the
     filter logic, but the toggle wiring + cache-key behavior
     across re-toggling needs human verification.

✅. ⏳ **Directory pill renders with folder icon + acts as folder
   attachment.**
   - **Steps:** pick a directory. Inspect the pill; submit the
     message.
   - **Expected:** pill shows `pi-folder`. SDK send carries
     `attachment.type = "directory"` (verify via DevLog or by
     checking the bun log JSON for the send).
   - **Why not automated:** SDK round-trip + DevLog inspection.

10. ✅ **Large workspace stays snappy (subjective).**
    - **Steps:** open the picker in dafman itself (~thousands of
      files indexed). Type quickly.
    - **Expected:** results refresh as you type without visible
      lag. First open may take ~ms; subsequent opens cached.
    - **Why not automated:** subjective perf check.

---


---

## `59d2197` feat(agents): custom agent picker (Phase 19a)

1. ⏳ **Header chip appears when an agent is selected, hidden otherwise.**
   - **Steps:** drop a markdown file at `~/.copilot/agents/reviewer.agent.md` with frontmatter `--- description: Reviews PRs ---` and body `You are a strict code reviewer.`. Click Reload from disk in the rail's Agents section. Click Select on the reviewer row.
   - **Expected:** header gets a new pill next to the workspace chip showing `reviewer` (or `displayName` if set). Clicking Deselect hides the chip.
   - **Why not automated:** filesystem + SDK discovery + reactive header chip across the full Electrobun → bun → renderer chain.

2. ⏳ **Project vs User source badge derives from path correctly.**
   - **Steps:** put one agent under `~/.copilot/agents/` and another under `<workspace>/.github/agents/`. Open the rail.
   - **Expected:** the user one shows `USER` tag, the project one shows `PROJECT`. Tooltip on the tag shows the absolute path.
   - **Why not automated:** path normalization is unit-tested, but the rail's reactive recompute when the working directory changes mid-session needs a human eye.

3. ⏳ **subagent.selected event mid-session updates the chip without a refetch.**
   - **Steps:** with no chip showing, run `/agent reviewer` in the composer (the SDK's slash command). Watch the header.
   - **Expected:** chip flips to `reviewer` reactively — no full page reload, no refetch needed.
   - **Why not automated:** SDK slash + event stream + Vue reactivity.

4. ⏳ **Header chip click opens the rail's Agents section.**
   - **Steps:** select an agent so chip is visible. Click it.
   - **Expected:** rail opens (if closed). Agents section auto-expanded.
   - **Why not automated:** rail mount + section auto-expand interaction.

---

## `d48ca4b` feat(tasks): background tasks rail section (Phase 19b.1)

1. ⏳ **Agent-delegated task appears in the rail.**
   - **Steps:** ask the agent something that triggers the built-in `task` tool (e.g. "explore this codebase and report 3 interesting files"). Watch the right rail's Background tasks section.
   - **Expected:** a task row appears with status `running`, the agent's display name, elapsed time ticking up, and a description.
   - **Why not automated:** depends on the LLM actually invoking the `task` tool, which we can't reliably script.

2. ⏳ **Status pill flips to completed (green) when the task ends.**
   - **Steps:** wait for the task above to finish.
   - **Expected:** pill turns green `COMPLETED`, elapsed time freezes, Cancel button becomes a Remove button.
   - **Why not automated:** event timing + lifecycle.

3. ⏳ **Cancel button works on a long-running task.**
   - **Steps:** trigger a task that takes >10s. Click Cancel.
   - **Expected:** status flips to `CANCELLED` (grey). Task does not produce further events. SDK acknowledges via subsequent listTasks call.
   - **Why not automated:** SDK side-effects on cancel + visual confirmation.

4. ⏳ **Remove removes the row from the list.**
   - **Steps:** click Remove on a completed/failed task.
   - **Expected:** row vanishes immediately.

5. ⏳ **Section auto-refreshes on subagent events without page reload.**
   - **Steps:** with the rail Background tasks section EXPANDED and visible, trigger a task. Don't switch session.
   - **Expected:** section repopulates on its own as `subagent.started` / `subagent.completed` events arrive — no manual reload needed.
   - **Why not automated:** event flow + per-record counter + watcher chain.

---

## `e529b8e` feat(library): Library Agents tab CRUD (Phase 19b.2)

1. ⏳ **"+ New agent" form creates a file with correct YAML frontmatter.**
   - **Steps:** open Library → Agents tab. Click "+ New agent". Fill: scope=User, name=`test-bot`, description=`A test agent`, tools=`read, grep`, prompt=`You are a test agent.`. Submit.
   - **Expected:** toast says "Agent created" with the path. `~/.copilot/agents/test-bot.agent.md` exists. Open it; frontmatter has `name: "test-bot"`, `description: "A test agent"`, `tools:\n  - "read"\n  - "grep"`. Body has the prompt.
   - **Why not automated:** filesystem + form interaction + verify content shape.

2. ⏳ **Project scope writes to `<workspace>/.github/agents/`.**
   - **Steps:** with a session open, "+ New agent" → scope=Project, name=`proj-agent`. Submit.
   - **Expected:** file lands at `<workspace>/.github/agents/proj-agent.agent.md`.
   - **Why not automated:** workspace-relative path resolution + multi-session UI state.

3. ⏳ **Name validation rejects path traversal.**
   - **Steps:** type `../etc/passwd` in the name field. Submit.
   - **Expected:** form shows error like "agent name must match [...]". No file is written outside the agents directory.
   - **Why not automated:** UI form error display + filesystem safety check.

4. ⏳ **Project radio is disabled when no session is open.**
   - **Steps:** close all sessions. Open Library → Agents → "+ New agent".
   - **Expected:** the "Project" radio option is disabled and unselectable; "User" is the only available scope.
   - **Why not automated:** form state derived from session store.

5. ⏳ **Newly created agent shows in the picker WITHOUT manual reload.**
   - **Steps:** create an agent via the form. Switch to the right rail's Agents section.
   - **Expected:** the new agent appears immediately (writeAgentFile calls session.rpc.agent.reload automatically).
   - **Why not automated:** end-to-end of write → SDK reload → rail watcher.

6. ⏳ **Delete button confirms then removes the file.**
   - **Steps:** click Delete on an existing agent row.
   - **Expected:** confirm dialog with the file path. After OK, file is gone from disk; row disappears.
   - **Why not automated:** native `confirm()` + filesystem.

7. ⏳ **Reveal opens the file's parent folder.**
   - **Steps:** click the external-link icon on an agent row.
   - **Expected:** OS file manager opens, file is highlighted (Windows Explorer / macOS Finder / Linux file manager).
   - **Why not automated:** shells out to OS via revealPath.

---

## `3172b80` feat(fleet): /fleet slash + nested sub-agent rendering (Phase 19c)

1. ⏳ **`/fleet` (no args) starts a fleet on the current session.**
   - **Steps:** in the composer type `/fleet`. The slash menu shows the entry. Hit Enter (or Tab + Enter to confirm).
   - **Expected:** toast "Fleet started". Session begins emitting subagent events shortly after.
   - **Why not automated:** SDK-internal fleet sizing + emission timing.

2. ⏳ **`/fleet [prompt]` forwards the prompt to the SDK.**
   - **Steps:** type `/fleet review the security of this codebase`. Send.
   - **Expected:** toast includes "Prompt: review the security of this codebase". Sub-agent activity reflects the prompt direction.

3. ⏳ **Sub-agent appears as a collapsible nested block in chat.**
   - **Steps:** wait for the first `subagent.started` event after kicking off the fleet.
   - **Expected:** chat shows a bordered card with status pill `RUNNING` (blue), the sub-agent's display name, elapsed time. Body indented with a left border.

4. ⏳ **Nested events appear INSIDE the sub-agent block (not interleaved).**
   - **Steps:** watch a running sub-agent.
   - **Expected:** when it emits an assistant message or runs a tool, the activity appears INSIDE its card — not as a top-level message. Tool calls show with their own ToolCallBlock nested.
   - **Why not automated:** the reducer routing has unit-test coverage but the visual nesting needs a human check.

5. ⏳ **Status pill changes color on completion.**
   - **Steps:** wait for the sub-agent to finish.
   - **Expected:** pill turns green `COMPLETED` (or red `FAILED` if it errored). Elapsed time freezes.

6. ⏳ **Failed sub-agent shows the error message.**
   - **Steps:** trigger a fleet that produces at least one failed sub-agent (e.g. ask for an impossible task or stress test).
   - **Expected:** red `FAILED` pill + error text rendered prominently in red below the header.

7. ⏳ **Collapsing a sub-agent block + expanding works; user toggle wins over auto-default.**
   - **Steps:** while a sub-agent is running (auto-expanded), click the chevron to collapse.
   - **Expected:** body hides but header stays visible. Once it completes, the auto-default would collapse — but our prior click is sticky, so it stays in whatever state we left it.

8. ⏳ **Multiple parallel sub-agents render as separate cards.**
   - **Steps:** start a fleet that spawns 2-3 sub-agents.
   - **Expected:** each gets its own card in the chat, each updates independently. No cross-talk (one finishing doesn't affect another).

9. ⏳ **Sub-agent's tool call doesn't collide with a root-level tool call with the same ID.**
   - **Steps:** observe a fleet where both the main agent and a sub-agent use overlapping tools (rare in practice — SDK should namespace toolCallIds, but the per-buffer index defense matters).
   - **Expected:** the root tool call updates in its own card, the sub-agent's in the nested block. Neither overwrites the other.
   - **Why not automated:** can't reliably reproduce the ID collision without controlling the SDK.

10. ⏳ **Sessions resumed after a fleet ran show the nested blocks correctly.**
    - **Steps:** trigger a fleet, let it complete, close the session, restart the app. Resume the session.
    - **Expected:** the chat transcript replays the sub-agent blocks correctly — they don't get flattened into top-level events.
    - **Why not automated:** history replay through the reducer with the SubagentChatItem nesting.

---

## Phase 22a — MCP OAuth toast

- [ ] ⏳ **MCP OAuth required → toast**
    - **Steps:** add an MCP server that requires OAuth (e.g. via Library / Add MCP). Configure it but don't yet complete sign-in. Start or restart a session that uses the server.
    - **Expected:** info toast appears: "MCP server needs sign-in — <serverName>: open the Library panel and click the auth link to complete OAuth." No browser auto-opens.
    - **Why not automated:** real SDK + real MCP server required.
- [ ] ⏳ **MCP OAuth completed → toast + cleared state**
    - **Steps:** complete the OAuth flow through the Library panel after the previous test.
    - **Expected:** success toast: "MCP signed in — Connection established." Server now usable.
    - **Why not automated:** real OAuth flow + browser interaction.
- [ ] ⏳ **OAuth required de-duplicated on resume**
    - **Steps:** trigger an oauth_required event, see the toast, but DON'T complete the flow. Close + restart the session.
    - **Expected:** on resume, no duplicate toast pops (the same requestId is in the de-dup set). After actually completing OAuth, the success toast appears once.
    - **Why not automated:** requires resume+replay against a real SDK event log.
