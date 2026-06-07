# Library as Source of Truth for Per-Session Config

**Status:** Direction DECIDED (2026-06-07) — full Library-merge model (OQ1 → B). Sections below from "Design" onward are the original analysis; the decision block supersedes the spec's earlier "keep a thin rail" recommendation.

---

## Summary

Today's `SessionDetailsPanel.vue` and `LibraryPanel.vue` manage overlapping configuration domains independently: Library owns global definitions (MCP configs, skill discovery, tool defaults, agent files) while the session rail duplicates the same entities with per-session toggles, creating two independent UIs for the same conceptual objects. This spec proposes making Library the **single definition surface** — global existence, discovery, and lifecycle — while per-session config becomes a pure **scoping layer** on top: which globally-defined items are active for this session, and what session-local overrides apply.

## Direction — DECIDED (2026-06-07)

User decision: **everything is configured through Library; the session details panel displays none of it.** This selects the spec's Alternative A / OQ1 **Option B (full merge)** over the originally-recommended "keep a thinned rail" — the analysis in §Design / §Open Questions / §Alternatives below is retained as background, but the resolutions here are authoritative.

**Model:**

1. **Library is the single surface** for MCP servers, skills, tools, and agents (definition + global default + per-session scoping all in one place).
2. **Each Library entity row gains a per-session control** alongside its existing global toggle. Concretely, **inline two-column** per row: a **"Default"** column (global, existing behavior — applies to all new sessions) and a **"This session"** column (the per-session override for the focused session: inherit / on / off). The two columns make "differs from global" self-evident, replacing the originally-proposed badge (resolves OQ2).
3. **The session details panel drops the MCP / skills / tools / agents sections entirely** and instead points to Library ("Configure in Library →"). It keeps only the genuinely session-only items: name, run mode, reasoning visibility, workspace (read-only), auto-approve, background tasks, files touched, plan, usage/quota, fork/export/compact.
4. **Active-agent selection also moves into Library** (Agents tab gets a per-session "use in this session" control), since under "everything through Library" the rail owns none of it. Source the list from `listAgentFiles(sessionId)` + `reloadAgents` to sync the SDK registry (resolves OQ7).

**Resolved OQs:** OQ1 → **B** (merge into Library, remove rail sections). OQ2 → two-column design (no separate badge). OQ3 → keep tool overrides with "restart required" caveat. OQ4 → per-session override **persistence is out of scope; tracked in #198** (overrides remain ephemeral as today). OQ5 → #12 stays independent (becomes Library-internal). OQ6 → per-session column follows `lastFocusedSessionId`; **disabled/hidden when no session is focused** (Library stays fully usable for global config). OQ7 → agent list from `listAgentFiles`.

**Open sub-decision (defaulted):** inline-two-column vs. a dedicated "This session" sub-pane inside Library. **Default: inline two-column** (matches "just add an extra toggle"); revisit only if rows get too dense.

**Revised phasing under this model:**

1. **Shared data layer + #7 fix** — per-domain reactive stores both surfaces read from; `reloadSessionMcpServers` after `addMcpConfig`. (Unchanged from original Phase 1; still the prerequisite, ship first.)
2. **Library per-session column** — add the "This session" override column to MCP / Skills / Tools tabs, wired to the existing `setSessionMcpEnabled` / `setSessionSkillEnabled` / tool-tristate RPCs, scoped to `lastFocusedSessionId`.
3. **Agent selection into Library** — Agents tab gains the per-session "use in this session" control sourced from `listAgentFiles`.
4. **Remove rail sections** — delete MCP / skills / tools / agent sections from `SessionDetailsPanel.vue`; add the "Configure in Library →" pointer; rail shrinks past the original ~⅓ estimate (agents removed too).
5. **Follow-up:** per-session override persistence — tracked in **#198**.

---

## Motivation

### What's missing today

1. **Duplication.** Users configure an MCP server in Library → MCP, then must also visit the session rail to enable it for the active session. The same server name appears in two places with separate toggle semantics.

2. **Conceptual mismatch.** Library tab toggles set _global defaults_; session rail toggles set _per-session runtime state_. Nothing communicates this boundary to the user; they look identical.

