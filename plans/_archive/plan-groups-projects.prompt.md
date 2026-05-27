# Plan: Groups & Projects

> **Status:** Design interview pending user input. Defaults chosen below
> based on the user's description in `problems.md`. Adjust after the
> interview responses arrive.

## Definitions

**Groups** — Visual workspaces. Each group is a full dockview layout with
its own set of open panes (sessions, terminals, sidebars). The user switches
between groups via a top-level tab bar. Think of it like browser tab groups
or VS Code multi-root workspace windows, but within one app window.

**Projects** — Logical configuration bundles. A project groups related
sessions and terminals under shared resources: workspace directory, MCP
servers, skills, agents, and settings. A project can be "opened as a group"
for convenience.

## Design decisions (defaults pending interview)

| Decision | Default | Rationale |
|---|---|---|
| Group switching | Top tabs | User said "tabs on top" |
| Group persistence | Full layout per group | User wants to go between groups |
| Default group | One "Main" group | Less jarring for new users |
| Project scope | Workspace + MCP + skills + agents | User mentioned "shared resources" |
| Project storage | `.dafman/` in project dir | Shareable across team members |
| Group↔Project link | Independent | User described them as separate concepts |

## Architecture

### Groups

**Core idea:** An outer tab bar above the existing dockview instance. Each
tab represents a "group" (workspace). Switching tabs swaps the dockview
layout by calling `api.fromJSON(savedLayout)` and `api.toJSON()` to save
the current one.

```
┌──────────────────────────────────────────────────┐
│ [Main] [Research] [Side project]   [+]           │  ← Group tabs
├──────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────────────────────┐ ┌───────────┐ │
│ │ Rail │ │ Dockview body        │ │ Details    │ │  ← Current layout
│ │      │ │ (sessions/terminals) │ │ rail       │ │
│ └──────┘ └──────────────────────┘ └───────────┘ │
└──────────────────────────────────────────────────┘
```

**Implementation:**

1. **`groupStore.ts`** — Pinia store managing groups:
   - `groups: GroupRecord[]` — id, name, layoutJson, createdAt
   - `activeGroupId: string`
   - `switchGroup(id)` — save current layout, load target layout
   - `createGroup(name)` — new empty group
   - `deleteGroup(id)` — confirm, remove, switch to another
   - `renameGroup(id, name)`
   - Persisted in `settings.json` under `groups` key

2. **`GroupTabBar.vue`** — Thin tab strip above the dockview:
   - Renders group tabs (name + close button)
   - Plus button to create new group
   - Right-click for rename/delete context menu
   - Drag to reorder
   - Ctrl+1/2/3… to switch groups

3. **`GroupsManagerPanel.vue`** — Activity bar panel:
   - List all groups with their contents (sessions, terminals)
   - Drag sessions/terminals between groups
   - Create/rename/delete groups
   - "Create group from selection" (select multiple sessions)

4. **Layout persistence changes:**
   - `settingsStore` gains a `groups` section:
     ```ts
     groups: {
       items: Array<{
         id: string;
         name: string;
         layout: DockviewSerializedState;
         sessionIds: string[];
       }>;
       activeGroupId: string;
     }
     ```
   - On group switch: save current → load next
   - On app restart: restore last active group's layout

5. **Session↔Group binding:**
   - Each session belongs to exactly one group
   - Moving a session between groups moves the panel
   - New sessions are created in the active group
   - The sessions manager shows a group badge per row

### Projects

**Core idea:** A project is a named configuration bundle stored in
`.dafman/project.json` in the workspace directory. It defines shared
settings that apply to all sessions created in that workspace.

**Implementation:**

1. **`.dafman/project.json`** schema:
   ```json
   {
     "name": "My App",
     "mcpServers": { ... },
     "skills": { "disabled": ["summarize"] },
     "agents": { "default": "reviewer" },
     "model": "gpt-5.5",
     "reasoningEffort": "medium",
     "systemPrompt": "You are helping with My App...",
     "approveAll": false
   }
   ```

2. **`projectStore.ts`** — Pinia store:
   - `projects: ProjectRecord[]` — loaded from disk
   - `activeProject: ProjectRecord | null` — based on active session's cwd
   - `loadProject(cwd)` — reads `.dafman/project.json`
   - `saveProject(cwd, config)` — writes to disk
   - `createProject(cwd, name)` — scaffolds `.dafman/project.json`
   - Settings resolution: `project setting > user setting > default`

3. **`ProjectsPanel.vue`** — Activity bar panel:
   - List projects (from workspace MRU + discovered `.dafman/` dirs)
   - Create project from current workspace
   - Open project as group (creates a new group with the project's layout)
   - Edit project settings (MCP, skills, agents, model, system prompt)

4. **Session config overlay:**
   - When creating a session in a workspace with `.dafman/project.json`:
     - Apply project's MCP servers to the session config
     - Apply project's skill disables
     - Apply project's default agent
     - Apply project's model/reasoningEffort defaults
   - The session's gear popover shows "Project: My App" with a link

5. **Project↔Group interop:**
   - "Open project as group" — creates a group named after the project,
     opens its workspace in a new session
   - "Create project from group" — saves the active group's workspace
     as a `.dafman/project.json`

## Phasing

### Phase 1: Groups (~3 days)
- GroupTabBar component
- groupStore with create/switch/delete/rename
- Layout save/restore per group
- Settings schema migration (add `groups` section)
- Keyboard shortcuts (Ctrl+1/2/3… for group switching)

### Phase 2: Groups Manager (~2 days)
- GroupsManagerPanel in the activity bar
- Drag-and-drop sessions between groups
- Context menu on group tabs
- Session badges showing group membership

### Phase 3: Projects foundation (~3 days)
- `.dafman/project.json` schema + read/write
- projectStore with load/save/create
- Session config overlay (MCP + skills + agents + model)
- "Project: X" indicator in session details

### Phase 4: Projects UI (~2 days)
- ProjectsPanel in the activity bar
- Create project wizard
- Edit project settings
- Open/create project from group and vice versa

## Open questions for user

1. Should groups share the same activity bar (sessions list, library,
   settings), or should each group have its own sidebar state?
2. Should projects be auto-detected from `.dafman/` on disk, or only
   explicitly registered?
3. Should a session's project binding be mutable (user can move a
   session to a different project)?
4. Should `.dafman/project.json` be gitignored by default, or
   committed (for team sharing)?
