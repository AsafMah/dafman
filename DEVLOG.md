# Development log

> Append-only chronicle of substantive sessions and findings. **Every agent
> session that touches the codebase ends with a new entry here** — investigation
> notes that don't fit a commit message, design decisions taken, dead ends,
> things future-me needs to know but couldn't have learned from the diff alone.
>
> Entries are top-down newest first. One H2 (`## YYYY-MM-DD ...`) per session.
> Inside each entry, lead with the takeaway, then the receipts.

---

## 2026-05-22 — SDK + CLI deep audit deliverable

### Takeaway

User asked for an exhaustive audit of `copilot-sdk-supercharged` + the
bundled `@github/copilot` CLI to find features missed in our plans.
Earlier session attempted a shallow pass; user pushed back ("I know you
like to be lazy but don't"). This session reads the SDK README
end-to-end (1135 lines), the full `dist/generated/rpc.d.ts` server +
session RPC surface (~2400 lines), and every `added` changelog entry
across 212 versions of `@github/copilot` (436 entries from v0.0.329 to
v1.0.48).

Deliverable: **`plans/plan-sdk-audit.prompt.md`** — categorised
findings (Wire-ready RPCs / Unset config knobs / CLI features /
Truly-new surfaces / Re-evaluated deferrals / Proposed Phases 18–23 /
Open questions). STATUS.md "Next concrete steps" replaced with the new
ordering.

### Why image gen comes back

Earlier I deferred image generation citing "no `responseFormat`
strings in CLI's `app.js`". That was misleading evidence — the SDK
README documents `assistant.image` events and `assistant.content`
mixed content blocks; the format is driven by the model and the
session config, not by string-matching in the CLI source. Re-listed
as Phase 21.

### Why MCP registry promoted ahead of Projects

Highest user-value per day of work; doesn't depend on any other
Phase landing. CLI shipped `copilot mcp` CLI command in 1.0.21
(matching scope on the terminal side); our gap was purely UI.

### Reading order captured for next agent

§I of `plan-sdk-audit.prompt.md` enumerates the exact files + line
ranges so the next session can pick up the cross-reference work
without re-discovering the same sources.

### Receipts

- Audit doc: `plans/plan-sdk-audit.prompt.md` (~520 lines, 9 sections).
- STATUS.md "Next concrete steps" rewritten + new historical-log
  bullet pointing at the audit.
- No code changes this session; the audit *is* the deliverable.
- Methodology + sources listed in §I so the conclusions are
  reproducible.

---

## 2026-05-22 — Export conversation + permission audit log (Phase 3 + Phase 4 start)

### Takeaway
Two clean wins, both ship end-to-end with tests:

**Export conversation.** Per-session gear popover → Export Markdown /
JSON. Renderer builds via `formatConversation` (reuses `processEvents`
so the export tracks what's on screen); bun writes under
`<userData>/exports/<basename(normalize(name))>` with path-traversal
defence; auto-reveals.

**Permission + URL audit log.** `<userData>/audit/permissions.jsonl` +
`urls.jsonl`. Append-only. Records permission decisions (kind,
decision, summary, approval scope/domain) + URL opens
(allowed/blocked + reason). Live tail visible in a new "Activity" tab
of the Diagnostics edge panel — sits alongside the existing logs tab,
same UI primitives. Decision pivot during the session: image gen was
on the next-steps list but isn't safely shippable today (CLI app.js
has no responseFormat handling; no model capability flag surfaces
support), and Tier-2 E2E was 1d-undersized (cross-platform
WebView debugging is its own project). Audit logging was a 1-d
slot that genuinely complements Phase 1's diagnostics work.

### Detail (export)
- `src/lib/exportConversation.ts` — `formatConversation(input, format)`
  + `exportFilenameStem`. Markdown ordering: title + metadata + per
  item (user with attachments, assistant skipping empties, reasoning
  folded inside `<details>` with encrypted variant, tool with
  args/output/result/error, system bubbles with icons). pendingRequest
  items deliberately skipped.
- `src-bun/app/exports.ts` — `saveExportFile` with basename+normalize
  sanitisation. New RPC + 1 wire-shape snapshot.
- `SessionHeaderControls.vue` popover gains the two buttons; dynamic
  imports keep the bundle cost gated.
- 15 markdown + 3 JSON + 3 filename + 3 bun-side tests.

### Detail (audit)
- `src-bun/app/audit.ts` — append-only JSONL writers split by category.
  Per-process ring buffer (500) + subscriber API for live fan-out;
  pattern mirrors `src-bun/app/logging.ts`. `recordPermission` +
  `recordUrl` return `Promise<void>` so tests can deterministically
  await side-effects.
- `SessionRegistry.enqueuePending` extended with optional
  `{ permissionKind, summary }` carried on the entry; recorded on
  every `respondToRequest` decision.
- `index.ts` openUrl handler records the allow/block + reason.
- `getAuditState` RPC + `auditEvent` webview message + bridge.
- `LogViewer.vue` gains a Logs/Activity SelectButton tab; Activity
  view reuses the same row primitives with per-decision colors.
- 4 bun-side tests (perm append + subs + ring; url append + separate
  files; 500 cap; no commingling) + 1 sessions.test integration that
  drives the full SDK→handler→respondToRequest→audit flow + 1 wire
  snapshot.

### Decision pivots logged
- **Image generation deferred.** SDK accepts `responseFormat` +
  `imageOptions` on session.send, but the bundled CLI's `app.js` has
  zero references to either, no model in the catalog exposes a
  capability flag indicating image support, and shipping a
  "Generate image" UI affordance that may always no-op violates
  anti-laziness rule #1 (no half-work). Re-evaluate when a confirmed
  working image-gen model lands.
- **Tier-2 E2E deferred.** Real Electrobun binary E2E requires
  cross-platform WebView debugging ports (WebView2 args on Windows,
  WKWebView remote inspect on macOS, GTK WebKit on Linux) — meaningful
  project, not a 1-d slot. Keeping Tier-1 renderer smoke + the
  Tier-2 build matrix (Phase 1) as the gate for now.
- **Per-session tool toggle deferred.** SDK exposes `availableTools` /
  `excludedTools` only at session create time + a read-only
  `tools.list` RPC. Mid-session mutation isn't documented. Building
  this properly needs a "default excluded tools" Settings panel +
  per-session view with "restart to apply" hint — bigger than 1 d.
  Stays in Phase 4.

### Receipts
- `src/lib/exportConversation.ts`, `src-bun/app/exports.ts`,
  `src-bun/app/audit.ts`, `src/stores/auditStore.ts` (new).
- `src/lib/__tests__/exportConversation.test.ts` (15),
  `src-bun/__tests__/exports.test.ts` (3),
  `src-bun/__tests__/audit.test.ts` (4),
  `src-bun/__tests__/sessions.test.ts` (+1 integration),
  `src-bun/__tests__/wire-contract.test.ts` (+2 snapshots).
- 347 `bun test` pass (was 325), lint clean, smoke green prod + hmr.

---

## 2026-05-21 — Phase 1: observability tail (log viewer + redaction + diagnostics + CI matrix)

### Takeaway
Closed every open M1 observability item in one chunk: in-app log viewer
(`LogViewer.vue`) wired to a live `logEvent` webview message, runtime
log-level toggle that mutates the bun side without restart, redaction
pipeline that strips tokens/prompts/attachment data before anything
reaches disk (12 snapshot tests pin each rule), diagnostics bundle
export that ships pre-redacted logs + a recent.json ring dump + a
settings snapshot + a README to `<userData>/dafman-diagnostics-…`, and
finally a cross-platform `electrobun build` CI matrix (Ubuntu / macOS /
Windows, currently `continue-on-error` until it's stable).

### Detail
- **Redaction (`src-bun/app/redact.ts`).** Two passes per object:
  sensitive keys (`token`/`secret`/`password`/`authorization`/`apiKey`/…)
  → `***`; content keys (`prompt`/`content`/`text`/`data`/`reasoningText`/
  `reasoningOpaque`/`encryptedContent`/`message`/…) → `{len, prefix}`
  shape descriptor. Long strings under unknown keys also get summarised.
  Recursion budget (depth 6) and array cap (32 + tail marker) so a
  pathological payload can't stall the logger.
- **Logger (`src-bun/app/logging.ts`).** Subscribers receive every emitted
  record (no level filter) so the in-app viewer can flip its display
  filter without losing context; the bun-side `level` only gates what
  reaches stderr + the daily file. New API: `setLogLevel`,
  `subscribeLogs`, `recentLogs` (ring of last 1000), `buildRecord` (also
  exported for tests).
- **RPCs.** `getLogState({recentLimit})` returns the live `{level, recent[]}`;
  `setLogLevel({level})` mutates the bun-side config; `exportDiagnostics({})`
  copies all `dafman-*.log` files + dumps recent.json + writes
  settings.json + README into `<userData>/dafman-diagnostics-YYYY-MM-DD-HHMM/`.
  New webview message: `logEvent` for live fan-out. Bridge surface
  (`RpcBridge.onLogEvent`) added; smoke + sessionsStore.restore.test +
  sessionCommands.test stubs updated.
- **Log viewer panel (`LogViewer.vue`).** Activity-bar bottom entry
  (`pi-bars`); on mount fills via `getLogState`, then subscribes to
  `logEvent`. Header row has Active-level dropdown (mutates bun side),
  Display dropdown (renderer-only filter), Search field (substring
  against JSON-serialised record), counts ("N shown / M buffered"),
  Clear, "Export bundle". List uses CSS grid (timestamp / level /
  message + fields beneath) with per-level color hints and a soft
  background tint for warn/error rows. Pause-on-scroll auto-detects so
  the user can scroll up without the tail snapping back; "paused"
  indicator appears in the count row.
- **CI matrix.** Tier-1 stays Linux-only and required (lint + test +
  vite + smoke). New Tier-2 `build-matrix` job runs `bunx electrobun
  build` on `ubuntu-latest` + `macos-latest` + `windows-latest`. Marked
  `continue-on-error: true` so a transient native-toolchain failure
  doesn't block merges; flip to required once it has been green for a
  week.
- **AppError union** gained `Io` variant for the diagnostics file ops.
  Mirrored in `src/ipc/types.ts` + the formatter in `src/ipc/invoke.ts`.

### Receipts
- `src-bun/app/redact.ts`, `src-bun/app/logging.ts` (rewritten),
  `src-bun/app/diagnostics.ts` (new).
- `src/stores/logStore.ts`, `src/components/LogViewer.vue` (new).
- `src-bun/__tests__/redact.test.ts` (12 cases, 1 snapshot),
  `src-bun/__tests__/diagnostics.test.ts` (2 integration tests),
  `src-bun/__tests__/wire-contract.test.ts` (+3 snapshots).
- `.github/workflows/ci.yml` (CI matrix).
- 325 `bun test` pass (was 308), lint clean, smoke green prod + hmr.

### Open question
Should the diagnostics bundle be a real ZIP rather than a directory?
Pragmatic v1 just creates the directory and reveals it — the user has
to zip it themselves before uploading to a bug report. If this proves
annoying we can add a programmatic ZIP step using Bun's archive
primitives.

---

## 2026-05-21 — Audit, ARCHITECTURE.md, anti-laziness AGENTS rules

### Takeaway
Every plan doc was carrying a "post-Electrobun port" header note dating back to
2026-05-17 and the M1 backlog in `STATUS.md` was stale. Two-thirds of the
"M1 still open" items actually shipped weeks ago. Auditing the codebase
against the plans surfaced ~30 RPC handlers, ~30 components, 11 Pinia stores,
and 10 bun-side domain modules already implemented. The remaining real
backlog is Observability tail (log viewer, redaction snapshot tests, runtime
log-level toggle), the M3 URL policy editor, and most of M4-M7. New
`ARCHITECTURE.md` captures the current reality; this `DEVLOG.md` becomes the
running log going forward; AGENTS.md gained hard anti-laziness rules
(below).

### Detail
- Audited every component / store / RPC against `plans/plan-roadmap.prompt.md`.
  Wrote the live state into `ARCHITECTURE.md` and re-organised the
  open-backlog list in `STATUS.md` to reflect what's actually missing.
- Updated `AGENTS.md` with five anti-laziness rules: no half-work, run the
  full check before claiming done, update `STATUS.md` + `CHANGELOG.md` +
  `DEVLOG.md` on every session, no silent doc drift, no unverified claims.
- README rewritten to surface the current feature set (multi-pane streaming
  chat, command palette, MCP-style permission UX, attachments, mermaid,
  dark mode) so first-time visitors don't land on the M0 description.

### Receipts
- `ARCHITECTURE.md` (new) — current module map + invariants + SDK gotchas.
- `DEVLOG.md` (new, this file).
- `AGENTS.md` — Anti-laziness rules section added.
- `STATUS.md` — Next concrete step + M1 / M2+ backlog refreshed.
- `README.md` — Features-today expanded; quick links restructured.

---

## 2026-05-21 — P0/P1 sweep: bounded events, reasoning_opaque, permission rules, session settings

### Takeaway
Four backlog items shipped end-to-end with tests. The
`reasoning_opaque`-displays-empty regression that I had previously patched
with a "Reasoned privately" placeholder was actually a wire-protocol bug:
the CLI delivers reasoning on `assistant.message.data.{reasoningText,
reasoningOpaque, encryptedContent}`, NOT on `assistant.reasoning_delta`.
Found this by reading `node_modules/@github/copilot/app.js:4487`.

### Detail
1. **Bounded `record.events`** (`38d42ca`). Ring-buffer trim at
   `MAX_EVENTS_PER_SESSION = 5000`. Consumers track absolute progress
   (`droppedEventCount + events.length`) instead of array indices so trims
   don't cause re-processing or skipping. Centralised via exported
   `sessionsStore.appendEvent`; every push site migrated. 3 regression tests.
2. **`reasoning_opaque` properly fixed** (`0812f9a`). Investigated CLI source
   — schema declares `assistant.reasoning_delta` / `assistant.reasoning` but
   `app.js` never emits them from the main model path. Reasoning is on
   `assistant.message.data.reasoningText` / `reasoningOpaque` (Anthropic) /
   `encryptedContent` (OpenAI GPT-5.x). Reducer's `assistant.message` handler
   harvests these into a reasoning ChatItem keyed at `msg:${messageId}` placed
   before the assistant bubble. Memory stored: "copilot CLI reasoning events".
3. **Permission rule editor** (`b015d68`). `PermissionRuleEditor.vue` builds
   the SDK's `PermissionDecisionApproveForSessionApproval` union from
   per-kind defaults: shell (commands, first-token prefix), read/write/memory
   (blanket), mcp (this tool vs all tools from server), url (auto-extracted
   domain), custom-tool. New IPC type `PermissionApprovalRule`. 3 new wire
   snapshots.
4. **Session-popover skills + usage metrics** (`a0a3886`). Three new bun RPCs
   (`listSessionSkills`, `setSessionSkillEnabled`, `getSessionUsageMetrics`)
   wired to SDK `rpc.skills.*` + `rpc.usage.getMetrics`. Lazy-fetched on
   popover-open. Errors surface inline because both APIs are `@experimental`
   in the SDK.

### Receipts
- Commits `38d42ca`, `0812f9a`, `b015d68`, `a0a3886`.
- Tests: 308 pass (up from 297 at session start).
- Memory: "copilot CLI reasoning events" (DecoratorNode rule already stored).

---

## How to keep this log useful

- Write entries when:
  - You shipped a substantive change (one or more commits).
  - You investigated something and the conclusion has lasting value
    (wire-protocol facts, SDK quirks, anti-patterns).
  - You hit a dead end worth warning future-you about.
  - You changed direction.
- Skip entries when:
  - You only touched docs.
  - You did a one-line bug fix with a clear commit message.
- Keep entries short. Lead with the takeaway. The diff is in git; here we
  capture what the diff alone wouldn't tell you.
