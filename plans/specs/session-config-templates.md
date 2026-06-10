# Session Config Templates

**Status:** Draft, 2026-06-10

---

## Summary

Add **session templates** — named snapshots of a session's configuration (agent, MCP servers enabled, skills enabled, run mode) that can be applied at new-session creation or to a running session. Templates are stored in `<userData>/session-templates.json`. A new **Templates** tab in LibraryPanel provides CRUD management. The command palette gains `template.new.<id>` entries for "New session from template". An "Apply template" / "Save as template" action lives in SessionDetailsPanel. This addresses the recurring friction of reconfiguring sessions identically across restarts or for different tasks.

---

## Motivation

### What's missing today

1. **No configuration reuse across sessions.** Every new session starts from global defaults (tool `settings.tools.{defaultExcluded, defaultAllowed}`, global MCP server allowlist, global skill enabled list). If a user always wants a specific agent + specific MCP subset + autopilot mode for "production debugging" sessions, they must manually select the agent, toggle the right MCPs, and change the mode every time.

2. **Per-session config is ephemeral.** `setSessionMode` (`src/shared/wireTypes.ts:618-621`), `selectAgent` (`src/shared/wireTypes.ts:675-678`), `setSessionSkillEnabled` (`src/shared/wireTypes.ts:663-666`), and `setSessionMcpEnabled` (`src/shared/wireTypes.ts:762-765`) set runtime state but there is no way to bundle these settings into a named preset.

3. **Session details panel is write-only.** The panel lets users configure the current session but does not expose "what is my current config as a reusable entity". There is no "Save as template" affordance.

4. **Library owns agent definitions but not session-scoped use patterns.** `LibraryAgentsTab.vue` manages agent files globally; `SessionDetailsPanel` applies them per-session. Neither surface provides a "commonly used combination" concept.

---

## Current State

