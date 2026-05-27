# Groups & Projects — Design Plan

## Overview

Two complementary features that add workspace organization to Dafman:

1. **Groups** — Visual workspace switching (like browser tab groups).
   A row of tabs above the dockview area. Each group contains its own
   full dockview layout (chat panels, terminals, sidebars). Switching
   groups swaps the entire pane arrangement instantly.

2. **Projects** — Logical resource grouping. A project ties together a
   workspace directory + shared settings (MCP servers, skills, agents,
   tool allowlist, model defaults). Sessions created within a project
   inherit its configuration. Projects can be promoted from groups and
   vice versa.

---

## Part 1: Groups

### Concept
- A **group** is a named dockview layout snapshot.
- The app maintains an ordered list of groups.
- Only one group is active at a time — its dockview JSON is loaded.
- Switching groups saves the current layout, loads the target.
- Groups persist across restarts (saved in settings).

### UI
- **Tab strip** above the dockview area (between activity bar top and
  the dock). Full-width, horizontally scrollable if many groups.
- Each tab: group name + close (×) + optional badge (session count).
- Right-click menu: Rename, Close, Move left/right, Convert to project.
- `+` button at the end creates a new group (opens empty dockview).
- Drag-and-drop to reorder.
- **Groups panel** in the activity bar (below Terminals): tree view of
  all groups → sessions + terminals inside each. Drag between groups.

### Data model
```typescript
interface GroupState {
  id: string;            // uuid
  name: string;          // user-editable
  dockviewJson: unknown; // persisted dockview layout blob
  projectId?: string;    // link to project (if promoted)
}
```
Settings gains: `groups: GroupState[]`, `activeGroupId: string`.

### Implementation plan
1. **GroupStore** (`src/stores/groupStore.ts`):
   - `groups: GroupState[]`, `activeGroupId`, `activeGroup` computed.
   - `createGroup(name?)`, `removeGroup(id)`, `switchGroup(id)`,
     `renameGroup(id, name)`, `reorderGroup(id, newIndex)`.
   - `switchGroup`: serialize current dockview → store in
     `activeGroup.dockviewJson`, then load target group's JSON via
     `api.fromJSON()`.
   - Settings migration (v11 → v12): extract current `layout.dockview`
     into a default "Main" group.

2. **GroupTabStrip** (`src/components/GroupTabStrip.vue`):
   - Rendered in `App.vue` between `.app-body` and the dockview div.
   - Tab bar with drag handles, close buttons, rename on double-click.
   - `+` button.

3. **GroupsPanel** (`src/components/GroupsPanel.vue`):
   - Activity bar entry (below Terminals).
   - Tree: Group name → list of session titles + terminal titles.
   - Actions: rename, delete, drag sessions between groups.

4. **Layout store changes**:
   - `saveLayout()` writes to `activeGroup.dockviewJson` instead of
     `settings.layout.dockview`.
   - `restoreFromLayout()` reads from `activeGroup.dockviewJson`.
   - Session resume on group switch: suspend (disconnect) sessions in
     the old group, resume sessions in the new group.

### Open questions for user
- Should closing the last group create a new empty one (like browser tabs)?
- Should groups have independent activity bar state (e.g. Sessions
  panel open in group A, Settings open in group B)?
- Should keyboard shortcut Ctrl+1-9 switch groups?

---

## Part 2: Projects

### Concept
- A **project** is a logical container: workspace directory + config
  overlay + a set of sessions/terminals.
- Projects are auto-detected from workspace directories (any directory
  containing `AGENTS.md`, `.github/copilot-instructions.md`, or
  `.mcp.json` qualifies as a project root).
- Projects can also be explicitly created via a dialog.
- A project's config overlay controls: MCP servers, skills, agents,
  tool allowlist, model defaults, instructions — shared across all
  sessions in the project.

### Data model
```typescript
interface ProjectConfig {
  id: string;
  name: string;
  workspaceDirectory: string;
  // Config overlay — when set, overrides global settings for sessions
  // in this project:
  mcpServers?: Record<string, McpConfig>;
  skills?: { disabled: string[] };
  agents?: { default?: string };
  tools?: {
    defaultAllowed: string[];
    defaultExcluded: string[];
  };
  modelDefaults?: {
    modelId?: string;
    reasoningEffort?: string;
  };
  instructions?: string;   // project-level system message prepend
}
```
Settings gains: `projects: ProjectConfig[]`.

### UI
- **Projects panel** in the activity bar (replaces or sits next to
  Sessions Manager):
  - List of projects with workspace path + session count.
  - Create from group, create from folder, open project as group.
  - Per-project settings editor (inline accordion or sub-panel).
- **Project badge** on session tabs — small colored dot or prefix
  showing which project a session belongs to.
- **"New session in project"** — create session with project config
  pre-applied (workspace, MCP overlay, skills, etc.).

### Implementation plan
1. **ProjectStore** (`src/stores/projectStore.ts`):
   - CRUD: `createProject`, `updateProject`, `deleteProject`.
   - `projectForSession(sessionId)` — lookup by workspace directory.
   - `applyProjectConfig(sessionId)` — set workspace, MCP overlay,
     tools, skills on a new session.

2. **Session integration**:
   - `SessionRecord` gains optional `projectId: string`.
   - On session create, if the workspace matches a project, auto-link.
   - SDK session config (`SessionConfig`) inherits project overlay:
     `availableTools`, `excludedTools`, `skills.disabled`.

3. **ProjectPanel** (`src/components/ProjectPanel.vue`):
   - Activity bar entry.
   - Project list → click to open project as group.
   - "New project" dialog with folder picker + name.
   - Per-project config editor (MCP, skills, tools, model defaults).

4. **Group ↔ Project bridge**:
   - `convertGroupToProject(groupId)` — creates a project from the
     sessions in a group; the group becomes the project's "active
     view".
   - `openProjectAsGroup(projectId)` — creates a new group pre-
     populated with the project's sessions.

### Open questions for user
- Should projects have their own settings file in the workspace (e.g.
  `.dafman/project.json`) or only live in Dafman's settings?
- Should project config changes apply retroactively to existing
  sessions, or only to new sessions?
- Should there be a concept of "project templates" (e.g. "Python
  project" with specific MCP servers and tools)?

---

## Priority & phasing

### Phase 1: Groups foundation (~2 sessions)
- GroupStore + settings migration
- GroupTabStrip component
- Layout save/restore per group
- Session suspend/resume on group switch

### Phase 2: Groups polish (~1 session)
- GroupsPanel in activity bar (tree view, drag between groups)
- Rename, reorder, keyboard shortcuts
- Badge with session count

### Phase 3: Projects foundation (~2 sessions)
- ProjectStore + settings schema
- Project auto-detection from workspace
- Session-project linking
- SDK config overlay (MCP, tools, skills)

### Phase 4: Projects UI (~1 session)
- ProjectPanel in activity bar
- New project dialog
- Per-project config editor
- Group ↔ Project conversion

### Phase 5: Integration polish (~1 session)
- Project badge on tabs
- "New session in project" flow
- Project templates (if user wants)
- E2E tests
