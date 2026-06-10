# SessionsManager.vue God-Object Split

**Status:** Draft — 2026-06-10

---

## Summary

Split `src/components/session/SessionsManager.vue` into a thin shell plus focused child components for the new-session form, toolbar/search controls, group sections, and session rows. This is a no-behavior-change extraction: stores, resume/delete side effects, confirmation popup ownership, and layout interactions stay in the shell while render-heavy markup and scoped CSS move next to the elements they style. The goal is to bring `SessionsManager.vue` below the 800-line soft budget and remove or ratchet down its file-size budget entry.

---

## Motivation

`CODE_AUDIT.md` flags `SessionsManager.vue` as the cycle’s biggest regressor: 1,039 → 1,340 lines (+301), now a new god component mixing session list rendering, toolbar, group management, drag/context actions, and row behavior (`CODE_AUDIT.md:21-22`, `CODE_AUDIT.md:185-188`). The file-size gate is ratcheted by `tools/file-size-budget.json`, which currently budgets `src/components/session/SessionsManager.vue` at 1,340 lines (`tools/file-size-budget.json:7`). The checker enforces 800 as the soft threshold and warns that split files should ratchet down or drop stale budget entries (`tools/check-file-sizes.ts:13-24`, `tools/check-file-sizes.ts:43-66`).

---

## Current state

### Responsibilities mixed in one SFC

`SessionsManager.vue` hosts all of the following in one `<script setup>`, template, and scoped style block:

1. Store wiring and selectors: sessions list, live sessions, groups, settings, client readiness, layout, toasts, confirmation service (`src/components/session/SessionsManager.vue:15-44`).
2. Row status derivation: open session ids, `recordsById`, `indicatorFor`, `sessionKindIcon`, and `extraPendingCount` (`src/components/session/SessionsManager.vue:46-121`).
3. New-session workspace form: workspace draft, suggestions, MRU/session-derived workspaces, folder picker, debounced filesystem browse, create-session handlers (`src/components/session/SessionsManager.vue:123-281`).
4. Toolbar view state: grouping/sort/color/search options and handlers (`src/components/session/SessionsManager.vue:284-329`).
5. Group collapse and lifecycle refresh: collapsed groups, mount refresh, sessions-length refresh watcher (`src/components/session/SessionsManager.vue:331-371`).
6. Resume/delete actions: optimistic resuming ids, focus existing panel, restore session, focus composer, ConfirmPopup delete flow (`src/components/session/SessionsManager.vue:375-449`).
7. Formatting and group tinting helpers: relative time, display title, session-to-dockview-group color map, row border style (`src/components/session/SessionsManager.vue:451-511`).
8. Template for create form, toolbar, search, empty states, groups, rows, badges, and delete button (`src/components/session/SessionsManager.vue:514-858`).
9. Scoped CSS for all of the above (`src/components/session/SessionsManager.vue:859-1340`).

### Existing decomposition patterns

- `ChatWindow.vue` has already moved major behavior into child components and composables: it imports `MessageComposer`, message renderers, `ToolCallBlock`, `SubagentBlock`, `PendingRequestCard`, `CommandResultCard`, and composables like `useChatScroll`, `useChatSubmit`, `useChatTimelineState`, and `useMessageActions` (`src/components/chat/ChatWindow.vue:13-44`). Its own comment states header controls live elsewhere and the component is transcript + composer (`src/components/chat/ChatWindow.vue:49-52`).
- `LibraryAgentsTab.vue` extracts repeated row/section rendering to `LibraryAgentsTabSection.vue` while retaining data loading and form state in the parent (`src/components/library/LibraryAgentsTab.vue:24-32`, `src/components/library/LibraryAgentsTab.vue:72-90`).
- `LibraryAgentsTabSection.vue` keeps row styles local to the extracted component because scoped CSS selectors bind to the rendering file (`src/components/library/LibraryAgentsTabSection.vue:145-149`). This is the key CSS rule to mirror.

### Coverage already guarding the behavior

