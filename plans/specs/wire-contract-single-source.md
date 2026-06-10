# Wire Contract Single Source

**Status:** Draft — 2026-06-10

---

## Summary

Make the IPC wire contract single-source by extracting the payload-only request, response, message, settings, error, and audit types into a shared module with **no `electrobun` import**. `src-bun/rpc.ts` stays the Bun-only `RPCSchema` adapter; `src/ipc/types.ts` becomes a renderer barrel that re-exports the shared payload types plus renderer-local constants. This chooses extraction over drift-detection because the repo already has an observed mirror mismatch (`sendMessage.agentMode`) and the audit identifies `src-bun/rpc.ts` ↔ `src/ipc/types.ts` as the top jscpd clone.

---

## Motivation

`CODE_AUDIT.md` identifies `src-bun/rpc.ts` ↔ `src/ipc/types.ts` as the #1 production clone: **597 duplicated lines across six blocks**, with the backend RPC schema and renderer declarations copy-maintained (`CODE_AUDIT.md:104`). The same family appears in `errors.ts` ↔ `types.ts` and `settings.ts` ↔ `settingsStore.ts` (`CODE_AUDIT.md:107-109`). The architecture intends a typed IPC surface (`ARCHITECTURE.md:31`) and documents the wire surface as `src-bun/rpc.ts`, mirrored in `src/ipc/types.ts`, snapshotted in `src-bun/__tests__/wire-contract.test.ts` (`ARCHITECTURE.md:270-274`). Manual mirroring has already drifted: backend `sendMessage.params` accepts `agentMode?: SessionMode` (`src-bun/rpc.ts:728-733`), `src-bun/index.ts` consumes it (`src-bun/index.ts:240-242`), and `sessionsStore` sends it (`src/stores/chat/sessionsStore.ts:706-723`), but renderer `CommandMap['sendMessage']['args']` lists only `sessionId`, `text`, `mode`, and `attachments` (`src/ipc/types.ts:601-608`).

---

## Current state

### Wire ownership is contradictory

- `src-bun/rpc.ts` says “Keep this file the single source of truth” and that both Bun and renderer import the type from it (`src-bun/rpc.ts:8-10`).
- The same file imports `RPCSchema` from `electrobun/bun` (`src-bun/rpc.ts:12`), which the renderer must never load.
- `src/ipc/types.ts` therefore restates payload-only types by hand so the Vue tree never imports `electrobun/bun` (`src/ipc/types.ts:1-5`).
- `src/ipc/invoke.ts` relies on renderer-local `CommandMap`, `CommandName`, and payload types from `@/ipc/types` for its typed bridge (`src/ipc/invoke.ts:8-18`, `src/ipc/invoke.ts:83-91`, `src/ipc/invoke.ts:151-158`).

### Build and lint boundary feasibility

- Renderer TypeScript includes only `src/**/*.ts`, `src/**/*.d.ts`, `src/**/*.tsx`, and `src/**/*.vue` (`tsconfig.json:35`), maps `@/*` to `./src/*` (`tsconfig.json:19-20`), and references the Bun tsconfig (`tsconfig.json:36`).
- Bun TypeScript includes only `src-bun/**/*.ts`, `tools/**/*.ts`, and `tools/**/*.vue` (`tsconfig.bun.json:21`).
- Vite resolves `@` to `src` (`vite.config.ts:12-15`).
- Electrobun builds Bun from `src-bun/index.ts` (`electrobun.config.ts:39-40`); it does not require renderer alias support for Bun imports.
- ESLint forbids `electrobun` imports under `src-bun/app/**/*.ts` (`eslint.config.js:149-158`) and under renderer `src/**/*.{ts,vue}` (`eslint.config.js:166-175`). It does **not** currently forbid renderer code from importing `src-bun/**` by path, nor Bun code from importing a pure `src/**` module.

**Feasibility conclusion:**

