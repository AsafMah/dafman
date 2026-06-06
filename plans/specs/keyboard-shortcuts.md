# Unified Keyboard Shortcuts

**Status:** Draft, 2026-06-06

## Summary

Dafman should have one keyboard-shortcut system that maps normalized chords and sequences to stable command ids, so the command palette, visible shortcut hints, settings editor, and actual key handling all agree. The shortcut layer should reuse the existing `commandRegistry` execution contract instead of creating a second action system, while still respecting pane-specific editors such as Lexical, Xterm, dockview tabs, file pickers, and modal overlays.

## Motivation

Today shortcuts are useful but scattered: global `window` listeners, Vue template key modifiers, Lexical command handlers, Xterm custom handlers, and dockview-adjacent tab inputs each decide their own behavior. That makes it hard to answer “what shortcuts exist?”, impossible to detect conflicts centrally, and impossible for users to customize or reassign keys without editing source. A unified registry gives Dafman a predictable default keymap, a Settings → Keyboard Shortcuts editor, and palette rows that show the binding that actually fires.

## Current state

### Architecture and command-palette baseline

- Renderer code is organized around `src/App.vue`, feature components under `src/components/`, Pinia stores under `src/stores/`, pure helpers under `src/lib/`, IPC wrappers under `src/ipc/`, and the Lexical composer stack under `src/lexical/` (`ARCHITECTURE.md:136-172`).
- The renderer uses `@/*` imports by convention (`ARCHITECTURE.md:174`).
- Shell commands live in `src/stores/shell/commandRegistry.ts`; the file explicitly says the command palette is the source of truth for things the palette can fire and that producers call `register(cmd)` while the palette reads `visibleCommands` (`src/stores/shell/commandRegistry.ts:1-4`).
- `Command` already has stable `id`, `label`, optional `hint`, `icon`, `group`, `keywords`, `when`, `run`, `children`, and a display-only/runtime-library `shortcut?: string[]` field (`src/stores/shell/commandRegistry.ts:27-80`).
- The registry is replace-by-id and lazy-filters `when()` in a computed; `register()` overwrites the `Map`, `unregister()` deletes, and `visibleCommands` filters through `safeWhen()` (`src/stores/shell/commandRegistry.ts:84-110`).
- Built-in commands are seeded once from `registerBuiltinCommands()` and dynamic commands re-register on store changes; the comments call out static commands plus dynamic workspace/model/run-mode families (`src/lib/registerBuiltinCommands.ts:1-18`).
- `App.vue` calls `registerBuiltinCommands({ confirm: primeConfirm })` during boot and mounts `<CommandPalette />` once at the app root so its listener works regardless of panel focus (`src/App.vue:180-187`, `src/App.vue:416-417`).
- `CommandPalette.vue` owns open/close state locally, hardcodes the global Ctrl/Cmd+K listener, closes on Escape, and uses capture-phase `useEventListener(window, 'keydown', ...)` for both (`src/components/shell/CommandPalette.vue:152-252`).
- Palette row selection resolves a `CommandDef` from a flattened `valueToCommand` map, toggles parent rows without running them, and runs leaf commands after closing (`src/components/shell/CommandPalette.vue:72-135`, `src/components/shell/CommandPalette.vue:193-234`).
- Palette rows already pass `cmd.shortcut` into `vue-command-palette` items and render `<kbd>` chips through `CommandPaletteRow.vue` (`src/components/shell/CommandPalette.vue:270-320`, `src/components/shell/CommandPaletteRow.vue:56-65`).
- `vue-command-palette`’s `perform` path only fires for its own shortcut prop; clicks and Enter selection go through `@select-item`, which Dafman handles manually (`src/components/shell/CommandPalette.vue:23-31`). That means a Dafman-owned shortcut layer should not depend on the library’s global shortcut firing as the source of truth.
- Current built-ins define many command ids (`sessions-manager.toggle`, `jobs.open`, `terminals.open`, `terminal.new`, `terminal.newSession`, `settings.open`, `session.new`, `appearance.darkMode.toggle`, `view.nextGroup`, `view.prevGroup`, settings/session/model/workspace parents, etc.) but do not assign `shortcut` values in `registerBuiltinCommands.ts` (`src/lib/registerBuiltinCommands.ts:69-281`, `src/lib/registerBuiltinCommands.ts:324-671`).

### Settings and persistence baseline

- Settings are a versioned JSON document owned by `SettingsService` at `<userData>/settings.json`; load is synchronous at startup and updates write JSON through `Bun.write` (`src-bun/app/config/settings.ts:1-9`, `src-bun/app/config/settings.ts:360-400`).
- Backend settings currently use `SETTINGS_VERSION = 14`, `defaultSettings()`, coercion helpers, and `migrate()` to validate every settings subtree before stamping the current version (`src-bun/app/config/settings.ts:32`, `src-bun/app/config/settings.ts:70-104`, `src-bun/app/config/settings.ts:307-350`).
- The renderer and Bun-side IPC schemas mirror `Settings`; renderer settings currently include `appearance`, `layout`, `workspaces`, `notifications`, `tools`, `permissions`, and `terminal` (`src/ipc/types.ts:47-56`).
- Settings round-trip over `getSettings` and `updateSettings` (`src/ipc/types.ts:913-914`) and through the Pinia `settingsStore.update(next)` full-replace path (`src/stores/app/settingsStore.ts:74-99`).
- `SettingsPanel.vue` is a thin orchestrator; new categories are expected to either add a section component or an inline `SettingsGroup`, and add an id to the `collapsed` map (`src/components/settings/SettingsPanel.vue:1-18`, `src/components/settings/SettingsPanel.vue:51-87`).
- Existing section components bind controls to computed getters/setters and call typed settings-store setters, e.g. terminal preferences (`src/components/settings/TerminalSettingsSection.vue:1-75`).

### Layout, panes, and focus baseline

