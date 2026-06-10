# Cross-Session Transcript Search

**Status:** Draft, 2026-06-10

---

## Summary

Add a full-text search surface that lets users query message content across all open sessions (and, in a later phase, closed on-disk sessions). A global command (`search.global`, default Ctrl/Cmd+Shift+F) opens a search panel; results show matching excerpts grouped by session and are clickable to navigate directly to the matching turn. The feature requires no new persistence layer — it queries the in-memory event buffers for open sessions in Phase 1, and calls `session.getEvents()` on lazily-resumed closed sessions in Phase 2.

---

## Motivation

### What's missing today

1. **No cross-session search.** A user with 20+ sessions who remembers "I asked the agent about the retry logic in session X a few days ago" has no way to find it without manually resuming each session and scrolling. The only search that exists is browser-native Ctrl+F within the rendered DOM of the currently visible panel — which finds nothing in other sessions.

2. **In-memory buffer is the only transcript API.** The frontend reducer ingests up to `EVENTS_REPLAY_CAP` (= 600, `src-bun/app/chat/sessions.ts:70-75`) events per session. The Bun side exposes `session.getEvents()` which returns the full SDK transcript. There is no search-oriented RPC.

3. **Sessions list shows summaries, not content.** `SessionMetadataSummary` (`src/ipc/types.ts:245-254`) carries a `summary?` string and metadata (cwd, repo, branch, timestamps) but not message content. The palette's session entries (`session.jump.<id>`, planned in #185) match against summaries — not against what the agent actually said.

4. **No scroll-to-event API.** `layoutStore.requestReveal` (`src/stores/shell/layoutStore.ts:182-186`) accepts `{ toolCallId? }` to scroll to a specific tool call, but there is no event-index anchor for arbitrary messages.

---

## Current State

| File                                            | Symbol                   | What it does                                                                                                                            |
| ----------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-bun/app/chat/sessions.ts:70-75`            | `EVENTS_REPLAY_CAP`      | Caps replay at 600 events; backend buffers more but renderer only gets a slice.                                                         |
| `src-bun/app/chat/sessions.ts:582-642`          | `hydrateHistory`         | Calls `session.getEvents()` and emits the replay batch to the forwarder. Full transcript is available on the Bun side.                  |
| `src-bun/app/chat/sessions.ts:738-759`          | `SessionRegistry.list()` | Returns `SessionMetadataSummary[]` for all sessions known to the CLI.                                                                   |
| `src/lib/chatEvents.ts:43-67`                   | `ChatItem` `kind: 'user' | 'assistant'`                                                                                                                            | User messages carry a `text` field built from `user.message` events; assistant messages accumulate text deltas from `assistant.message_delta`. |
| `src/lib/chatEvents.ts:330-337`                 | `isVisualEventType`      | Filters which eventTypes produce visible items: `assistant.*`, `user.*`, `tool.*`, `system.notification`.                               |
| `src/stores/shell/layoutStore.ts:182-186`       | `requestReveal`          | Stores `{ toolCallId? }` scroll intent by sessionId for `ChatWindow` to consume.                                                        |
| `src/stores/observability/jobsStore.ts:160-186` | `openOwningSession`      | Cross-group reveal: activates outer group panel + inner chat panel; falls back to `addPanel`. Used by the palette session-jump command. |
| `src/stores/shell/commandRegistry.ts:27-79`     | `Command`                | Shape: `id, label, hint?, icon?, group?, keywords?, shortcut?, when?(), run(), children?`.                                              |
| `src/constants/panels.ts:45-53`                 | `PANEL_IDS`              | Singleton edge panel ids. A search overlay panel would need a new entry here.                                                           |

---

## Design

### Search RPC

Add `searchSessionTranscripts(query: string, options?: { sessionIds?: string[]; limit?: number }): Promise<TranscriptSearchResult[]>` to `src-bun/rpc.ts`.

```ts
interface TranscriptSearchResult {
  sessionId: string;
  sessionSummary: string | undefined;
  matches: TranscriptMatch[];
}

