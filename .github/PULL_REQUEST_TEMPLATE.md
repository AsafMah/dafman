<!--
Per AGENTS.md anti-laziness rules (§10–§22): a PR is not done until
the gate is green AND the docs are updated AND the change has been
dogfooded. This template is the checklist. Don't tick boxes you
haven't verified.
-->

## Summary

<!--
What does this PR change, and why? One-paragraph version of the commit
message body. Reference issues with `Fixes #123` or `Refs #123`.
-->

## Linked issue

<!-- Fixes #_______ or Refs #_______. PRs without a linked issue need a one-line justification here. -->

## Type of change

- [ ] feat — new functionality
- [ ] fix — bug fix
- [ ] refactor — code reshape without behavior change
- [ ] tech-debt — cleanup, build-vs-buy swap, file split
- [ ] docs — documentation only
- [ ] test — adds or improves tests
- [ ] chore — tooling / build / CI

## Anti-laziness gate (AGENTS.md §10–§22)

### Tests + lint
- [ ] `bun run check` is green locally (lint + lint:bun + lint:tsc-bun + lint:eslint + test + build + smoke + e2e)
- [ ] If touching renderer bundle / IPC / Lexical / dockview / prism: ran `bun run smoke` AND `bun run dev` (manual dogfood per rule 4a) — not just `bun run check`
- [ ] Added or updated tests for the code changed; failing-test-before-fix for bugs (rule 5)

### Docs
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` for user-visible changes
- [ ] `DEVLOG.md` has a new H2 entry for this session
- [ ] `STATUS.md` updated if this closes a milestone item or shifts direction
- [ ] `plans/*.prompt.md` updated if this affects an active plan
- [ ] `MANUAL_TESTS.md` "Pending verification" section updated if there's behavior the user has to dogfood

### Architecture / API
- [ ] No new `window.dispatchEvent` / `window.addEventListener('dafman:*')` (rule 18)
- [ ] No new direct `invokeCommand(` from `.vue` (rule: composables own IPC, not components)
- [ ] No file grew past 800 lines; if approaching, split first (rule 19)
- [ ] No raw `throw new Error(` in `src-bun/app/` RPC handlers — go through `rpcGuard`
- [ ] If hand-rolling infrastructure, build-vs-buy check done (rule 16)

### Review
- [ ] Ran the code-review subagent against this diff (`bun run pr:review` or manual)
- [ ] Findings addressed or noted in this PR description as deliberate

### Co-authorship
- [ ] `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer present on every commit (unless user opted out)

## Screenshots / GIFs

<!-- Required for UI changes. Before/after if applicable. -->

## Notes for reviewers

<!--
- Anything reviewers should know before reading the diff?
- Any deliberate deviations from the plan / spec?
- Any deferred follow-ups filed as new issues?
-->