- `SessionsManager.toolbar.test.ts` is a component test specifically for grouping dropdown, sort direction, color-by-group, search open/close, Escape handling, and stale search reset (`src/components/session/__tests__/SessionsManager.toolbar.test.ts:1-7`, `src/components/session/__tests__/SessionsManager.toolbar.test.ts:43-133`).
- `sessionsListStore.grouped.test.ts` covers grouping, sorting, filtering, date buckets, and persisted view-state validation without mounting the manager (`src/stores/chat/__tests__/sessionsListStore.grouped.test.ts:1-9`, `src/stores/chat/__tests__/sessionsListStore.grouped.test.ts:57-238`).
- E2E flow 20 creates a second session via the Sessions activity panel’s “New session” button and asserts details-rail singleton behavior (`e2e/full/flows/20-details-singleton.pwtest.ts:31-40`).
- E2E flow 28 verifies renamed session titles propagate to the Sessions sidebar from the single owner (`e2e/full/flows/28-rename-propagation.pwtest.ts:1-10`, `e2e/full/flows/28-rename-propagation.pwtest.ts:56-64`).
- E2E flows 23 and 24 guard group/session layout behavior around new groups and moved sessions (`e2e/full/flows/23-groups-create.pwtest.ts:1-8`, `e2e/full/flows/24-groups-move-session.pwtest.ts:1-9`).

---

## Design

### Target component structure

Add these child components under `src/components/session/`:

1. `SessionsNewSessionForm.vue`
2. `SessionsManagerToolbar.vue`
3. `SessionGroupSection.vue`
4. `SessionRow.vue`

Keep `SessionsManager.vue` as the shell that owns stores, side effects, and cross-component orchestration.

### Shell responsibilities that stay in `SessionsManager.vue`

`SessionsManager.vue` should keep:

- Store creation and `storeToRefs` calls.
- `ConfirmPopup group="sessions-manager"`, because delete confirmation needs the click target from the row and one popup host for the panel (`src/components/session/SessionsManager.vue:514-516`, `src/components/session/SessionsManager.vue:427-449`).
- Workspace browse/create actions until/unless a later composable extraction is warranted.
- Resume behavior, including focusing existing panels, re-adding missing panels, and emitting `focus-composer` (`src/components/session/SessionsManager.vue:379-424`).
- Delete behavior and `confirm.require` call, preserving `event.currentTarget` for PrimeVue anchoring (`src/components/session/SessionsManager.vue:427-433`).
- Cross-store derived maps: `recordsById`, `openSessionIds`, `sessionGroupColor`, labels, indicators, and group-color styles.
- `collapsedGroups`, `isGroupExpanded`, and `toggleGroup` unless the group component later owns internal collapse. Keeping it in the shell preserves forced expansion while search is active (`src/components/session/SessionsManager.vue:335-345`).

### `SessionsNewSessionForm.vue`

**Extracts:** template lines for the create-new-session block (`src/components/session/SessionsManager.vue:518-557`) and related form CSS (`src/components/session/SessionsManager.vue:875-936`).

**Props:**

- `workspace: string`
- `suggestions: string[]`
- `clientReady: boolean`
- `pickingFolder: boolean`
- `creatingSession: boolean`
- `creatingClient: boolean`

**Emits:**

- `update:workspace(value: string)`
- `complete(event: AutoCompleteCompleteEvent)`
- `pickFolder()`
- `submit()`

**Notes:**

- The shell keeps `workspaceDraft`, suggestions, `onSearchWorkspaces`, `onPickFolder`, and `onCreateSession` for the first split.
- Use `v-model:workspace` from the shell.
- Keep AutoComplete dependency local to the child.

### `SessionsManagerToolbar.vue`

**Extracts:** toolbar and search bar template (`src/components/session/SessionsManager.vue:560-660`) and toolbar/search CSS (`src/components/session/SessionsManager.vue:938-1038`).

**Props:**

- `grouping: GroupingMode`
- `sortField: SortField`
- `sortDir: SortDir`
- `colorByGroup: boolean`
- `searchQuery: string`
- `searchOpen: boolean`
- `loading: boolean`

**Emits:**

- `update:grouping(value: GroupingMode)`
- `update:sortField(value: SortField)`
- `update:sortDir(value: SortDir)`
- `update:colorByGroup(value: boolean)`
- `update:searchQuery(value: string)`
- `update:searchOpen(value: boolean)`
- `refresh()`

**Notes:**

- Keep the option arrays with the toolbar if they are only render concerns; export them only if tests need direct access.
- Preserve Escape behavior by emitting `update:searchQuery('')` and `update:searchOpen(false)` from the child.
- Update `SessionsManager.toolbar.test.ts` either to continue mounting the shell or add focused child tests while keeping at least one shell integration mount.

### `SessionGroupSection.vue`

**Extracts:** group header, collapsed preview, and `<ul>` list wrapper (`src/components/session/SessionsManager.vue:694-766`) plus group/list CSS (`src/components/session/SessionsManager.vue:1040-1163`).

**Props:**

- `group: SessionGroup`
- `expanded: boolean`
- `clientReady: boolean`
- `flat: boolean` (or derive from `group.kind` inside)
- `previewLabel: string`
- `previewTime: string`

**Emits:**