- A renderer `import type` from `src-bun/rpcTypes.ts` would avoid runtime bundling if it remains type-only, and the current lint boundary would allow it because it bans `electrobun`, not `src-bun` paths. But it violates the intended mental boundary and depends on every caller preserving type-only imports.
- A shared module under `src/shared/` is cleaner: renderer already includes it and Vite already resolves it through `@`; Bun needs `tsconfig.bun.json` to include `src/shared/**/*.ts` and can import it relatively from `src-bun/rpc.ts` / `src-bun/app/**`. No Electrobun config change is needed.
- Recommended lint hardening: add a renderer `no-restricted-imports` pattern for `src-bun/**` / `../src-bun/**` after the shared module lands, so future contributors cannot take the tempting `src → src-bun` shortcut.

### Snapshot tests cover shapes but not the mirror

- `wire-contract.test.ts` imports type samples from `../rpc` and `../app/shared/errors`, i.e. Bun-side only (`src-bun/__tests__/wire-contract.test.ts:1-18`).
- The test’s stated purpose is “if anyone renames a field, this test breaks loudly” and to keep snapshots in sync with `../rpc.ts` (`src-bun/__tests__/wire-contract.test.ts:20-23`).
- Several request samples are untyped object literals. The `agentMode` snapshots exist (`src-bun/__tests__/wire-contract.test.ts:395-409`), but they did not catch the missing renderer `CommandMap` field because the renderer mirror is not part of the test.

---

## Design

### Chosen approach: A — extract pure payload types

Create `src/shared/wireTypes.ts` as the contract module with **only type exports** for JSON-safe payloads and wire maps. It must not import `electrobun`, Vue, Pinia, or Bun-only modules.

Core exports:

- Value/payload types now duplicated in `src-bun/rpc.ts` and `src/ipc/types.ts`: `SessionMode`, `Settings`, `Appearance`, `ToolsPrefs`, `PermissionsPrefs`, `TerminalPrefs`, `ModelSummary`, `SessionMetadataSummary`, `AgentInfo`, `TaskInfo`, `JobRecord`, `AgentFileEntry`, `SendMessageAttachment`, `WorkspaceFileMatch`, `SessionEventPayload`, `PendingRequestPayload`, `RespondToRequestParams`, `PermissionApprovalRule`, `LogRecord`, `AuditEntry`.
- `AppErrorPayload`, moved from `src-bun/app/shared/errors.ts` into the shared type module; `errors.ts` imports it and continues to own `AppError`/`rpcGuard` runtime behavior.
- `CommandMap`, in the renderer-friendly shape `{ args; result }`.
- `WebviewMessageMap`, in the renderer/bun message shape for `sessionEvent`, `pendingRequest`, `logEvent`, `auditEvent`, `terminalEvent`, and `commandResultEvent`.

Keep `LAYOUT_SCHEMA_VERSION` in `src/ipc/types.ts` or move it to a separate shared constants module only if Bun needs the value. It is currently a renderer value used by `settingsStore` (`src/stores/app/settingsStore.ts:16-32`) and is not present in `src-bun/rpc.ts`.

### Bun adapter stays Bun-only

`src-bun/rpc.ts` becomes an adapter around the shared maps:

- Import `type { CommandMap, WebviewMessageMap, AppErrorPayload, ... }` from `../src/shared/wireTypes`.
- Define a local mapped type that converts renderer `{ args; result }` entries into Electrobun `{ params; response }` entries.
- Define `DafmanRPC` using `RPCSchema` only in `src-bun/rpc.ts`.
- Keep `WebviewSendChannels` derived from `DafmanRPC['webview']['messages']` so the existing `src-bun/index.ts` cast remains tied to the schema (`src-bun/rpc.ts:1316-1327`).

This preserves the architecture rule: only the Bun adapter knows about `electrobun/bun`; pure app modules and renderer modules import only JSON payload types.

### Renderer barrel becomes thin

`src/ipc/types.ts` should:

- Re-export shared payload types and `CommandMap` from `@/shared/wireTypes`.
- Keep renderer-only values such as `LAYOUT_SCHEMA_VERSION` if they are not part of the IPC wire.
- Stop declaring mirrored interfaces directly.

`src/ipc/invoke.ts` keeps importing from `@/ipc/types`; call sites do not need to move in the first cut (`src/ipc/invoke.ts:8-18`).

### Settings and error family cleanup

