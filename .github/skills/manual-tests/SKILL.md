---
name: manual-tests
description: >-
  Workflow for dogfooding the dafman manual-test checklist (MANUAL_TESTS.md) in
  the live app and turning findings into receipt-backed GitHub issues instead of
  vibes. TRIGGER when the user says "dogfood", "let's do manual tests", "run the
  manual checklist", "walk MANUAL_TESTS", "verify the pending tests", "let's test
  the app by hand", "go through pending verification", or asks to record manual
  pass/fail results. ENFORCES: update MANUAL_TESTS.md as you go (not a scratch
  table), root-cause every failure before filing (dafman bug vs invalid fixture
  vs SDK constraint — verify against node_modules SDK source), one issue per
  distinct finding with template + labels, structured ask_user forms (never
  free-form), and clean up throwaway fixtures. Half-walked, mis-attributed
  checklists are worse than none because they pollute the issue tracker.
---

# Manual tests / dogfooding (dafman)

`MANUAL_TESTS.md` `## ⏳ Pending verification` is the queue of checks that
`bun run check` can't confirm (visual rendering, OS dialogs, focus, keyboard
flows, real CLI/SDK side-effects, restart persistence). This skill walks that
queue with the user in a live `bun run dev` instance, records results inline,
and converts every miss into a tracked issue with a verified root cause.

The agent **drives**; the user is the hands+eyes. You cannot click in the live
electrobun app yourself — you present batched checks, the user reports, you
record + investigate + file.

## Hard rules (do not skip)

1. **Update `MANUAL_TESTS.md` AS YOU GO.** The moment a user reports a result,
   edit that item's `- [ ] result:` line to `- [x] result: v PASS …` or
   `- [ ] result: x FAIL …` with a one-line note + any issue number. A separate
   scratch table (SQL) is fine for *your* tracking, but it is NOT a substitute —
   the file is the source of truth and the user is watching it. (This rule
   exists because the user caught the skill author tracking only in SQL.)
2. **Root-cause every failure before filing.** A failed check has three possible
   owners: (a) a real dafman bug, (b) an invalid test fixture *you* built, or
   (c) a correct SDK/library constraint. Do NOT file a dafman bug until you've
   ruled out (b) and (c). Verify against `node_modules/@github/copilot*/…`
   source when the SDK is involved (AGENTS.md rule 4 — no unverified claims).
   Precedent: a "custom agent X not found" failure was an invalid `mcp-servers`
   block missing the SDK-required `tools` array, NOT a dafman select bug — but
   chasing it correctly surfaced two *real* gaps (#81, #82).
3. **One issue per distinct finding.** Use the templates in
   `.github/ISSUE_TEMPLATE/` (Bug = Steps/Expected/Actual/Sample/Env; Feature =
   Problem/Shape/Acceptance). Label every issue: kind (`bug`/`enhancement`),
   `area:*`, `prio:p0/p1/p2`, and `manual-test-fail` when a pending row failed.
   Cite code receipts (path:line) and SDK source in the body — the next agent
   must be able to re-verify without re-spelunking.
4. **Structured `ask_user` forms only.** Present each batch as an `ask_user`
   form with one enum field per check (`pass`/`fail`/`skip`) + a free-text
   `notes` field. Never ask for results in plain prose — it loses structure and
   the mapping to checklist ids.
5. **Distinguish the literal claim from the feature intent.** "Agent appears
   after Refresh" can PASS literally while the intent (it's *usable* after
   Refresh) FAILS. Record the literal result, then file the intent gap. Don't
   let a literal pass mask a broken feature.
6. **Verify with a fresh test, not a nearby proxy.** When you *think* you know
   the cause (e.g. "Refresh doesn't SDK-reload"), construct a clean isolated
   repro (drop one valid fixture, click Refresh, try select) before filing —
   confirm the exact mechanism, don't infer it from an adjacent failure.

## Setup (run once per session)

```pwsh
# 1. Boot the app detached (npm wrapper exits 0; the app stays running).
bun run dev    # mode=async, detach=true
Start-Sleep 12
Get-Process electrobun -ErrorAction SilentlyContinue   # expect ~2 procs = booted

# 2. Read the queue.
#    MANUAL_TESTS.md ## ⏳ Pending verification — each item: id, Steps,
#    Expected, Why-not-automated, and a `- [ ] result:` line to fill.
```

Optional scratch tracker (yours, not the source of truth):

```sql
CREATE TABLE dogfood (id TEXT PRIMARY KEY, batch TEXT, needs TEXT,
                      status TEXT DEFAULT 'pending', result TEXT);
```

## Workflow

1. **Read + batch the queue.** Group `⏳ Pending verification` items by setup
   cost so the user runs cheap checks first:
   - *zero-setup visual* (theme toggle, pane resize, card styling),
   - *low-setup* (needs one fixture you can author),
   - *multi-session* (two sessions, different cwds — auto-refresh tests),
   - *background-task* (Jobs / spinner — needs a long-running tool call),
   - *external infra* (real OAuth MCP server — usually defer).