3. **Stale-data coupling.** The session rail reloads its skill/tool/MCP lists independently of the Library tab. They can diverge after a config change (e.g. adding a new MCP server in Library does not appear in the session rail until the rail manually refreshes — the root cause of the #7 sign-in bug).

4. **Scalability.** `SessionDetailsPanel.vue` is 2253 lines. Adding new Library-owned entity types (instructions, agent files) would only make it longer, even though the session rail has no business owning their definitions.

5. **Missing agent-Library integration.** Agents are discovered globally in `LibraryAgentsTab.vue`, but the per-session select/deselect UX lives only in the session rail. There is no Library-visible feedback about which session is using which agent.

---

## Current State

### Per-session config today

| Section            | SessionDetailsPanel symbol                                        | RPC(s)                                                                           | Storage                                                                                   |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Session name       | `onRenameSubmit` (`SessionDetailsPanel.vue:155-164`)              | `setSessionName` (`rpc.ts:802`)                                                  | CLI-side session metadata                                                                 |
| Run mode           | `modeChoice` (`SessionDetailsPanel.vue:167-175`)                  | `setSessionMode` (`rpc.ts:794`)                                                  | CLI-side session state, re-applied on resume (`rpc.ts:770`)                               |
| Reasoning override | `reasoningChoice` (`SessionDetailsPanel.vue:184-197`)             | (frontend-only override on `SessionRecord`)                                      | Pinia, not persisted                                                                      |
| Workspace          | display-only (`SessionDetailsPanel.vue:199-210`)                  | `setSessionWorkingDirectory` (`rpc.ts:806`)                                      | CLI-side                                                                                  |
| Auto-approve all   | `approveAll` (`SessionDetailsPanel.vue:213-219`)                  | `setSessionApproveAll` (`rpc.ts:836`)                                            | dafman-persisted per session, re-applied on resume (`rpc.ts:770`)                         |
| Agents             | `useSessionAgents` (`details/useSessionAgents.ts`)                | `listAgents`, `selectAgent`, `deselectAgent` (`rpc.ts:866-884`)                  | Session-scoped SDK agent registry                                                         |
| Skills             | `useSessionSkills` (`details/useSessionSkills.ts:18-85`)          | `listSessionSkills`, `setSessionSkillEnabled` (`rpc.ts:848-862`)                 | Per-session SDK disabled-skill overlay                                                    |
| Tools              | `useSessionTools` (`details/useSessionTools.ts:32-192`)           | `listBuiltinTools`, `setSessionMcpEnabled` (`rpc.ts:963-989`) + `settings.tools` | Global `settings.tools.{defaultExcluded,defaultAllowed}` — applied at session create only |
| MCP servers        | `useSessionTools.mcpServers` (`details/useSessionTools.ts:59-75`) | `listSessionMcpServers`, `setSessionMcpEnabled` (`rpc.ts:975-989`)               | Per-session SDK MCP runtime enable/disable                                                |
| Plan               | `useSessionPlan` (`details/useSessionPlan.ts`)                    | (not yet in rpc.ts — CLI-side file)                                              | Session-local plan file                                                                   |
| Usage / Quota      | `useSessionUsage`                                                 | `getSessionUsageMetrics`, `getAccountQuota` (`rpc.ts:955,1001`)                  | Read-only from SDK                                                                        |

### Global/Library today

| Tab          | Component                    | What it manages                                                               | RPC(s)                                                                                                                                |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| MCP          | `LibraryMcpTab.vue`          | Configured + discovered server definitions, global enable/disable             | `listMcpConfigs`, `addMcpConfig`, `updateMcpConfig`, `removeMcpConfig`, `enableMcpServers`, `disableMcpServers`, `discoverMcpServers` |
| Skills       | `LibrarySkillsTab.vue`       | Discovery across workspace/user dirs, global disabled-set                     | `discoverSkills`, `setGloballyDisabledSkills`                                                                                         |
| Tools        | `LibraryToolsTab.vue`        | Default-excluded/default-allowed tool list                                    | `updateSettings` (mutates `settings.tools`)                                                                                           |
| Agents       | `LibraryAgentsTab.vue`       | Filesystem agent CRUD (`listAgentFiles`, `writeAgentFile`, `deleteAgentFile`) | `listAgentFiles`, `writeAgentFile`, `deleteAgentFile`, `listAgentFilesGlobal`                                                         |
| Instructions | `LibraryInstructionsTab.vue` | Read-only project/user instruction discovery                                  | `listInstructions`                                                                                                                    |

### The global/session boundary today

**Fully split (correct model, partially broken UX):**

- **MCP:** `McpRegistry` (`src-bun/app/library/mcpRegistry.ts`) speaks to the singleton CLI client (`client.rpc.mcp.config.*`). Session runtime enable/disable is `session.rpc.mcp.list` / `setSessionMcpEnabled`. Library owns definitions; session owns runtime state. This is the right model but the UX doesn't communicate it — and adding a new server does not reload the session runtime (root cause of #7 `"MCP server does not exist"` bug at `src/composables/library/useMcpLibrary.ts:229-242`).

**Partially split (leaky):**

- **Skills:** `SkillsRegistry.setGloballyDisabled()` (`src-bun/app/library/skillsRegistry.ts:74-80`) writes the global disabled-skill list. But the session rail's `setSessionSkillEnabled` (`useSessionSkills.ts:40-54`) calls `invokeCommand('setSessionSkillEnabled', ...)` — a _session-scoped_ path. The Library tab and session rail thus write to different scopes of the same entity, with no indication to the user which toggle overrides which.

**Not split (global only, session-create-time only):**

- **Tools:** `settings.tools.defaultExcluded/defaultAllowed` is written by Library → Tools tab (`LibraryToolsTab.vue:68-99`) and applied at session create only. The session rail comment explicitly says `"Per-tool restriction applies to NEW sessions only"` (`SessionDetailsPanel.vue:952-956`). There is no live per-session tool override mechanism; the session rail shows stale creation-time state.

**Session-only (no global concept):**

- **Name, mode, reasoning override, workspace, auto-approve, plan, usage/quota** — these are inherently per-session; no global definition exists or is needed.

**Session-owned but globally defined:**

- **Agents:** files exist globally (`LibraryAgentsTab`), but "current agent for session" is pure session state. The gap: the session rail does not "select from Library"; it discovers agents independently via `listAgents(sessionId)` (a session-scoped SDK call). Library Agents tab cannot show which sessions are using which agent.

---

## Design

### 1. What "source of truth" means concretely

Library = **definition surface**: the set of configured entities, their properties, and their _global defaults_. A global default is the behavior for a freshly-created session with no overrides.

Per-session config = **scoping layer**: for each Library entity, a session records one of three states:

- `inherit` — use the global default (implicit, no per-session record needed)
- `enabled` — explicitly activated for this session, even if globally disabled
- `disabled` — explicitly deactivated for this session, even if globally enabled

For skills and MCP, this maps naturally to the existing `setSessionSkillEnabled` / `setSessionMcpEnabled` RPCs. For tools, the existing session tristate (`default` / `only-allow` / `forbidden`) is already the override model; the global default is the `settings.tools.defaultExcluded` set.

**Nothing changes about where data is stored at the SDK layer.** This is a UX and conceptual reorganization, not a new persistence scheme.

### 2. Effective config composition

For any session `S` and entity `E`:

```
effective(S, E) =
  per_session_override(S, E)          // if present
  ?? global_default(E)                // Library-global setting
  ?? sdk_builtin_default(E)           // SDK discovers automatically
```

- **MCP servers:** global default = Library enable/disable toggle. Per-session override = `setSessionMcpEnabled`. A server disabled globally but explicitly enabled for session S is available in S.
- **Skills:** global default = `SkillsRegistry.setGloballyDisabled`. Per-session override = `setSessionSkillEnabled`. Same model.
- **Tools:** global default = `settings.tools.{defaultExcluded, defaultAllowed}`. Per-session override = tool tristate state. Tooling already supports this; the UX just needs to expose it as "override of global default."
- **Agents:** global definition = filesystem agent files. Per-session = `selectAgent(sessionId, name)`. There is no "global default agent"; a session starts with no current agent unless one is selected.

### 3. Migration path by section

#### 3a. MCP servers

**Target:** Library MCP tab becomes the _only_ place to define, configure, and globally enable/disable servers. The session rail shows a lightweight **per-session override list**: servers whose session-local state differs from their global state.

| What                                    | Where after                                 | Change                                                                                                          |
| --------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Configured server list, add/edit/remove | Library → MCP only                          | No change to Library; remove redundant session-rail "MCP servers" section (`SessionDetailsPanel.vue:1037-1088`) |
| Global enable/disable toggle            | Library → MCP (`LibraryMcpTab.vue:56-63`)   | No change; already correct                                                                                      |
| Per-session enable/disable override     | Session config panel (thin view)            | Keep only when a session has at least one server with state differing from global default                       |
| Sign-in                                 | Library → MCP (`LibraryMcpTab.vue:113-129`) | Already there; fix: session reload after `addMcpConfig` (see #7)                                                |

**Immediate fix needed** (pre-full-migration, tracked in #7): after `addMcpConfig` call `reloadSessionMcpServers(sessionId)` so the live session runtime knows about the new server before sign-in.

#### 3b. Skills

**Target:** Library → Skills is the primary enable/disable surface. Session rail shows only per-session overrides (skills whose session-local state differs from global).

| What                                    | Where after                      | Change                                                                                       |
| --------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| Skill discovery + global enable/disable | Library → Skills only            | No change; already correct                                                                   |
| Per-session override toggle             | Session config panel (thin view) | Re-model: show only skills with a non-inherit session override; add "reset to global" action |
| "Manage globally →" link                | Session rail → Library           | Already exists (`useSessionSkills.ts:56-68`); keep                                           |

**Data model clarification needed** (see §Open Questions #2): `setSessionSkillEnabled` and `setGloballyDisabledSkills` write to different SDK scopes (`session.rpc.skills.setSkillEnabled` vs `client.rpc.skills.config.setDisabledSkills`). The current UI does not distinguish them.

#### 3c. Tools

**Target:** Library → Tools sets the global default. Session rail shows per-session overrides (tools whose tristate state is not `default`). The "applies to new sessions only" restriction is a current SDK constraint, not a design goal; if the SDK gains live tool mutation, the session rail override should become live too.

| What                                      | Where after                      | Change                                                                 |
| ----------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| Global default-excluded / default-allowed | Library → Tools only             | No change                                                              |
| Per-session tristate override             | Session config panel (thin view) | Keep; show only tools with non-`default` state; add "reset all" action |
| Allowlist-active warning banner           | Session config panel             | Keep; mirrors global state for this session                            |

#### 3d. Agents

**Target:** Library → Agents is the file management surface (create, edit, delete, view path). Session rail shows current-agent selection, browsing the Library's discovered list.

| What                              | Where after                | Change                                                                                                                               |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Agent file list (filesystem CRUD) | Library → Agents only      | No change                                                                                                                            |
| Current agent selection           | Session config panel       | Keep `select`/`deselect` buttons; but source the agent list from the Library's data, not an independent `listAgents(sessionId)` call |
| Reload trigger                    | Library → Agents (Refresh) | `reloadAgents(sessionId)` promoted to Library-level action                                                                           |

The key shift: session rail does not maintain an independent agent list; it reads from a shared Library-level computed list (potentially derived from `listAgentFiles` + `listAgentFilesGlobal`) and passes only the selection state.

#### 3e. Session-only settings (unchanged placement)

These sections stay in the session rail and have no Library equivalent:

| Section                               | Reason                                      |
| ------------------------------------- | ------------------------------------------- |
| Session name                          | Unique per session by definition            |
| Run mode (interactive/plan/autopilot) | Per-session runtime state                   |
| Reasoning visibility override         | Per-session display preference              |
| Workspace (cwd)                       | Per-session path; read-only display in rail |
| Auto-approve all                      | Per-session permission shortcut             |
| Background tasks                      | Runtime-only, no global concept             |
| Files touched                         | Derived from session events                 |
| Plan                                  | Session-local markdown artifact             |
| Usage / Quota                         | Read-only metrics, no config                |
| Fork / Export / Compact               | Session lifecycle actions                   |

#### 3f. Instructions

Instructions (`LibraryInstructionsTab.vue`) are already read-only project/user discovery with no per-session interaction. No change.

### 4. Session Details Panel fate

Two options (see §Open Questions #1). Recommended: **keep it, thin it out into a per-session scoping view**.

After migration, the session rail contains:

1. **Session settings** (name, mode, reasoning, workspace, approve-all) — unchanged
2. **Active agent** (select/deselect from Library's list) — simplified; no independent list management
3. **Per-session overrides** (MCP, skills, tools) — only entries that differ from global defaults; empty-state hint links to Library for global config
4. **Background tasks** — unchanged
5. **Files touched** — unchanged
6. **Plan** — unchanged
7. **Usage / Quota** — unchanged
8. **Fork / Export / Compact** — unchanged

The sections eliminated from the session rail:

- Full MCP server list (definition-level, moved to Library only)
- Full skills list (global enable/disable, moved to Library only)
- Full tools list (global defaults, moved to Library only)

The rail shrinks from ~2253 lines to roughly one-third that size.

### 5. Global-vs-session boundary table

| Config item                              | Global only             | Session only                             | Overridable (global default + per-session override) |
| ---------------------------------------- | ----------------------- | ---------------------------------------- | --------------------------------------------------- |
| MCP server definitions (add/edit/remove) | ✓                       |                                          |                                                     |
| MCP server global enable/disable         | ✓                       |                                          |                                                     |
| MCP server per-session runtime enable    |                         |                                          | ✓                                                   |
| MCP server sign-in                       |                         | ✓ (OAuth runs via active session)        |                                                     |
| Skill discovery                          | ✓                       |                                          |                                                     |
| Skill global enable/disable              | ✓                       |                                          |                                                     |
| Skill per-session enable/disable         |                         |                                          | ✓                                                   |
| Tool global default excluded/allowed     | ✓                       |                                          |                                                     |
| Tool per-session tristate override       |                         |                                          | ✓                                                   |
| Agent file CRUD (create/edit/delete)     | ✓                       |                                          |                                                     |
| Agent global availability                | ✓ (file presence)       |                                          |                                                     |
| Current agent selection                  |                         | ✓                                        |                                                     |
| Instructions discovery                   | ✓                       |                                          |                                                     |
| Session name                             |                         | ✓                                        |                                                     |
| Run mode                                 |                         | ✓                                        |                                                     |
| Reasoning visibility                     |                         | ✓ (overrides global Settings appearance) |                                                     |
| Workspace (cwd)                          |                         | ✓                                        |                                                     |
| Auto-approve all                         | ✓ (default in Settings) | ✓ (per-session toggle)                   |                                                     |
| Plan                                     |                         | ✓                                        |                                                     |
| Usage / Quota                            |                         | ✓ (read-only)                            |                                                     |

### 6. Per-session override persistence

**Current mechanisms (no change proposed):**

- MCP: `setSessionMcpEnabled` → `session.rpc.mcp.enable/disable` (session-scoped SDK, not persisted by dafman; lost on session close + reopen)
- Skills: `setSessionSkillEnabled` → `session.rpc.skills.setSkillEnabled` (same: SDK session-scoped)
- Tools: `settings.tools.defaultExcluded` at create time; per-session tristate held only in frontend `SessionRecord` (lost on reload)

**Implication:** today's per-session overrides are _ephemeral_ (session-lifetime or frontend-lifetime only). This is a pre-existing constraint, not introduced by this design. A future persistence story (`src-bun/app/config/` adding a per-session overlay file keyed by `sessionId`) is out of scope here but should be tracked as a follow-up.

---

## Open Questions

1. **Keep session rail or remove it?**
   - Option A (recommended): Keep `SessionDetailsPanel.vue` as a thinned-out per-session scoping view. The right-edge panel is useful real estate for per-session context while the active session is focused. Remove only the global-definition sections.
   - Option B: Remove the session rail entirely; embed per-session override controls inline in the Library tab (e.g. a "Session overrides" secondary pane or column). Risk: Library panel is already left-edge; combining global + per-session config in one surface increases cognitive load.
   - Option C: Remove the session rail; promote per-session config into the session tab header (similar to `SessionHeaderControls.vue`). Risky for complex controls (tasks, plan, usage).
   - **Default: Option A.**

2. **How are skill overrides modeled? Global vs session scope disambiguation.**  
   `LibrarySkillsTab` calls `setGloballyDisabledSkills` (server-scoped, bulk replace). The session rail calls `setSessionSkillEnabled` (session-scoped, single toggle). These write to different SDK primitives. Today the user sees two identical-looking toggles with no indication of scope. After this design, only the Library tab would show the global toggle; the session rail would show only skills that have an active per-session override.  
   **Decision needed:** when the user session-disables a skill that is globally enabled, should the session rail show a "differs from global" badge? Recommended: yes, with a "reset to global default" action per row.

3. **Tool overrides — live mutation vs create-time only.**  
   `settings.tools.defaultExcluded` is applied only at `createSession` time (the SDK does not support runtime tool mutation). The session rail currently shows a warning: _"Per-tool restriction applies to NEW sessions only."_ After the migration, the Library → Tools tab owns global defaults and the session rail shows per-session tristate — but if the SDK still has no live mutation path, the session-rail tool overrides are also create-time-only (or require a session restart). This should be called out in the UI.  
   **Decision needed:** should the session rail tool overrides section be hidden until the SDK supports live mutation, or kept with the "restart required" caveat? Recommended: keep with caveat; it is still useful to see what a session was created with.

4. **Backward compatibility for existing per-session overrides.**  
   Existing sessions have per-session skill/MCP overrides stored in the live SDK session state. They are not persisted by dafman (see §6). On page reload or session resume the overrides are lost — this is already true today.  
   The Library-as-SoT migration does not make this worse; it is pre-existing. No migration of existing data is required.  
   **Decision needed:** should this spec include a §Future tracking ticket for per-session override persistence? Recommended: yes; file a follow-up issue.

5. **Does this subsume issue #12 (unify MCP/agent creator UX)?**  
   Issue #12 asks to unify `McpServerForm` (modal) and the agent creator (inline) into a single shape, with inline preferred. This design does not block #12 and is independent of it. However, if the session rail loses its full MCP and agent list sections (Option A), #12 becomes purely a Library-internal question: which shape to use for add/edit forms within Library tabs. Recommended: leave #12 independent; implement this design first (since #12 can be done inside Library tab regardless of session rail state). Cross-reference in #12.

6. **Library session context — which session does the Library scoping view use?**  
   `LibraryMcpTab.vue` already reads `lastFocusedSessionId` / `activeSessionId` (`useMcpLibrary.ts:90-101`) to determine which session's live MCP status to surface. The per-session override pane in the session rail already has the session ID from `layoutStore.activeSessionId` (`SessionDetailsPanel.vue:46`). No ambiguity for the session rail. For the Library panel (left edge), if a "per-session overrides" column or sub-view is added inside Library, it must use `lastFocusedSessionId` as the context — same as the current MCP tab pattern. This is already established.

7. **Agent list source after migration.**  
   Today the session rail calls `listAgents(sessionId)` (SDK-level agent registry for the session). Library Agents tab calls `listAgentFiles(sessionId)` (filesystem). These can diverge: the SDK may load agents the filesystem didn't reload yet (or vice versa).  
   **Decision needed:** which source does the session-rail "select agent" picker use after migration? Recommended: use `listAgentFiles(sessionId)` (same as Library) to guarantee a single source, and call `reloadAgents(sessionId)` when needed to sync the SDK registry. This unifies the two currently divergent lists.

---

## Alternatives

### A. Full merge: Library becomes a session-aware split-pane

Library tab gets a left pane (global) and right pane (per-session overrides for focused session). Session rail is removed entirely.

- **Pro:** single surface for all config; no "which pane do I go to" question.
- **Con:** Left-edge panel already feels crowded with 5 tabs. Mixing global definitions and per-session state in the same panel makes the panel context-dependent (changes as you switch sessions). Breaks the current mental model of Library = stable/global.
- **Verdict:** Do not recommend. Too disruptive to current UX patterns.

### B. Session rail becomes a session-scoped Library view (same component, different props)

`LibraryPanel.vue` gains a `sessionId` prop; when mounted in the session rail position it renders per-session toggles; when mounted in the sidebar it renders global toggles.

- **Pro:** code reuse across global and per-session surfaces.
- **Con:** The two modes have very different data requirements, action semantics, and visual density. Conditional-rendering inside a "smart" panel becomes a maintenance burden. The existing `LibraryPanel` and `SessionDetailsPanel` have different layout roles (sidebar vs right-edge rail); unifying them risks forcing shared CSS and layout assumptions.
- **Verdict:** Not recommended. The session rail should remain its own thin component reading from Library stores/composables, not a forked rendering mode of LibraryPanel.

### C. Status quo — improve data sharing but keep both panels independent

Add a shared Pinia store (`libraryStore` or per-domain stores) so Library tabs and the session rail read from the same reactive cache. Session rail keeps its current sections but stops re-fetching data independently.

- **Pro:** lowest risk; no UX redesign.
- **Con:** does not fix the conceptual duplication or the "two places to configure the same thing" UX problem. The original motivation of this issue is unaddressed.
- **Verdict:** This is a prerequisite step (the shared store), not an alternative. Implement it regardless (it fixes #7's reload issue); the full redesign follows.

---

## Implementation Phases

### Phase 1 — Shared data layer (no UX change)

- Extract per-domain reactive stores (`mcpStore`, `skillsStore`, `toolsStore`) that Library tabs and session rail composables both subscribe to.
- After any Library mutation (add/edit/remove/toggle), invalidate/re-fetch the relevant session-scoped view automatically.
- Fix #7: after `addMcpConfig`, call `reloadSessionMcpServers(sessionId)` for the active session before sign-in is available.

### Phase 2 — Session rail thinning

- Remove the full MCP server list from the session rail. Keep only per-session override rows (servers whose session-local state ≠ global state). If empty: show hint "MCP servers configured globally in Library."
- Remove the full skills list from the session rail. Keep only per-session override rows. Same empty-state hint.
- Remove the full tools list from the session rail. Keep only tools with non-`default` tristate. Same hint.
- Add per-row "reset to global default" actions in the override view.

### Phase 3 — Agent list unification

- Session rail "Agents" section reads from `listAgentFiles(sessionId)` (same as Library Agents tab) instead of SDK `listAgents`.
- Add a shared `agentsStore` computed from the filesystem source; both Library tab and session rail subscribe.
- Remove the independent `reloadAgents` from the session rail; it becomes a Library-tab action.

### Phase 4 — Library global/session UX refinement

- Library → MCP tab: add per-row "currently active in session" indicator when `serverStatus` = `connected` for the focused session.
- Library → Skills tab: add per-row "overridden in session" badge when the focused session has a per-session override for that skill.
- Library → Tools tab: label the tool list as "Global defaults (session overrides in session panel)."

### Phase 5 — Session rail cleanup

- Shrink `SessionDetailsPanel.vue` to its remaining sections: session settings, active agent selector, per-session overrides (thin), tasks, files, plan, usage/quota, actions.
- Extract residual composables to `src/composables/session/` (mirror Library's `src/composables/library/` pattern).

---

## References

- `src/components/session/SessionDetailsPanel.vue` — current 2253-line right-rail implementation
- `src/components/session/details/useSessionTools.ts` — tool list + MCP enable/disable composable
- `src/components/session/details/useSessionSkills.ts` — skill list + toggle composable
- `src/components/library/LibraryPanel.vue` — Library panel, 5-tab host
- `src/components/library/LibraryMcpTab.vue` — global MCP CRUD surface
- `src/components/library/LibrarySkillsTab.vue` — global skill enable/disable
- `src/components/library/LibraryToolsTab.vue` — global tool default-excluded/allowed
- `src/components/library/LibraryAgentsTab.vue` — filesystem agent management
- `src/composables/library/useMcpLibrary.ts` — MCP composable, `getLibrarySession()` pattern (`:90-101`)
- `src-bun/app/library/mcpRegistry.ts` — server-scoped MCP config CRUD
- `src-bun/app/library/skillsRegistry.ts` — server-scoped skills global disabled-set
- `src-bun/rpc.ts` — full RPC contract; per-session config RPCs at `:746-989`
- `ARCHITECTURE.md §4` — component map, `SessionDetailsPanel` entry (`:239`); `SessionRecord is the runtime source of truth` (`:262`)
- Issue #7 — MCP global config vs session runtime split; root cause of sign-in bug; `useMcpLibrary.ts:229-242`
- Issue #12 — Unify MCP/agent creator UX (independent, but scoped to Library tabs after this migration)
- Issue #28 — this spec's source issue
- `plans/specs/session-pane.md` — Sessions Manager grouping/sort; related session-level view spec
- `plans/specs/backend-abstraction-acp.md` — ACP backend; relevant if per-session config persistence is added in Phase 5+