- Move `AppErrorPayload` into the shared module; update `src-bun/app/shared/errors.ts` to import the type and keep `AppError`, `formatPayload`, and `rpcGuard` local (`src-bun/app/shared/errors.ts:8-17`, `src-bun/app/shared/errors.ts:62-87`).
- Update `src-bun/app/config/settings.ts` to import settings-related types from the shared module instead of `../../rpc`; it currently imports `Appearance`, `KeyboardShortcutPrefs`, `Layout`, `NotificationPrefs`, `PermissionsPrefs`, `ReasoningVisibility`, `Settings`, `ShortcutScope`, `TerminalPrefs`, `ThemeChoice`, `ToolsPrefs`, and `Workspaces` from `../../rpc` (`src-bun/app/config/settings.ts:18-29`).
- Keep `SettingsService` runtime behavior unchanged; default settings and coercion stay in `settings.ts` (`src-bun/app/config/settings.ts:67-116`).

### `wire-contract.test.ts` evolution

Keep the existing snapshot strategy but make samples type-check against the shared `CommandMap` / payload types instead of Bun-only `DafmanRPC` declarations.

Required changes:

1. Import samples from `src/shared/wireTypes` (via a relative path from `src-bun/__tests__/wire-contract.test.ts`) rather than from `../rpc` for payload shapes.
2. Type request samples with `satisfies CommandMap['<command>']['args']`. This would have caught the current `agentMode` drift because `src-bun/__tests__/wire-contract.test.ts:395-409` would fail if `CommandMap['sendMessage']['args']` omitted `agentMode`.
3. Keep a small Bun-adapter type assertion that `DafmanRPC` is derived from the shared maps. The snapshot content should not need duplicate samples for Bun vs renderer because both import the same types.
4. Add one renderer-side lightweight type test only if the team wants a second guard that `src/ipc/types.ts` re-exports the shared `CommandMap`. It should not mirror snapshots; mirroring snapshots is the rejected alternative.

---

## Open Questions

1. **Where should the shared module live?**
   - Option A: `src/shared/wireTypes.ts`.
   - Option B: `src-bun/rpcTypes.ts` imported type-only by renderer.
   - **Recommended default:** Option A. It avoids renderer → `src-bun` coupling, works with the existing Vite alias, and only requires `tsconfig.bun.json` to include `src/shared/**/*.ts`.

2. **Should `src/ipc/types.ts` remain as a barrel?**
   - Option A: keep it as the stable renderer import path.
   - Option B: migrate renderer code directly to `@/shared/wireTypes`.
   - **Recommended default:** keep the barrel for the first PR. `src/ipc/invoke.ts` and renderer stores already depend on it (`src/ipc/invoke.ts:8-18`); a barrel keeps the behavioral diff small.

3. **Should the lint boundary explicitly ban renderer imports from `src-bun/**`?\*\*
   - **Recommended default:** yes, after the shared module lands. Current ESLint only bans `electrobun` direct imports (`eslint.config.js:166-175`), so a follow-up guard prevents the “type-only from `src-bun`” shortcut from becoming convention.

4. **Should `AppErrorPayload` move in the first slice?**
   - **Recommended default:** yes, but after `CommandMap` is shared. It is only a 17-line clone (`CODE_AUDIT.md:107`) and validates the pattern for runtime-owned classes importing shared payload types.

---

## Alternatives

### Alternative A — shared pure payload module

**Pros**

- Deletes the 597-line clone instead of policing it.
- Makes new channels a single edit to the wire map.
- Catches current-style drift at compile time when tests use `satisfies CommandMap[...]`.
- Preserves the renderer’s no-`electrobun` rule because `RPCSchema` stays in `src-bun/rpc.ts`.

**Cons**

- Requires a small tsconfig change for Bun (`src/shared/**/*.ts`).
- Requires carefully avoiding renderer-only imports from the shared module. Existing `KeyboardShortcutPrefs` currently comes from a renderer path in `src/ipc/types.ts` (`src/ipc/types.ts:7`); the shared module must own the serializable shape or move shortcut wire types into shared too.

### Alternative B — keep both files and add renderer drift-detection snapshots

**Pros**

- Lowest immediate implementation risk.
- Can detect divergence between Bun samples and renderer samples in CI.
- Does not alter module boundaries.