- `layoutStore` owns the dockview API and documents that new persistent UI surfaces should be dockview panels; edge panels are opened through `openEdgePanel(...)`, not ad hoc chrome (`src/stores/shell/layoutStore.ts:1-11`).
- `activeSessionId` tracks the currently-focused chat panel and is already used by command `when()` predicates; edge panels can make focus non-chat, so `lastFocusedSessionId` exists for workspace-scoped surfaces (`src/stores/shell/layoutStore.ts:143-154`).
- In v3, chat panels live inside inner dockviews owned by active groups, so active-session recomputation must inspect the active inner dockview before falling back (`src/stores/shell/layoutStore.ts:315-360`).
- Edge-panel ids and seeds are centralized in `src/constants/panels.ts`; current singleton panes are Sessions, Session details, Settings, Library, Jobs, Terminals, and Logs (`src/constants/panels.ts:40-53`, `src/constants/panels.ts:89-150`).

### Inventory of today’s shortcut/key handlers

| Area | Current chord/key | Current behavior | Where it lives | Current scope/context | Design note |
|---|---:|---|---|---|---|
| Command palette | Ctrl+K on Windows/Linux, Cmd+K on macOS | Toggle palette; ignores repeats, Alt, Shift; will not open over PrimeVue confirm/dialog overlays | `src/components/shell/CommandPalette.vue:152-172`, registered at `src/components/shell/CommandPalette.vue:251` | Global capture listener | Move to `commandPalette.toggle` command + global shortcut binding. Keep overlay guard in scope resolver. |
| Command palette | Escape | Close palette and restore previous focus / active composer fallback | `src/components/shell/CommandPalette.vue:174-191`, registered at `src/components/shell/CommandPalette.vue:252` | Palette-open global capture listener | Palette scope should own Escape above global scope. |
| Command palette rows | Enter / click | Parent rows expand/collapse; leaf rows close palette then run command | `src/components/shell/CommandPalette.vue:193-234` | Inside `vue-command-palette` dialog | Leave mostly native to palette UI; expose as non-customizable accessibility/navigation behavior. |
| Composer submit | Enter | Submit at session default send mode unless slash/mention menu is active; empty composer consumes as no-op | `src/components/chat/MessageComposer.vue:9-15`, `src/lexical/plugins.ts:118-154`, `src/lexical/plugins.ts:215-276` | Lexical composer | Central registry should provide the mapping, but Lexical should remain the event hook because it must respect composition and editor state. |
| Composer line break | Shift+Enter | Soft line break; when typeahead menu is open dispatches `INSERT_LINE_BREAK_COMMAND` so typeahead does not select | `src/lexical/plugins.ts:122-128`, `src/lexical/plugins.ts:215-230`, `src/lexical/plugins.ts:284-289` | Lexical composer | Shortcut action is editor mutation, not palette-visible command by default. |
| Composer paragraph | Ctrl/Cmd+Enter | Hard newline / paragraph insert | `src/lexical/plugins.ts:129-132`, `src/lexical/plugins.ts:215-225`, `src/lexical/plugins.ts:280-283` | Lexical composer | Store as `Mod+Enter`, display platform-specific. |
| Composer force send | Alt+Enter | Submit with `steer` mode | `src/lexical/plugins.ts:133-134`, `src/lexical/plugins.ts:215-222` | Lexical composer | App-specific, user-customizable if Lexical asks registry for current mapping. |
| Composer force queue | Ctrl/Cmd+Shift+Enter | Submit with `queue` mode | `src/lexical/plugins.ts:135`, `src/lexical/plugins.ts:215-220` | Lexical composer | App-specific, user-customizable. |
| Composer interrupt | Ctrl/Cmd+Alt+Enter | Abort current turn then send / submit with `interrupt` mode | `src/components/chat/MessageComposer.vue:357-400`, `src/lexical/plugins.ts:136`, `src/lexical/plugins.ts:215-222` | Lexical composer | App-specific, destructive enough to keep explicit modifier and conflict warnings. |
| Composer markdown shortcuts | Markdown typing patterns like `# `, lists, fences, `**` | Lexical markdown transformer auto-formatting when enabled | `src/components/chat/MessageComposer.vue:19-24`, `src/lexical/plugins.ts:84-92` | Lexical rich-text composer | Treat as editor feature, not global shortcut registry. Settings can link to Markdown toggle, not rebind individual patterns. |
| Slash command menu | Tab while slash menu open | Complete highlighted slash command text without executing | `src/components/chat/SlashCommandPlugin.vue:60-75` | Lexical slash typeahead | Local typeahead shortcut; can stay local or migrate to `composer.typeahead` scope later. |
| Slash command menu | Enter while slash menu open | Lexical typeahead select; no-arg commands execute locally, arg-taking commands complete text | `src/components/chat/SlashCommandPlugin.vue:173-200`; menu-active coordination in `src/lexical/composerMenuState.ts:4-13` | Lexical slash typeahead | Keep the typeahead-owned Enter behavior; central registry must defer composer Enter when typeahead active. |
| Mention file picker | ArrowDown / ArrowUp | Move highlighted @-file result while editor retains focus | `src/components/chat/MentionPlugin.vue:15-20`, `src/components/chat/MentionPlugin.vue:160-172` | Window capture while mention picker has results | Replace window listener with `filePicker` / `composer.typeahead` scoped handler or keep as adapter into shared registry. |
| File picker input | ArrowDown / ArrowUp / Enter / Escape | Navigate results, select highlighted result, dismiss picker | `src/components/shared/FilePicker.vue:160-175`, bound at `src/components/shared/FilePicker.vue:270-271` | Focused FilePicker input | Local navigation; not user-reassignable by default. |
| File picker toggles | Alt+H / Alt+I | Toggle hidden files / ignored files while picker is open, even when editor has focus | `src/components/shared/FilePicker.vue:178-196`, labels at `src/components/shared/FilePicker.vue:285-298` | Window capture during FilePicker lifecycle | Good candidate for scoped shortcuts with visible hints. |
| Composer command terminal | `!`, then second `!` from empty composer | Enter command-terminal mode, clear editor, request embedded terminal | `src/composables/useComposerCommandMode.ts:1-6`, `src/composables/useComposerCommandMode.ts:109-130`, bound by `src/components/chat/MessageComposer.vue:433-439` | Composer capture handler | Model as a composer-only sequence/typed trigger, with strong safeguards against firing during normal text entry. |
| Composer command terminal | Escape then Escape within 400 ms | Exit command-terminal mode | `src/composables/useComposerCommandMode.ts:67-98` | Embedded terminal in composer | Sequence support needs timeout and per-scope sequence state. |
| Composer command terminal | Ctrl+Backspace | Exit command-terminal mode | `src/composables/useComposerCommandMode.ts:99-106` | Embedded terminal in composer | Terminal-like scope; should beat shell input only when command terminal wrapper is active. |
| Inline message editor | Ctrl/Cmd+Enter | Save edited message | `src/components/chat/MessageEditorBody.vue:55-78`, hint in `src/components/chat/MessageEditor.vue:71-72` | Lexical message editor | Migrate to `messageEditor` scope; keep Lexical command hook. |
| Inline message editor | Ctrl/Cmd+Shift+Enter | Save and fork when `canFork` | `src/components/chat/MessageEditorBody.vue:55-78`, hint in `src/components/chat/MessageEditor.vue:71-72` | Lexical message editor | Same. |
| Inline message editor | Escape | Cancel edit | `src/components/chat/MessageEditorBody.vue:80-88`, hint in `src/components/chat/MessageEditor.vue:71-72` | Lexical message editor | Same. |
| Terminal panel | Ctrl+Shift+C / Alt+Insert | Copy Xterm selection to clipboard; returns `false` to stop Xterm if selected text exists | `src/components/terminal/TerminalPanel.vue:237-254`, installed at `src/components/terminal/TerminalPanel.vue:398-399` | Xterm custom key handler | Keep Xterm hook; ask shortcut registry only for terminal-scope app bindings, then otherwise pass through to PTY. |
| Pending user-input request | Ctrl+Enter | Submit typed answer | `src/components/permissions/PendingRequestCard.vue:411-414` | Focused PrimeVue Textarea inside pending card | Migrate to modal/request scope; consider adding `Mod+Enter` alias for macOS. |
| Chat tab rename | Enter / Escape | Commit or cancel session tab rename; stops other keydown propagation | `src/components/chat/ChatTab.vue:69-77`, `src/components/chat/ChatTab.vue:214-217` | Focused tab rename input | Keep local editing behavior; not a global shortcut. |
| Group tab rename | Enter / Escape | Commit or cancel group rename | `src/components/shell/GroupTab.vue:7-10`, `src/components/shell/GroupTab.vue:244-246` | Focused group rename input | Keep local editing behavior; not a global shortcut. |
| Reasoning block | Enter / Space | Toggle compact reasoning expansion | `src/components/chat/ReasoningBlock.vue:45-52` | Focused `role=button` reasoning header | Native accessibility activation; do not make user-reassignable. |
| Session header chips | Enter / Space | Open workspace folder chip or agent/session-details chip | `src/components/session/SessionHeaderControls.vue:306-342` | Focused chip with `role=button` | Native accessibility activation; command shortcuts can be added separately. |
| Workspace settings input | Enter | Commit default workspace draft | `src/components/settings/WorkspaceSettingsSection.vue:18-24`, `src/components/settings/WorkspaceSettingsSection.vue:80-86` | Focused settings input | Local form behavior; not user-reassignable. |
| Dockview | Library/native tab and focus keys, if any | Dockview handles its own widget internals; Dafman code has no central dockview keyboard adapter today | `src/App.vue:424-433`, `src/stores/shell/layoutStore.ts:1-11` | Dockview component internals | Do not fight library internals. Add app-level layout commands (`view.nextGroup`, `view.prevGroup`, pane toggles) around dockview APIs. |