- `toggle(groupKey: string)`
- `newInWorkspace(path: string)`
- `resume(session: SessionMetadataSummary)`
- `delete(event: MouseEvent, session: SessionMetadataSummary)`

**Slots / composition:**

- Either render `SessionRow` internally with row-view props from the parent, or expose a row slot. Recommended default: render `SessionRow` internally only after `SessionRow.vue` lands; parent passes a `rows` view model so `SessionGroupSection` stays presentation-only.

### `SessionRow.vue`

**Extracts:** row `<li>`, main button, icon/dot, metadata, pending badge, open/resuming badge, delete button (`src/components/session/SessionsManager.vue:767-855`) plus row CSS (`src/components/session/SessionsManager.vue:1165-1340`).

**Props:**

- `session: SessionMetadataSummary`
- `label: string`
- `relativeTime: string`
- `isOpen: boolean`
- `isResuming: boolean`
- `kindIcon: { iconClass: string; tooltip: string; muted: boolean }`
- `indicator: NotificationStyle | null`
- `extraPendingCount: number`
- `groupColorStyle?: { borderLeft: string }`

**Emits:**

- `resume(session: SessionMetadataSummary)`
- `delete(event: MouseEvent, session: SessionMetadataSummary)`

**Critical detail:**

- The delete emit must pass the original mouse event so the shell can call `confirm.require({ target: event.currentTarget as HTMLElement, ... })` and PrimeVue anchors to the clicked trash button (`src/components/session/SessionsManager.vue:427-433`). Do not replace this with `sessionId` only.

### View-model option for rows

To keep child props simple, the shell may build a small row view model per session:

- `session`
- `label`
- `relativeTime`
- `isOpen`
- `isResuming`
- `kindIcon`
- `indicator`
- `extraPendingCount`
- `groupColorStyle`

This avoids passing store instances or helper functions into children and follows the “components are dumb; data/actions live in stores/composables” rule from `AGENTS.md:100-101`.

### CSS placement

Move scoped CSS with the component that renders the elements. This is not optional: the prior Library Agents extraction documents that scoped CSS left in the parent silently stops styling extracted rows (`src/components/library/LibraryAgentsTabSection.vue:145-149`).

Expected CSS ownership:

- Shell: `.sessions-manager`, `.manager-body`, state messages.
- `SessionsNewSessionForm.vue`: `.new-session-*`, `.workspace-input` deep AutoComplete rules.
- `SessionsManagerToolbar.vue`: `.manager-toolbar`, `.toolbar-*`, `.search-bar*`.
- `SessionGroupSection.vue`: `.workspace-group`, `.group-*`, `.session-list*`.
- `SessionRow.vue`: `.session-row`, `.session-main`, `.session-label`, `.session-kind*`, `.session-state-dot*`, `.badge-pending`, `.session-meta`, `.open-badge`, `.resuming-pill`.

### Budget ratchet target

Current budget entry is 1,340 lines (`tools/file-size-budget.json:7`). Target after all extraction phases:

| File                                                |      Target |
| --------------------------------------------------- | ----------: |
| `src/components/session/SessionsManager.vue`        | ≤ 450 lines |
| `src/components/session/SessionsNewSessionForm.vue` | ≤ 220 lines |
| `src/components/session/SessionsManagerToolbar.vue` | ≤ 220 lines |
| `src/components/session/SessionGroupSection.vue`    | ≤ 260 lines |
| `src/components/session/SessionRow.vue`             | ≤ 260 lines |

If the shell lands below 800, remove `src/components/session/SessionsManager.vue` from `tools/file-size-budget.json`. If it remains above 800 after an intermediate PR, lower the cap to the new actual line count rather than leaving 1,340.

---

## Open Questions

1. **Should the new-session form be extracted in this round?**
   - Option A: yes, extract form along with toolbar/group/row.
   - Option B: leave form in shell until the row/list split lands.
   - **Recommended default:** yes, but after row/group/toolbar. It is a clear UI seam and keeps the shell focused on orchestration.

2. **Should `relativeTime` move to a utility?**
   - Option A: keep in shell and pass rendered strings.
   - Option B: move to `src/lib/formatElapsed.ts` or a session-local helper.
   - **Recommended default:** keep in shell for this no-behavior-change split. A utility move can happen later if another component needs identical formatting.

3. **Should group collapse state move into `SessionGroupSection`?**
   - **Recommended default:** no. The shell needs to force all groups open while search has a query (`src/components/session/SessionsManager.vue:339-345`), so keeping collapse state in the shell avoids cross-component synchronization.

