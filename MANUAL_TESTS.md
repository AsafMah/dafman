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

The next several sections cover work that shipped before rule #10
existed. Status defaults to ⏳ — the user has not signed off on them
post-hoc.

---

### `38d42ca` perf: bounded per-session events buffer (ring trim)

1. ⏳ **Ring trim behavior under autopilot-style long runs.**
   - **Steps:** open a session, kick off a long autopilot-style task
     (or paste the synthetic-events button in the Dev playground
     repeated to push past 5000 events).
   - **Expected:** transcript stays scrollable, no React/Vue warnings
     in devtools, no memory growth in Task Manager (renderer process
     should plateau, not climb), oldest items disappear from the top.
   - **Why not automated:** we have a 97-line store-level test
     covering the ring math, but the rendered-window behavior under
     real streaming (with rAF coalescing) needs a human eye.

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

2. ❌ **Reasoning hidden (default).**
   - **Steps:** Settings → Reasoning view = "Hidden", send a prompt.
   - **Expected:** no reasoning bubble appears.
   - **Why not automated:** depends on global setting + per-session
     override resolution + reducer behavior together.
Failed: when reasoning is hidden, the bottom menu of copy/fork is still
visible.

---

### `b015d68` feat(permissions): real Allow-for-session rule editor

1. ❌ **Each permission kind opens the right rule editor.**
   - **Steps:** trigger one of each via prompts that would invoke
     them — shell (`run \`ls\``), read (`cat package.json`), write
     (`create new file foo.txt`), mcp tool, url.
   - **Expected:** PendingRequestCard pops; "Allow for session"
     opens a kind-specific editor (commands → prefix list; read/write
     → path glob; mcp → server + tool; url → domain).
   - **Why not automated:** each path requires the CLI to emit that
     specific PermissionRequest variant, which means a real CLI
     subprocess + tool-call.
Shell: This "exact command" field shows empty.
Read/Write: Only asks if to allow all files to read or write.


2. ❌ **Rule survives the rest of the session.**
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

5. ❌ **Diagnostics bundle export → reveals folder.**
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

7. ❌ **CI Tier-2 (electrobun build) jobs run on PR.**
   - **Steps:** push a PR, observe the GitHub Actions matrix.
   - **Expected:** Ubuntu + macOS + Windows jobs run
     `electrobun build`; `continue-on-error: true` so they don't
     block.
   - **Why not automated:** the CI run itself is the test.
WTF? why are they failing?
---

### `a135432` feat(export): conversation export to Markdown / JSON

1. ⏳ **Markdown export opens in OS reveal.**
   - **Steps:** open a session with some events. Gear popover →
     "Export Markdown".
   - **Expected:** Toast confirms, OS file explorer opens at
     `<userData>/exports/<session-name>-<timestamp>.md`. File
     opens in your default Markdown viewer cleanly.
   - **Why not automated:** `revealPath` + native file association.

2. ❌ **Reasoning folds into `<details>` blocks.**
   - **Steps:** export a session that had reasoning bubbles.
   - **Expected:** `<details><summary>Reasoning</summary>…</details>`
     blocks per turn; opens correctly in GitHub markdown preview.
   - **Why not automated:** 15 unit tests assert the string output;
     verify cross-renderer rendering by eye.
Nope, opens parent folder instead of file.

3. ❌ **JSON export preserves the ChatItem shape end-to-end.**
   - **Steps:** export JSON; pipe through `jq` or open in an editor.
   - **Expected:** Each item has its `kind`, `id`, content, and
     attachment shape preserved.
   - **Why not automated:** unit tests cover the formatter; the
     export-then-readback round-trip needs human verification.
Nope, that's all that's exported:
     {
     "title": "Session 54a6367f",
     "workingDirectory": "C:\\Users\\mahle\\programming\\dafman\\build\\dev-win-x64\\dafman-dev\\bin",
     "model": null,
     "exportedAt": "2026-05-22T04:20:07.729Z",
     "items": []
     }

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

3. ❌ **JSONL files persist across restart.**
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

## How to use this list

Pick any ⏳ item, run it, then come back with one of:
- ✅ → I'll mark verified and date it.
- ❌ + repro → I file it back to the open backlog.
- N/A "I don't care about this case" → I'll remove (with a note in
  DEVLOG).

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

