# Session Pane: Groupings, Sorting, Search, Color-by-Group

**Status:** Draft — 2026-06-06

---

## Summary

Enhance the Sessions Manager panel (`src/components/session/SessionsManager.vue`) with
user-controlled grouping modes, per-column sort, an inline filter/search box, and
row-level tinting that optionally ties a session's color to its dockview group. All
view preferences persist locally so the pane opens in the user's last chosen state.

---

## Motivation

Today the pane always groups by workspace path and always sorts by `modifiedTime` DESC
(via `sessionsListStore.grouped`, `sessionsListStore.ts:140-174`). Users with many
sessions across multiple workspaces and dockview groups have no way to:

- See all sessions by when they were last active, regardless of workspace
- Quickly find a session by name or partial id
- Visually correlate a sidebar row to the dockview group it lives in

The workspace grouping is hardcoded as the only view; no mechanism exists to switch,
sort differently, or narrow by text. The "open" badge on a row (`SessionsManager.vue:644`)
gives binary open/closed — but not *which* dockview group.

---

## Current State

### Data sources

| Symbol | File | Purpose |
|--------|------|---------|
| `WorkspaceGroup` | `src/stores/chat/sessionsListStore.ts:17-26` | Current group shape: key=path, label, sessions[] |
| `grouped` computed | `sessionsListStore.ts:140-174` | Hardcoded group-by-cwd + MRU sort |
| `SessionMetadataSummary` | `src/ipc/types.ts:245-254` | Catalog row: `sessionId`, `startTime`, `modifiedTime`, `cwd?`, `summary?`, `repository?`, `branch?` |
| `SessionRecord.accent` | `src/stores/chat/sessionsStore.ts:48-49` | Per-session HSL, assigned by `accentForIndex(creationCount++)` (`src/lib/color.ts:31-35`) |
| `GroupMeta.color` | `src/ipc/types.ts:194-196` | Per-dockview-group hex color, cycled from `GROUP_COLORS[8]` (`src/stores/shell/groupsStore.ts:34-43`) |
| `extractPanelIdsFromBody` | `src/stores/shell/groupsStore.ts:481-489` | Extracts session ids from a group's inner dockview body |
| `innerBodiesCache` | `groupsStore.ts:101` | Per-group serialized inner body; valid for unmounted groups |
| `usePersistedRef` | `src/composables/usePersistedRef.ts` | localStorage-backed reactive ref with throttle, validation, cap |
| `openSessionIds` | `SessionsManager.vue:43` | Set of currently-open session ids |

### Current grouping + sort in the component

```
sessionsListStore.grouped → WorkspaceGroup[] (sorted by each group's newest modifiedTime)
SessionsManager.vue:122-131 → sortedGroupSessions: open first, then closed, each in MRU order
```

No secondary sort, no filter, no mode toggle.

### Color today

`accentForIndex` (`color.ts:31`) maps a monotonic creation counter to one of 12 HSL
slots. It is assigned once at `createSession`/`restoreSession` time
(`sessionsStore.ts:496, 624`). The session pane currently renders no accent tint on
rows; the accent only appears in `ChatTab.vue` / `SidebarTab.vue` (not in scope here
to verify, but the spec assumes it). There is no mapping of sessionId → dockview group
stored anywhere durably; `groupsStore.innerBodiesCache` holds it transiently.

---

## Design

### 1. View-state data model

```typescript
type GroupingMode = 'workspace' | 'dockview-group' | 'date-bucket' | 'flat';
type SortField    = 'modified' | 'created' | 'name' | 'activity';
type SortDir      = 'desc' | 'asc';

interface SessionPaneViewState {
  grouping: GroupingMode;   // default: 'workspace'
  sortField: SortField;     // default: 'modified'
  sortDir: SortDir;         // default: 'desc'
  searchQuery: string;      // default: ''  — NOT sticky (see §Open Questions #1)
  colorByGroup: boolean;    // default: false
}
```

Persisted with `usePersistedRef('dafman.sessionPane.view', defaults)`. The key follows
the existing `dafman.details.section.*` / `dafman.filePicker.*` convention.

