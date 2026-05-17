# Frontend shell — architecture

> Authoritative snapshot of the current Vue/Bun frontend shell. Newer than
> `plan-architecture.prompt.md` (which is the legacy Rust/Tauri layout with
> a one-line "post-port" note). When the two disagree, this file wins.

## TL;DR

- **The body of the app is dockview-vue.** Sessions are panels. Future
  sidebars (recent sessions, permission queue, MCP status, log viewer,
  BYOK editor, project tree) are dockview **edge groups**, not new
  chrome. Add them via `useLayoutStore().openEdgePanel(position, …)`.
- A slim app-chrome strip at the top holds only global window-level
  actions (New Session, Settings ⚙, Dev wrench 🔧). It is *not* the
  place to grow new functional UI.
- Dockview layout is persisted as opaque JSON inside `settings.json`
  (`layout.dockview`). On startup we resume each session id referenced
  by the layout via `client.resumeSession()`, prune any that failed,
  then `api.fromJSON(layout)`.
- Per-session conversation data lives CLI-side. We never persist event
  buffers / transcripts; the SDK rehydrates them via
  `session.getMessages()` after resume.

## Module map

```
src/
  App.vue                       # shell: topbar + <DockviewVue> body
  main.ts                       # createApp + plugin install + dockview CSS

  components/
    ChatWindow.vue              # one per session; the dockview "chat" panel
    MessageComposer.vue         # Lexical-backed input
    MessageContent.vue          # Lexical-backed assistant/user rendering
    ReasoningBlock.vue          # collapsible reasoning card
    ToolCallBlock.vue           # collapsible tool-call card
    SettingsDialog.vue          # modal (intentionally NOT a dockview panel)

  dev/
    Playground.vue              # ?dev — synthetic event harness, echo chat

  stores/
    layoutStore.ts              # owns the DockviewApi; addPanel / openEdgePanel / snapshot / restore
    sessionsStore.ts            # owns SessionRecord[]; createSession / restoreSession / closeSession
    settingsStore.ts            # versioned settings.json; persistLayout()
    clientStore.ts              # singleton SDK client lifecycle
    modelsStore.ts              # listModels() cache
    permissionsStore.ts         # stub (M1 item: real permission UX)
    toastStore.ts               # PrimeVue toast bridge

  lib/
    chatEvents.ts               # pure reducer: SessionEventPayload[] -> ChatItem[]
    color.ts                    # accentForIndex (per-session palette)
    theme.ts                    # resolveIsDark(theme, prefersDark)

  ipc/
    types.ts                    # CommandMap + payload types (hand-mirrors src-bun/rpc.ts)
    invoke.ts                   # typed invokeCommand + onSessionEvent
    electrobunBridge.ts         # adapter to Electrobun's rpc.request
    rendererLog.ts              # renderer→bun log forwarder

  lexical/                      # Lexical theme + plugin wiring
```

## Lifecycle

```
boot
  └─ main.ts createApp / Pinia / PrimeVue
       └─ App.onMounted
            ├─ settingsStore.load()                  # reads settings.json (versioned, v3)
            ├─ clientStore.createClient()            # spawns Copilot CLI (uses native binary; see SDK gotcha)
            └─ restoreFromLayout()                   # NEW (post-dockview)
                 ├─ extract panel ids from settings.layout.dockview.panels
                 ├─ Promise.all(ids.map(sessionsStore.restoreSession))
                 │     └─ each calls RPC resumeSession(id) → backend SessionRegistry.resume(id)
                 │           └─ session.getMessages() replayed through the same forwarder
                 └─ pendingRestoreLayout = prunePanels(layout, succeededIds)

dockview ready
  └─ App.onDockReady(event)
       ├─ layoutStore.setApi(event.api)
       ├─ event.api.onDidRemovePanel(...) ───► sessionsStore.closeSession(panel.id)
       ├─ if pendingRestoreLayout: layoutStore.restore(pendingRestoreLayout)   ◄─ before subscribing to changes
       └─ event.api.onDidLayoutChange(...) ─► scheduleLayoutSave() (debounced 300 ms)

scheduleLayoutSave  ─►  settingsStore.persistLayout(layoutStore.snapshot())
                                                   └─ RPC updateSettings({ ..., layout: { dockview: ... }})
```

## Session lifecycle invariants

- **Source of truth:** `sessionsStore.sessions[]` for runtime state
  (events, model, reasoningEffort, title). The dockview layout JSON is
  **only** UI shape (panel ids + sizes + positions). Don't duplicate
  per-session state into the layout.
- **Panel ids = session ids.** `addPanel({ id: sessionId, … })`. This
  is the contract that lets us extract session ids from a serialized
  layout via `Object.keys(layout.panels)`.
- **Close path is unidirectional.** ChatWindow's in-pane close button
  is hidden in App (`:hide-close="true"`); the only close path is the
  dockview tab X → `onDidRemovePanel` → `sessionsStore.closeSession`.
  This means `closeSession()` never needs to call into the layout
  store.
- **Add path:** `sessionsStore.createSession()` returns a record →
  caller calls `layoutStore.addPanel(id)`.
- **Restore path:** `sessionsStore.restoreSession(id)` resumes via SDK
  + appends a SessionRecord with `events: []`. The replayed history
  arrives through the standard event forwarder and lands in
  `record.events` via the reducer just like live events.