## Design

### 1. One action model: shortcuts fire commands

Use `commandRegistry` as the action catalog. A shortcut never calls arbitrary component code directly if a stable command id can represent the action.

Concrete changes:

- Extend `src/stores/shell/commandRegistry.ts` with lookup helpers:
  - `getCommand(id: string): Command | null` over top-level commands and visible child commands.
  - `visibleFlattenedCommands: computed<Command[]>` for palette, settings search, and shortcut resolution.
  - `runCommand(id: string): boolean | Promise<boolean>` that applies existing `when()` visibility, handles parent commands as non-runnable unless explicitly marked, catches/logs errors the same way `CommandPalette.vue` currently does, and returns whether anything ran.
- Keep `Command.shortcut?: string[]` as a display compatibility field for the first migration, but make it derived from the shortcut registry for built-ins. Long term, command registrations should not hardcode shortcuts; the keymap owns them.
- Add command ids for shell actions that currently are only local component state:
  - `commandPalette.toggle`, `commandPalette.open`, `commandPalette.close`.
  - `library.open`, `logs.open`, `sessionDetails.toggle` for existing edge panels from `PANEL_IDS`.
  - `keyboardShortcuts.open` to open Settings focused to the Keyboard Shortcuts section.
- Add scoped, non-palette or advanced command ids for app-specific editor actions:
  - `composer.submit.default`, `composer.insert.softBreak`, `composer.insert.paragraph`, `composer.submit.steer`, `composer.submit.queue`, `composer.submit.interrupt`.
  - `composer.commandMode.enter`, `composer.commandMode.exit`.
  - `messageEditor.save`, `messageEditor.saveAndFork`, `messageEditor.cancel`.
  - `terminal.copySelection`.
  - `filePicker.toggleHidden`, `filePicker.toggleIgnored`.
  - `pendingRequest.submitUserInput`.

