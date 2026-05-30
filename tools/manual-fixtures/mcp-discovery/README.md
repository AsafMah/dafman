# MCP discovery repro fixture (issue #9, part 1)

A throwaway workspace for dogfooding **discovered-MCP-server toggle persistence**
(GitHub issue [#9](https://github.com/AsafMah/dafman/issues/9), part 1).

## What's here

`.mcp.json` declares two discoverable stdio MCP servers (`fixture-memory`,
`fixture-everything`) launched via `npx` from the official
`@modelcontextprotocol/*` packages. They're real and connectable, but you don't
need them to connect for the toggle-persistence test — they only need to **appear
under Library → MCP → Discovered**.

## ⚠️ Use `.mcp.json`, not `.vscode/mcp.json`

The original #9 repro used `.vscode/mcp.json`, but **Copilot CLI removed
`.vscode/mcp.json` support** (bundled SDK string: *"Copilot CLI's incomplete
support for .vscode/mcp.json has been removed … migrate to .mcp.json"*). The
current SDK discovers `.mcp.json` and `.github/mcp.json` in the session's working
directory only — so a `.vscode/mcp.json`-based repro would show **no discovered
servers at all** and mislead the test. This fixture deliberately uses `.mcp.json`.

## How to dogfood (see `MANUAL_TESTS.md` §9.1 for the full checklist)

1. `bun run dev`.
2. Create a session whose **working directory is this folder**
   (`tools/manual-fixtures/mcp-discovery`).
3. Library → MCP → **Discovered** should list `fixture-memory` /
   `fixture-everything`.
4. Toggle one **off**, fully quit Dafman, relaunch, reopen a session in the same
   folder.
5. The toggle should still be **off** (it routes through the SDK's persisted
   disabled list via `mcp.config.disable`).