- **Title sync:** `session.title_changed` event sets
  `record.title`. App.vue watches `[id, title]` pairs and calls
  `layoutStore.renamePanel(id, title || shortPanelTitle(id))`.

## Adding a new surface

**Adding a new chat-like feature?** Make it a dockview panel.

```ts
// 1. Register a named template slot on <DockviewVue> in App.vue:
<template #permissions="{ params }">
  <PermissionQueue :items="..."/>
</template>

// 2. Open it from anywhere:
useLayoutStore().openEdgePanel("left", {
  id: "permission-queue",
  component: "permissions",
  title: "Permissions",
  initialSize: 320,
});
```

Edge groups persist in the same `layout.dockview` JSON, so visibility +
size survive restart with no extra work. Toggle visibility (e.g. a
keybind) via `layoutStore.toggleEdgeGroup("left")`.

**Adding a new global action (rare)?** Add it to the topbar in App.vue.
Resist the urge — most things are panels.

**Adding a new modal (Settings-style)?** PrimeVue dialog; not a
dockview panel. Modals are transient and benefit from focus
management; panels are persistent and benefit from layout integration.

## Wire contract (IPC)

Single source of truth: `src-bun/rpc.ts`. Mirror in `src/ipc/types.ts`.
Snapshot in `src-bun/__tests__/wire-contract.test.ts`.

| Command | Direction | Notes |
|---|---|---|
| `createClient` | renderer → bun | spawns Copilot CLI (deny-by-default permission model) |
| `createSession` | renderer → bun | returns new session id |
| `resumeSession` | renderer → bun | resumes by id; replays history via `session.getMessages()` |
| `listSessions` | renderer → bun | returns `SessionMetadataSummary[]` for "recent sessions" picker (UI TBD) |
| `disconnectSession` | renderer → bun | drops the in-memory entry; data persists CLI-side |
| `sendMessage` | renderer → bun | streams replies as events |
| `setSessionModel` | renderer → bun | per-session model + reasoning effort |
| `listModels` | renderer → bun | with capabilities |
| `getSettings` / `updateSettings` | renderer → bun | versioned (current: v3); `Layout` is part of the shape |
| `getLogDir` / `openLogFolder` | renderer → bun | dev/diagnostics |
| `rendererLog` | renderer → bun | mirrors renderer console.error into bun JSON log |
| `sessionEvent` | bun → renderer | single fan-out channel keyed by `sessionId`. Carries optional envelope `agentId` / `eventId` / `timestamp` lifted from the SDK event for sub-agent attribution. |

`SessionEventPayload.data` is the SDK event's `.data` field verbatim —
the frontend reducer (`src/lib/chatEvents.ts`) reads fields like
`data.toolCallId` directly. Don't reshape the payload in the bun
forwarder.

## Settings schema (v3)

```ts
interface Settings {
  version: 3;
  appearance: { theme: "system" | "light" | "dark"; reasoningVisibility: "hidden" | "compact" | "expanded" };
  layout: { dockview: unknown | null };  // opaque dockview JSON
}
```

Migration is in `src-bun/app/settings.ts`. Adding a field requires:
- bump `SETTINGS_VERSION`,
- extend `Settings` in `src-bun/rpc.ts` and `src/ipc/types.ts`,
- add a coercer in `migrate()` that defaults the field for old docs,
- add a test in `settings.test.ts` proving the old version migrates
  cleanly,
- update snapshot in `wire-contract.test.ts`.

## SDK gotchas (already burned, codified here)

1. **The bundled Copilot CLI JS entrypoint needs Node ≥ 24** (uses
   `node:sqlite`). `src-bun/app/client.ts` resolves the prebuilt
   `@github/copilot-${platform}-${arch}` binary and passes it via
   `cliPath` to dodge the Node version coupling. Don't change this
   without verifying it works on a Node ≤ 23 machine.
2. **SDK permissions are deny-by-default.** Removing the `approveAll`
   shim in `sessions.ts` without a replacement makes the agent's tools
   silently fail. Real permission UX (renderer modal) is M1 item #2.
3. **`session.on()` does NOT replay history.** After `resumeSession()`,
   call `session.getMessages()` and forward each event through the
   normal emit path — the reducer is keyed by ids and converges.
4. **Tool/extension hooks** the SDK exposes that we should reach for
   before reinventing:
   - `onPreToolUse` / `onPostToolUse` — gate or transform any tool call
     without reimplementing the tool.
   - `registerTools()` — add desktop-native tools (open in editor,
     paste screenshot, …) the agent can call.
   - `overridesBuiltInTool: true` — replace a built-in (e.g. `write`)
     when you need behavior the hooks can't express; usually
     unnecessary.
   - `availableTools` / `excludedTools` — per-session/project tool
     allowlist/denylist.

## Tests at a glance

| Surface | Runner | Where |
|---|---|---|
| Backend domain modules | `bun test` | `src-bun/__tests__/` |
| Wire-shape snapshots | `bun test` (`toMatchSnapshot`) | `src-bun/__tests__/wire-contract.test.ts` |
| Frontend pure reducers | `bun test` | `src/lib/__tests__/` |
| Vue SFCs | `bun test` + `tools/bun-vue-loader.ts` (preloaded via `bunfig.toml`) | next to source; currently sparse — see roadmap |
| E2E (real Electrobun binary) | not wired | (open) |

Always run `bun run check` before pushing.
