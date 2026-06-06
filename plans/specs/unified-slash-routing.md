# Unified Slash Routing

**Status:** Draft  
**Date:** 2026-06-06  
**Tracking issue:** [#34](https://github.com/AsafMah/dafman/issues/34)

---

## Summary

Introduce a unified slash-command registry that merges dafman's local `SESSION_COMMANDS`, SDK-advertised commands (`session.rpc.commands.list()`), and per-session dynamic namespaces (`/agent <name>`, `/skill <name>`, `/mcp`) into one resolution layer. One composer typeahead shows all sources with provenance badges; one execution path routes to local-run vs. SDK-invoke vs. library-open. The copy-pasted "lookup + invoke + warn-on-miss" pattern in `/agent` becomes the general mechanism for the whole dynamic namespace.

---

## Motivation

**What's broken today:**

1. **Two disjoint worlds.** Dafman's typeahead (`SlashCommandPlugin.vue:122`) shows only `SESSION_COMMANDS` — a static, client-side array. Copilot CLI's own builtins (`/compact`, `/usage`, `/restart`, `/skills`, `/statusline`) and user-invocable skills appear only in the CLI TUI; the composer user never sees them. A user who types `/summarize` gets no typeahead hint and the message is sent verbatim, where the SDK dispatches it silently or produces an error.

2. **Bespoke per-namespace pattern.** Sprint A3 shipped `/agent <name>` (`sessionCommands.ts:142-201`) with its own lookup → `listAgents` → `selectAgent` → warn-on-miss chain. Repeating that verbatim for `/skill <name>` and `/mcp <name>` would produce three copies of the same resolution logic, each drifting independently.

3. **No discovery path for skills/MCP as slash commands.** The `listSessionSkills` RPC exists and returns `userInvocable: boolean` (`rpc.ts:848-858`). The SDK already has `session.rpc.commands.list()` which surfaces builtins, skills, and client-registered commands in one call (`rpc.d.ts:10815`). Neither feeds the composer.

4. **`/mcp`, `/skill`, `/skills` open the library tab** (`sessionCommands.ts:115-140`) but there is no `/mcp <server>` or `/skill <name>` invocation path — the user types the name and the message goes to the SDK completely unguided, where it may or may not be a known command.

5. **`/?` and `/help` list only local commands** (`sessionCommands.ts:398-425`) — they don't know about CLI builtins or user skills, so the help surface is inaccurate.

---

## Current State

| File | Symbol | Role |
|---|---|---|
| `src/lib/sessionCommands.ts:22-48` | `SessionCommand` interface | Local command model: `slash`, `label`, `description`, `icon?`, `keywords?`, `group`, `run(sessionId, args?)`, `acceptsArgs?` |
| `src/lib/sessionCommands.ts:99-111` | `runLocalSlashCommand` | Linear scan of `SESSION_COMMANDS`; case-insensitive match on `slash`; returns `true` if handled. Called from the composer submit path. |
| `src/lib/sessionCommands.ts:113-426` | `SESSION_COMMANDS` | **16** static entries — see the catalog below. |
| `src/lib/sessionCommands.ts:142-201` | `/agent` entry | Has `acceptsArgs: true`; calls `invokeCommand('listAgents')`, matches by name, calls `invokeCommand('selectAgent')`, toasts warn-on-miss. |
| `src/components/chat/SlashCommandPlugin.vue:122` | `allOptions` | `computed(() => SESSION_COMMANDS.map(c => new SlashOption(c)))` — static, no SDK source. |
| `src/components/chat/SlashCommandPlugin.vue:124-136` | `filteredOptions` | Filters by `slash`, `label`, `description`, `keywords`. No provenance concept. |
| `src/components/chat/SlashCommandPlugin.vue:181-214` | `onSelectOption` | If `acceptsArgs`: inserts `/cmd ` for arg-typing (bug #175 fix); else: removes query text and calls `cmd.run()` immediately. |
| `src/components/chat/SlashCommandPlugin.vue:60-101` | Tab handler | Tab-completes to `/cmd ` without executing; mirrors `onSelectOption` for the keyboard path. |
| `src-bun/app/chat/sessionConfigBuilder.ts:329-348` | `buildRegisteredCommands` | Only registers `/library` with the SDK as a `CommandDefinition`. |
| `src-bun/rpc.ts:848-858` | `listSessionSkills` | Returns `Array<{ name, description, source, enabled, userInvocable }>`. |
| `src-bun/rpc.ts:865-868` | `listAgents` | Returns `AgentInfo[]` — used by `/agent` run handler. |
| `src-bun/rpc.ts:975-983` | `listSessionMcpServers` | Returns `Array<{ name, status, source?, error? }>`. |
| `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:10807-10856` | `session.rpc.commands` | `list(params?) → Promise<CommandList>`, `invoke(params) → Promise<SlashCommandInvocationResult>`, `execute(params)`, `enqueue(params)` — all `@experimental`. |
| `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:2382-2405` | `SlashCommandInfo` | `{ name, aliases?, description, kind: "builtin"|"skill"|"client", input?: SlashCommandInput, allowDuringAgentExecution, experimental? }` |
| `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:2413-2427` | `SlashCommandInput` | `{ hint, required?, completion?: "directory", preserveMultilineInput? }` — type-safe arg hints |
| `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:2482-2495` | `CommandsListRequest` | `{ includeBuiltins?, includeSkills?, includeClientCommands? }` — per-source filter flags |
| `node_modules/@github/copilot-sdk/dist/types.d.ts:406-413` | `CommandDefinition` | SDK-side registration: `{ name, description?, handler: CommandHandler }` |

### Local command catalog (current `SESSION_COMMANDS`, 16 entries)

| Slash | Group | Action (`run`) | Args | `acceptsArgs` today | Notes |
|---|---|---|---|---|---|
| `/mcp` | Library | open Library → MCP tab | none | – | |
| `/skill` | Library | open Library → Skills tab | none | – | dup of `/skills` |
| `/skills` | Library | open Library → Skills tab | none | – | dup of `/skill`; collides with CLI builtin (OQ 3) |
| `/agent` | Library | no-arg: open Agents tab; `<name>`: select agent | optional | ✅ | the bespoke lookup pattern (Motivation 2) |
| `/model` | Session | open model selector (right rail) | none | – | |
| `/autopilot` | Session | toggle autopilot↔interactive | none | – | |
| `/compact` | Session | compact history | none | – | collides with CLI builtin (same semantic) |
| `/fork` | Session | fork → new panel | none | – | |
| `/rename` | Session | no-arg: inline rename; `<title>`: set directly | optional | ✅ | |
| `/cd` | Session | no-arg: show cwd; `<path>`: change | optional | ✅ | |
| `/close` | Session | close panel (keeps history) | none | – | |
| `/fleet` | Session | spawn sub-agent fleet | optional prompt | ✅ | |
| `/library` | Navigation | open Library (`<tab>`, default mcp) | optional tab | ❌ **wrong** | takes an arg but executes on select |
| `/plan` | Session | plan mode (+ `<prompt>` → planning turn) | optional prompt | ❌ **wrong** | takes an arg but executes on select |
| `/?` | Session | help toast (static local list) | none | – | dup of `/help` |
| `/help` | Session | help toast (static local list) | none | – | dup of `/?`; collides with CLI builtin (OQ 6) |

The per-command `acceptsArgs` boolean is hand-set and **already inconsistent** (`/plan`, `/library` take args but omit it). Under unified routing this hand-tuning should go away entirely — see **OQ 9**.

**Key gap:** `session.rpc.commands.list()` is `@experimental` but present in the installed `1.0.0-beta.9` types. The `copilot-sdk-update.md` spec (row #2 in the feature table) already recommends calling it on session create/resume. This spec is the consumer of that capability.

---

## Design

### 1. Unified Slash Entry type

Introduce `UnifiedSlashEntry` as the canonical shape that all sources are mapped into before they reach the typeahead or resolver:

```ts
// src/lib/slashRegistry.ts (new file)
export type SlashSource =
  | 'dafman'       // local SESSION_COMMANDS
  | 'sdk-builtin'  // CLI builtins (kind="builtin")
  | 'sdk-skill'    // user-invocable skills (kind="skill")
  | 'sdk-client'   // CommandDefinitions registered by SDK clients (kind="client")
  | 'agent'        // /agent <name> dynamic entries
  | 'mcp'          // /mcp <server> dynamic entries

export interface UnifiedSlashEntry {
  slash: string           // leading "/" included
  label: string
  description: string
  source: SlashSource
  icon?: string           // PrimeIcons class; fallback per-source
  keywords?: string[]
  group: string
  acceptsArgs?: boolean
  argHint?: string        // from SlashCommandInput.hint or synthesized
  argRequired?: boolean   // from SlashCommandInput.required
  /// Execution:
  run(sessionId: string, args?: string): void | Promise<void>
}
```

`SESSION_COMMANDS` entries map to `source: 'dafman'`; their existing `run` is preserved verbatim.

---

### 2. Slash Registry store

New Pinia store: `src/stores/chat/slashRegistryStore.ts`.

```ts
interface SlashRegistryState {
  // Per-session SDK commands. Populated on session-ready, refreshed
  // on session resume. Key: sessionId.
  sdkEntries: Map<string, UnifiedSlashEntry[]>
  // Global dafman-local entries. Never changes at runtime.
  // (SESSION_COMMANDS mapped to UnifiedSlashEntry[])
  localEntries: UnifiedSlashEntry[]
}
```

**Load trigger:** When a session transitions to `status: 'ready'` (watcher in `sessionsStore` or a new session hook), call `loadSdkCommands(sessionId)`:

```ts
async function loadSdkCommands(sessionId: string) {
  // Bun-side: new RPC handler (see §4)
  const list = await invokeCommand('listSessionCommands', { sessionId })
  // list: UnifiedSlashEntry[] (pre-mapped on the bun side)
  sdkEntries.set(sessionId, list)
}
```

The bun-side handler calls `session.rpc.commands.list({ includeBuiltins: true, includeSkills: true, includeClientCommands: false })` — exclude `client` entries because dafman's own registered commands are already in `localEntries`.

**Dynamic namespace entries (agents, MCP):** These are NOT pre-fetched into the store. Instead, they are resolved lazily on typeahead open via a reactive computed that joins:

1. `localEntries` (always stable)
2. `sdkEntries.get(sessionId) ?? []`
3. Dynamic agent entries: `listAgents(sessionId)` result → `UnifiedSlashEntry[]` with `source: 'agent'`, slash `/agent <name>`, description from agent's `displayName`
4. Dynamic MCP entries: `listSessionMcpServers(sessionId)` → each enabled server → `source: 'mcp'`, slash `/mcp <server>` (open-server tab shortcut)

Points (3) and (4) are loaded once per session-ready event (same trigger as SDK commands) and cached in the store alongside SDK entries. They update on `setSessionMcpEnabled` / `selectAgent` events.

**Computed merge:**

```ts
function entriesForSession(sessionId: string): UnifiedSlashEntry[] {
  const local = localEntries         // always first
  const sdk   = sdkEntries.get(sessionId) ?? []
  const all   = [...local, ...sdk]
  // Deduplicate by slash (after precedence resolution — see §5)
  return dedupeBySlash(all)
}
```

---

### 3. Typeahead changes (`SlashCommandPlugin.vue`)

**Replace** the `allOptions` computed:

```ts
// Before:
const allOptions = computed(() => SESSION_COMMANDS.map(c => new SlashOption(c)))

// After:
const registry = useSlashRegistryStore()
const allOptions = computed(() =>
  registry.entriesForSession(props.sessionId).map(e => new SlashOption(e))
)
```

`SlashOption` wraps `UnifiedSlashEntry` instead of `SessionCommand` (same shape, just the broader type).

**Provenance badges** in the template: add a `source` chip next to the slash name.

```html
<span class="slash-item-name">{{ opt.entry.slash }}</span>
<span v-if="opt.entry.source !== 'dafman'" class="slash-item-badge" :data-source="opt.entry.source">
  {{ sourceBadgeLabel(opt.entry.source) }}
</span>
<span class="slash-item-desc">{{ opt.entry.description }}</span>
```

Badge labels:
- `sdk-builtin` → `"CLI"`
- `sdk-skill` → `"skill"`
- `agent` → `"agent"`
- `mcp` → `"mcp"`
- `dafman` → (no badge; always first, already familiar)

**`acceptsArgs` for SDK entries:** `SlashCommandInput.required === true` → `acceptsArgs: true`; bare `input` present (even if not required) → `acceptsArgs: true` so Enter completes to `/cmd ` rather than firing immediately. This matches the existing `onSelectOption` behavior for `acceptsArgs` commands (`SlashCommandPlugin.vue:192-208`).

**Arg hint display:** When the typeahead shows a selected item that has `argHint`, render it as a placeholder ghost below the item label (same pattern as the palette's `hint` field).

---

### 4. Execution path (`runLocalSlashCommand` and send path)

**Current flow** (in `useChatSubmit.ts` or wherever the send path lives): `runLocalSlashCommand(sessionId, text)` → if returns `false`, message is sent to the SDK verbatim.

**New flow:**

```
text starts with "/" ?
  YES → resolveSlashCommand(sessionId, text)
        returns:
          { kind: 'local',   run }    → run(sessionId, args); don't send
          { kind: 'sdk-invoke', name, input } → session.rpc.commands.invoke({ name, input })
          { kind: 'sdk-send' }        → send verbatim (unknown; let SDK error)
          null                        → not a slash command; send normally
```

**`resolveSlashCommand(sessionId, text)`** lives in `slashRegistry.ts`:

```ts
export function resolveSlashCommand(
  sessionId: string,
  text: string,
): SlashResolution | null {
  const { slash, args } = parseSlashCommand(text) ?? {}
  if (!slash) return null

  const entries = useSlashRegistryStore().entriesForSession(sessionId)
  const match = entries.find(e => e.slash.toLowerCase() === slash)

  if (!match) {
    // Unknown slash: forward to SDK (see open question #5)
    return { kind: 'sdk-send' }
  }

  if (match.source === 'dafman' || match.source === 'agent' || match.source === 'mcp') {
    return { kind: 'local', run: () => match.run(sessionId, args) }
  }

  // SDK-sourced (builtin, skill, client): route through SDK invoke
  return { kind: 'sdk-invoke', name: match.slash.slice(1), input: args }
}
```

The `sdk-invoke` path calls `invokeCommand('invokeSessionCommand', { sessionId, name, input })` — a new bun-side RPC handler that calls `session.rpc.commands.invoke({ name, input })` and emits the result as a system message.

**`/agent`, `/skill`, `/mcp` without args:** These remain `source: 'dafman'` and their existing `run` handlers open library tabs when `args` is empty — no change to that behavior.

**`/agent <name>` with args:** The existing `/agent` entry's `run` handler is preserved exactly (it already does lookup → `selectAgent`). The dynamic per-agent entries (`/agent codex`, `/agent summarize`) added by the agent namespace are *additional* entries that call `selectAgent` directly — they are convenience shortcuts to the same underlying action.

**`/skill <name>` dynamic entries:** Add a new `source: 'agent'` (or `'sdk-skill'`) entry per user-invocable skill. The `run` handler calls `session.rpc.commands.invoke({ name, input: args })` via the new `invokeSessionCommand` RPC. The bare `/skill` or `/skills` entries remain as dafman-local library-openers.

---

### 5. Precedence and conflict rules

When two entries share the same `slash` value, the **first** survives in `dedupeBySlash`. Resolution order:

1. **`dafman`** (local `SESSION_COMMANDS`) — always wins. These are dafman's explicit UI actions; an SDK builtin named the same must not shadow them.
2. **`agent`** dynamic entries — per-agent shortcuts (e.g. `/agent codex`) are synthesized names; they only exist for exact `<name>` suffixes, not bare `/<name>`, so collision with SDK builtins is unlikely in practice.
3. **`mcp`** dynamic entries — same as agents.
4. **`sdk-builtin`** — CLI runtime builtins.
5. **`sdk-skill`** — user skills.
6. **`sdk-client`** — other SDK-registered clients.

**Known static collisions today:**

| Slash | dafman source | SDK source | Winner |
|---|---|---|---|
| `/compact` | `sessionCommands.ts:231` (calls `compactSessionHistory`) | CLI builtin | dafman (acceptable: same semantic) |
| `/skills` | `sessionCommands.ts:133` (opens library tab) | CLI builtin (user-invocable skills list) | dafman — **decision needed (OQ #3)** |
| `/help` | `sessionCommands.ts:414` (local list) | CLI builtin | dafman — **decision needed (OQ #6)** |

---

### 6. New IPC surface

Two new entries in `src-bun/rpc.ts` `DafmanRPC`:

```ts
/// Returns merged SDK-native slash commands for the session:
/// builtin + skill, mapped to UnifiedSlashEntry shape.
/// Excludes client-registered commands (those come from SESSION_COMMANDS).
listSessionCommands: {
  params: { sessionId: string }
  response: Array<{
    slash: string        // "/<name>"
    label: string        // description
    description: string
    source: 'sdk-builtin' | 'sdk-skill' | 'sdk-client'
    acceptsArgs: boolean
    argHint?: string
    argRequired?: boolean
    allowDuringAgentExecution: boolean
    experimental?: boolean
  }>
}

/// Invokes an SDK-native slash command and returns any text output.
/// For kind="skill" the SDK dispatches via the skill runner; for kind="builtin"
/// it runs the CLI's built-in handler. Client-handled commands
/// (kind="client") should use the dafman local path instead.
invokeSessionCommand: {
  params: { sessionId: string; name: string; input?: string }
  response: { kind: 'text'; text: string } | { kind: 'prompt'; prompt: string } | { kind: 'completed' }
}
```

The `listSessionCommands` bun-side handler calls `session.rpc.commands.list({ includeBuiltins: true, includeSkills: true, includeClientCommands: false })` and maps `SlashCommandInfo[]` to the response shape.

The `invokeSessionCommand` handler calls `session.rpc.commands.invoke({ name, input })` and returns the `SlashCommandInvocationResult` discriminated union mapped to the simpler response type. Text results are also emitted as `system.notification` events so they appear in the chat timeline.

---

### 7. `/?` and `/help` enrichment

Once `slashRegistryStore` is populated, the `/help` and `/?` run handlers should enumerate `entriesForSession(sessionId)` grouped by source instead of the static `SESSION_COMMANDS` array. This makes the help surface accurate for the current session's skill/builtin set.

---

### 8. Palette integration

`registerBuiltinCommands.ts` already imports `SESSION_COMMANDS` and maps them into `Command` palette entries. The same watch pattern that drives dynamic "Switch Model" entries can drive dynamic skill/agent palette entries from `slashRegistryStore`. This is a follow-on (Phase 3) and not blocking the composer typeahead work.

---

## Open Questions

**OQ 1 — Does `session.rpc.commands.list()` actually work in beta.9?**  
It is `@experimental` and present in the installed types (`rpc.d.ts:10815`). The `copilot-sdk-update.md` spec notes it but hasn't tested it. The bun-side handler needs a try/catch fallback: if `commands.list` throws or returns an empty list, degrade gracefully (show only `SESSION_COMMANDS`). **Decision: proceed with `@experimental` call; wrap in try/catch; log but don't crash if unavailable.**

**OQ 2 — Bare `/agent`, `/skill`, `/mcp` vs. `/<name>` direct invocation?**  
The issue asks whether `/cmd <name>` form coexists with `/<name>` direct form (where `<name>` is a skill/agent/mcp-server name). Adding `/<skillname>` directly creates a namespace collision risk if a skill is named `compact`, `fork`, `help`, etc.  
**Recommended default:** Keep `/agent <name>`, `/skill <name>`, `/mcp <name>` as the authoritative forms for dafman-dispatch. Direct `/<skillname>` is routed through the SDK (sdk-invoke path) for skills that appear in `commands.list`. The dynamic per-agent shortcut entries in §2 are supplementary — they don't create a new command syntax, they just pre-populate the typeahead so users can type `/codex` and see it resolved.

**OQ 3 — `/skills` collision with CLI builtin.**  
Today `/skills` opens the Library tab. The CLI also has a `/skills` builtin that lists user skills inline. Both behaviors are reasonable; they diverge in where output appears (dafman panel vs. chat timeline).  
**Options:**
- A) dafman wins (current); CLI behavior invisible.
- B) Rename dafman's entry to `/skill-library` or fold it into `/library skills`.
- C) Detect ambiguity and prompt user.
**Recommended default:** A (preserve backward compat). Add a note in the typeahead description: "Opens Library. To see skills inline, run /skill in CLI."

**OQ 4 — Caching lifetime for `listSessionCommands`.**  
Skills and agents can change mid-session (user enables a skill in the Library panel, user drops a new agent file). How stale can the cached entries be?  
**Recommended default:** Refresh on every `listSessionSkills` or `listAgents` result change (already reactive via Pinia stores). For SDK-native builtins (stable set), cache for the session lifetime. Expose a `refreshSlashCommands` action callable from the Library panel's existing refresh flow.

**OQ 5 — What happens to unknown `/<name>` at send time?**  
If the user types `/unknownthing` and it isn't in any source, the current fallthrough sends it verbatim and the SDK errors (or dispatches it if it happens to match a skill the list call missed). Three options:
- A) Warn-toast "Unknown command /unknownthing" and don't send. Ask user to hit Enter again to force-send.
- B) Forward to SDK silently (current behavior). Let the SDK surface the error in the chat timeline.
- C) Forward to SDK with a toast: "Sending /unknownthing to Copilot CLI…" (informational).
**Recommended default:** B (preserve current implicit behavior; avoids false positives when `commands.list` is incomplete or stale).

