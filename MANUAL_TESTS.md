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
> 2. User dogfoods. Items get marked `✅` (verified) or `❌` (failing).
> 3. `❌` items get an issue filed (use `.github/ISSUE_TEMPLATE/bug_report.yml`,
>    label `manual-test-fail`) and the row is removed from this file
>    (the issue body cites the archive line for history).
> 4. When the section's last item is verified, the agent moves the
>    whole section into `MANUAL_TESTS_archive.md`.
>
> **Format per pending item:**
> - **Steps:** what to do.
> - **Expected:** what you should see.
> - **Why not automated:** the one-line reason.

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
walked by the user. After dogfooding, items move to ✅ (then to
[`MANUAL_TESTS_archive.md`](MANUAL_TESTS_archive.md) when the whole
section is verified) or get a GitHub issue filed (with label
`manual-test-fail`) and removed from this file.

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

- **7.1** ⏳ **Sign-in opens the system browser and completes OAuth end-to-end.**
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

- **7.2** ⏳ **The OAuth consent screen names the app "Dafman".**
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

- **18.1** ⏳ **All dockview chrome is light in light mode.**
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

- **18.2** ⏳ **Library Tools "Enable all" / "Disable all" and the composer mode
    select read with good contrast in light mode.**
  - **Steps:** in light mode, open Library → Tools (see the Enable all / Disable
    all buttons) and the composer toolbar's mode select.
  - **Expected:** the buttons and the mode select have clearly legible text
    against their background — no washed-out / "weak" low-contrast controls.
  - **Why not automated:** contrast-on-rendered-background is a visual judgement;
    the underlying tokens are invertible but the perceived weakness only shows
    against the real rendered chrome.
  - **Measured baseline (light mode, post-#18, via `bun run inspect`):** *Enable
    all* `#475569` on `#f1f5f9` ≈ 6:1 (good); *Disable all* (text variant) and
    the unselected composer mode select use `--p-text-muted-color` (slate-500
    `#64748b`) ≈ 4.5:1 — AA-passing but on the muted side. If these still read
    "weak" when dogfooding, file a follow-up to bump those muted controls to a
    higher-contrast token.

### Issue #19 — Instructions markdown respects theme tokens (2026-05-30)

- **19.1** ⏳ **Instruction file content inverts correctly in dark mode.**
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

- **19.2** ⏳ **Raw HTML inside an instruction file also themes correctly.**
  - **Steps:** in an instruction file, include a literal raw `<code>inline</code>`
    and/or `<a href="…">link</a>` (HTML, not markdown). Expand it; toggle theme.
  - **Expected:** the raw `<code>`/`<a>`/`<pre>` render with the same invertible
    token colors as the markdown-generated equivalents — legible in both themes.
  - **Why not automated:** same computed-color-cascade limitation as 19.1.

### Issue #17 — composer mode selector compact form on narrow panes (2026-05-30)

- **17.1** ⏳ **Mode selector swaps to a compact icon Select on narrow panes.**
  - **Steps:** open a session so the composer shows. Drag the chat pane (or window) from wide to narrow, watching the bottom-bar mode control on the left.
  - **Expected:** while wide, the 3-icon segmented control (Interactive / Plan / Autopilot) shows. Once the composer toolbar drops below ~620px, it swaps to a single icon-only dropdown showing the current mode's icon; opening it lists all three modes with icon + label. The bottom bar reflows smoothly the whole way — no overflow, clipping, or jump.
  - **Why not automated:** the swap is driven by a CSS `@container (max-width: 620px)` query; happy-dom has no layout so the query never matches in unit tests. Smoke boots the bundle but doesn't drive a session-active composer through a width sweep.

- **17.2** ⏳ **Compact Select changes mode and stays in sync.**
  - **Steps:** at narrow width, pick a different mode from the compact dropdown. Widen back out.
  - **Expected:** the selection persists, the wide segmented control reflects the same mode, and the per-mode accent color (blue / amber / purple) matches.
  - **Why not automated:** depends on the live container-query swap being active (see 17.1).

### Issue #10 — MCP "Remove" no longer jumps to Discovered (2026-05-30)

- **10.1** ⏳ **Removing a configured MCP server doesn't bounce to Discovered.**
  - **Steps:** Library → MCP. Add/configure an MCP server so it appears under
    the **Configured** section. Click its Remove (trash) action.
  - **Expected:** the server disappears from Configured and does **not**
    immediately re-appear under the **Discovered** section. (A server that's
    *also* defined in a workspace file may legitimately return after the next
    refresh — that's correct.)
  - **Why not automated:** the unit test covers the in-memory list sync; this
    item confirms the live render of the two sibling sections matches.

### Issue #9 — MCP discovered-toggle persistence (DOGFOOD-FIRST — 2026-05-30)

- **9.1** ⏳ **Disabled discovered MCP server stays disabled across restart.**
  - **Steps:** Library → MCP. Toggle OFF a server in the **Discovered**
    section. Fully quit the app. Relaunch. Open Library → MCP again.
  - **Expected:** the server is still toggled OFF.
  - **Why not automated:** persistence is enforced by the CLI's user-config
    disabled list (SDK `mcp.config.disable`), which only round-trips across a
    real process restart. Our code already routes through the persisted
    config-level disable (rpc.d.ts:3367) — this test confirms whether the
    original "doesn't persist" bug still reproduces. **If it does NOT repro,
    close #9. If it DOES, capture the exact repro (server source category +
    steps) on the issue so the runtime root cause can be found.**

### Issue #16 — Jobs "Go to session" scrolls to spawning tool call (2026-05-30)

- **16.1** ⏳ **Reveal scrolls to the spawning tool-call card (cross-session).**
  - **Steps:** in session A with a long transcript, spawn a background task (a tool call early in the history that runs in the background). Switch to session B. Open the Jobs panel and click "Go to session" (the up-right arrow) on A's job.
  - **Expected:** the app switches to session A and scrolls so the tool-call card that spawned the job is centered in view (not the top of the transcript), with a brief highlight flash on the card.
  - **Why not automated:** real `scrollIntoView` geometry + dockview panel-mount timing with a live spawned background task isn't reproducible in happy-dom/smoke; the unit test stubs `scrollIntoView` and asserts it's called on the matching node, but can't verify actual scroll position.

- **16.2** ⏳ **Freshly-opened panel still reveals (timing path).**
  - **Steps:** close session A's panel entirely (leave only B open). Spawn-and-track a job for A beforehand. From the Jobs panel click "Go to session" so A's panel opens fresh.
  - **Expected:** A opens AND scrolls to the spawning card — the reveal is not lost to the async panel mount.
  - **Why not automated:** the lost-intent race only manifests with the real dockview async mount; covered conceptually by the store-parked intent + onMounted consume, but needs the live panel lifecycle.

- **16.3** ⏳ **Autopilot job falls back to bottom.**
  - **Steps:** start an autopilot session (no spawning tool call → job has no `toolCallId`). From another session, click "Go to session" on that autopilot job.
  - **Expected:** switches to the session and scrolls to the bottom (latest work), no error.
  - **Why not automated:** depends on the autopilot session lifecycle + live scroll geometry.

### Issue #51 — Library tabs auto-refresh on session switch (2026-05-28)

- **51.1** ⏳ **Agents tab auto-refreshes.**
  - **Steps:** open two sessions A and B with different `workingDirectory` (one with project agents in `<cwd>/.github/agents/`, one without). Open Library → Agents while focused on A. Switch to B.
  - **Expected:** the project-agent section updates (becomes empty if B has no project agents). No need to click Refresh.
  - **Why not automated:** smoke stub can't simulate session-switch + IPC re-fetch flow without a full E2E harness; covered conceptually by the new `watch` but verification needs the live dockview event.

- **51.2** ⏳ **Skills tab auto-refreshes.**
  - **Steps:** as above with Library → Skills.
  - **Expected:** skill list updates when switching sessions whose `<cwd>/.github/skills/` differs.

- **51.3** ⏳ **MCP tab auto-refreshes.**
  - **Steps:** as above with Library → MCP. Drop an `.vscode/mcp.json` under one session's cwd, none under the other.
  - **Expected:** the Discovered section updates on switch.

- **51.4** ⏳ **No infinite loops / re-render storms.**
  - **Steps:** switch sessions rapidly (5+ times in a few seconds).
  - **Expected:** each switch triggers exactly one reload per tab; no console errors or visible spinner thrashing.

### Issue #22 — Library Agents refresh button (2026-05-28, second attempt)

- **22.1** ⏳ **Refresh button appears next to "New agent".**
  - **Steps:** open Library → Agents.
  - **Expected:** a `Refresh` button with `pi-refresh` icon sits in the
    tab header, to the left of `New agent`. Layout matches Library →
    Skills / MCP / Tools / Instructions which already have this affordance.
  - **Why not automated:** visual placement / responsive layout in the
    real dockview right rail isn't reliably assertable from the smoke stub.

- **22.2** ⏳ **External agent file appears after Refresh click.**
  - **Steps:** with the Agents tab open, drop a valid `.agent.md`
    file under `~/.copilot/agents/` (or `<cwd>/.github/agents/` with
    a session whose `workingDirectory` points there). Click `Refresh`.
  - **Expected:** the new agent appears in the list without switching tabs.
  - **Why not automated:** external filesystem mutation + real SDK
    listAgents call.

- **22.3** ⏳ **Rows still styled as cards (no E.8 regression).**
  - **Steps:** look at any agent row in the list.
  - **Expected:** bordered card with name + path stacked on the left,
    action buttons (Select/Edit/Reveal/Delete) on the right.
    Two-row CSS grid layout. NOT a plain HTML list.
  - **Why not automated:** vue-tsc + smoke don't catch scoped-CSS-doesn't-match-child-element issues; this is the regression class that ate 2 PRs already this session.

### Sprint D — Jobs spinner center (issue #15, 2026-05-28)

- **D15.1** ⏳ **Running job spinner rotates in place.**
  - **Steps:** run `bun run dev`, start a chat session, ask the agent to spawn a background task, then open the Jobs panel while the job is `starting` or `running`.
  - **Expected:** the spinner beside the active job rotates around its own center without orbiting an off-center point.
  - **Why not automated:** the bug is a visual glyph/transform-origin artifact in the live browser compositor; unit tests cannot reliably assert the perceived rotation pivot.

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

### Sprint A2 — Library Agents Edit button (2026-05-27)

- **A2.1** ⏳ **Edit opens form prefilled.**
  - **Steps:** click the pencil icon on any existing agent row.
  - **Expected:** form opens with title `Edit <name>`. Name and Scope
    are disabled. Other fields show the parsed values from the file.
  - **Why not automated:** form prefill + scope/name lock across all
    fields needs a full Vue mount + DOM read.

- **A2.2** ⏳ **Edit save persists known fields + preserves unknown frontmatter.**
  - **Steps:** create an agent file by hand at
    `~/.copilot/agents/foo.agent.md` with a `mcp-servers:` block in
    the frontmatter that we don't model. Click Edit on the row.
    Change the description. Click Save.
  - **Expected:** toast "Agent saved". File on disk: description
    updated, `mcp-servers:` block still present byte-for-byte.
  - **Why not automated:** filesystem round-trip + SDK reload chain.

- **A2.3** ⏳ **Preserved-keys hint shows when there are unknown frontmatter keys.**
  - **Steps:** open Edit on the file above (which has `mcp-servers:`).
  - **Expected:** blue info banner at the top of the form: "Unknown
    frontmatter keys preserved: edits won't strip `mcp-servers`,
    `github`, plugin keys, etc."

- **A2.4** ⏳ **Preserved-keys hint hidden when there's nothing to preserve.**
  - **Steps:** create an agent via `New agent`, save it. Then Edit.
  - **Expected:** no preserved-keys banner.

### Sprint A3 — `/agent <name>` selects (2026-05-27)

- **A3.1** ⏳ **`/agent reviewer` selects the agent.**
  - **Steps:** type `/agent reviewer` (with a real agent name) in
    composer → Enter.
  - **Expected:** header chip flips to `reviewer`; toast "Agent
    selected: Reviewer"; an in-stream system note appears under the
    last message.
  - **Why not automated:** SDK roundtrip + reactive header chip.

- **A3.2** ⏳ **`/agent unknown` warns + lists available.**
  - **Steps:** type `/agent unknown-name` → Enter.
  - **Expected:** warn toast "No agent named 'unknown-name'.
    Available: foo, bar, baz". Chip does NOT change.

- **A3.3** ⏳ **`/agent` with no argument opens Library.**
  - **Steps:** type `/agent` → Enter (or pick from slash menu).
  - **Expected:** right-edge Library panel opens to the Agents tab.

---

## How to use this list

Pick any ❌ item to fix or any ⏳ item to verify, then come back with
one of:
- ✅ → I'll mark verified and date it.
- ❌ + repro → I'll move it down to Failing.
- N/A "I don't care about this case" → I'll remove (with a note in
  the relevant commit message).
