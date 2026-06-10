# Projects — per-workspace config overlay

**Status:** Draft, 2026-06-10

---

## Summary

Add a **project** layer: a named, per-workspace bundle of default session
configuration (agent, enabled MCP servers, disabled skills, run mode, model +
reasoning effort, approve-all, tool allow/exclude policy) keyed by a canonical
working-directory path. When a session is created in a project's directory, the
project's defaults are applied automatically. This inserts a middle tier into
config resolution:

```
global defaults (settings.json)  ←  project overlay  ←  per-session override
```

Projects are stored in `<userData>/projects.json` and managed from a new
**Library → Projects** tab (CRUD) plus a "Save current session as project
default" action. The overlay is **delta-encoded** and applied through the same
machinery as session templates (#243), so a project is, in effect, "a template
that auto-applies to a directory." This is the unblocker called out in
`plans/TODO_archive.md` §Projects row 1, and it is the dependency behind
per-project autopilot policy and the per-project MCP overlay (#198, partial
#11).

---

## Motivation

### What's missing today

1. **No per-workspace config reuse.** Every session created in a given
   directory starts from the _global_ defaults. A user whose `~/work/api` repo
   always wants the `backend` agent + a specific MCP subset + autopilot must
   reconfigure that by hand (or apply a template #243) every single time. The
   directory "knows" nothing about how the user likes to work in it.

2. **`Workspaces` is a bare MRU.** `Workspaces` is just
   `{ recent: string[]; defaultWorkspace: string }`
   (`src/shared/wireTypes.ts:134-140`) — a list of paths and a default. There
   is no place to attach configuration to a path.

3. **Per-session persistence is minimal.** `PersistedSessionMeta` only stores
   `{ approveAll?, mode? }` (`src-bun/app/chat/sessionMetadataStore.ts:32-35`).
   Agent / MCP / skills / model selections are runtime-only and are **not**
   re-applied across resume or reload (this is #198). A project overlay gives
   those selections a durable home keyed by directory rather than by ephemeral
   session id.

4. **Defaults are global-only and applied at create-time.**
   `ToolsPrefs.{defaultExcluded, defaultAllowed}` (`wireTypes.ts:68-74`),
   `PermissionsPrefs.defaultApproveAll` (`wireTypes.ts:76-78`), and
   `Appearance.{defaultModelId, defaultReasoningEffort}` (`wireTypes.ts:141-148`)
   are read once when a session is created. There is no scope between "every
   new session everywhere" and "this one session right now."

5. **Templates (#243) are manual + un-bound.** `SessionTemplate` captures the
   same config dimensions but is a _named, manually-applied_ preset. Nothing
   ties a template to a directory or applies it automatically. Projects fill
   exactly that gap and can reuse the template apply/capture machinery.

---

## Current State

| File                                                        | Symbol                                 | What it does                                                                                          |
| ----------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/shared/wireTypes.ts:134-140`                           | `Workspaces`                           | `{ recent: string[]; defaultWorkspace: string }` — bare MRU + default. No per-path config.            |
| `src/shared/wireTypes.ts:156-167`                           | `Settings`                             | Global settings doc (`<userData>/settings.json`, `SETTINGS_VERSION = 15`).                            |
| `src/shared/wireTypes.ts:68-78`                             | `ToolsPrefs` / `PermissionsPrefs`      | Global tool allow/exclude + default approve-all, applied at session create.                           |
| `src/shared/wireTypes.ts:141-148`                           | `Appearance.defaultModelId/...`        | Global default model + reasoning effort for new sessions.                                             |
| `src/shared/wireTypes.ts:633-640`                           | `createSession`                        | `{ workingDirectory?, model?, reasoningEffort? }` → `sessionId`. The hook point for project apply.    |
| `src/shared/wireTypes.ts:689-704`                           | `resumeSession`                        | Resumes a CLI session; returns `{ cwd, model, approveAll, mode }`. No template/project param today.   |
| `src/shared/wireTypes.ts:716-724`                           | `setSessionWorkingDirectory`           | Mutates a session's cwd (+ optional base) — would re-resolve which project applies.                   |
| `src-bun/app/chat/sessionMetadataStore.ts:32-35`            | `PersistedSessionMeta`                 | `{ approveAll?, mode? }` per session in `<userData>/session-metadata.json`. Pattern for small extras. |
| `src-bun/app/config/settings.ts:35,72`                      | `SETTINGS_VERSION` / `defaultSettings` | Versioned global settings; `loadOrDefault` + `coerce*` migration pattern.                             |
| `src-bun/app/config/templateService.ts`                     | `TemplateService`                      | `<userData>/session-templates.json` store (#243). Direct pattern for `ProjectService`.                |
| `src-bun/app/config/templateOps.ts`                         | `applyTemplate` / `captureTemplate`    | Fans out `selectAgent`/`setSessionMcpEnabled`/`setSkillEnabled`/`setMode`; reads current config.      |
| `src-bun/app/config/snippetService.ts`                      | `SnippetService`                       | Another `<userData>/*.json` atomic-write store to mirror.                                             |
| `src-bun/index.ts:153-155`                                  | `SessionMetadataStore.loadOrDefault`   | Startup-instantiated store injected into the registry. Same wiring for `ProjectService`.              |
| `src/components/library/LibraryPanel.vue`                   | Tab layout                             | One import + tab entry adds a "Projects" tab (mirrors Agents/Snippets/Templates tabs).                |
| `src/lib/sessionCommands.ts` / `registerBuiltinCommands.ts` | new-session flow / `session.new.*`     | Where session creation is triggered; project apply hooks in after `sessionId` resolves.               |
| `plans/specs/session-config-templates.md`                   | —                                      | Sibling spec; Projects deliberately reuse its `SessionTemplate` shape + apply machinery.              |

---

## Design

### Project data shape

```ts
interface Project {
  /// Canonical absolute path of the workspace this project configures.
  /// This is the identity key — one project per directory.
  path: string;
  /// Display name. Defaults to the basename of `path` when omitted.
  name?: string;
  /// The config overlay, delta-encoded against global defaults. Identical
  /// dimensions to SessionTemplate (#243) plus the global-default fields that
  /// today only live in settings.json.
  defaults: ProjectDefaults;
  createdAt: string; // ISO
  updatedAt: string;
}

interface ProjectDefaults {
  agentName?: string;
  agentScope?: AgentFileScope; // 'user' | 'project'
  mcpEnabled?: string[]; // server names to force ON (delta)
  skillsDisabled?: string[]; // skill names to force OFF (delta)
  runMode?: SessionMode; // interactive | plan | autopilot
  modelId?: string; // '' / undefined = global default
  reasoningEffort?: string | null;
  approveAll?: boolean; // per-project autopilot/approve-all policy
  toolsExcluded?: string[]; // overrides ToolsPrefs.defaultExcluded
  toolsAllowed?: string[]; // overrides ToolsPrefs.defaultAllowed
}
```

Stored as `{ version: 1, projects: Project[] }` in `<userData>/projects.json`.

**Delta encoding (consistent with #243).** `mcpEnabled` is an explicit
enable-list, `skillsDisabled` an explicit disable-list; unlisted servers/skills
keep their global default. An `undefined` scalar (`runMode`, `modelId`,
`approveAll`, …) means "inherit global default." This keeps a project from
silently force-disabling a newly-added global MCP server, and makes the overlay
composable with the per-session layer.

### Config resolution (the overlay)

Effective config for a session is computed left-to-right, each layer
overriding the previous **only for fields it sets**:

```
global defaults (settings.ts)  →  project overlay (by cwd)  →  per-session override (runtime)
```

- **Global → project**: applied at session create (and on
  `setSessionWorkingDirectory` when the cwd changes which project matches).
- **Project → session**: a user's manual change in `SessionDetailsPanel` / gear
  popover always wins for that session and (per #198) persists.

Projects do **not** introduce a new effective-config computation in the hot
path: the overlay is materialized **once** into concrete per-session setter
calls at create-time (same as `applyTemplate`), not recomputed per event.

### Bun-side `ProjectService`

New `src-bun/app/config/projectService.ts`, mirroring `TemplateService` /
`SnippetService`:

```ts
class ProjectService {
  static loadOrDefault(path: string): ProjectService;
  list(): Project[];
  getForPath(cwd: string): Project | undefined; // canonical-path match
  save(project: Project): Promise<void>; // insert/update by path
  delete(path: string): Promise<void>;
}
```

Persistence via `atomicWrite` (temp+rename+`.bak`). Paths canonicalized
(resolve + normalize separators + case-fold on Windows) before compare/store.

### RPCs (added to `src/shared/wireTypes.ts`, re-exported from `rpc.ts`)

- `listProjects() → Project[]`
- `getProjectForPath({ path }) → Project | undefined`
- `saveProject({ project }) → void`
- `deleteProject({ path }) → void`
- `applyProjectToSession({ sessionId, path }) → ApplyTemplateResult` — fans out
  the overlay through the **same** sequence as `applyTemplate` (reuse
  `templateOps`), returning the same `{ applied, warnings }` shape.
- `captureProjectFromSession({ sessionId, path, name? }) → Project` — reads the
  live session config (reuse `captureTemplate`'s readers) into a `Project`.

### Auto-apply at session creation

The session-create flow (renderer `sessionCommands` / `session.new.*`) already
passes `workingDirectory`. After `createSession` resolves a `sessionId`:

1. `getProjectForPath(workingDirectory)` (cheap, in-memory map lookup).
2. If a project matches, `applyProjectToSession(sessionId, path)`.
3. Surface a toast: "Applied project defaults: <name>" + any
   `ApplyTemplateResult.warnings` (servers/skills that no longer exist).

`createSession` itself stays unchanged on the wire (model/reasoningEffort still
accepted); the model/effort from the project default are passed _into_
`createSession` where the renderer already plumbs those, and the
agent/mcp/skills/mode/approve-all are applied post-create via
`applyProjectToSession`. Because a new session has no history, apply-ordering
issues don't arise (same rationale as #243 §7.3).

### `setSessionWorkingDirectory` re-resolution

When a session's cwd changes to a directory with a _different_ project, prompt
(non-blocking toast with an "Apply <project> defaults" action) rather than
auto-clobbering a session the user has already been working in. Silent
auto-apply only happens at create-time.

### UI

- **Library → Projects tab** (`LibraryProjectsTab.vue`, mirrors
  `LibraryTemplatesTab` / `LibrarySnippetsTab`): list rows (name + path + a
  summary like "backend · 2 MCP · autopilot"); row actions **Edit** (inline
  form), **Delete** (confirm), **Apply to session** (active session). Inline
  create/edit form: path (folder picker, prefilled with the active session's
  cwd), name, agent select, MCP multi-select, skills multi-select, run mode,
  model, approve-all toggle, tool policy.
- **"Save current session as project default"** action in
  `SessionDetailsPanel.vue` header row (next to the #243 template actions) →
  `captureProjectFromSession` keyed to the session's cwd.
- **Project chip** (Phase 2): a small indicator in the session header / bottom
  bar showing which project the active session belongs to, click to open the
  Projects tab. (Pairs with the agent-chip work, `TODO_archive` Messaging row
  20 / #27.)

### Reusing template machinery (deliberate)

`ProjectDefaults` is a superset of `SessionTemplate`'s fields (adds
model/approve-all/tool policy). `applyProjectToSession` and
`captureProjectFromSession` reuse the `templateOps` apply/capture functions,
extended to cover the extra fields. Projects and Templates stay **distinct
entities** (a project is path-keyed + auto-applied; a template is named +
manual), but share one apply/capture core. This avoids a second fan-out
implementation drifting from the first.

---

## Open Questions

1. **Identity: path-keyed vs id-keyed.** **Recommended:** key by canonical
   `path` (one project per directory) — matches the mental model ("this folder's
   setup") and makes `getProjectForPath` a direct lookup. A uuid adds rename
   bookkeeping for no v1 benefit. Display `name` is editable; `path` is the key.

2. **cwd matching: exact vs nearest-ancestor.** A session in
   `~/work/api/packages/db` — does the `~/work/api` project apply?
   **Recommended:** exact canonical-path match for v1 (predictable, no surprise
   inheritance). Nearest-ancestor walk is a Phase 3 option behind a per-project
   `applyToSubdirectories` flag.

3. **Storage: `userData/projects.json` vs repo-local `.dafman/project.json`.**
   **Recommended:** `userData/projects.json` for v1 — no writes into the user's
   repo, no git noise, consistent with snippets/templates. A repo-local,
   git-shareable variant is a Phase 3 option (and the natural home for
   project-scoped MCP _definitions_, which ties to #11).

4. **Reuse `SessionTemplate` machinery?** **Recommended:** yes — share the
   `templateOps` apply/capture core (extended for model/approve-all/tools).
   Keep `Project` and `SessionTemplate` as separate persisted entities.

5. **Auto-apply silently, or confirm, at create-time?** **Recommended:** apply
   silently + toast a summary (with warnings). New sessions have no state to
   clobber; a confirmation dialog on every new-session-in-a-project would be
   friction. cwd-_change_ re-resolution (running session) does prompt (above).

6. **Project-scoped MCP/agents — enable-subset vs own definitions.**
   **Recommended:** v1 `mcpEnabled` references **globally-defined** MCP servers
   (delta enable, exactly like templates). Project-_owned_ MCP/agent definitions
   (`.dafman/` or `.github/` files) are Phase 3 and converge with the MCP scope
   picker (#11) + Library source-of-truth (#28).

7. **Relationship to `Workspaces.recent`.** **Recommended:** leave
   `workspaces.recent` as the raw path MRU; `projects.json` is a separate,
   sparse overlay (most recent workspaces won't be projects). The Projects tab
   can offer "create a project from a recent workspace."

8. **Per-session override persistence (#198) ordering.** Projects are the
   _middle_ layer; #198 (persisting per-session agent/MCP/skills overrides) is
   the _top_ layer and a separate work item. **Recommended:** ship Projects
   first (durable, directory-keyed config covers the common case), then #198
   layers session-specific deviations on top. They compose; neither blocks the
   other's core.

---

## Alternatives

### A. Projects inside `settings.json`

Add `projects: Project[]` to `Settings` and bump `SETTINGS_VERSION`.
**Tradeoff:** `updateSettings` is a full-document replace; per-project CRUD
would churn the settings version and rewrite the whole blob. A separate file
avoids version churn and matches snippets/templates. ✗

### B. Projects = repo-local `.dafman/project.json` (only)

Store config in the repo so it's git-shareable across a team.
**Tradeoff:** writes into the user's repository (git noise, needs gitignore
guidance), and not every workspace is a git repo. Genuinely useful for _shared_
project setup, but as the _only_ store it's too opinionated for v1. Kept as a
Phase 3 option. ✗ (for v1)

### C. No project entity — auto-apply Templates bound to a path

Add an optional `boundPath?` to `SessionTemplate` and auto-apply matching
templates at create-time, instead of a separate `Project` type.
**Tradeoff:** conflates two mental models (a named reusable preset vs. "this
folder's setup"), and templates don't carry the global-default fields
(model/approve-all/tools) a project overlay needs. Sharing the _apply core_
(the chosen design) gets the reuse benefit without overloading one entity. ✗

### D. Projects own the dockview group / layout too

Bundle a saved layout (which panels/groups open) into the project.
**Tradeoff:** layout is the concern of Groups v3 + workspace layout snapshots; a
project is about _agent config_, not window arrangement. Keep them orthogonal;
a future "open project" command could compose both. ✗ (out of scope)

---

## Implementation Phases

### Phase 1 — Storage + apply core + auto-apply

1. `Project` / `ProjectDefaults` types in `wireTypes.ts`; re-exports in
   `rpc.ts` + `ipc/types.ts`.
2. `ProjectService` (`src-bun/app/config/projectService.ts`) with canonical-path
   keying; wire into `index.ts` + `test-server.ts`.
3. Extend `templateOps` apply/capture to cover model/approve-all/tool-policy;
   implement the 6 RPC handlers (reusing it) in both backends.
4. `useProjectsStore` (Pinia).
5. Auto-apply hook in the session-create flow: `getProjectForPath` →
   `applyProjectToSession` → toast (with warnings). Re-resolution prompt on
   `setSessionWorkingDirectory`.

### Phase 2 — Library tab + capture + chip

- `LibraryProjectsTab.vue` (CRUD, folder picker, multi-selects), `"projects"`
  tab in `LibraryPanel.vue`.
- "Save current session as project default" in `SessionDetailsPanel.vue`.
- Project chip indicator in the session header / bottom bar.

### Phase 3 — Stretch

- Nearest-ancestor cwd matching (`applyToSubdirectories`).
- Repo-local `.dafman/project.json` (shareable) + project-owned MCP/agent
  definitions (converges with #11 / #28).
- Compose with workspace layout snapshots ("open project" = config + layout).

---

## References

- `plans/TODO_archive.md` §Projects/accounts/persistence rows 1–4 (project
  model, multi-account, per-session + per-project MCP overlay)
- `src/shared/wireTypes.ts:134-140` — `Workspaces`
- `src/shared/wireTypes.ts:68-78,141-148` — global default config (tools /
  permissions / model)
- `src/shared/wireTypes.ts:633-640,689-724` — `createSession` /
  `resumeSession` / `setSessionWorkingDirectory`
- `src-bun/app/chat/sessionMetadataStore.ts:32-35` — `PersistedSessionMeta`
- `src-bun/app/config/templateService.ts` + `templateOps.ts` — the store +
  apply/capture core to reuse (#243)
- `src-bun/app/config/snippetService.ts` — sibling `userData/*.json` store
- `src-bun/index.ts:153-155` — startup store wiring
- `plans/specs/session-config-templates.md` (#243) — sibling spec
- `plans/specs/library-source-of-truth.md` (#28) — config source-of-truth
  direction
- GitHub issues: [#264](https://github.com/AsafMah/dafman/issues/264) (this) ·
  [#198](https://github.com/AsafMah/dafman/issues/198) (per-session override
  persistence) · [#11](https://github.com/AsafMah/dafman/issues/11) (MCP scope)