Recommendation: add an optional command presentation field rather than hiding these outside the command registry:

```ts
interface Command {
  id: string;
  label: string;
  run: () => void | Promise<void>;
  when?: () => boolean;
  children?: Command[];
  /** Transitional display field, derived from the effective keymap for built-ins. */
  shortcut?: string[];
  palette?: {
    visible?: boolean; // default true
    group?: string;
  };
  shortcutContext?: ShortcutScopeId[]; // display/filter hint only
}
```

`palette.visible === false` lets Keyboard Settings list local editor actions without making every text-editing primitive noisy in Ctrl/Cmd+K.

### 2. Shortcut registry and data model

Add `src/stores/shell/shortcutRegistry.ts` plus pure helpers under `src/lib/shortcuts/`.

Proposed data model:

```ts
export type ShortcutScopeId =
  | 'global'
  | 'modal'
  | 'commandPalette'
  | 'activePanel'
  | 'chatPanel'
  | 'composer'
  | 'composerTypeahead'
  | 'composerCommandTerminal'
  | 'messageEditor'
  | 'terminal'
  | 'filePicker'
  | 'pendingRequest'
  | 'settings'
  | 'dockviewTabRename';

export type ShortcutEventPhase = 'keydown' | 'keyup';
export type ShortcutRepeat = 'ignore' | 'allow';
export type EditablePolicy = 'ignore-editables' | 'allow-editables' | 'only-editables';
export type ShortcutPredicateId =
  | 'always'
  | 'commandVisible'
  | 'hasActiveSession'
  | 'hasTerminalSelection'
  | 'typeaheadOpen'
  | string;

export interface ShortcutConflict {
  kind: 'exact' | 'scope-shadow' | 'prefix' | 'reserved-native' | 'unknown-command';
  bindingId: string;
  conflictingBindingId?: string;
  commandId: string;
  scope: ShortcutScopeId;
  message: string;
}

export interface KeyPress {
  /** Canonical modifier token. `mod` maps to Meta on macOS, Control elsewhere. */
  modifiers: ReadonlyArray<'Mod' | 'Ctrl' | 'Meta' | 'Alt' | 'Shift'>;
  /** Logical key for display and non-printable matching: `Enter`, `Escape`, `ArrowDown`, `K`, `/`. */
  key: string;
  /** Optional physical-key fallback for layout-sensitive shortcuts: `KeyK`, `Backquote`, `Digit1`. */
  code?: string;
}

export interface KeySequence {
  presses: readonly KeyPress[];
  timeoutMs?: number; // default 1000 for multi-press sequences
}

export interface KeyBinding {
  id: string;               // stable default id, e.g. `default.commandPalette.toggle`
  commandId: string;        // stable commandRegistry id
  scope: ShortcutScopeId;
  sequence: KeySequence;
  when?: ShortcutPredicateId;
  phase?: ShortcutEventPhase; // default keydown
  repeat?: ShortcutRepeat;    // default ignore
  editablePolicy?: EditablePolicy;
  preventDefault?: boolean;   // default true for app commands
  stopPropagation?: boolean;  // default true once handled
  source: 'default' | 'user' | 'runtime';
  locked?: boolean;           // cannot reassign, e.g. native accessibility Enter/Space
  native?: boolean;           // documented but handled by library/browser/editor
  description?: string;
}

export interface ShortcutResolution {
  binding: KeyBinding;
  commandId: string;
  scope: ShortcutScopeId;
  conflict?: ShortcutConflict;
}
```

Settings persistence should store only differences from defaults:

```ts
export interface KeyboardShortcutPrefs {
  schemaVersion: 1;
  disabledDefaultBindingIds: string[];
  customBindings: UserKeyBinding[];
}

export interface UserKeyBinding {
  id: string; // `user.${crypto.randomUUID()}`
  commandId: string;
  scope: ShortcutScopeId;
  sequence: KeySequence;
}
```

Add this as `settings.keyboardShortcuts` (or `settings.keyboard`, see open question 2), increment backend `SETTINGS_VERSION`, add renderer/Bun IPC types, add `defaultSettings()` defaults, and add a backend `coerceKeyboardShortcuts(raw)` in the same style as `coerceTerminal()`.

### 3. Scope and focus resolution

Resolution is a stack, not a flat global map. The same chord can be valid in different panes when the scopes cannot both win for the same key event.

Default stack, highest priority first:

1. `modal`: PrimeVue confirm/dialog masks, pending cards, blocking overlays. Global shortcuts do not fire unless a binding explicitly opts into modal scope.
2. `commandPalette`: palette search input and list. Escape closes; Enter/Arrow navigation remains library-owned.
3. `filePicker` / `composerTypeahead`: active slash or @ picker. Picker navigation wins over composer submit.
4. `messageEditor`: inline user-message editing. Save/cancel wins over global commands.
5. `composerCommandTerminal`: embedded terminal launched from composer command mode.
6. `terminal`: active Xterm terminal panel. Terminal-scope app bindings run first; otherwise the event passes through to the PTY.
7. `composer`: focused Lexical composer.
8. `settings` / `activePanel` / `chatPanel`: active dockview panel type, derived from focus and `layoutStore`.
9. `global`: shell-level commands that are safe from most panes.

Focus detection should be explicit where possible:

- Add a tiny directive/composable, e.g. `v-shortcut-scope="'composer'"` or `provideShortcutScope(scopeId)`, that writes `data-shortcut-scope` on root elements and registers lifecycle metadata.
- Fall back to DOM containment only for third-party widgets (`[command-dialog]`, Xterm root, PrimeVue masks).
- Use `layoutStore.activeSessionId`, `lastFocusedSessionId`, active group/panel component, and `PANEL_IDS` for panel-derived scopes. Do not infer pane identity from user-visible titles.
- Text inputs/contenteditable default to `ignore-editables` for global shortcuts, except bindings explicitly marked `allow-editables` (`commandPalette.toggle`) or `only-editables` (`messageEditor.save`, composer actions).