2. **Author fixtures for setup-heavy checks** instead of asking the user to.
   Custom agents → `~/.copilot/agents/<name>.agent.md` (see SDK schema note
   below). MCP/skill fixtures similarly. A valid fixture is part of the test;
   an invalid one wastes a round-trip (rule 2).
3. **Present one batch** via an `ask_user` form (enum per check + notes).
4. **Record immediately** — edit each item's `result:` line in
   `MANUAL_TESTS.md` (rule 1) and your scratch tracker.
5. **Investigate every FAIL or "works but weird"** before moving on:
   - Read the relevant component/composable/service (code receipts).
   - If the SDK is implicated, read `node_modules/@github/copilot*/…` (the
     bundled `app.js` is minified ~12 MB — grep with a Node script that slices
     ±300 chars around the pattern; PowerShell `Select-String` truncates).
   - Tail the dev log for runtime errors the user can't see:
     `Get-ChildItem $env:LOCALAPPDATA\com.dafman.app\dev\dafman-*.log` →
     newest → grep for the feature / `error` / `warn` (filter the noisy
     recurring renderer warnings).
6. **File issues** for confirmed findings (rule 3). For a failed *pending* row,
   mark it `manual-test-fail` and remove the row from `MANUAL_TESTS.md` per the
   file's own header workflow (the issue body cites the archive line).
7. **Restart-dependent checks** (e.g. "survives an app restart", "discovered on
   fresh boot"): restart the app yourself —
   ```pwsh
   Get-Process electrobun,bun -ErrorAction SilentlyContinue |
     ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch {} }
   Start-Sleep 2
   bun run dev   # async, detach
   ```
   Only `Stop-Process -Id <pid>` is allowed (no name-based kills per env rules).
8. **Clean up throwaway fixtures** you created purely to test (e.g.
   `external-test.agent.md`); leave fixtures the user wants to keep.
9. **Close out a section.** When the last item in a `⏳ Pending verification`
   sub-section is verified, move the whole section into
   `MANUAL_TESTS_archive.md` (per the file header). Update `DEVLOG.md` (new top
   H2, lead with the takeaway, list issues filed) and `CHANGELOG.md` if any
   user-visible behavior was confirmed/changed. Commit (docs-only → may
   direct-push to `main`).

## dafman facts the checklist relies on

- **Launch:** `bun run dev` (the launcher wrapper exits 0 but the electrobun
  app persists detached — verify via `Get-Process electrobun`). Use
  `mode=async, detach=true`.
- **Dev log:** `$env:LOCALAPPDATA\com.dafman.app\dev\dafman-<date>.log`
  (JSON-lines). Backend `log.info/warn` lands here; the SDK does NOT emit agent
  *discovery* diagnostics here. A recurring `Failed setting prop "prefix" on
  <div>` renderer warning floods the log — filter it out.
- **Custom-agent fixtures:** `~/.copilot/agents/<name>.agent.md`, frontmatter
  per the SDK's `.agent.md` schema. `description` is **required**; `mcp-servers`
  http entries **require** a `tools` array; a modeled key with the wrong shape
  makes the SDK `safeParse` reject the whole file → the agent is silently
  dropped → "custom agent X not found". Unknown keys are stripped+warned, not
  fatal. (Stored memory: "SDK `.agent.md` frontmatter is validated by zod
  safeParse…".) dafman's own *form-created* agents are always valid — prefer the
  form path when you just need a working agent.
- **Issue templates/labels:** `.github/ISSUE_TEMPLATE/{bug_report,feature_request,tech_debt}.yml`;
  labels in AGENTS.md `## Workflow`. `gh issue create --template …` or
  `--body-file <md> --label "bug,area:library,prio:p2"`.

## When NOT to run a full dogfood

- The user asks about ONE check — just walk that one, don't boot the whole
  queue.
- `MANUAL_TESTS.md ## ⏳ Pending verification` is empty — nothing to dogfood;
  say so.
- The change under test is pure backend/unit-coverable — `bun run check` is the
  right gate, not a manual walk.

## When to escalate / ask

- A check needs infra you can't stand up (real OAuth MCP server, OS keyring,
  multi-window timing) — flag it, suggest deferring, and ask the user if they
  can provide the environment.
- A single failure implies a broad refactor (>5 files) — file the issue, but
  rubber-duck before proposing the fix in the same breath.

## References

- Queue + format: `MANUAL_TESTS.md` (header `## Pending verification` workflow).
- Archive: `MANUAL_TESTS_archive.md`.
- Issue workflow + labels: `AGENTS.md` `## Workflow — GitHub Issues + PRs`.
- Anti-laziness contract: `AGENTS.md` rules 1, 4, 4a, 10, 11, 13, 15.
- Diagnostic ladder for visual/CSS bugs: `AGENTS.md` `### bun run inspect`.
