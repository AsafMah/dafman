# Dafman
> A desktop replacement for the GitHub Copilot CLI built on [Electrobun](https://docs.electrobunny.ai/electrobun/) (Bun + native webview) with a Vue 3 renderer.

Dafman gives humans a real UI on top of the same engine the Copilot CLI uses: multiple panes, simultaneous projects, visible reasoning and tool calls, settings, automations, MCP integrations, and an editor for diffs and files. Conversations and configuration persist across restarts.

> Status: **early development**. M0 (multi-pane streaming chat) is live. The roadmap toward a CLI-replacement is tracked in [`plans/plan-roadmap.prompt.md`](plans/plan-roadmap.prompt.md).

## Features (today)
- Multi-session chat panes in a responsive grid.
- Streaming token deltas via the GitHub Copilot SDK (`copilot-sdk-supercharged`).
- Per-session accent color derived from creation order.
- Light & dark mode via PrimeVue theme tokens.

## Planned (M1–M7)
See [`plans/`](plans/) for the full design system.

## Status & progress
Live progress board: [STATUS.md](STATUS.md). Plans live in [plans/](plans/).

## Stack
- **Shell:** Electrobun 1.18 (Windows / macOS / Linux), native webview, system Bun runtime.
- **Main process:** TypeScript + [`copilot-sdk-supercharged`](https://github.com/jeremiahjordanisaacson/copilot-sdk-supercharged).
- **Renderer:** Vue 3 + Vite + TypeScript + [PrimeVue](https://primevue.org) (Aura).
- **State:** Pinia.
- **Tests:** `bun test` (one runner for backend + frontend; Vue SFCs via `tools/bun-vue-loader.ts`).

## Getting started

### Prerequisites
- [Bun](https://bun.sh) 1.3+ (handles the package manager, runtime, and test runner).
- A GitHub Copilot subscription, or BYOK credentials for a supported provider. The Copilot CLI is bundled by the Node.js SDK — no separate install required.

### Install dependencies
```bash
bun install
```

### Common commands
| Want to… | Run |
|---|---|
| run everything (lint + tests + build) | `bun run check` |
| run all tests | `bun test` |
| lint (vue-tsc -b) | `bun run lint` |
| start the app in dev | `bun run dev` |
| dev with frontend HMR | `bun run dev:hmr` |
| build a release bundle | `bun run build` |

### Run in development
```bash
bun run dev
```

### Build a release bundle
```bash
bun run build
```

## Project layout
```
src/                # Vue 3 + TypeScript renderer
src-bun/            # Bun main process (RPC handlers, SDK glue, settings, logging)
tools/              # Bun plugins (e.g. the Vue SFC test loader)
plans/              # Design documents (the source of truth for direction)
electrobun.config.ts
bunfig.toml
```

## Contributing
Contributions are very welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) and the design docs in [`plans/`](plans/). Please read the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Security
To report a vulnerability, follow [`SECURITY.md`](SECURITY.md). Do not open public issues for security problems.

## License
[MIT](LICENSE) © 2026 Dafman contributors.
