# Problems & Future Ideas

> Solved items are in the historical log below. Future ideas have been
> moved to `plans/plan-backlog-audit.prompt.md` § User-requested future ideas.

## Open

(No open items.)

## Solved (2026-05-26 sweep — round 2)

- [x] Left tab bar runtime exclusivity sometimes needed two clicks — made obsolete by removing the exclusivity model entirely. v2 layout uses dockview's native vertical tab strip on both edges; tabs are independent first-class panels with native drag/click/collapse behavior. See DEVLOG 2026-05-26 (later).

## Solved (2026-05-26 sweep)

- [x] Multiple left sidebars open at startup — `ActivityBar.activate()`
  enforces "at most one of {Sessions, Terminals, Library, Jobs, Logs,
  Settings} open" at runtime, but `dock.fromJSON(layout)` in
  `layoutStore.restore()` bypassed that path entirely; any persisted
  snapshot with 2+ activity-bar panels stacked on the left edge would
  restore all of them. Added `enforceActivityBarExclusivity()` that
  sweeps the dock after every restore: keeps the currently-active one
  (or the first by canonical order if none are active) and removes
  the rest. Regression test in
  `src/stores/shell/__tests__/layoutStore.activityBarExclusivity.test.ts`.

- [x] `"see attachment"` triggered an SQL safety filter — `AttachmentNode.getTextContent()`
  was emitting `(see attachment "<name>")` as the prompt-side reference
  for inline pills. The upstream Copilot CLI uses a different shape
  for pasted-file slugs: `[<emoji> <name>]` (literals in
  `node_modules/@github/copilot/app.js` at `function sWa` + the
  `rWa` emoji table + `m2r="📷"` constant). Switched our slug to
  match the CLI verbatim — `[📷 screenshot.png]`, `[📄 notes.txt]`,
  `[💻 sample.ts]`, etc. — so the model resolves attachment refs
  via the same payload it already understands and the literal
  "see attachment" phrase no longer trips the SQL filter.

- [x] Sessions don't get their title sometimes when they are resumed —
  `resume()` was making TWO calls to `getSessionMetadata`: one for the
  cwd (line 294) and a second one via `pollTitleFromMetadata` (line
  370) AFTER history replay finished. The title was set late at best,
  not at all if `meta.summary` flipped between the two reads. Fixed
  by capturing both `meta.context.workingDirectory` AND `meta.summary`
  off the early read and emitting `session.title_changed` immediately
  after the entry is registered (before replay). The post-resume
  poll stays as a safety net for sessions that genuinely had no
  summary at metadata-read time.
- [x] The "modes" button no longer shrinks to a select - it's just
  gone. — The `@container (max-width: 620px)` rule in
  `MessageComposer.vue` hid `.mode-button-group` and was supposed to
  swap in a `.mode-select-shell` fallback, but the fallback was never
  rendered (the class doesn't exist anywhere in the codebase). The
  3-icon SelectButton is ~90 px wide; fits without the swap. Removed
  the hide rule.
- [x] Remove the thing that a session automatically opens its settings
  — `layoutStore.addPanel` auto-opened the session-details right-rail
  on every chat-panel add (Phase 18a behavior). Removed the
  auto-open; the rail is still openable on demand via the
  activity-bar toggle / `toggleSessionDetailsPanel`.

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