Recommended rule: the most specific active scope wins. Exact duplicate chords inside the same scope are hard conflicts. A more-specific binding may intentionally shadow a global binding, but the Settings UI must label it as “shadows Global → X while composer is focused.”

### 4. Chords, sequences, and cross-platform syntax

Canonical storage format:

- Use `Mod` for cross-platform “primary modifier.” Display as `⌘` on macOS and `Ctrl` elsewhere.
- Store modifiers in canonical order: `Mod`, `Ctrl`, `Meta`, `Alt`, `Shift`, then key.
- Treat `Ctrl` and `Meta` as distinct when the user explicitly records them. `Mod` is only used for defaults and user bindings that choose “primary modifier.”
- Store both `key` and optional `code`. MDN notes `KeyboardEvent.key` is locale/modifier-sensitive, while `code` is physical-key-oriented; use `key` for non-printable/logical controls and store `code` when the user records a printable key where layout matters.
- Do not use `event.key` casing as identity; normalize letter display to uppercase and matching to lower/canonical.
- Ignore `event.repeat` by default for commands. Allow repeat only for navigation-style bindings that explicitly opt in.
- Ignore IME composition (`isComposing` or `key === 'Process'`) for text-editor scopes, preserving the existing composer guard (`src/lexical/plugins.ts:247-258`).

Sequence semantics:

- Multi-press sequences are space-separated in display: `Mod+K Mod+S`, `G S`, `Escape Escape`.
- Default sequence timeout: 1000 ms; command-terminal Escape Escape keeps its current 400 ms as an override unless the UX wants one consistent timeout.
- During a partial sequence, show a small transient status-bar hint (`Mod+K…`) only outside the command palette. Do not block normal typing for printable-key sequences in editable scopes unless the binding is explicitly in that editable scope.
- Prefix conflicts are real conflicts: `G` and `G S` cannot both fire immediately in the same scope. Either require a timeout for the shorter binding or reject the assignment.

### 5. Conflict detection

Run conflict checks whenever default keymap + user overrides are merged and whenever the Settings editor records a new binding.

Conflict classes:

- **Exact conflict:** same normalized sequence, same winning scope, both enabled. Hard error unless the user disables/reassigns one.
- **Scope shadow:** same sequence, different scopes where one can be active inside the other (`composer` shadows `global`). Allowed, but show a warning and explain which context wins.
- **Prefix conflict:** one sequence is a prefix of another in the same winning scope (`G` vs `G S`, `Escape` vs `Escape Escape`). Hard error unless the shorter binding is explicitly delayed and the UX accepts the delay.
- **Reserved/native conflict:** browser/editor/terminal native shortcuts (`Tab` focus traversal, text editing keys, terminal shell keys, accessibility Enter/Space) should be marked locked/native or require a warning override.
- **Invisible command conflict:** binding points to a command whose `when()` is currently false or command id is unknown. Store can save it, but runtime resolution cannot fire it; settings UI should label as unavailable in current context.

Conflict output should include `bindingId`, `commandId`, `scope`, normalized sequence, and a human-readable message. The Settings editor should use that same data; tests should assert conflict objects, not DOM text.

### 6. Default keymap

Default keymap should cover the current inventory first, then add a small set of pane navigation shortcuts. Defaults should be conservative: avoid single printable global keys, avoid stealing browser/system-level chords unless Dafman already does, and avoid terminal PTY input except terminal-scope copy.

| Scope | Command id | Default binding | Palette-visible? | Notes |
|---|---|---:|---|---|
| global | `commandPalette.toggle` | `Mod+K` | Yes | Replaces current hardcoded Ctrl/Cmd+K. |
| global | `session.new` | `Mod+N` | Yes | Existing command. Desktop app, so acceptable despite browser convention. |
| global | `settings.open` | `Mod+,` | Yes | Common desktop settings chord. |
| global | `sessions-manager.toggle` | `Mod+Shift+S` | Yes | Existing command. |
| global | `library.open` | `Mod+Shift+L` | Yes | New command for existing Library edge panel. |
| global | `terminals.open` | `Mod+Backquote` | Yes | Existing command. Display can render as Ctrl/⌘ plus the backquote key; store `Backquote` code for matching. |
| global | `terminal.new` | `Mod+Shift+Backquote` | Yes | Existing command. |
| global | `jobs.open` | `Mod+Shift+J` | Yes | Existing command. |
| global | `logs.open` | `Mod+Shift+O` | Yes | New command for log viewer panel; keep `logs.openFolder` unbound by default. |
| global | `sessionDetails.toggle` | `Mod+I` | Yes | New command for right details rail. Watch conflict with browser devtools only if packaged webview exposes it. |
| global | `view.nextGroup` | `Mod+Shift+]` | Yes | Existing command. |
| global | `view.prevGroup` | `Mod+Shift+[` | Yes | Existing command. |
| global | `keyboardShortcuts.open` | `Mod+K Mod+S` | Yes | Sequence opens Settings → Keyboard Shortcuts; chosen to live under the palette mnemonic. |
| commandPalette | `commandPalette.close` | `Escape` | No | Palette-owned. |
| composer | `composer.submit.default` | `Enter` | No/advanced | Existing behavior. Deferred when typeahead active. |
| composer | `composer.insert.softBreak` | `Shift+Enter` | No/advanced | Existing behavior. |
| composer | `composer.insert.paragraph` | `Mod+Enter` | No/advanced | Existing behavior (`Ctrl/Cmd+Enter`). |
| composer | `composer.submit.steer` | `Alt+Enter` | No/advanced | Existing behavior. |
| composer | `composer.submit.queue` | `Mod+Shift+Enter` | No/advanced | Existing behavior. |
| composer | `composer.submit.interrupt` | `Mod+Alt+Enter` | No/advanced | Existing behavior. |
| composer | `composer.commandMode.enter` | `! !` | No/advanced | Preserve current trigger; Settings should warn this is text-sensitive. |
| composerTypeahead | `slash.completeSelected` | `Tab` | No/native | Existing slash-menu behavior; not user-reassignable initially. |
| filePicker | `filePicker.toggleHidden` | `Alt+H` | No/advanced | Existing behavior. |
| filePicker | `filePicker.toggleIgnored` | `Alt+I` | No/advanced | Existing behavior. |
| filePicker | `filePicker.select` / native | `Enter` | No/native | Existing local picker navigation. |
| messageEditor | `messageEditor.save` | `Mod+Enter` | No/advanced | Existing behavior. |
| messageEditor | `messageEditor.saveAndFork` | `Mod+Shift+Enter` | No/advanced | Existing behavior when forkable. |
| messageEditor | `messageEditor.cancel` | `Escape` | No/advanced | Existing behavior. |
| terminal | `terminal.copySelection` | `Ctrl+Shift+C`, `Alt+Insert` | No/advanced | Existing Xterm handler. On macOS consider `Cmd+C` only if Xterm/native copy does not already own it. |
| composerCommandTerminal | `composer.commandMode.exit` | `Escape Escape`, `Ctrl+Backspace` | No/advanced | Existing behavior. |
| pendingRequest | `pendingRequest.submitUserInput` | `Mod+Enter`, compatibility `Ctrl+Enter` | No/advanced | Current code only has Ctrl+Enter; add Mod+Enter for macOS parity while preserving Ctrl+Enter. |
| dockviewTabRename | native rename commit/cancel | `Enter`, `Escape` | No/native | Existing local form behavior. |
| accessibility | native activate focused role/button | `Enter`, `Space` | No/native | Reasoning blocks and chips should keep WAI-ARIA activation, not be user-reassigned. |