| File                                             | Symbol                                     | What it does                                                                                                           |
| ------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/shared/wireTypes.ts:618-621`                | `setSessionMode`                           | Sets run mode (interactive/plan/autopilot) for a session; applies immediately.                                         |
| `src/shared/wireTypes.ts:675-678`                | `selectAgent`                              | Selects a named agent for a session by name.                                                                           |
| `src/shared/wireTypes.ts:679-682`                | `deselectAgent`                            | Clears the session's active agent.                                                                                     |
| `src/shared/wireTypes.ts:663-666`                | `setSessionSkillEnabled`                   | Enables or disables a named skill for the session.                                                                     |
| `src/shared/wireTypes.ts:762-765`                | `setSessionMcpEnabled`                     | Enables or disables a named MCP server for the session.                                                                |
| `src/shared/wireTypes.ts:652-662`                | `listSessionSkills`                        | Returns `{ name, enabled }[]` for all skills in the session.                                                           |
| `src/shared/wireTypes.ts:667-670`                | `listAgents`                               | Returns `AgentInfo[]` for the session; `.selectedAgent` on the result identifies the active one.                       |
| `src/shared/wireTypes.ts:601-616`                | `resumeSession`                            | Creates a session resuming an existing CLI session by id; passes `workingDirectory`, `model`. No template param today. |
| `src-bun/app/chat/sessionMetadataStore.ts:32-35` | `PersistedSessionMeta`                     | Today holds `{ approveAll?, mode? }` per session — the pattern for small per-session extras.                           |
| `src-bun/app/config/settings.ts:9-10`            | `SETTINGS_VERSION = 15`                    | Version-migrated settings JSON in `<userData>/`. New files follow the same directory convention.                       |
| `src-bun/index.ts:153-155`                       | `SessionMetadataStore.loadOrDefault(path)` | JSON-backed store loaded at startup and injected into the registry. Same pattern for `TemplateService`.                |
| `src/components/library/LibraryPanel.vue:12-27`  | Tab layout                                 | PrimeVue tabs; new tab requires one `<Tab>` + `<TabPanel>` entry and one component import.                             |
| `src/components/library/LibraryAgentsTab.vue`    | Full tab component                         | Pattern to follow for LibraryTemplatesTab: `LibraryTabHeader`, reactive list, inline create/edit form.                 |
| `src/lib/registerBuiltinCommands.ts:638-685`     | `session.switch`                           | Dynamic palette children rebuilt from a reactive store — model for `template.new.*` children.                          |

---

## Design

### 7.1 Template data shape

```ts
interface SessionTemplate {
  id: string; // uuid v4
  name: string; // display name, e.g. "Prod debug – autopilot"
  agentName?: string; // agent.name value to pass to selectAgent; undefined = no agent
  mcpEnabled: string[]; // server names to enable; servers not listed use session defaults
  skillsDisabled: string[]; // skill names explicitly disabled; skills not listed use defaults
  runMode?: SessionMode; // 'interactive' | 'plan' | 'autopilot'; undefined = keep default
  createdAt: string; // ISO timestamp
  updatedAt: string;
}
```

**Rationale for delta encoding:** Templates store only the differences from global defaults. `mcpEnabled` is an explicit enable list (user must have these ON); `skillsDisabled` is an explicit disable list. This way a template doesn't silently break when the user adds a new global MCP server — new servers remain at their global default rather than being force-disabled because they weren't in the template snapshot.

Stored as `{ version: 1, templates: SessionTemplate[] }` in `<userData>/session-templates.json`.

### 7.2 Bun-side TemplateService

New file `src-bun/app/config/templateService.ts`. Mirrors `SessionMetadataStore`:

```ts
class TemplateService {
  static loadOrDefault(path: string): TemplateService;
  list(): SessionTemplate[];
  save(template: SessionTemplate): Promise<void>; // insert or update by id
  delete(id: string): Promise<void>;
}
```

RPCs added to `src/shared/wireTypes.ts` (and exposed in `src-bun/rpc.ts`):

- `listTemplates → SessionTemplate[]`
- `saveTemplate(template: SessionTemplate) → void`
- `deleteTemplate(id: string) → void`
- `applyTemplate(sessionId: string, templateId: string) → ApplyTemplateResult`
- `captureTemplate(sessionId: string, name: string) → SessionTemplate` — reads the current session config and saves it as a new template

`applyTemplate` on the Bun side calls, in sequence:

1. `selectAgent(sessionId, template.agentName)` or `deselectAgent(sessionId)` if `agentName` is undefined
2. For each `name` in `template.mcpEnabled`: `setSessionMcpEnabled(sessionId, name, true)`
3. For each `name` in `template.skillsDisabled`: `setSessionSkillEnabled(sessionId, name, false)`
4. If `template.runMode` is set: `setSessionMode(sessionId, template.runMode)`

Returns `{ applied: true, warnings: string[] }` where `warnings` lists any server/skill names that no longer exist.

`captureTemplate` calls `listAgents`, `listSessionSkills`, `listSessionMcpServers`, and `getSessionMode` to read the current session state, constructs a `SessionTemplate`, saves it, and returns it.

### 7.3 New session from template

The command palette gains a dynamic family `template.new.<id>` under the "Templates" group, re-computed whenever `useTemplatesStore.templates` changes (mirrors `session.switch` children in `registerBuiltinCommands.ts:638-685`).

Running `template.new.<id>`:

1. Calls `newSession({ workingDirectory: ... })` to create a fresh session (or the standard new-session flow).
2. Once the session resolves its `sessionId`, calls `applyTemplate(sessionId, templateId)`.
3. Reveals the new session panel.

Because new sessions have no history to conflict with, apply-order issues don't arise.

### 7.4 Applying a template to a running session

"Apply template…" action in `SessionDetailsPanel.vue` (added to the header row alongside fork/compact). Opens a small select dialog listing saved templates by name. Confirming calls `applyTemplate(sessionId, templateId)`. A toast confirms success and lists any warnings from `applyTemplateResult.warnings`.

### 7.5 Capturing the current session as a template

"Save as template…" action in `SessionDetailsPanel.vue` (same header row). Prompts for a name (inline input, validated non-empty), then calls `captureTemplate(sessionId, name)`. A toast confirms with the template name.

### 7.6 Library Templates Tab

New `LibraryTemplatesTab.vue` in `src/components/library/`. Structure mirrors `LibraryAgentsTab.vue`:

- `LibraryTabHeader` with actions: **New** (primary), **Refresh**.
- Template list: each row shows `name`, `agentName ?? "no agent"`, count of MCPs + skills overridden. Row actions: **Edit** (inline form), **Delete** (confirm), **Apply to session** (enabled when a session is focused — calls `applyTemplate(lastFocusedSessionId, id)`).
- Inline create/edit form: `name` input, `agentName` select (pulls from `listAgentFiles` union), `mcpEnabled` multi-select (pulls from `listMcpConfigs`), `skillsDisabled` multi-select (pulls from `listBuiltinSkills`), `runMode` select.

`LibraryPanel.vue` gains a `"templates"` tab entry.

### 7.7 New session from template — creation flow detail

The existing `newSession` RPC creates a session with a working directory. The template is applied post-creation — no changes to the SDK session creation API are needed. This means:

1. `newSession({ workingDirectory })` → `sessionId`
2. `applyTemplate(sessionId, templateId)` → `ApplyTemplateResult`
3. Reveal panel

If `applyTemplate` fails partially (e.g. an MCP server can't be enabled because it's not configured), warnings are shown in a toast but the session remains open. The failure mode is graceful: the user has a live session that just doesn't have all template settings applied.

### Open Questions

1. **Template agent reference.** Agent names are scoped (user vs project) and the same name can exist in both scopes. `agentName` in the template shape is a bare name. **Recommended default:** store both `agentName` and `agentScope` in the template. `captureTemplate` reads the active agent's scope from `listAgents`. `applyTemplate` calls `selectAgent` with the stored name + scope; if the scoped file is missing, fall back to user scope and add to warnings.

2. **Delta vs. snapshot encoding.** Should templates capture ALL MCP/skill states (full snapshot) or just the user's intentional overrides (delta from global defaults)? **Recommended default:** delta (as specified above). A full snapshot silently disables newly-added global MCPs; a delta doesn't. However, delta means "apply template" doesn't guarantee a deterministic final state if global defaults differ across machines. For a single-user desktop tool, delta is the better tradeoff.

3. **Template inheritance.** Should templates have a "base template" pointer for composition? **Recommended default:** no — flat templates only for v1. Composition adds complexity for minimal gain.

4. **Apply to new session: working directory.** Should templates capture the working directory? **Recommended default:** no — working directory is workspace-dependent. The standard new-session flow prompts for (or defaults to) the current workspace.

5. **Conflicts during apply.** If a skill in `skillsDisabled` no longer exists (removed from the CLI), `applyTemplate` would get a 404-style error from `setSessionSkillEnabled`. **Recommended default:** log the warning, include in `ApplyTemplateResult.warnings`, and continue applying the rest of the template.

---

## Alternatives

### A. Templates inside settings.json

Add `templates: SessionTemplate[]` to the `Settings` document and include in `SETTINGS_VERSION`. **Tradeoff:** `settings.update()` is a full-replace of the entire settings blob — templates can be large lists and bumping the settings version for every CRUD op is noisy. Separate file avoids version churn. ✗

### B. Templates as agent files with custom frontmatter

Encode templates as `.agent.md` files with custom `dafman-template:` frontmatter. **Tradeoff:** agent files are SDK-registered and appear in the agent picker — templates are not SDK entities. Reusing the agent file format creates false affordance and risks SDK warnings about unknown frontmatter keys (see `agentFiles.ts:16-27`). ✗

### C. Templates as a library sub-feature of Sessions Manager

Put templates in the Sessions Manager panel alongside session groupings. **Tradeoff:** Sessions Manager is already growing (#184, #232). Templates are a Library concern (global config presets), not a session-instance concern. Library is the right home per the `#28` direction. ✓ (selected approach)

