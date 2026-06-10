# Prompt Snippet Library

**Status:** Draft, 2026-06-10

---

## Summary

Add a **Snippets** tab to LibraryPanel where users can create, edit, and organize reusable prompt fragments ("snippets"). Snippets are insertable into any session's composer via three paths: (1) the command palette, (2) an optional slash trigger in the composer typeahead, and (3) a toolbar button in the composer. Persistence is a `snippets.json` file in `<userData>/` managed by a new `SnippetService` on the Bun side.

---

## Motivation

### What's missing today

1. **No snippet reuse.** Users who repeatedly send variations of the same prompt (code-review checklists, persona-priming blocks, debugging frameworks, project-specific context starters) must retype or paste from an external clipboard manager every time. There is no in-app concept of a saved, tagged prompt fragment.

2. **Instructions ≠ snippets.** The Library Instructions tab (`src/components/library/LibraryInstructionsTab.vue`) lists discovery-managed `.github/copilot-instructions.md` / `AGENTS.md` files — these are static, always-on system prompts, not user-insertable fragments. They serve a different purpose and are not composable with on-demand insertion.

3. **Session commands are hardcoded.** `SESSION_COMMANDS` in `src/lib/sessionCommands.ts:113` is a static array. There is no runtime-extensible path for user-defined slash triggers that insert text rather than executing a Dafman action.

4. **No palette surface for personal content.** The command palette today surfaces session commands and workspace actions. There is no "personal prompt library" group.

---

## Current State

| File                                                 | Symbol                               | What it does                                                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/library/LibraryPanel.vue:12-27`      | Tab imports + `STORAGE_KEY`          | PrimeVue tabs with `activeTab` persisted in localStorage. Tabs: `mcp`, `skills`, `tools`, `agents`, `instructions`. Adding a new tab requires one import and one `<Tab>` + `<TabPanel>` entry. |
| `src/components/library/LibraryTabHeader.vue`        | `LibraryTabHeaderAction`             | Shared header component for all Library tabs. Same pattern used by all five existing tabs.                                                                                                     |
| `src/lib/sessionCommands.ts:22-48`                   | `SessionCommand`                     | Interface with `slash`, `label`, `description`, `icon?`, `keywords?`, `run()`, `acceptsArgs?`. Slash-typeahead reads from `SESSION_COMMANDS` array.                                            |
| `src/components/chat/SlashCommandPlugin.vue:40-125`  | `SlashOption`, `allOptions`          | Maps `SESSION_COMMANDS` to `SlashOption` instances; `filteredOptions` narrows by query.                                                                                                        |
| `src/components/chat/SlashCommandPlugin.vue:181-214` | `onSelectOption`                     | Handles typeahead selection: either replaces the `/cmd` node with a `\n`-terminated completion or runs `handleSessionCommand`.                                                                 |
| `src-bun/app/config/settings.ts:9-10,89-90`          | userData path                        | `join(Utils.paths.userData, 'settings.json')` pattern used consistently. New files go in the same directory.                                                                                   |
| `src-bun/index.ts:153-155`                           | `SessionMetadataStore.loadOrDefault` | Precedent for a JSON-backed store initialized at startup and handed to a service. Same pattern for `SnippetService`.                                                                           |
| `src/stores/shell/commandRegistry.ts:27-80`          | `Command`                            | Palette command shape. Dynamic commands re-register on store changes (e.g. session list drives `session.jump.*`). Snippets follow the same pattern.                                            |
| `src/lib/registerBuiltinCommands.ts:638-685`         | `session.switch`                     | Dynamic palette children rebuilt from a reactive store — the model for `snippet.insert.*` children.                                                                                            |

---

## Design

### 7.1 Snippet data shape

```ts
interface Snippet {
  id: string; // uuid v4
  title: string; // human label (shown in palette + tab)
  body: string; // markdown-capable text; inserted verbatim into composer
  tags: string[]; // free-form tags for filtering in the Snippets tab
  shortcut?: string; // optional slash trigger, e.g. "codereview" → "/codereview"
  createdAt: string; // ISO timestamp
  updatedAt: string;
}
```

Stored as `{ version: 1, snippets: Snippet[] }` in `<userData>/snippets.json`. Read synchronously at startup; writes are async via `Bun.write`.

### 7.2 Bun-side SnippetService

New file `src-bun/app/config/snippetService.ts`. Pattern mirrors `SessionMetadataStore` (JSON file + in-memory cache + async write).

```ts
class SnippetService {
  static loadOrDefault(path: string): SnippetService;
  list(): Snippet[];
  save(snippet: Snippet): Promise<void>; // insert or update by id
  delete(id: string): Promise<void>;
}
```

RPCs added to `src-bun/rpc.ts`:

- `listSnippets → Snippet[]`
- `saveSnippet(snippet: Snippet) → void`
- `deleteSnippet(id: string) → void`

Wire into `src-bun/index.ts` at startup alongside `SessionMetadataStore`.

### 7.3 Library Snippets Tab

New `LibrarySnippetsTab.vue` in `src/components/library/`. Structure mirrors `LibraryAgentsTab.vue`:

- `LibraryTabHeader` with actions: **New snippet** (primary), **Refresh**.
- Snippet list: each row shows `title` + tag pills. Row actions: **Insert** (inserts into active session's composer), **Edit** (opens inline form), **Delete** (with confirm).
- Inline create/edit form: `title` input, `body` textarea (with a line-count hint), `tags` input (comma-separated), `shortcut` input (optional; validated to be alphanumeric, no leading `/`).

`LibraryPanel.vue` gets a new `"snippets"` tab entry and imports `LibrarySnippetsTab`.

### 7.4 Palette integration

A reactive Pinia store `useSnippetsStore` holds `snippets: Snippet[]` and calls `listSnippets` on mount. `registerBuiltinCommands.ts` watches the store and registers:

```
snippet.insert                  // parent: "Insert Snippet…"
  snippet.insert.<id>           // child per snippet: runs insertSnippetIntoComposer(id)