### 7. Settings UI: Keyboard Shortcuts editor

Add `src/components/settings/KeyboardShortcutsSection.vue` and include it from `SettingsPanel.vue` after Appearance or before Terminal.

Core UI:

- Search field over command label, id, group, keywords, current shortcuts, and scope.
- Group rows by command group + scope: Global, Navigation, Sessions, Active Session, Composer, Terminal, File Picker, Message Editing, Settings, Native.
- Each command row shows:
  - label, command id, scope, current binding chips, default binding chips, conflict badges, “Reset” button, “Add shortcut” button.
  - if palette-visible, it should match the palette label/group; if advanced/native, label it “Editor shortcut” or “Native behavior.”
- Recording flow:
  1. User clicks “Add shortcut” / “Edit.”
  2. Modal captures next chord or sequence, with visible timer for sequences.
  3. UI normalizes to canonical `KeySequence`, resolves conflicts, and shows exact/shadow/prefix warnings.
  4. Save writes `settings.keyboardShortcuts.customBindings` and/or `disabledDefaultBindingIds` through `settingsStore.update()`.
- Reassignment flow disables the old default binding id and adds a custom binding for the same command/scope.
- “Reset command” removes custom bindings for that command and re-enables default binding ids.
- “Reset all shortcuts” clears the keyboard prefs object after confirmation.
- “Show native/editor shortcuts” toggle controls noisy rows like Enter/Space activation, Markdown shortcuts, and FilePicker navigation.

Palette presentation:

- Palette rows should show the effective first binding for that command in the current platform/context. If a command has multiple active bindings, show the primary one and a `+1` tooltip or include all if chips fit.
- Palette search should include shortcut text (`mod k`, `ctrl enter`) so users can find commands by chord.
- If a command is hidden by `when()`, its shortcut should not fire and should not show in palette, but Settings can still list it as unavailable.

### 8. Migration and coexistence plan

Do not big-bang every handler through one `window` listener. Some surfaces need their native hook because the editor/library has state the global DOM event cannot safely infer.

Recommended migration:

1. **Global shell shortcuts first.** Add shortcut registry, default keymap, settings schema, `commandPalette` open-state store, and bind global commands (`Mod+K`, pane toggles, group switching). Remove hardcoded Ctrl/Cmd+K from `CommandPalette.vue` after parity tests pass.
2. **Palette display integration.** Derive `Command.shortcut` display from `shortcutRegistry.effectiveBindingsForCommand(command.id)` and include shortcut text in `searchValueFor`.
3. **Settings editor.** Add Keyboard Shortcuts section backed by settings overrides and conflict detection. Start with global commands and pane toggles.
4. **Lexical adapter.** Keep `KEY_ENTER_COMMAND` and `KEY_ESCAPE_COMMAND` hooks, but replace hardcoded modifier matrix with `shortcutRegistry.match(event, 'composer' | 'messageEditor', context)`. Preserve IME guards, empty guards, and typeahead deferral.
5. **FilePicker and mention adapter.** Replace window-level Alt+H/Alt+I and Arrow forwarding with scoped shortcut registration while picker is mounted. Keep local input navigation for focused input.
6. **Xterm adapter.** Keep `attachCustomKeyEventHandler`; call shortcut registry for terminal-scope commands first, then return `true` to pass all other keys through to the PTY. Copy-selection remains local because it depends on `term.getSelection()`.
7. **Document native leftovers.** Keep accessibility Enter/Space, rename input Enter/Escape, Lexical markdown typing patterns, and dockview internals native. List them in Keyboard Settings under a “Native / not reassignable” filter so the inventory is still complete.

## Open questions