---

## Implementation Phases

### Phase 1 — Core storage + palette + details panel actions

1. Add `SessionTemplate` type to `src/shared/wireTypes.ts`; add `listTemplates`, `saveTemplate`, `deleteTemplate`, `applyTemplate`, `captureTemplate` command entries.
2. Implement `TemplateService` in `src-bun/app/config/templateService.ts`; wire into `src-bun/index.ts`.
3. Implement the 5 RPC handlers (`applyTemplate` calls the per-session RPCs in sequence; `captureTemplate` reads current state).
4. Implement `useTemplatesStore` (Pinia) in `src/stores/`.
5. Add "Save as template…" and "Apply template…" actions to `SessionDetailsPanel.vue` header row.
6. Register dynamic `template.new.*` palette commands in `registerBuiltinCommands.ts`.

### Phase 2 — Library Templates Tab

- Implement `LibraryTemplatesTab.vue` with full CRUD.
- Add `"templates"` tab to `LibraryPanel.vue`.
- "Apply to session" row action wired to `lastFocusedSessionId`.

### Phase 3 — Stretch

- Template import/export (JSON file, for cross-machine sharing).
- `template.apply.<id>` palette commands (apply to the active running session without opening the details panel).

---

## References

- `src/shared/wireTypes.ts:618-621` — `setSessionMode`
- `src/shared/wireTypes.ts:663-666` — `setSessionSkillEnabled`
- `src/shared/wireTypes.ts:675-682` — `selectAgent` / `deselectAgent`
- `src/shared/wireTypes.ts:762-765` — `setSessionMcpEnabled`
- `src/shared/wireTypes.ts:652-662` — `listSessionSkills`
- `src/shared/wireTypes.ts:667-670` — `listAgents`
- `src/shared/wireTypes.ts:601-616` — `resumeSession`
- `src-bun/app/chat/sessionMetadataStore.ts:32-35` — `PersistedSessionMeta` (pattern for small per-session extras)
- `src-bun/app/chat/sessionMetadataStore.ts:61-88` — `SessionMetadataStore.loadOrDefault` (JSON store pattern)
- `src-bun/index.ts:153-155` — startup wiring for the store
- `src/components/library/LibraryPanel.vue:12-27` — tab structure
- `src/components/library/LibraryAgentsTab.vue` — full tab component pattern
- `src/lib/registerBuiltinCommands.ts:638-685` — dynamic palette children pattern
- `src-bun/app/library/agentFiles.ts:54-78` — `AgentFileSpec` (agent name/scope reference)
- GitHub issue #243