**Cons**

- Leaves the 597 duplicated lines intact (`CODE_AUDIT.md:104`).
- Every wire change still requires two source edits plus test updates.
- Snapshot tests can still miss untyped samples unless every sample is annotated against both maps.
- This is a guardrail, not a fix; it does not address the audit’s root cause.

**Decision:** choose Alternative A. Alternative B is acceptable only as a temporary safety net during the extraction PR if reviewers want a pre-refactor failing test that demonstrates current drift.

---

## Implementation phases

1. **Largest clone block first: shared `CommandMap` and request surface.**
   - Create `src/shared/wireTypes.ts` with payload types needed by `CommandMap` and the renderer-friendly request map.
   - Add `src/shared/**/*.ts` to `tsconfig.bun.json` (`tsconfig.bun.json:21`).
   - Update `src-bun/rpc.ts` to derive `DafmanRPC['bun']['requests']` from the shared map while keeping `RPCSchema` local (`src-bun/rpc.ts:682-733`).
   - Update `src/ipc/types.ts` to re-export `CommandMap` from shared.
   - Type all request snapshot samples with `satisfies CommandMap[...]`, especially `sendMessage.agentMode` (`src-bun/__tests__/wire-contract.test.ts:395-409`).

2. **Move message and pending-request payloads.**
   - Move `SessionEventPayload`, `PendingRequestPayload`, `RespondToRequestParams`, and request data shapes into shared.
   - Update `src/ipc/invoke.ts` listener types to continue importing via `@/ipc/types` (`src/ipc/invoke.ts:72-79`).
   - Keep `src-bun/rpc.ts` message schema derived from `WebviewMessageMap`.

3. **Move settings and app metadata shapes.**
   - Move settings-related interfaces to shared.
   - Update `src-bun/app/config/settings.ts` imports (`src-bun/app/config/settings.ts:18-29`).
   - Keep `LAYOUT_SCHEMA_VERSION` local until/unless Bun needs it.

4. **Move error and observability payloads.**
   - Move `AppErrorPayload`, `LogRecord`, and `AuditEntry` into shared.
   - Keep `AppError` and `rpcGuard` in `src-bun/app/shared/errors.ts`; keep renderer `AppError` class in `src/ipc/invoke.ts` (`src/ipc/invoke.ts:20-38`).

5. **Delete mirror comments and add boundary guard.**
   - Replace “mirrors `src-bun/rpc.ts`” comments in `src/ipc/types.ts` with a short barrel explanation.
   - Add an ESLint renderer import restriction against `src-bun/**` once no renderer import needs it.
   - Ratchet any file-size budget entries for `src-bun/rpc.ts` / `src/ipc/types.ts` downward if the implemented slice drops either below its current cap (`tools/file-size-budget.json`).

---

## References

- `CODE_AUDIT.md:104` — 597 duplicated wire lines across six clone blocks.
- `CODE_AUDIT.md:153-155` — current IPC safety status and #157 purity note.
- `ARCHITECTURE.md:270-274` — IPC surface location and test reference.
- `src-bun/rpc.ts:8-12` — current “single source” comment plus `RPCSchema` import.
- `src/ipc/types.ts:1-5` — hand-mirror rationale.
- `tsconfig.json:19-36`, `tsconfig.bun.json:21`, `vite.config.ts:12-15`, `electrobun.config.ts:39-40`, `eslint.config.js:149-175` — feasibility constraints.
- `src-bun/__tests__/wire-contract.test.ts:20-23`, `src-bun/__tests__/wire-contract.test.ts:395-409` — snapshot strategy and current untyped `agentMode` samples.

---

## Recommended first PR

Extract the shared `CommandMap` and request payload types into `src/shared/wireTypes.ts`, update `src-bun/rpc.ts` to derive `DafmanRPC['bun']['requests']` from it, re-export `CommandMap` from `src/ipc/types.ts`, add `src/shared/**/*.ts` to `tsconfig.bun.json`, and make the `sendMessage` snapshots use `satisfies CommandMap['sendMessage']['args']`. This is the smallest slice that starts with the largest duplicate block and immediately fixes the observed `agentMode` drift class.
