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
