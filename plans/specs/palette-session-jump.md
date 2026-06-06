# Palette Session Jump

**Status:** Draft  
**Date:** 2026-06-06

---

## Summary

Extend the command palette (Ctrl/Cmd+K) with dynamic entries that let users jump to open sessions and resume on-disk-only sessions by name. Open sessions activate their panel via the cross-group reveal logic from #173; closed sessions trigger a resume path and then reveal. The feature replaces the friction of opening the Sessions Manager sidebar every time the user wants to switch sessions.

---

## Motivation

**What's missing today:**  
`session.switch` in `src/lib/registerBuiltinCommands.ts:638-685` already generates "Switch to Session" children for open sessions using `layoutStore.api?.getPanel(r.id)`. However:

1. **Closed (on-disk-only) sessions are invisible.** `sessionsListStore` holds every CLI-managed session (`SessionMetadataSummary`), but the palette never surfaces them. The user must open the Sessions Manager sidebar and manually click "Resume."
2. **The existing switch command does not use cross-group nav (#173).** It calls `panel.api.setActive()` directly on the outer dockview API — the `openOwningSession` pattern in `jobsStore.ts:160-186` (which walks `groupsStore.innerApis` to handle sessions in non-active groups) is not reused.
3. **No fuzzy workspace disambiguation.** Two sessions with the same summary/title are shown identically; users cannot tell them apart without opening both.
4. **No keyboard path from palette → resume.** There is no affordance to resume a session without mousing to the Sessions Manager.

---

## Current state

| File | Relevant symbol | What it does |
|---|---|---|
| `src/lib/registerBuiltinCommands.ts:638-685` | `session.switch` | Dynamic parent + children for open panels only; uses `layoutStore.api?.getPanel` (outer dock only). |
| `src/stores/chat/sessionsListStore.ts:28-219` | `useSessionsListStore` | Holds `SessionMetadataSummary[]` sorted by `modifiedTime` DESC. `refresh()` fetches via `invokeCommand('listSessions', {})`. `hasLoaded` tracks first load. |
| `src/stores/chat/sessionsStore.ts:583-722` | `restoreSession` | Resumes a CLI session via `invokeCommand('resumeSession', ...)`, creates a `SessionRecord`, then drains buffered events. Returns `null` on 404/failure. |
| `src/stores/observability/jobsStore.ts:160-186` | `openOwningSession` | Cross-group reveal: walks `groupsStore.innerApis` to find the session's current inner dockview, activates the outer group panel first, then the inner chat panel. Falls back to `addPanel` if not open. Parks a `requestReveal` intent for scroll-to-bottom. |
| `src/stores/shell/layoutStore.ts:182-186` | `requestReveal` | Stores a `{ toolCallId? }` scroll intent by session id; `ChatWindow` consumes on mount + watch. |
| `src/stores/shell/layoutStore.ts:860-868` | `activatePanel` | Activates a panel by session id (outer dock only). Used post-resume to bring the new pane forward. |
| `src/ipc/types.ts:245-254` | `SessionMetadataSummary` | `{ sessionId, startTime, modifiedTime, summary?, isRemote, cwd?, repository?, branch? }` — the on-disk catalog shape. |
| `src/stores/shell/commandRegistry.ts:27-79` | `Command` | Shape: `id, label, hint?, icon?, group?, keywords?, shortcut?, accent?, when?(), run(), children?`. |
| `src/lib/palette.ts:58-64` | `searchValueFor` | Builds the fuse search corpus: `id + label + group + hint + keywords` joined. |

---

## Design

### 7.1  Command taxonomy

Two new command families, both under the `"Sessions"` group (same group as existing `session.new` / `session.switch`):

| Command id | Condition | Label template | Action |
|---|---|---|---|
| `session.jump.<id>` | session is open (panel exists in any inner dockview) | `Go to: <display>` | `openOwningSession(id)` |
| `session.resume.<id>` | session is on-disk only (not open in any panel) | `Resume: <display>` | `resumeAndReveal(id)` |

`<display>` is the disambiguation label described in §7.4.

The existing `session.switch` parent+children is **replaced** by these flat entries (no two-step drill-down). The drill-down pattern (expand → select) adds an extra keypress for the most common use case (jump to a specific named session). Flat children with good `keywords` achieve the same grouping without friction.

**Parent wrapper (optional — open question #1):** If the total count of jump+resume entries exceeds a threshold (see §7.5), a single `"Jump to Session…"` parent can collapse all of them under drill-down to avoid list clutter. Default: flat when ≤ 12 sessions total, parent+children when > 12.

### 7.2  Navigation: open sessions

For `session.jump.<id>`:

```ts
// src/lib/registerBuiltinCommands.ts — inside the jump-children builder
run: () => {
  jobsStore.openOwningSession(r.sessionId);
  // openOwningSession already calls requestReveal with no toolCallId
  // (scroll-to-bottom). That is the right default for a jump.
}
```

`openOwningSession` (`jobsStore.ts:160-186`) handles:
- Session in a non-active group → activates outer group panel + inner chat panel.
- Session not currently in any panel → adds it via `layoutStore.addPanel` then activates.

No new nav logic is needed; `openOwningSession` already covers the #173 cross-group case.

### 7.3  Resume path: closed sessions

For `session.resume.<id>`:

```ts
run: async () => {
  const record = await sessionsStore.restoreSession(s.sessionId);
  if (!record) return; // toast already issued by restoreSession
  layoutStore.addPanel(record.id);
  layoutStore.activatePanel(record.id);
  layoutStore.requestReveal(record.id, {}); // scroll to bottom
}
```

`restoreSession` (`sessionsStore.ts:589-722`) calls `resumeSession` RPC, creates a `SessionRecord`, drains buffered events, and returns `null` with an info toast on failure — no additional error handling needed at the command layer.

**Side note on the `addPanel` / `activatePanel` split:**  
`restoreSession` does not open a panel — that is always the caller's job (same as `session.new`). The existing `session.new` command does `layoutStore.addPanel(record.id)` immediately after `createSession`. Resume should mirror this.

### 7.4  Disambiguation: display label

`SessionMetadataSummary` provides: `summary?` (human-readable title, may be absent), `cwd?` (workspace path), `sessionId` (UUID).

**Display label algorithm:**

```
function sessionDisplayLabel(s: SessionMetadataSummary): { label: string; hint: string } {
  const name  = s.summary?.trim() || `Session ${s.sessionId.slice(0, 8)}`;
  const wsBase = s.cwd ? basename(s.cwd) : null; // reuse layoutStore.basename
  const idSuffix = s.sessionId.slice(0, 6);
  const hint = wsBase ? `${wsBase}  ·  ${idSuffix}` : idSuffix;
  return { label: name, hint };
}
```

- `label` → palette row left column.
- `hint` → palette row right column (small grey text, same slot as keyboard shortcut).
- `hint` always carries at least the short GUID prefix so same-named sessions are still unique to the eye.
- `keywords` for each entry: `[s.sessionId, s.sessionId.slice(0,8), name, s.cwd ?? '', wsBase ?? '']` — so typing a workspace basename or a partial GUID finds the session.

### 7.5  Session set: which sessions to surface

**Open sessions** (jump entries): always all of them. Same as today's `session.switch` children — no cap needed; the number of concurrently-open panels is naturally small.

**Closed sessions** (resume entries): **cap at the 20 most-recently-modified** (by `SessionMetadataSummary.modifiedTime` DESC — already pre-sorted by `sessionsListStore.refresh`). Rationale: the SDK catalog can grow without bound; showing 200 resume entries pollutes the list for no practical gain. The Sessions Manager sidebar remains the full-catalog browser for power users.

**Combined cap override:** if the user types into the palette, fuse filtering makes a large list workable. The cap applies only to the *initially-shown* list, not to match results. Implementation: pass the first 20 closed sessions as children; fuse still operates over their keywords corpus.

### 7.6  Ordering in the palette

Within the `"Sessions"` group, ordering follows dafman's existing group/insertion-order semantics (no custom sort in the palette):

1. `session.new` (static, already registered).
2. `session.new.workspace` parent (static, already registered).
3. Open-session jump entries — ordered by `sessionsStore.sessions` array position (creation order / last-opened order within the runtime).
4. Closed-session resume entries — ordered by `modifiedTime` DESC (natural order from `sessionsListStore.sessions`).

The "recent first" property emerges from `sessionsListStore.sortByModifiedDesc` (`sessionsListStore.ts:37-39`), which is the sort order maintained by every `refresh()` and `upsertLiveSession()` call.

### 7.7  Registration watcher

A single `watch` in `registerBuiltinCommands` drives both families (replace-by-id means full re-emit on every change is safe):

```ts
watch(
  () => ({
    open: sessionsStore.sessions.map((s) => ({ id: s.id, title: s.title, accent: s.accent })),
    catalog: sessionsListStore.sessions.map((s) => s.sessionId + s.modifiedTime),
    rev: layoutStore.layoutRev,
  }),
  ({ open }) => {
    const openIds = new Set(open.map((s) => s.id));
    const openPanelIds = new Set(
      open.filter((r) => {
        for (const innerApi of Object.values(groupsStore.innerApis)) {
          if (innerApi.getPanel(r.id)) return true;
        }
        return false;
      }).map((r) => r.id)
    );

    // Jump entries — open sessions only
    for (const r of open) {
      if (!openPanelIds.has(r.id)) continue;
      const { label, hint } = sessionDisplayLabel(/* ... */);
      registry.register({
        id: `session.jump.${r.id}`,
        label: `Go to: ${label}`,
        hint,
        group: 'Sessions',
        icon: 'pi pi-arrow-right',
        accent: r.accent,
        keywords: [r.id, r.id.slice(0, 8), label],
        run: () => jobsStore.openOwningSession(r.id),
      });
    }

    // Resume entries — closed-only, capped at 20
    const closed = sessionsListStore.sessions
      .filter((s) => !openIds.has(s.sessionId))
      .slice(0, 20);
    for (const s of closed) {
      const { label, hint } = sessionDisplayLabel(s);
      registry.register({
        id: `session.resume.${s.sessionId}`,
        label: `Resume: ${label}`,
        hint,
        group: 'Sessions',
        icon: 'pi pi-history',
        keywords: [s.sessionId, s.sessionId.slice(0,8), label, s.cwd ?? ''],
        run: async () => {
          const record = await sessionsStore.restoreSession(s.sessionId);
          if (!record) return;
          layoutStore.addPanel(record.id);
          layoutStore.activatePanel(record.id);
          layoutStore.requestReveal(record.id, {});
        },
      });
    }
  },
  { immediate: true, deep: false },
);
```

**Stale-entry cleanup:** Because `session.jump.*` and `session.resume.*` entries are replaced by id but never explicitly unregistered, closing a session leaves a jump entry pointing at a dead panel. Two approaches:

- **Option A (recommended):** The watcher only registers entries that pass their current check on each fire. The `layoutRev` source ensures the watcher fires on panel open/close. Stale jump entries are simply overwritten with their new classification (e.g., a session that was "jump" becomes "resume" after its panel closes — next fire registers `session.resume.<id>` and the old `session.jump.<id>` remains. **An unregister call per session on each watcher fire fixes this:** unregister `session.jump.<id>` before registering `session.resume.<id>` and vice versa, or simply always call both `register` operations.

- **Option B:** Add `when()` predicate: `when: () => Boolean(innerApis[...].getPanel(r.id))`. Cheaper but requires per-call innerApis scan and misses the `session.resume` upgrade.

**Recommended:** Option A with explicit unregister: on every watcher fire, unregister all previously-known session entries and re-register the correct set. Track a local `Set<string>` of registered ids; diff on each fire. This is the same pattern as `session.switch` (see `registerBuiltinCommands.ts:645-685`).

### 7.8  Catalog freshness

`sessionsListStore.sessions` is pull-based (no streaming update from the SDK). The watcher will be stale until a `refresh()` is triggered. Mitigations:

1. `registerBuiltinCommands` should call `sessionsListStore.refresh()` once at registration time if `!sessionsListStore.hasLoaded` — ensures the palette has data on first open without waiting for the Sessions Manager to mount.
2. When the palette opens (`openPalette()` in `CommandPalette.vue:184-187`), trigger a fire-and-forget `sessionsListStore.refresh()` so the list reflects on-disk reality as of palette open. Refresh is fast (single RPC) and idempotent.

Option 2 requires wiring into `CommandPalette.vue`'s `openPalette` — a one-liner `void sessionsListStore.refresh()`.

---

## Open questions

1. **Flat vs. parent+children for the session list?**  
   Flat entries (one row per session) match the pattern for "Switch to Session." A `"Jump to Session…"` parent reduces clutter when there are many sessions but adds a drill-down step. Recommended default: flat. If the combined count exceeds 12, switch to a parent+children arrangement (session count rarely exceeds 12 in practice). Needs a decision on whether a dynamic threshold or a static parent is more maintainable.

2. **Show ALL on-disk sessions or only recent N + a "Browse more…" entry?**  
   Current proposal: cap at 20 most-recently-modified closed sessions. The alternative is to show all (potentially hundreds in a long-running install) or to add a terminal "Browse all sessions" entry that opens the Sessions Manager sidebar. Decision: confirm the cap of 20 or adjust to a different number. The "Browse more…" pattern is low-effort addable and user-friendly.

3. **Confirm-before-resume?**  
   Resuming spawns a CLI session and replays potentially large event history. In practice this is fast (subsecond) and already how SessionsManager.vue works (no confirm on click). However, if the session has pending requests or a long history, the spinner can surprise users. Recommendation: no confirm — mirror SessionsManager behavior. Revisit if users report the resume latency as confusing.

4. **Ordering: mtime vs. activity (session position in sessionsStore)?**  
   For open sessions the palette ordering follows `sessionsStore.sessions` (runtime insertion order). For closed sessions it follows `modifiedTime` DESC from `sessionsListStore`. An alternative: a single unified list sorted by a "last touched" composite (open sessions ranked before closed, then mtime within each tier). Recommendation: keep the two-tier approach (open first, closed by mtime) for simplicity.

5. **Replace or augment the existing `session.switch` parent?**  
   Replacing it removes the old two-step drill-down for open sessions. Augmenting (keeping `session.switch` AND adding flat `session.jump.*`) creates duplicates. Recommendation: **replace** — remove the `session.switch` parent and its children registration block (`registerBuiltinCommands.ts:638-685`), and replace with the new flat `session.jump.*` + `session.resume.*` entries.

6. **Should this reuse the session-search component from the session-pane spec?**  
   A separate spec may propose a search-driven session-picker pane. The palette feature is independent (palette commands + registry entries, no dedicated component) and can be implemented without waiting for that spec. If the session-picker pane lands first, the palette entries can delegate to it via `activateEdgePanel`. Recommendation: implement palette entries independently.

7. **`sessionsListStore.refresh()` on palette open: acceptable performance?**  
   `listSessions` is a synchronous scan of the CLI's JSON catalog. On large catalogs (hundreds of sessions) the RPC round-trip may be tens of milliseconds — fine. On NFS / cloud mounts it could be slower. The refresh is fire-and-forget (the palette renders with stale data first, then updates reactively when the response arrives). No UX blocker here unless the catalog refresh takes > ~200ms; treat that as a separate perf issue.

---

## Alternatives / options

### A: Palette entries vs. dedicated session-picker panel  

| Approach | Tradeoff |
|---|---|
| **Palette entries (this spec)** | Zero new components; uses existing fuse search; keyboard-first; low implementation cost. Limited by palette max-height and single-line row format. **Recommended.** |
| Dedicated session-picker panel (modal or edge panel) | Richer UI (timestamps, workspace chips, multi-select). Higher cost; requires a new component and panel registration. Better if bulk operations (close/delete/batch-resume) are needed. |

### B: Replace `session.switch` vs. extend it

| Approach | Tradeoff |
|---|---|
| **Replace (recommended)** | Single code path; no duplicate entries; simpler mental model. Must verify no external callers depend on the `session.switch` id. |
| Extend (keep `session.switch`, add new ids) | Backwards-compatible; no deletion risk. Palette shows two ways to jump to the same session — confusing. |

### C: Cap at N vs. show all  

| Approach | Tradeoff |
|---|---|
| **Cap at 20 + "Browse…" entry** | Clean palette; covers 95%+ of real use. **Recommended.** |
| Show all | Simple; no hidden sessions. Pollutes the list on large installs. |
| Cap without "Browse…" | Simplest implementation. Slightly less discoverable. |

### D: Confirm-before-resume vs. fire-and-forget

| Approach | Tradeoff |
|---|---|
| **Fire-and-forget (recommended)** | Matches SessionsManager.vue UX; no extra click. |
| Confirm dialog | Safer for users who hit Resume by accident. Adds latency to the most common path. |

---

## Implementation phases

### Phase 1 — Foundation (no UI change yet)
- Call `sessionsListStore.refresh()` on first open of `registerBuiltinCommands` if `!hasLoaded`.
- Wire `sessionsListStore.refresh()` in `CommandPalette.vue:openPalette`.
- Add `sessionDisplayLabel(s: SessionMetadataSummary)` helper to `src/lib/palette.ts` (or a new `src/lib/sessionPaletteEntries.ts`).

### Phase 2 — Jump entries (open sessions)
- Add the `session.jump.*` watcher in `registerBuiltinCommands.ts`.
- Call `jobsStore.openOwningSession(id)` from each entry's `run`.
- Remove the `session.switch` parent registration block (lines 638-685).
- Unit test: jump entries appear for open sessions, absent for closed.

### Phase 3 — Resume entries (closed sessions)
- Add the `session.resume.*` portion of the same watcher (or a second watcher).
- Implement `resumeAndReveal` inline in `run`: `restoreSession` → `addPanel` → `activatePanel` → `requestReveal`.
- Cap at 20 most-recent closed sessions.
- Unit test: resume entries appear for catalog-only sessions, absent for open ones.

### Phase 4 — Disambiguation and search quality
- Populate `keywords` with workspace basename + short GUID.
- Test: typing a workspace folder name surfaces the correct sessions.
- Test: two sessions with the same summary are distinguished by hint.

### Phase 5 — "Browse all sessions" entry (optional)
- If cap is confirmed at 20, add a static `session.browseAll` entry:  
  `{ label: 'Browse All Sessions…', run: () => layoutStore.activateEdgePanel('sessions-manager', 'left') }`.
- Gated `when: () => sessionsListStore.sessions.length > 20`.

---

## References

- `src/lib/registerBuiltinCommands.ts:638-685` — existing `session.switch` watcher (to be replaced)
- `src/stores/observability/jobsStore.ts:160-186` — `openOwningSession` cross-group nav
- `src/stores/shell/layoutStore.ts:182-186` — `requestReveal`
- `src/stores/shell/layoutStore.ts:860-868` — `activatePanel`
- `src/stores/chat/sessionsListStore.ts:28-219` — on-disk catalog
- `src/stores/chat/sessionsStore.ts:583-722` — `restoreSession` (resume path)
- `src/stores/shell/commandRegistry.ts:27-79` — `Command` shape
- `src/lib/palette.ts` — `searchValueFor`, `parentSelfTokens`, `childMatchTokens`
- `src/components/shell/CommandPalette.vue:184-187` — `openPalette` (catalog refresh hook point)
- `src/ipc/types.ts:245-254` — `SessionMetadataSummary`
- Issue #173 — cross-group reveal (the `openOwningSession` fix)
