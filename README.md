# Dafman

> A desktop UI for the GitHub Copilot CLI — built on
> [Electrobun](https://docs.electrobunny.ai/electrobun/) (Bun + native webview)
> with a Vue 3 renderer. One language end-to-end, no Electron.

Dafman gives you a real interface on top of the same engine the Copilot CLI
uses: streaming chat across multiple sessions side by side, visible reasoning
and tool calls, real permission gates with allow-for-session rules, file/image
attachments inline in the composer, dark mode, command palette, and resume
across restarts.

> **Status:** active development. M1 (make-it-solid) is largely done; M2
> (messaging power-ups) is most of the way there. The next big milestones are
> Projects + multi-account (M4), MCP UI (M5), and Automations (M6). Live
> progress: [`STATUS.md`](STATUS.md). Direction: [`plans/`](plans/).

---

## What's in it today

**Chat surface**
- Streaming token deltas via `@github/copilot` SDK.
- Visible reasoning blocks (compact / expanded / hidden), with proper
  handling of opaque encrypted reasoning (Anthropic + GPT-5.x).
- Inline tool-call cards: per-tool summary line, args + result blocks with
  syntax highlighting, status state machine (running → success / error).
- Markdown rendering with syntax-highlighted code fences, KaTeX math,
  footnotes, definition lists, emoji, task lists, and a constrained safe
  HTML subset (DOMPurify allowlist).
- Optional lazy-loaded [mermaid](https://mermaid.js.org) diagram rendering.
- Composer: Lexical-backed with markdown shortcuts, slash commands, `@file`
  mentions with workspace search, drag/drop + paste attachments rendering
  as inline pills (file / image / dir / selection — with type icons), three
  send modes (steer / queue / interrupt) via `Ctrl+Enter` / `Ctrl+Shift+Enter`
  / `Alt+Enter`.
- Message actions: copy, retry, quote, edit-and-resend, fork to new session.

**Layout**
- [dockview-vue](https://dockview.dev) body: every session is a panel, every
  sidebar (Sessions Manager, Settings, …) is an edge group. Drag, split,
  resize, persist across restarts.
- Sessions Manager edge panel: lists every CLI-side session grouped by
  workspace, with resume / delete.
- Session-aware status: tab dots for unseen turns or pending input,
  OS-native notifications on background panels.

**Permissions**
- Real `onPermissionRequest` / `onUserInputRequest` / `onElicitationRequest`
  modal (not the deny-by-default shim). FIFO queue per session.
- **Allow for session** with a real rule editor — pick `git status`-style
  command prefixes, blanket read/write, this-MCP-tool vs all-tools-from-server,
  or auto-extract the URL domain. Honours the SDK's
  `PermissionDecisionApproveForSessionApproval` union.
- URL-mode elicitation with safe scheme allowlist; auto-approves OAuth happy
  paths (`https://github.com/login/*`, `https://*.githubcopilot.com/*`,
  `http://localhost:*`).
- Per-session auto-approve toggle (gear popover).

**Sessions**
- Multi-pane with per-session accent color.
- Per-session model + reasoning effort picker; per-session run mode
  (interactive / plan / autopilot).
- Workspace MRU with native folder picker.
- Skills list in the gear popover (enable/disable per session).
- Usage metrics: requests, premium cost, last in/out tokens.
- Compact history / reset approvals / rename inline.

**Shell**
- Command palette (`Cmd/Ctrl+K`) with fuzzy search across registered
  commands, models, sessions, and slash actions.
- Boot splash with phase reporting.
- Light + dark mode via PrimeVue tokens (theme-aware dockview chrome,
  message bubbles, code blocks).
- Brand favicon + activity bar mark.
- Toasts that respect quiet hours; click-to-dismiss; deduped.

---

## Tech stack

| Layer        | Choice |
|--------------|--------|
| Shell        | [Electrobun](https://docs.electrobunny.ai/electrobun/) 1.18 (Windows / macOS / Linux), native webview |
| Main process | TypeScript + Bun + [`@github/copilot`](https://github.com/github/copilot-sdk) |
| Renderer     | Vue 3 + Vite + TypeScript |
| UI kit       | [PrimeVue](https://primevue.org) (Aura preset) + PrimeIcons |
| Layout       | [dockview-vue](https://dockview.dev) |
| State        | [Pinia](https://pinia.vuejs.org) |
| Composer     | [Lexical](https://lexical.dev) + custom decorator nodes |
| Markdown     | markdown-it + Prism + DOMPurify + KaTeX |
| Code blocks  | CodeMirror 6 |
| Tests        | `bun test` (one runner for backend, renderer, and Vue SFCs via `tools/bun-vue-loader.ts`) + Playwright smoke |

The Copilot CLI binary is bundled with the SDK; no separate install.

---

## Getting started

### Prerequisites
- [Bun](https://bun.sh) **1.3+** — package manager, runtime, and test runner.
- A GitHub Copilot subscription (or BYOK credentials for a supported provider).

### Install
```bash
bun install
```

### Common commands
| Want to… | Run |
|---|---|
| Full gate (lint + tests + build + smoke) | `bun run check` |
| All tests | `bun test` |
| Watch tests | `bun test --watch` |
| Coverage | `bun test --coverage` |
| Lint (vue-tsc) | `bun run lint` |
| Start the app | `bun run dev` |
| Start with frontend HMR | `bun run dev:hmr` |
| Build a release bundle | `bun run build` |
| Renderer smoke (Playwright) | `bun run smoke` |

`bun run check` is the gate before any push. It runs lint, the full test
suite, the Vite build, the Electrobun build, and the Playwright smoke
against both the prod and HMR bundles.

---

## Project layout

```
ARCHITECTURE.md     ← live architecture snapshot (read this first)
AGENTS.md           ← agent contract: conventions, anti-laziness rules
STATUS.md           ← live progress board
DEVLOG.md           ← append-only running log
CHANGELOG.md        ← release notes
plans/              ← design documents (future direction; M0–M7 roadmap)
src/                ← Vue 3 renderer
src-bun/            ← Bun main process (RPC handlers, SDK glue, settings)
tools/              ← Bun plugins (Vue SFC test loader, dist prep)
e2e/                ← Playwright renderer smoke tests
public/             ← static assets (favicon, brand mark)
electrobun.config.ts
bunfig.toml
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full module map, lifecycle
invariants, and SDK gotchas.

---

## Contributing

Contributions are very welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md)
and skim [`ARCHITECTURE.md`](ARCHITECTURE.md) + the relevant
[`plans/`](plans/) doc before diving in. The agent contract in
[`AGENTS.md`](AGENTS.md) lists the hard rules — those apply to humans too.

For security issues: [`SECURITY.md`](SECURITY.md). **Do not open public
issues for security vulnerabilities.**

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) covers community expectations.

---

## License

[MIT](LICENSE) © 2026 Dafman contributors.