1. **Build vs library:** Should Dafman depend on a small keybinding parser/matcher such as `tinykeys`, use older `mousetrap`, or hand-roll the parser? Recommended default: use `tinykeys` behind a Dafman adapter for parsing/matching/sequences, but keep scopes, conflict detection, settings persistence, and command execution in Dafman-owned code.
2. **Persistence field name:** Store prefs as `settings.keyboardShortcuts` (explicit) or `settings.keyboard` (broader future input prefs)? Recommended default: `keyboardShortcuts` because it is precise and mirrors the Settings section.
3. **Scope shadow policy:** Should users be allowed to assign the same chord in a specific scope and global scope? Recommended default: allow intentional shadowing with a warning; block exact same-scope conflicts.
4. **Global shortcuts inside terminal:** Should global pane shortcuts like `Mod+K` fire while Xterm has focus? Recommended default: allow only a small allowlist (`commandPalette.toggle`, maybe `settings.open`) and otherwise let terminal input win.
5. **Composer Enter customization:** Should the core Enter send/newline behavior be fully reassignable, or only display/documented? Recommended default: make force-send variants reassignable after the Lexical adapter exists, but keep plain Enter and Shift+Enter locked until there is strong test coverage because they are core typing semantics.
6. **Mac parity for current Ctrl-only bindings:** Pending request submit is currently `Ctrl+Enter` in Vue template, not `Cmd+Enter`. Should the migration add `Mod+Enter` and keep `Ctrl+Enter` as an alias? Recommended default: yes.
7. **Presentation in command palette:** Should every shortcutable local editor action appear in Ctrl/Cmd+K? Recommended default: no; show them in Keyboard Settings by default and expose only user-facing commands in the palette unless the action is safe and understandable outside its pane.
8. **Sequence timeout:** Use tinykeys’ 1000 ms default, keep command terminal’s current 400 ms double-Escape, or use one global timeout? Recommended default: global 1000 ms, with per-binding override for `Escape Escape` if user testing shows 1000 ms accidentally exits terminals.
9. **Per-workspace keymaps:** Should shortcuts be global app settings only or per workspace/project? Recommended default: app-global only for the first version; per-workspace adds synchronization and surprise without a current requirement.

## Alternatives / options

### Matcher/parser library

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| `tinykeys` | Tiny TypeScript library; supports `$mod`, sequences, matching against `KeyboardEvent.key` and `code`, parsing for display, and documents sequence conflicts. | Scope/conflict/persistence still need custom code; another dependency. | **Recommended default** behind a Dafman adapter. |
| `mousetrap` | Mature, no dependency, supports combinations and Gmail-style sequences; handles international layouts. | Older JavaScript API, global-binding model does not map cleanly to Dafman scoped panes, plugin ecosystem is extra surface. | Acceptable fallback, not preferred. |
| Hand-rolled | Full control, no dependency, can optimize for Dafman’s exact model. | Easy to get layout/modifier/sequence edge cases wrong; duplicates library work. | Only choose if dependency policy rejects tinykeys. |

### Persistence location

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| Existing `settings.json` | Already versioned, typed, migrated, loaded at boot, and exposed to renderer; good fit for user preferences. | Settings object grows; full-replace writes mean large keymaps rewrite the whole file. | **Recommended default.** |
| New `keybindings.json` file | Easy manual editing/import/export; could mirror VS Code. | New IPC/file lifecycle, migration, corruption handling, and UI save path; more places to debug. | Defer until users ask for manual file editing. |
| LocalStorage | Renderer-only, simple. | Not portable with backend settings, harder to validate/migrate, webview storage reset risk. | Do not use. |

### Scope resolution

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| Single global listener with DOM-derived scope stack | One place to handle global chords and conflicts. | Fragile without explicit scope markers; editor libraries still need adapters. | Use for shell-level dispatch plus explicit `data-shortcut-scope`. |
| Per-component registration only | Naturally local; easier for Xterm/Lexical. | Inventory/conflict detection becomes decentralized again unless components register metadata centrally. | Use as adapter layer, not as the whole design. |
| Browser/native only | Least custom code. | Cannot deliver user customization, palette integration, or conflict detection. | Not acceptable for this feature. |

### Migration depth

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| Migrate all handlers immediately | Maximum consistency. | High risk in Lexical/Xterm/typeahead; many subtle typing regressions. | Avoid. |
| Global first, adapters over time | Delivers palette/settings value quickly; preserves editor correctness. | Temporary hybrid system remains. | **Recommended default.** |
| Metadata-only inventory, no runtime migration | Low risk. | Does not actually allow customization or conflict prevention. | Not enough. |

### Presentation

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| Show all shortcuts in command palette | Discoverable. | Palette becomes noisy with Enter/Escape/native editor internals. | No. |
| Palette shows effective shortcuts for palette commands; Settings shows everything | Clean palette, complete inventory. | Users must open Settings for editor/native details. | **Recommended default.** |
| Separate “Keyboard Shortcuts” command center outside Settings | Room for power UI. | Another surface; current Settings pattern is ready. | Defer. |

## Implementation phases

1. **Evidence and tests harness**
   - Add pure tests for shortcut normalization, platform `Mod` display, sequence parsing, exact/scope/prefix conflicts, and settings merge.
   - Use current inventory above as fixtures; do not touch runtime behavior yet.

2. **Core registry**
   - Add `src/lib/shortcuts/normalize.ts`, `src/lib/shortcuts/conflicts.ts`, `src/lib/defaultKeymap.ts`, and `src/stores/shell/shortcutRegistry.ts`.
   - Extend `commandRegistry` with flattened command lookup and `runCommand(id)`.
   - Add a small `commandPaletteStore` so `commandPalette.toggle/open/close` can be a command instead of component-local-only state.

3. **Settings persistence**
   - Add `KeyboardShortcutPrefs` to `src/ipc/types.ts` and `src-bun/rpc.ts`.
   - Add defaults/coercion/migration in `src-bun/app/config/settings.ts`; increment `SETTINGS_VERSION`.
   - Add `settingsStore.setKeyboardShortcuts(...)` or a patch-style setter.

4. **Global shell cutover**
   - Register default global keymap and effective binding display.
   - Move Ctrl/Cmd+K from `CommandPalette.vue` into the shortcut registry.
   - Add commands for missing edge panels (`library.open`, `logs.open`, `sessionDetails.toggle`, `keyboardShortcuts.open`).
   - Verify palette toggle, pane toggles, group navigation, and overlay/modal suppression.