4. **Should row view models be precomputed or should children call helper functions?**
   - **Recommended default:** precompute row props in the shell. It avoids passing Pinia stores/functions into children and makes child tests deterministic.

---

## Alternatives

### Alternative A — component extraction around render seams

**Pros**

- Directly reduces the god object with minimal behavior risk.
- Mirrors successful `LibraryAgentsTabSection.vue` extraction.
- Keeps scoped CSS with rendered elements.
- Lets tests focus on toolbar/row/group behavior.

**Cons**

- Parent still owns many helper functions until optional composables are extracted.
- More component files.

### Alternative B — composable-first extraction

**Pros**

- Can reduce script complexity before template movement.
- Useful for workspace autocomplete and row view-model derivation.

**Cons**

- Does not reduce template/CSS bloat, which is most of the SFC size.
- Risks hiding UI behavior behind abstractions while the file still exceeds the budget.

### Alternative C — rewrite SessionsManager around a virtualized/list library

**Pros**

- Could help if session counts grow dramatically.

**Cons**

- Audit notes virtual list is not needed at current scale (`CODE_AUDIT.md:173`).
- Not a no-behavior-change split.

**Decision:** choose Alternative A. Use small helper/composable moves only when they make a component contract cleaner.

---

## Implementation phases

1. **Extract `SessionRow.vue`.**
   - Move row markup and row CSS.
   - Parent computes row props and receives `resume` / `delete` emits.
   - Preserve delete event target for ConfirmPopup.
   - Add/adjust row-focused tests for resume/delete emits if needed.

2. **Extract `SessionGroupSection.vue`.**
   - Move group header, collapsed preview, list wrapper, and group/list CSS.
   - Use the already-extracted row component.
   - Keep collapse state in shell.
   - Verify flat mode hides group header and workspace mode still shows per-group New Session.

3. **Extract `SessionsManagerToolbar.vue`.**
   - Move toolbar/search markup, options, focus behavior, and CSS.
   - Convert direct `viewState` mutations into explicit update emits.
   - Update `SessionsManager.toolbar.test.ts` so it still covers shell wiring and child behavior.

4. **Extract `SessionsNewSessionForm.vue`.**
   - Move create-session form markup and CSS.
   - Keep workspace autocomplete data/actions in the shell for this phase.
   - Verify E2E flow 20 still creates a second session via the Sessions activity panel (`e2e/full/flows/20-details-singleton.pwtest.ts:31-40`).

5. **Ratchet file-size budget.**
   - Remove the `SessionsManager.vue` entry from `tools/file-size-budget.json` if the shell is ≤ 800.
   - If any new child somehow exceeds 800, split before landing rather than adding a new budget entry.
   - Keep this as the final phase so behavior is already protected before budget churn.

---

## References

- `CODE_AUDIT.md:21-22`, `CODE_AUDIT.md:185-188` — SessionsManager growth and mixed responsibilities.
- `tools/file-size-budget.json:7`, `tools/check-file-sizes.ts:13-24`, `tools/check-file-sizes.ts:43-66` — budget ratchet mechanism.
- `src/components/session/SessionsManager.vue:15-44`, `src/components/session/SessionsManager.vue:46-121`, `src/components/session/SessionsManager.vue:123-281`, `src/components/session/SessionsManager.vue:284-371`, `src/components/session/SessionsManager.vue:375-511`, `src/components/session/SessionsManager.vue:514-858`, `src/components/session/SessionsManager.vue:859-1340` — current mixed responsibilities.
- `src/components/chat/ChatWindow.vue:13-44`, `src/components/chat/ChatWindow.vue:49-52` — decomposition precedent.
- `src/components/library/LibraryAgentsTabSection.vue:145-149` — scoped CSS extraction rule.
- `src/components/session/__tests__/SessionsManager.toolbar.test.ts:1-7`, `src/stores/chat/__tests__/sessionsListStore.grouped.test.ts:1-9` — current coverage.
- `e2e/full/flows/20-details-singleton.pwtest.ts:31-40`, `e2e/full/flows/28-rename-propagation.pwtest.ts:56-64`, `e2e/full/flows/23-groups-create.pwtest.ts:1-8`, `e2e/full/flows/24-groups-move-session.pwtest.ts:1-9` — e2e coverage touching the panel.

---

## Recommended first PR

Extract only `SessionRow.vue` with row markup, row CSS, and explicit `resume` / `delete(event, session)` emits. Keep all store logic, group rendering, toolbar, and form behavior in `SessionsManager.vue`. This is the smallest no-behavior-change slice, tests the event-target preservation needed by ConfirmPopup, and immediately removes the densest repeated row markup/CSS from the god component.
