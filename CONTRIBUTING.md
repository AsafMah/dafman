# Contributing to Dafman

Thanks for considering a contribution! Dafman is a desktop UI for the
GitHub Copilot CLI, built on [Electrobun](https://docs.electrobunny.ai/)
(Bun + native webview) with a Vue 3 renderer. **One language end-to-end
— TypeScript + Bun only.** No Electron, no Rust, no Tauri (the repo's
earliest commits did target Tauri; ignore any stale references you
find).

## For AI coding agents

If you're an AI coding agent (Copilot CLI, Codex, Claude, Cursor, Aider,
Gemini CLI, etc.) working on this repo, **read
[`AGENTS.md`](AGENTS.md) first** — it is the canonical, agent-focused
contract per the [agents.md](https://agents.md/) standard. The
anti-laziness rules (§10–§22) are binding.

## Code of Conduct

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Where to start

- **Open work:** `gh issue list` or the
  [issues page](https://github.com/AsafMah/dafman/issues). Triage by
  milestone (`Sprint B/C/D/E` for the bug-sprint queue, `M1 — Features`
  for the post-sprint backlog) or by `good-first-task` label.
- **What ships today:** [`plans/DONE.md`](plans/DONE.md).
- **Pre-migration backlog:** [`plans/TODO_archive.md`](plans/TODO_archive.md)
  (frozen — do not add new rows).
- **Architecture:** [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **Manual-test backlog:** [`MANUAL_TESTS.md`](MANUAL_TESTS.md)
  (pending-verification checklists awaiting dogfood).

## Filing issues

Use the templates in `.github/ISSUE_TEMPLATE/`:

- **Bug report** — Steps / Expected / Actual / Concrete sample. Per
  AGENTS.md rule 15, paste the literal broken output (ANSI text, JSON
  payload, agent file shape) so it can be lifted into a test fixture
  verbatim.
- **Feature request** — Problem / Proposed shape / Acceptance items.
  Per AGENTS.md rule 9, answer the spec-interview questions
  (scope / defaults / shortcuts / edge states / replaced vs extended)
  before opening.
- **Tech debt** — Current / Target / Build-vs-buy check / Verification.
  Per AGENTS.md rule 16, exhaust dependencies (package.json,
  `@vueuse/core`, PrimeVue, npm) before proposing hand-rolled code.

For **security**: do NOT open a public issue. Use a
[GitHub Security Advisory](https://github.com/AsafMah/dafman/security/advisories/new).
For **open-ended questions**: use Discussions.

## Development setup

```pwsh
git clone https://github.com/AsafMah/dafman.git
cd dafman
bun install
bun run dev          # or `bun run dev:hmr` for frontend HMR
```

## Build / test / lint

| Want to… | Run |
|---|---|
| Full gate (matches CI) | `bun run check` |
| Unit tests | `bun test` |
| Watch tests | `bun test --watch` |
| Coverage | `bun test --coverage` |
| Lint (vue-tsc) | `bun run lint` |
| Lint (ESLint) | `bun run lint:eslint` |
| Lint (backend tsc) | `bun run lint:tsc-bun` |
| Smoke (Playwright) | `bun run smoke` |
| Full E2E | `bun run e2e:run` |

`bun run check` runs all of the above in CI-compatible order:
`lint → lint:bun → lint:tsc-bun → lint:eslint → test → build →
smoke:run`. Push only when it's green.

## Branching & commits

- **Branch from `main`** with `<sprint-or-type>/<short-slug>`:
  - `sprint-b/mcp-oauth-login`
  - `fix/jobs-spinner-center`
  - `refactor/extract-agent-section`
  - `docs/contributing-refresh`
- **Conventional Commits** for messages and PR titles:
  - `feat(chat): ...`, `fix(mcp): ...`, `refactor(library): ...`,
    `docs: ...`, `test: ...`, `chore(ci): ...`
- Keep commits focused; squash on merge (auto via GitHub).
- Every commit should include the
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
  trailer unless the contributor opted out.

## Pull requests

PR is **required** for changes to `src/` or `src-bun/` (CI gates merge).
Direct push to `main` is allowed for docs-only or CI-only changes.

- **Fill out the PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) —
  the anti-laziness checklist IS the gate. Don't tick what you
  haven't verified.
- **Link the issue:** `Fixes #N` (auto-close on merge) or `Refs #N`.
- **Run the code-review subagent** against your diff before requesting
  merge: `bun run pr:review` (helper script, or invoke the
  `code-review` agent manually).
- **CI required checks:** `lint`, `test`, `smoke`, `e2e`,
  `build-matrix (ubuntu-latest)`.
- **Auto-merge:** label your PR `automerge` to have it squash-merge
  itself once required checks pass (primarily for Dependabot patches).

## Code style

- **TypeScript:** strict mode. `vue-tsc --noEmit` must pass.
  See `eslint.config.js` for rule set; complexity capped at 15
  (per rule 20 — don't bump the cap, refactor the function).
- **Vue:** components are dumb; data + actions live in composables /
  Pinia stores. SFCs use `<script setup lang="ts">`.
- **CSS:** prefer PrimeVue tokens (`var(--p-*)`); avoid hardcoded hex
  except for per-session accents in `src/lib/color.ts`.
- **IPC:** never call `electrobun.rpc.request` directly in components;
  always go through `src/ipc/invoke.ts` with typed `CommandMap`.
- **Backend (`src-bun/`):** domain modules under `src-bun/app/` MUST
  NOT import from `electrobun/bun`. Only `src-bun/index.ts` touches
  BrowserWindow / BrowserView. RPC handlers wrap with `rpcGuard`
  from `src-bun/app/errors.ts` — never raw `throw new Error`.
- **Logs:** structured via `log.info("msg", { key: val })` from
  `src-bun/app/logging.ts`.

## Architecture conventions

- See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the live module map +
  lifecycle invariants + SDK gotchas.
- Renderer stores call IPC; components don't.
- Every IPC handler returns either a result or `AppErrorPayload`
  (discriminated union from `rpcGuard`).
- Every event payload has a typed mirror on the renderer in
  `src/ipc/types.ts`. The `CommandMap` is the wire contract.

## Optional: enable GitHub Copilot Code Review

GitHub now offers native Copilot Code Review on PRs (separate from the
`code-review` subagent). To enable on the repo:

1. Repo Settings → Code & automation → Copilot → Code review.
2. Toggle "Automatic code review by Copilot" → On.

This complements the `code-review` subagent: native runs on the PR at
GitHub time, the subagent runs locally before push.

## Questions

Open a [GitHub Discussion](https://github.com/AsafMah/dafman/discussions)
or an issue with the `question` label.
