# Problems & Future Ideas

> Solved items are in the historical log below. Future ideas have been
> moved to `plans/plan-backlog-audit.prompt.md` § User-requested future ideas.

## Open

- The word "attachment" triggers an issue with the sql, we need to reword "see attachment"
- Sessions still don't get their title sometimes when they are resumed
- Groups feature attempted twice, both reverted:
  - v1 (~1900 lines): multiple DockviewVue instances — fundamentally broken
  - v2 (~380 lines): single dockview + layout swap — passed all automated tests but failed at runtime
  - Root cause: no automated tests cover real dockview layout restore/switch flows
  - Need real dockview integration tests before attempting again



## Solved (2026-05-22 sweep)

- [x] Command palette slash commands work (`/mcp`, `/model`, etc.)
- [x] Composer toolbar order: left (mode/allow/dir), center (upload+md), right (model/terminal/settings)
- [x] Markdown buttons use real Lexical editor formatting
- [x] Terminal works on Windows (Bun native PTY)
- [x] Slash commands local-only (no token waste); SDK commands forwarded only when distinct
- [x] Composer responsive via CSS container queries (no overlap)
- [x] Panel minimums enforced; Library tab rows styled
- [x] Slash popup scroll fixed; /model has icon and opens selector
- [x] View tool has per-tool detail components
- [x] Plan mode has interactive + autopilot + fleet buttons
- [x] View tool shows raw diff instead of file content — now strips diff header
- [x] Plan mode missing autopilot/fleet buttons — always shown now


Future Ideas:
Groups
  - Another level of grouping
  - Visual rather than logical
  - The idea is to have tabs on top, where each tab contains basically the window we have now - open panes, etc.
  - So you could go between multiple groups of panes, each with its own set of open panes, etc.
  - Groups can be named.
  - See if we can use the existing dockview for this, or do something else.
  - Also have a "groups" tab, that let's you easily manage groups - see their contents, drag and drop between them, easily close or open sessions and terminals, rename, etc.
Projects
  - Logical grouping of panes
  - Can share resources - skills, mcps, agents, files (via a shared workspace directory)
  - Each project can be comprised of multiple sessions and terminals
  - Probably need some implementation in the session level via a skill + settings + permissions
  - Projects panel to create and manage them, create project from group, open project as group, etc
