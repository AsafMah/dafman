# Dafman
> A desktop replacement for the GitHub Copilot CLI built on Tauri (Rust + Vue 3).
Dafman keeps the speed and resource profile of a native Rust process while giving humans a real UI: multiple panes, simultaneous projects, visible reasoning and tool calls, settings, automations, MCP integrations, and an editor for diffs and files. Conversations and configuration persist across restarts.
> Status: **early development**. M0 (multi-pane streaming chat) is live. The roadmap toward a CLI-replacement is tracked in [`plans/plan-roadmap.prompt.md`](plans/plan-roadmap.prompt.md).
## Features (today)
- Multi-session chat panes in a responsive grid.
- Streaming token deltas via the GitHub Copilot SDK (Supercharged distribution).
- Per-session accent color derived from the session id.
- Light & dark mode via PrimeVue theme tokens.
## Planned (M1–M7)
See [`plans/`](plans/) for the full design system:
- `plan-overview.prompt.md` — vision, principles, decisions register.
- `plan-architecture.prompt.md` — backend & frontend module layout, IPC contract.
- `plan-roadmap.prompt.md` — milestones M0–M7.
- `plan-messagingAndUx.prompt.md` — chat UX, reasoning, tools, inline elicitation.
- `plan-toolsAndPermissions.prompt.md` — built-in tools, permission model, MCP.
- `plan-platformFeatures.prompt.md` — projects, accounts, skills, agents, automations.
- `plan-sdkAndExternalSurfaces.prompt.md` — Supercharged SDK pinning, URL/browser surface, MCP OAuth.
- `plan-testingStrategy.prompt.md` — test pyramid, E2E, CI matrix.
## Status & progress

Live progress board: [STATUS.md](STATUS.md). Plans live in [plans/](plans/).

## Stack
- **Shell:** Tauri 2 (Windows / macOS / Linux)
- **Backend:** Rust + tokio + [`github-copilot-sdk`](https://github.com/github/copilot-sdk) (Supercharged distribution)
- **Frontend:** Vue 3 + Vite + TypeScript + [PrimeVue](https://primevue.org) (Aura)
- **State:** Pinia (from M1)
- **Tests:** `cargo test`, Vitest, Playwright
## Getting started
### Prerequisites
- Rust (stable) — install via [rustup](https://rustup.rs).
- Node.js 20+ and npm (or pnpm/bun).
- The Copilot CLI on your PATH (or set `COPILOT_CLI_PATH`). See the [SDK README](https://github.com/github/copilot-sdk/tree/main/rust) for binary install. Future releases will embed the CLI.
- A GitHub Copilot subscription (or BYOK credentials for a supported provider).
### Install dependencies
```bash
npm install
```
### Common commands

| Want to… | Run |
|---|---|
| run everything (lint + tests + build) | `npm run check` |
| run frontend tests (vitest) | `npm test` |
| run backend tests (cargo) | `npm run test:rust` |
| run both test suites | `npm run test:all` |
| lint everything | `npm run lint` |
| auto-format Rust | `npm run fmt:rust` |
| start the app in dev | `npm run tauri dev` |
| build a release bundle | `npm run tauri build` |

### Run in development
```bash
npm run tauri dev
```
### Build a release bundle
```bash
npm run tauri build
```
## Project layout
```
src/                # Vue 3 + TypeScript frontend
src-tauri/          # Rust backend (Tauri commands, SDK glue)
plans/              # Design documents (the source of truth for direction)
public/             # Static assets served by Vite
```
## Contributing
Contributions are very welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) and the design docs in [`plans/`](plans/). Please read the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
## Security
To report a vulnerability, follow [`SECURITY.md`](SECURITY.md). Do not open public issues for security problems.
## License
[MIT](LICENSE) © 2026 Dafman contributors.