**OQ 6 — `/help` collision with CLI builtin.**  
Similar to `/skills`. CLI's `/help` is a live listing of all commands; dafman's `/help` is a toast with the static local list.  
**Recommended default:** If we implement §7 (enriched help), dafman's `/help` becomes a superset of the CLI's — keep dafman winning. After §7 ships, the help content will be accurate.

**OQ 7 — Per-session vs. global command sets.**  
Skills and agents are per-session (they depend on `cwd`, enabled/disabled state, loaded agent files). SDK builtins are per-session-type (may differ between plan-mode and interactive sessions). `SESSION_COMMANDS` are global (same for all sessions).  
**Decision: all commands are per-session in the registry** (the local entries are just copied into every session's merge result). No global-only view is needed for the composer; the palette already handles global commands separately.

**OQ 8 — `invokeSessionCommand` result display.**  
When the SDK's `commands.invoke` returns a `SlashCommandAgentPromptResult` (the command wants to send a message to the agent), should dafman (a) emit it as a user turn directly, (b) insert it into the composer text for the user to review and send, or (c) emit as a system.notification?  
**Recommended default:** (a) emit as a user turn directly — this matches what the CLI TUI does when a skill produces a prompt. (b) would be confusing (looks like the user typed it). (c) loses the agent dispatch.

**OQ 9 — The local `acceptsArgs` boolean is interim and should be derived, not hand-set.**  
Each `SESSION_COMMANDS` entry carries a hand-set `acceptsArgs` (#175). The catalog above shows it is already wrong for `/plan` and `/library`, and **most** commands will need to accept args once SDK/CLI commands (which advertise typed `SlashCommandInput` hints) flow through the same typeahead. Patching individual booleans now is throwaway work. The unified resolver should decide insert-vs-execute uniformly: SDK entries derive it from `SlashCommandInput` (§3); local entries should carry an optional `argHint?` and the typeahead inserts-to-`/cmd ` whenever an `argHint` is present (SDK or local), executing only truly no-arg actions.  
**Recommended default:** stop hand-setting `acceptsArgs` per command — give every entry an optional `argHint?`, drive insert-vs-execute off its presence, and fold the current 4 `acceptsArgs: true` flags + the `/plan`/`/library` fix into this migration rather than before it. **Decision needed:** adopt `argHint`-driven arg acceptance vs keep explicit booleans.

---

## Alternatives / Options

### A. Extend `SessionCommand` in place vs. new `UnifiedSlashEntry`

| Option | Tradeoff |
|---|---|
| Extend `SessionCommand` with `source?` | Minimal delta; keeps one type. Risk: forces `run` to be optional for SDK entries (they don't need a renderer-side handler). |
| New `UnifiedSlashEntry` (recommended) | Clean separation; `SessionCommand` stays the local contract; `UnifiedSlashEntry` is the display/resolution contract. `SESSION_COMMANDS` entries are mapped once at store init. |

### B. Where to merge: renderer store vs. bun-side

| Option | Tradeoff |
|---|---|
| Merge in renderer Pinia store (recommended) | `SESSION_COMMANDS` lives in the renderer; no serialization needed for local entries. SDK entries come via IPC as a flat JSON array. Simple. |
| Merge in bun-side session registry | Would require serializing `SESSION_COMMANDS` (which include `run` functions — not serializable) across IPC. Not viable as-is. |

### C. Forward unknown slash as `sdk-send` vs. block-with-warn

| Option | Tradeoff |
|---|---|
| Forward silently (recommended) | Backward compat; handles edge cases where `commands.list` is stale. |
| Warn-then-confirm (OQ #5 option A) | Prevents accidental sends but adds friction for power users who know what they're typing. |

### D. Dynamic agent/MCP entries as slash vs. subcommands

| Option | Tradeoff |
|---|---|
| `/agent <name>` subcommand form only (current) | Simpler; no namespace pollution. `/agent` entry's `acceptsArgs` typeahead already helps. |
| Also synthesize `/<name>` top-level entries for every agent (recommended with caution) | Mirrors CLI behavior; instant typeahead for frequent users. Risk: collision. Mitigate with precedence rules (§5) and only synthesize for `userInvocable: true` entries. |

---

## Implementation Phases

### Phase 1 — SDK command discovery (bun + store)
1. Add `listSessionCommands` and `invokeSessionCommand` to `src-bun/rpc.ts` and `src-bun/index.ts`.
2. Implement bun-side handlers in `src-bun/app/chat/sessionRegistry.ts` (or a new `sessionCommandsService.ts`): call `session.rpc.commands.list({ includeBuiltins: true, includeSkills: true, includeClientCommands: false })`, map to response shape.
3. Create `src/stores/chat/slashRegistryStore.ts`: `localEntries` from `SESSION_COMMANDS`, `sdkEntries` map, `loadSdkCommands(sessionId)` action, `entriesForSession(sessionId)` computed.
4. Wire `loadSdkCommands` into the session-ready lifecycle (watch `session.status === 'ready'` in `sessionsStore`).
5. Tests: `src-bun/__tests__/sessions.test.ts` — mock `commands.list` response, assert `listSessionCommands` maps correctly; test graceful fallback when `commands.list` throws.

### Phase 2 — Unified typeahead
1. Refactor `SlashCommandPlugin.vue`: replace `SESSION_COMMANDS` import with `useSlashRegistryStore().entriesForSession(sessionId)`.
2. Add provenance badge to the slash menu item template.
3. Wire `acceptsArgs` for SDK entries via `SlashCommandInput.required || input != null`.
4. Update `filteredOptions` to also match on `source` (so `/cli` or `/skill` as search terms filter by badge).
5. Manual smoke: open composer, type `/`, confirm local + SDK builtins + skills all appear with badges; Tab completion works for both `acceptsArgs` cases.

### Phase 3 — Unified execution path
1. Introduce `resolveSlashCommand` in `src/lib/slashRegistry.ts` (see §4).
2. Replace `runLocalSlashCommand` call site(s) in the composer submit path with `resolveSlashCommand`.
3. Handle `sdk-invoke` path: `invokeCommand('invokeSessionCommand', ...)`.
4. Handle `sdk-send` fallthrough (no-op vs. OQ #5 decision).
5. Tests: unit test `resolveSlashCommand` with mocked registry state; confirm local commands still short-circuit without IPC, SDK commands route to `invokeSessionCommand`.

### Phase 4 — Dynamic namespace entries
1. Add agent entries to `slashRegistryStore`: on `loadSdkCommands`, also call `listAgents(sessionId)` and synthesize `UnifiedSlashEntry[]` for `userInvocable` agents with `source: 'agent'`.
2. Add MCP entries similarly from `listSessionMcpServers`.
3. Update `entriesForSession` to include these.
4. Refresh on Library panel "Refresh" actions.

### Phase 5 — Enriched help + palette
1. Update `/help` and `/?` run handlers to enumerate `slashRegistryStore.entriesForSession(sessionId)`.
2. Add dynamic skill/agent slash entries to the command palette (watch `sdkEntries` in `registerBuiltinCommands.ts`).

---

## References

- [Issue #34](https://github.com/AsafMah/dafman/issues/34) — source issue
- [Issue #33](https://github.com/AsafMah/dafman/issues/33) — closed; bespoke `/skill` that was rejected in favor of this general solution
- `src/lib/sessionCommands.ts` — current `SessionCommand` model and 16-entry `SESSION_COMMANDS` (full catalog in Current State)
- `src/components/chat/SlashCommandPlugin.vue` — Lexical typeahead + `acceptsArgs` execution logic
- `src-bun/app/chat/sessionConfigBuilder.ts:329-348` — `buildRegisteredCommands`, currently only `/library`
- `src-bun/rpc.ts:848-858` — `listSessionSkills` response shape
- `src-bun/rpc.ts:865-868` — `listAgents` response shape
- `src-bun/rpc.ts:975-983` — `listSessionMcpServers` response shape
- `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:10807-10856` — `session.rpc.commands` surface (`list`, `invoke`, `execute`, `enqueue`)
- `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:2382-2427` — `SlashCommandInfo`, `SlashCommandInput` shapes
- `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:2482-2495` — `CommandsListRequest` filters
- `node_modules/@github/copilot-sdk/dist/types.d.ts:406-413` — `CommandDefinition` (server-side registration)
- `plans/specs/copilot-sdk-update.md` — feature table row #2 (`commands.list` → typeahead enrichment) and row #1 (register all local slash commands with SDK); this spec is the implementation target for those rows
- `plans/specs/keyboard-shortcuts.md` — parallel registry pattern (command registry precedence model)