```

`insertSnippetIntoComposer(id: string)` looks up the snippet body and dispatches a Lexical `INSERT_TEXT_COMMAND` (or equivalent) on the active session's editor instance. The active editor reference is available via the `editorRef` pattern already used by `MessageComposer.vue`.

Because snippets are user content, the palette group is **"Snippets"** (distinct from "Session" commands). Keywords include `title + tags.join(' ')` so tag-based filtering works.

### 7.5 Slash typeahead integration

For each snippet with a `shortcut` field, `SlashCommandPlugin.vue` (or its data source) gains a computed that merges static `SESSION_COMMANDS` with dynamic snippet-derived entries:

```ts
const snippetCommands = computed<SessionCommand[]>(() =>
  snippetsStore.snippets
    .filter((s) => s.shortcut)
    .map((s) => ({
      slash: `/${s.shortcut}`,
      label: s.title,
      description: 'Insert snippet',
      icon: 'pi-bookmark',
      run: (_sessionId) => insertSnippetIntoComposer(s.id),
    })),
);

const allOptions = computed(() =>
  [...SESSION_COMMANDS, ...snippetCommands.value].map((c) => new SlashOption(c)),
);
```

This keeps `SESSION_COMMANDS` static and unmodified. Snippet slash entries are purely additive and re-computed reactively when snippets change. Shortcut conflicts with existing commands are surfaced in the Snippets tab form (validate on save: warn if `/<shortcut>` already exists in `SESSION_COMMANDS`).

### 7.6 Composer toolbar button (stretch)

A small **Snippets** icon button (`pi-bookmark`) in the composer's leading toolbar area (right of the existing controls) opens a compact `<Popover>` listing snippets with fuzzy filter. Selecting one calls `insertSnippetIntoComposer`. Deferred to a follow-up unless the toolbar has obvious space.

### Open Questions

1. **Snippet insert position.** Should a snippet be appended after the current cursor, or replace the entire composer content? **Recommended default:** insert at the current cursor position (Lexical `$insertNodes`). If the composer is empty, insert at the start. Never replace existing content.

2. **Shortcut namespace collision.** SDK-native slash commands (not in `SESSION_COMMANDS`) are also sent via the composer; `SlashCommandPlugin` only handles Dafman-registered commands and lets unknown `/text` through. A snippet shortcut that matches an SDK command would shadow it. **Recommended default:** validate on save — warn if shortcut matches any known `SESSION_COMMANDS.slash`. Unknown SDK commands are user's responsibility.

3. **Body length limit.** Large snippets (e.g. entire system prompts) can be valuable but slow down the palette search. **Recommended default:** 10 000 chars max, enforced in the form and on the Bun side. Display a char counter in the form.

4. **Import/export.** Should snippets be exportable as a JSON file for sharing across machines? **Recommended default:** out of scope for v1; the snippets.json path is documented so power users can copy it manually.

---

## Alternatives

### A. Extend the Instructions tab with "personal snippets"

Repurpose the Instructions tab (currently read-only file discovery) to also manage personal in-app snippets. **Tradeoff:** conceptually muddy — Instructions are always-on system-level files; snippets are on-demand inserts. Separate tabs keep the domains clean.

### B. Snippets as real agent files (YAML frontmatter)

Store snippets as `.md` files in `~/.config/github-copilot/agents/` so they appear in the Agents tab. **Tradeoff:** agent files are executable by the SDK; snippet bodies are passive text. Repurposing that format creates false affordance and SDK side-effects.

### C. Settings-based storage (add `snippets` to `settings.json`)

Add `snippets: Snippet[]` to the Settings document. **Tradeoff:** Settings is version-migrated and its `update()` path is a full-replace of the whole document. A separate file is safer for a potentially large list and avoids bumping `SETTINGS_VERSION` for every snippet CRUD.

---

## Implementation Phases

### Phase 1 — Core CRUD + palette

1. Add `Snippet` type to `src-bun/rpc.ts` and `src/ipc/types.ts`.
2. Implement `SnippetService` in `src-bun/app/config/snippetService.ts`; wire into `src-bun/index.ts`.
3. Add `listSnippets`, `saveSnippet`, `deleteSnippet` RPC handlers.
4. Implement `useSnippetsStore` (Pinia) in `src/stores/`.
5. Implement `LibrarySnippetsTab.vue` with create/edit/delete/insert.
6. Add `"snippets"` tab to `LibraryPanel.vue`.
7. Register dynamic `snippet.insert.*` palette commands in `registerBuiltinCommands.ts`.
8. Implement `insertSnippetIntoComposer` utility.

### Phase 2 — Slash typeahead

- Extend `SlashCommandPlugin.vue` to merge snippet-derived commands.
- Add shortcut conflict validation in the Snippets tab form.

### Phase 3 — Composer toolbar button (stretch)

- Add `pi-bookmark` icon button to composer toolbar; popover snippet picker.

---

## References

- `src/components/library/LibraryPanel.vue:12-27` — tab structure; add `"snippets"` entry here
- `src/components/library/LibraryAgentsTab.vue` — full tab component pattern to follow
- `src/components/library/libraryTabHeader.ts` — `LibraryTabHeaderAction` type
- `src/lib/sessionCommands.ts:22-49` — `SessionCommand` interface + `SESSION_COMMANDS`
- `src/components/chat/SlashCommandPlugin.vue:40-125` — `SlashOption`, `allOptions`, `filteredOptions`
- `src/lib/registerBuiltinCommands.ts:638-685` — dynamic palette children pattern (session.switch)
- `src/stores/shell/commandRegistry.ts:27-80` — `Command` shape
- `src-bun/index.ts:153-155` — `SessionMetadataStore.loadOrDefault` persistence pattern
- `src-bun/app/config/settings.ts:72-104` — `defaultSettings` / `migrate` version pattern
- GitHub issue #242