---

### 2. Grouping modes

#### 2a. `workspace` (current behavior, default)

Group key = `session.cwd ?? ''`. Same as today's `WorkspaceGroup`. No change to the
underlying data; just wired to the new mode switcher.

#### 2b. `dockview-group`

Group key = `GroupMeta.id`. Label = `GroupMeta.name`. Color dot = `GroupMeta.color`.

**Membership lookup:** at render time, build a reverse map
`sessionId → groupId` by iterating `groupsStore.groups` and calling
`extractPanelIdsFromBody(groupsStore.innerBodiesCache[g.id] ?? groupsStore.innerApis[g.id]?.toJSON())`.
This is an O(total panels) scan, done once per `grouped` recompute — acceptable.

Sessions not present in any group body (closed, never opened in this session, or
opened after the last body snapshot) fall into an "Unassigned" bucket.

**Limitation:** closed sessions that were never opened in the current runtime
(loaded only from `listSessions` catalog) have no group membership unless a
durable `sessionId → groupId` index exists (see §Open Questions #4).

#### 2c. `date-bucket`

Group by calendar bucket of the active sort field (default: `modifiedTime`):
- Today
- Yesterday
- This week (Mon–Sun)
- This month
- Older

Bucket label changes with `sortField`; if `sortField === 'created'` the bucket
reflects `startTime`, etc. Buckets with zero sessions are hidden.

#### 2d. `flat`

No grouping. Single scrollable list, sorted by the active `(sortField, sortDir)` pair.
The group header, collapse chevron, and per-group New Session button are hidden.
A global New Session button (already present at the top) remains.

---

### 3. Sort options

Applied within each group (and globally for `flat`).

| `sortField` | Source field | Notes |
|-------------|--------------|-------|
| `modified`  | `SessionMetadataSummary.modifiedTime` | Default; ISO lexical compare is sufficient |
| `created`   | `SessionMetadataSummary.startTime` | ISO lexical |
| `name`      | `displayTitle(sessionId)` | Case-insensitive locale compare; live titles take precedence |
| `activity`  | `SessionRecord.unseenTurns` DESC, then `isThinking` first | Puts active/noisy sessions at top; closed sessions sort to bottom |

`sortDir` flips all comparisons. For `activity`, direction only applies to unseenTurns
tie-breaking (always put thinking sessions first regardless of dir).

**Within `workspace`/`dockview-group`/`date-bucket` modes:** the existing open-first
sub-sort (`SessionsManager.vue:122-131`) is **removed** and replaced by the chosen
`sortField`/`sortDir`. Open-first becomes a toggle (see §Open Questions #2).

---

### 4. Search / filter box

#### Placement

Inline below the `manager-toolbar` header, collapsed by default behind a search icon
button. Clicking the icon expands a text input (autofocused). Pressing Escape or
clearing the input collapses it. The icon shows a filled/active state when a query
is active.

```
┌─────────────────────────────────────────┐
│  Sessions            [🔍] [⟳]          │
├─────────────────────────────────────────┤
│  🔍 [filter sessions…              ✕]   │  ← expanded state
├─────────────────────────────────────────┤
│  ▼ 📁 dafman  (3)              [+]      │
│    ● session-name               3m ago  │
│    ○ another session            1d ago  │
└─────────────────────────────────────────┘
```

#### Match logic

A session row is visible if the query string (trimmed, lowercased) matches any of:

1. `displayTitle(sessionId)` — live or catalog title
2. `SessionMetadataSummary.cwd` — workspace path substring
3. `sessionId` — prefix match (first 8 hex chars is sufficient)
4. `SessionMetadataSummary.summary` — if present

All four fields are OR'd. No fuzzy matching in v1; plain `string.includes`.

#### Group visibility

A group header is visible if ≥1 of its sessions matches. When a query is active:
- All groups auto-expand (ignore `collapsedGroups` reactive record)
- Match-highlighting is out of scope for v1

#### Stickiness

See §Open Questions #1.

---

### 5. Color-by-group (`colorByGroup` toggle)

#### What it changes

When enabled, each open session's row gets a left-border tint (3 px, using
`border-left: 3px solid <color>`) derived from the session's dockview group color
(`GroupMeta.color`). Closed / unassigned sessions get no tint.

The `colorByGroup` flag is independent of the `grouping` mode — it can be on even
when `grouping === 'workspace'`.

#### Coexistence with `SessionRecord.accent`

`SessionRecord.accent` is an HSL string assigned at creation time from a 12-hue
palette (`color.ts:PALETTE`). `GroupMeta.color` is a hex string from an 8-swatch
palette (`groupsStore.ts:GROUP_COLORS`).

**Recommendation: layer them, with group color taking the border and accent unused
in the session list.** The accent already owns the ChatTab color dot and (presumably)
other surfaces. In the sidebar list:

- **`colorByGroup: false`** (default) — no tint on rows; row appearance unchanged.
- **`colorByGroup: true`** — left border = `GroupMeta.color` for open sessions
  with a known group assignment; no border for closed/unassigned.

No attempt to blend or replace the per-session accent; the two colors serve different
axes (per-session identity vs per-group workspace membership).

#### Implementation sketch

```typescript
// In SessionsManager.vue — computed
const sessionGroupColor = computed(() => {
  if (!viewState.value.colorByGroup) return null;
  const map = new Map<string, string>(); // sessionId → color
  for (const g of groupsStore.groups) {
    const body = groupsStore.innerBodiesCache[g.id]
               ?? groupsStore.innerApis[g.id]?.toJSON();
    for (const sid of extractPanelIdsFromBody(body)) {
      map.set(sid, g.color);
    }
  }
  return map;
});
```

Row style: `:style="{ borderLeft: sessionGroupColor?.get(session.sessionId) ? \`3px solid \${sessionGroupColor.get(session.sessionId)}\` : undefined }"`.

---

### 6. Toolbar / controls layout

```
┌─────────────────────────────────────────────────────┐
│  Sessions      [group▾] [sort▾] [↕] [🔍] [⟳]      │
└─────────────────────────────────────────────────────┘
```

- **`[group▾]`** — small dropdown or icon-button that cycles/opens a 4-item menu:
  `By workspace`, `By dockview group`, `By date`, `Flat`. Icon: `pi-sitemap` or similar.
- **`[sort▾]`** — dropdown: `Modified`, `Created`, `Name`, `Activity`. Keeps current
  selection label visible (or abbreviates to icon+tooltip at narrow widths).
- **`[↕]`** — direction toggle: `pi-sort-amount-down` / `pi-sort-amount-up-alt`.
- **`[🔍]`** — search toggle (expands/collapses inline filter input below).
- **`[⟳]`** — existing refresh button.

At very narrow panel widths (< ~200 px), collapse all icon buttons into a single
`⋯` overflow menu. This is optional for v1; a fixed-width toolbar is acceptable initially.

---

### 7. Wireframe (ASCII)

```
┌─────────────────────────────────────────────────────────┐
│  [Workspace ▾]  new session                             │
│  [─────────────────────────────] [📂]  [ New session ]  │
├─────────────────────────────────────────────────────────┤
│  Sessions    [⣿] [↓mod] [↕] [🔍] [⟳]                  │
├─ (filter active) ───────────────────────────────────────┤
│  🔍 [react…                                      ✕]     │
├─────────────────────────────────────────────────────────┤
│  ▼ 📁 dafman  (2)                              [+]      │
│  │  ● 🗨 [G1] session-abc            open  3m ago  [🗑] │
│  │  ○ 💬 session-xyz                       1d ago  [🗑] │
├─────────────────────────────────────────────────────────┤
│  ▼ 📁 my-api  (1)                              [+]      │
│  │  ● 🗨 [G2] another-session        open  5h ago  [🗑] │
└─────────────────────────────────────────────────────────┘

[G1] = color dot when colorByGroup is on and grouping = workspace
Left border color on open rows when colorByGroup is on
```

---

### 8. Persistence

```
localStorage key                     value
dafman.sessionPane.view              JSON: SessionPaneViewState
```

Written via `usePersistedRef` with throttle = 0 (instant; state changes are infrequent
— no high-frequency writes). Validate against a known-good defaults shape so a
stale/corrupt entry falls back cleanly.

`searchQuery` stickiness: see §Open Questions #1.

---

## Open Questions

1. **Should `searchQuery` persist across reloads?** A sticky search means reopening
   the app shows a filtered list, which could appear broken. Recommended default:
   **not sticky** — initialize `searchQuery` to `''` on mount regardless of stored state.
   Store the preference only if the user explicitly opts in (toggle), or omit it from
   the persisted shape entirely. *Decision needed: sticky vs ephemeral.*

2. **Open-first sub-sort: keep or remove?** Today `sortedGroupSessions` always floats
   open sessions to the top of each group (`SessionsManager.vue:122-131`). With a
   user-controlled sort this becomes surprising. Options:
   - (a) Remove open-first; rely solely on `activity` sort mode to achieve similar effect.
   - (b) Keep it as a separate sticky toggle alongside the sort (adds UI complexity).
   - (c) Keep it always-on but only for `sortField !== 'activity'`.
   *Recommended: (a). Decision needed.*

3. **"Group by dockview group" = existing `GroupMeta`?** — ✅ **RESOLVED (2026-06-07): reuse the existing `GroupMeta`** (the dockview outer group the user already names + colors). No new "session group" concept — groups are just the dockview grouping.

4. **Closed / unseen sessions' dockview-group membership** — ✅ **RESOLVED (2026-06-07): (a) leave them gray / "Unassigned".** No durable `sessionId → groupId` index and no body reconstruction — groups are just a visual grouping, so a session with no known current-runtime group renders **untinted under "Unassigned"**. Membership comes only from `innerBodiesCache` / `innerApis` for sessions opened this runtime; closed/catalog-only sessions stay gray.

5. **Color-by-group with per-session accent: which wins in contexts beyond the sidebar?**
   This spec proposes group color → sidebar left-border, session accent → chat tab dot.
   But if a future redesign wants to unify them, we'd have a conflict. Should
   `SessionRecord.accent` be deprecated in favor of group color for open sessions?
   *Out of scope for this feature but flagged for future alignment.*

6. **Where should the `colorByGroup` toggle live?** Options:
   - (a) Inline in the sessions pane toolbar (compact icon button with tooltip).
   - (b) Settings panel ("Appearance" section).
   - (c) Both: Settings as the persistent flag, toolbar as a quick toggle.
   *Recommended: (a) only — keeping UI preferences near the UI surface that uses them,
   consistent with `useDetailsSections.ts` pattern. Decision needed.*

7. **Should "By date" grouping react to `sortField`?** If the user switches to
   `created` sort, do date buckets reflect `startTime` or always `modifiedTime`?
   *Recommended: date bucket reflects the active `sortField`'s timestamp.
   Decision needed (affects implementation complexity slightly).*

---

## Alternatives / Options

### A. Grouping: reuse `WorkspaceGroup` shape vs new `SessionGroup<T>` shape

**Option A1 (recommended):** Generalize `WorkspaceGroup` into a generic
`SessionGroup` shape with a discriminated `kind` field. The `grouped` computed
in `sessionsListStore` becomes a function of `viewState.grouping`. The component
receives one polymorphic `SessionGroup[]` and renders group headers with
mode-appropriate icons/labels.

**Option A2:** Keep `WorkspaceGroup` as-is; add separate `groupedByDockview`,
`groupedByDate`, `flat` computeds. Component picks the right one. Simpler to diff
but parallel computed logic is harder to maintain.

*Tradeoff: A1 is more code upfront but the component stays slim. A2 is faster
to land the first two modes. Recommend A1.*

---

### B. Sort: store-computed vs component-computed

**Option B1 (recommended):** `sessionsListStore` computes the final ordered/filtered
`SessionGroup[]` given `viewState` as input. Single source of truth; testable without
mounting the component.

**Option B2:** Leave `sessionsListStore.grouped` untouched; sort/filter entirely
in the component with a local `computed`. No store changes; easier diff. But logic
creep in the component.

*Tradeoff: B1 is cleaner and more testable. B2 is lower risk for v1. Recommend B1
but acceptable to start with B2 and refactor.*

---

### C. Color-by-group: CSS border-left vs background tint vs colored icon

**Option C1 (recommended):** `border-left: 3px solid <groupColor>` on the `.session-row`
for open+assigned sessions. Same pattern used for unread/active indicators in many
desktop chat UIs. Does not interfere with existing row layout.

**Option C2:** Subtle background-color tint (`background: <groupColor>15` — 8% alpha).
More prominent but can clash with hover/active states.

**Option C3:** Replace the `open` badge text with a colored group-name chip.
Most informative (shows the group name) but adds horizontal width pressure.

*Recommend C1 for v1; C3 as a v2 enhancement once color-by-group proves useful.*

---

### D. Search: always-visible input vs toggle

**Option D1 (recommended):** Collapsed by default behind a `🔍` icon; expands inline.
Keeps the pane compact when not searching. Pattern consistent with LogViewer search
(`src/components/observability/`).

**Option D2:** Always-visible input below the toolbar. No toggle interaction; simpler
template. Takes vertical space permanently.

*Recommend D1.*

---

## Implementation Phases

### Phase 1 — Sort + flat mode (no grouping changes)

- Add `viewState` (`usePersistedRef`) to `SessionsManager.vue`
- Add sort-field + sort-direction controls to the toolbar
- Implement `sortField`/`sortDir` within the existing `workspace` grouping
- Remove or gate the hardcoded open-first sub-sort (resolves OQ #2)
- Flat mode: render a single list when `grouping === 'flat'`

**Acceptance:** toolbar controls visible, sort changes row order within groups, flat
mode shows no headers.

### Phase 2 — Search / filter

- Add `🔍` toggle + inline input
- Implement match logic (title + cwd + sessionId + summary)
- Group auto-expand when a query is active
- Persist query stickiness decision (OQ #1)

**Acceptance:** typing "react" shows only sessions whose title/workspace contains
"react"; groups with no matches are hidden.

### Phase 3 — `dockview-group` grouping

- Implement `sessionId → groupId` reverse map from `innerBodiesCache`
- Add best-effort closed-session map via `innerBodies` walk (OQ #4 option c)
- `WorkspaceGroup` shape generalized to `SessionGroup` with `kind` discriminant
- `grouped` computed moved to accept `viewState.grouping` as input (or computed
  variant per mode — whichever matches the chosen architecture from OQ A)
- Group header shows `GroupMeta.color` dot + `GroupMeta.name`

**Acceptance:** switching to "By dockview group" regroups rows; open sessions in
group "Work" appear under "Work" header.

### Phase 4 — `date-bucket` grouping + color-by-group

- Implement date bucket logic
- Add `colorByGroup` toggle to toolbar
- Implement `sessionGroupColor` computed + border-left CSS binding
- Wire `colorByGroup` into `viewState`

**Acceptance:** date buckets visible; enabling color-by-group shows left-border tints
on open session rows matching their dockview group color.

---

## References

| File | Relevance |
|------|-----------|
| `src/components/session/SessionsManager.vue` | Primary component to modify |
| `src/stores/chat/sessionsListStore.ts` | `WorkspaceGroup`, `grouped` computed, sort logic |
| `src/stores/chat/sessionsStore.ts:45-152` | `SessionRecord.accent`, `accentForIndex` |
| `src/stores/shell/groupsStore.ts:34-66, 481-489` | `GROUP_COLORS`, `GroupMeta`, `extractPanelIdsFromBody` |
| `src/ipc/types.ts:188-197, 245-254` | `GroupMeta`, `SessionMetadataSummary` types |
| `src/lib/color.ts:15-35` | `PALETTE`, `accentForIndex` |
| `src/composables/usePersistedRef.ts` | localStorage persistence primitive |
| `src/components/session/details/useDetailsSections.ts` | localStorage naming convention (`dafman.details.section.*`) |
| `src/components/library/LibraryPanel.vue:29-47` | localStorage tab-persistence pattern |