interface TranscriptMatch {
  /// Ordinal index of the event within getEvents() result — used as a
  /// scroll anchor by the frontend (requestReveal extension).
  eventIndex: number;
  /// 'user' | 'assistant' | 'system' — derived from eventType prefix.
  role: 'user' | 'assistant' | 'system';
  /// Up to 300 chars of surrounding context with the match highlighted
  /// via <<match>> delimiters (simple to parse on the frontend).
  snippet: string;
  timestamp?: string;
}
```

**Phase 1 — open sessions only.** The Bun registry has an in-memory `entries` Map keyed by sessionId. For each open entry, call `session.getEvents()` (already cached by the SDK after initial hydration), filter events where `eventType` starts with `user.` or `assistant.`, extract text content, and substring-match `query` (case-insensitive). Return up to `options.limit ?? 50` total matches across sessions.

**Phase 2 — closed sessions.** Call `client.listSessions()` to enumerate all known sessions, skip ones already in `entries`, and for each candidate: resume the session in a lightweight read-only mode (no event forwarding to the frontend, just `getEvents()`) or use the SDK's `getSessionMetadata` if it exposes full event access. This is gated on SDK capability; defer to a follow-up.

**Text extraction per event type:**

- `user.message`: `data.message` (string)
- `assistant.message_delta`: `data.text` (string, accumulated)
- `assistant.message_complete`: `data.text` (full assistant turn text)
- `system.notification`: `data.message`

### Frontend: Search Panel

New dockview edge panel **Search** (`PANEL_IDS.search = 'search-panel'`, component `PANEL_COMPONENTS.searchPanel`). Placed in the left activity bar, icon `pi-search`. `initialSize: 360`.

The panel contains:

1. **Query input** — plain `<input type="search">` (not the composer). Debounced 200 ms before invoking `searchSessionTranscripts` via `invokeCommand`.
2. **Results list** — grouped by session. Each group shows the session summary as a header and lists matching excerpts below. Excerpt text renders with `<<match>>` delimiters converted to `<mark>` tags.
3. **Session jump** — clicking a result calls `openOwningSession(sessionId)` (for open sessions) and then sets a `requestReveal` with the `eventIndex` anchor (see §Scroll Anchor extension below).
4. **Scope selector** — radio group: "Open sessions" (Phase 1) vs "All sessions" (Phase 2, grayed out until implemented).

Command: `search.global` (label: "Search all sessions…", group: "Search", shortcut: `["Ctrl+Shift+F", "Cmd+Shift+F"]`). Registered in `registerBuiltinCommands.ts`. Fires `layoutStore.openEdgePanel(PANEL_IDS.search)` and focuses the query input.

### Scroll Anchor Extension

`requestReveal` currently accepts `{ toolCallId?: string }`. Extend to `{ toolCallId?: string; eventIndex?: number }` (backward-compatible). When `eventIndex` is set, `ChatWindow` scrolls to the rendered element whose corresponding event ordinal matches — identify via a `data-event-index` attribute added to timeline item wrappers in `ChatWindow.vue`.

### Open Questions

1. **Event text extraction accuracy.** The SDK's `getEvents()` returns raw SDK events; their exact `data` shape is typed as `Record<string, unknown>` in the IPC layer (`src/ipc/types.ts:166-170`). Extraction must be defensive (type-guard every field). **Recommended default:** extract from `eventType === 'user.message'` → `data.message`, and `eventType === 'assistant.message_complete'` → `data.text`, falling back to empty string if shape doesn't match.

2. **Result limit and performance.** `session.getEvents()` can return thousands of events. **Recommended default:** scan up to 2000 events per session, return up to 8 match snippets per session, 50 total. Make these configurable constants in the Bun handler.

3. **Overlay vs. panel.** A dockview edge panel persists between uses; a modal overlay (like the command palette) is lighter and dismisses with Escape. **Recommended default:** edge panel — it allows the user to refine their query while looking at the session content side-by-side.

4. **Phase 2 scope.** Closed session search requires resuming sessions just to read events — expensive and potentially spammy. **Recommended default:** defer Phase 2 until the SDK exposes a read-only event query or a local SQLite access path.

---

## Alternatives

### A. Client-side only (reduce to renderer state)

Search only the events already in the renderer's `chatEvents` reducer for open sessions. Avoids a new RPC. **Tradeoff:** misses events beyond `EVENTS_REPLAY_CAP` (600) — long sessions silently omit early messages. Not good enough as the primary search path.

### B. Full-text index (SQLite FTS5 via Bun)

Maintain a local SQLite FTS5 index in `<userData>/search.db`. Events are indexed as they arrive from the forwarder. **Tradeoff:** correct and fast at scale; but adds significant complexity (index schema, migration, incremental updates on event stream). Better deferred until Phase 2 closed-session search makes it necessary.

### C. SDK-native search

Expose a `session.search(query)` RPC if the CLI/SDK adds it. Dafman wraps it. **Tradeoff:** ideal but not available today; not a blocker for Phase 1.

---

## Implementation Phases

### Phase 1 — Open-session search (MVP)

1. Add `TranscriptSearchResult` / `TranscriptMatch` types to `src-bun/rpc.ts` and `src/ipc/types.ts`.
2. Implement `searchSessionTranscripts` in `src-bun/app/chat/sessions.ts` — iterate open entries, call `getEvents()`, extract text, substring-match.
3. Wire the new command to `rpc.ts` handler registry.
4. Add `PANEL_IDS.search` and `PANEL_COMPONENTS.searchPanel` to `src/constants/panels.ts`; add seed to `LEFT_ACTIVITY_TABS`.
5. Implement `SearchPanel.vue` — query input, results grouped by session, click-to-navigate.
6. Extend `requestReveal` to accept `eventIndex`; add `data-event-index` attributes to `ChatWindow.vue` timeline items; consume in the scroll composable.
7. Register `search.global` command in `registerBuiltinCommands.ts`.

### Phase 2 — Closed-session search

- Extend `searchSessionTranscripts` to accept `includeClosedSessions: true`.
- For each closed session: resume in read-only mode (no event forwarding), call `getEvents()`, search, then immediately discard the entry.
- Add "All sessions" option to the scope selector; disable until Phase 2 ships.

---

## References

- `src-bun/app/chat/sessions.ts:70-75` — `EVENTS_REPLAY_CAP`
- `src-bun/app/chat/sessions.ts:582-642` — `hydrateHistory` / `getEvents()` usage
- `src-bun/app/chat/sessions.ts:738-759` — `SessionRegistry.list()`
- `src/lib/chatEvents.ts:43-67` — `ChatItem` user/assistant shapes
- `src/lib/chatEvents.ts:330-337` — `isVisualEventType`
- `src/stores/shell/layoutStore.ts:182-186` — `requestReveal`
- `src/stores/observability/jobsStore.ts:160-186` — `openOwningSession`
- `src/constants/panels.ts:40-168` — panel id/component/seed registry
- `src/lib/registerBuiltinCommands.ts:638-685` — session.switch command (palette command pattern)
- GitHub issue #241