5. **Keyboard Settings UI**
   - Add `KeyboardShortcutsSection.vue` to `SettingsPanel.vue` with search, groups, recorder, conflict badges, reset command, and reset all.
   - Make command palette search include shortcut text and display effective binding chips.

6. **Scoped adapters**
   - Lexical composer/message-editor adapter for Enter/Escape commands.
   - FilePicker/Mention adapter for picker navigation and Alt+H/Alt+I.
   - Xterm adapter for terminal copy and future terminal-scope commands.
   - Keep accessibility/native handlers documented but locked.

7. **Documentation and manual QA**
   - Add user-facing docs for `Mod`, scopes, conflicts, reset, and native/non-reassignable shortcuts.
   - Add/refresh manual tests only for behaviors not covered by unit/e2e (especially terminal focus and IME/composition if automation cannot drive it).

## Verification

- Unit tests for normalization:
  - `Mod+K` displays `Ctrl+K` on Windows/Linux and `⌘K` or `Cmd+K` on macOS.
  - `Ctrl+K` and `Meta+K` remain distinct when explicitly recorded.
  - `event.key`/`event.code` fallbacks match printable and non-printable keys as designed.
- Unit tests for conflict detection:
  - exact same-scope conflicts are hard errors.
  - composer `Enter` can shadow global only with a shadow warning.
  - `G` vs `G S` prefix conflict is caught.
  - disabled default + custom replacement yields one effective binding.
- Settings tests:
  - missing `keyboardShortcuts` migrates to defaults.
  - malformed custom bindings are dropped without dropping other settings.
  - updateSettings round-trip preserves custom bindings.
- Component tests:
  - `CommandPalette.test.ts` opens via effective `Mod+K`, closes via Escape, and does not open over confirm/dialog overlays.
  - palette rows show effective shortcut chips and update after settings override.
  - Keyboard Settings recorder detects conflicts and reset restores defaults.
  - FilePicker Alt+H/Alt+I still works while composer focus remains in Lexical.
- Lexical tests:
  - existing `submitOnEnter.test.ts` matrix remains green after adapter migration.
  - IME composition still never submits.
  - slash/mention active state still defers plain Enter to typeahead selection.
- Terminal tests/manual QA:
  - Ctrl+Shift+C / Alt+Insert copy selection and do not write to PTY when selection exists.
  - normal terminal input and shell shortcuts pass through when no terminal-scope binding matches.
- E2E smoke:
  - open app, use `Mod+K`, run New Session, open Settings → Keyboard Shortcuts, reassign a harmless command, verify palette chip and runtime binding, reset it.

## Critical files

- `src/stores/shell/commandRegistry.ts` — command interface, idempotent registration, `visibleCommands`.
- `src/lib/registerBuiltinCommands.ts` — built-in command ids, dynamic command families, active-session command gates.
- `src/components/shell/CommandPalette.vue` — current global hotkey, palette state, selection-to-command execution, shortcut chip plumbing.
- `src/components/shell/CommandPaletteRow.vue` — shortcut display chips.
- `src/lib/palette.ts` — palette search value formatting; should include shortcut text after migration.
- `src/App.vue` — built-in command registration and root palette mount.
- `src/stores/shell/layoutStore.ts` — active session/panel state, edge-panel open/toggle APIs.
- `src/constants/panels.ts` — stable edge-panel ids and pane inventory.
- `src/lexical/plugins.ts` — composer Enter matrix and IME/typeahead guards.
- `src/composables/useComposerCommandMode.ts` — `! !`, Escape Escape, Ctrl+Backspace command-terminal behavior.
- `src/components/chat/MessageComposer.vue` — Lexical plugins and composer key capture wiring.
- `src/components/chat/MessageEditorBody.vue` — inline editor save/fork/cancel shortcuts.
- `src/components/chat/SlashCommandPlugin.vue` and `src/components/chat/MentionPlugin.vue` — typeahead key behavior.
- `src/components/shared/FilePicker.vue` — file picker navigation and Alt+H/Alt+I.
- `src/components/terminal/TerminalPanel.vue` — Xterm custom key handler.
- `src/components/permissions/PendingRequestCard.vue` — Ctrl+Enter user-input submit.
- `src/stores/app/settingsStore.ts`, `src/ipc/types.ts`, `src-bun/rpc.ts`, `src-bun/app/config/settings.ts` — settings persistence and wire schema.
- `src/components/settings/SettingsPanel.vue` and new `KeyboardShortcutsSection.vue` — Settings UI integration.

## References

- Read-only shell investigation: `agent://ShellSurfaces`.
- Renderer architecture and module map: `ARCHITECTURE.md:136-230`.
- Command registry contract: `src/stores/shell/commandRegistry.ts:1-110`.
- Built-in command seeding: `src/lib/registerBuiltinCommands.ts:1-772`.
- Command palette overlay: `src/components/shell/CommandPalette.vue:1-320`.
- Settings persistence: `src-bun/app/config/settings.ts:1-400`, `src/ipc/types.ts:47-56`, `src/ipc/types.ts:913-914`, `src/stores/app/settingsStore.ts:1-115`.
- Shortcut inventory searches: `keydown|KeyboardEvent|useEventListener`, Vue `@keydown`, Lexical `KEY_*_COMMAND`, and `shortcut/keybinding` searches over `src/` on 2026-06-06.
- `tinykeys`: https://github.com/jamiebuilds/tinykeys — small TS keybinding library with `$mod`, sequences, `key`/`code` matching, parse support, and sequence-conflict behavior.
- `mousetrap`: https://github.com/ccampbell/mousetrap — mature JavaScript shortcut library with combinations and Gmail-style sequences.
- MDN `KeyboardEvent.key`: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key — key values are locale/modifier-sensitive; repeated keydown behavior and IME/text-input caveats matter for matching.