9.  ❌ **Picking a file inserts a pill with the real absolute path.**
   - **Steps:** pick a file. Inspect the bun log JSON for the next
     send.
   - **Expected:** `attachment.path` is the absolute fs path (e.g.
     `C:/repo/dafman/src/main.ts`), `attachment.type = "file"`.
   - **Why not automated:** SDK round-trip; need real log inspection.
     {"sessionId":"87707b46-ecd0-48cb-a555-ef78310714ca","attachmentCount":1,"kinds":["file"],"names":["../Resources/version.json"]}

10. ⏳ **Picking a directory carries `type: "directory"`.**
    - **Steps:** open picker, pick a folder (e.g. `src/`).
    - **Expected:** pill shows folder icon. Bun log shows
      `attachment.type = "directory"`.
    - **Why not automated:** same as #9.

---

### `@`-trigger flow

1. ⏳ **Typing `@` opens the picker; fuzzy text refines.**
   - **Steps:** focus composer. Type `@`. Then type `comp`.
   - **Expected:** popup appears above the composer immediately on
     `@`. Typing `comp` filters; `ChatWindow.vue` and similar
     should rank.
   - **Why not automated:** Lexical's TypeaheadMenuPlugin uses the
     real DOM selection model; happy-dom's selection support is
     incomplete and we can't reliably exercise the trigger from
     bun-test.

2. ⏳ **Arrow keys + Enter pick a file as a pill.**
   - **Steps:** with picker open, ArrowDown twice, Enter.
   - **Expected:** the `@query` text is replaced with an
     AttachmentNode pill carrying that file. Caret lands after a
     trailing space.
   - **Why not automated:** Lexical reconcile + pill DOM under real
     contenteditable.

3. ⏳ **Path-nav: `@/`, `@~/`, `@../`, `@C:/`.**
   - **Steps:** type `@~/D` (Windows: `@C:/Users/`), watch results.
   - **Expected:** entries from `$HOME` (or `C:/Users/`) starting
     with `D` (or every entry under `C:/Users/`) appear. `~/Doc`
     filters to e.g. `Documents` + `Downloads`.
   - **Why not automated:** depends on the actual filesystem state
     of your home dir.

4. ⏳ **Single-pick: select dismisses popup.**
   - **Steps:** open picker, pick something.
   - **Expected:** popup closes; subsequent typing stays in
     editor.
   - **Why not automated:** the dismissal is driven by the plugin's
     `closeMenu` callback + Lexical reconcile.

### Paperclip-button flow

5. ⏳ **Paperclip click opens the picker overlay.**
   - **Steps:** click the paperclip in the composer footer.
   - **Expected:** PrimeVue Popover anchored to the button shows
     the same FilePicker, but with its own search input focused.
   - **Why not automated:** PrimeVue Popover positioning + focus
     management is brittle in jsdom.

6. ⏳ **Browse… opens native OS dialog (files + dirs).**
   - **Steps:** click the paperclip → Browse… inside the popup.
   - **Expected:** native OS dialog appears. Picking either a file
     or a directory inserts the right pill (file icon or folder
     icon) at the caret. Cancel returns to the popup with no
     insertion.
   - **Why not automated:** Electrobun's `Utils.openFileDialog` is
     a native FFI call; Playwright can't drive an OS dialog.

7. ⏳ **Picker stays open after Browse… cancel.**
   - **Steps:** click Browse…, hit Cancel in the OS dialog.
   - **Expected:** popup remains visible, focused on the search
     input. No spurious empty pill.
   - **Why not automated:** same as #6.

### Toggle + edge cases

8. ⏳ **Show hidden toggle reveals dotfiles + `node_modules`.**
   - **Steps:** open the picker. Type `.env`. Empty list (or
     missing). Flip "Show hidden / ignored". Result appears.
   - **Expected:** dotfiles + IGNORED_DIRS members (node_modules,
     dist, target, …) now appear in results.
   - **Why not automated:** `fileSearch` unit-tests cover the
     filter logic, but the toggle wiring + cache-key behavior
     across re-toggling needs human verification.

9. ⏳ **Directory pill renders with folder icon + acts as folder
   attachment.**
   - **Steps:** pick a directory. Inspect the pill; submit the
     message.
   - **Expected:** pill shows `pi-folder`. SDK send carries
     `attachment.type = "directory"` (verify via DevLog or by
     checking the bun log JSON for the send).
   - **Why not automated:** SDK round-trip + DevLog inspection.

10. ⏳ **Large workspace stays snappy (subjective).**
    - **Steps:** open the picker in dafman itself (~thousands of
      files indexed). Type quickly.
    - **Expected:** results refresh as you type without visible
      lag. First open may take ~ms; subsequent opens cached.
    - **Why not automated:** subjective perf check.

---
