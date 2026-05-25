---
name: code-audit
description: >-
  Workflow for producing and refreshing CODE_AUDIT.md in the dafman repo with verified,
  receipt-backed data instead of vibes. TRIGGER when the user says "do a code audit",
  "refresh the audit", "look at code quality", "review the codebase", "find dead code",
  "find duplication", "what's left to clean up", "rethink components for library
  replacements", "build vs buy", "are we reinventing the wheel", or asks to update
  CODE_AUDIT.md / STATUS.md complexity sections.
  ENFORCES: every table cell must be sourced from a fresh tool run (grep / glob /
  jscpd / eslint / Get-Content line counts), never from memory or prior CODE_AUDIT
  snapshots. Includes anti-laziness contract — partial / stale audits are worse than
  no audit because they pollute future decision-making.
---

# Code Audit (dafman)

The dafman `CODE_AUDIT.md` is the single source of truth for code-quality state.
Every refresh must re-verify EVERY data point. Stale tables have caused real
regressions where users acted on out-of-date complexity numbers.

## Hard rules (do not skip)

1. **No memory citations.** Every count, every line number, every file size in
   the refreshed audit MUST come from a tool run in this session (grep, glob,
   jscpd, eslint, Get-Content). If you can't re-derive it, drop the row or
   mark it `(stale, needs verification)`.
2. **Run the full toolchain.** ESLint, jscpd, file-size scan, complexity scan,
   and grep counts for architectural patterns (event bus, casts,
   direct-IPC-from-Vue, setTimeout sites). One missed scan = stale section.
3. **Diff against the existing table before writing.** Highlight what changed
   (e.g. `1319 → 1209 (↓110, terminal extracted)`), don't just rewrite. The
   delta is the value.
4. **Mark fixed items.** Use `~~strikethrough~~` + `✅ Fixed` rather than
   deleting rows — preserves history and shows progress.
5. **Never trust the previous audit's verdict.** A row marked "🔴 Replace" in
   the last refresh may have been resolved; verify against the codebase now.
6. **Rubber-duck before executing the cleanup plan derived from the audit.**
   Phase plans are speculative until critique passes.

## Required scans (run all of these, save outputs)

### 1. File size distribution (top ~30 files, prod + tests)

```pwsh
Get-ChildItem -Recurse -Include *.ts,*.vue -Path src,src-bun |
  Where-Object { -not $_.FullName.Contains('node_modules') } |
  ForEach-Object { [pscustomobject]@{ Lines = (Get-Content $_.FullName).Count; Path = $_.FullName.Substring((Get-Location).Path.Length + 1) } } |
  Sort-Object Lines -Descending | Select-Object -First 35
```

Production-only total: filter out `__tests__` and `*.test.ts`.

### 2. ESLint breakdown by rule

```pwsh
bun run lint:eslint --format json > eslint-out.json
# Parse: group warnings by ruleId, count per file
```

Group by `ruleId`, then by `filePath` for top offenders. Don't trust summary
counts from prior runs.

### 3. jscpd duplication

```pwsh
bunx jscpd src --reporters json --output ./.jscpd-out --silent
# Then: parse ./.jscpd-out/jscpd-report.json
```

Split duplicates into:
- Cross-file production (excluding `__tests__`, `.test.ts`)
- Intra-file production
- Test boilerplate (acceptable noise)

Clean up `.jscpd-out` after.

### 4. Architectural pattern grep (every one of these)

| Pattern | What it counts |
| ------- | -------------- |
| `new CustomEvent\('dafman:` | Window-event dispatch sites |
| `addEventListener\('dafman:` | Window-event listener sites |
| `as unknown as` | Type-escape hatches (per file + total) |
| `invokeCommand\(` in `*.vue` | Direct IPC from components (architecture bypass) |
| `setTimeout\(.*0\)` | Focus / timing hacks |
| `requestAnimationFrame` | rAF scheduling hacks |
| `localStorage\.setItem` | Hand-rolled persistence sites |
| `new ResizeObserver` | Hand-rolled observers |
| `throw new Error\(` in `src-bun/app/` | RPC handlers bypassing rpcGuard |

### 5. Complexity hotspots (CC > 15)

Read the ESLint JSON for `complexity` warnings; cross-reference with
`max-lines-per-function` warnings to identify oversized AND complex
functions (the worst class).

### 6. God-object check (lines per file)

Any file > 800 lines in `src/` or `src-bun/app/` gets a "what's mixed
together" inventory in §6.9.

### 7. Build-vs-buy sweep (§5)

For every file in `src/lib/`, `src/composables/`, and `src-bun/app/`:
- Read the file (or skim its API surface)
- Ask: "Is this domain logic, or hand-rolled infrastructure?"
- If infrastructure: search npm for the obvious library. Tag 🔴/🟡/🟢.

Don't skip PrimeVue or Vue-ecosystem coverage:
- Grep for `title=` attrs (should be `v-tooltip`)
- Grep for custom `@keyframes` (should be `<ProgressSpinner>` / `<Skeleton>`)
- Grep for manual badge/chip CSS (should be `<Badge>`/`<Chip>`)
- Look for hand-rolled empty states, scroll containers, virtual lists,
  accordions, clipboard handling — PrimeVue or VueUse covers most.

### 8. Backend-specific

- `as unknown as` count in `src-bun/`
- Raw `throw new Error(` in RPC paths (should use rpcGuard wrapping)
- Duplicate test seams (`_setForTest`, `setForTest`)
- God objects in `src-bun/app/`

## Required CODE_AUDIT.md sections

The audit MUST contain:
- §1 File size distribution (deltas vs prior audit)
- §2 ESLint (issues by rule, complexity hotspots, oversized functions)
- §3 jscpd (cross-file + intra-file, with extraction candidates)
- §4 Runtime safety (type, error handling, performance, backend-specific) — mark `~~fixed~~`
- §5 Build vs buy (renderer / backend / Bun-native / PrimeVue / Vue-ecosystem / summary)
- §6 Architectural debt (god objects, store deps, event bus, casts, etc.)
- §7 What's been done ✅
- §8 Priority cleanup plan (Phase A → F, ordered)

## Workflow

1. **Snapshot scans** — run §1–§8 scans above, save raw outputs.
2. **Diff vs current audit** — for each table, compute the deltas. Mark fixed
   rows with `~~strikethrough~~ ✅ Fixed`.
3. **Re-write tables** — replace stale data with verified numbers. Always
   include the delta annotation (`(↓N — reason)`).
4. **Refresh §5 verdicts** — re-check whether previously-tagged "🔴 Replace"
   items are still hand-rolled or were resolved.
5. **Refresh §8 plan** — reorder phases if a library swap is now blocked,
   add new phases for newly-discovered debt, remove completed work.
6. **Rubber-duck the plan** — before executing any phase, run the rubber-duck
   agent against the proposed phase. Critique blind spots: library fit,
   ordering, hidden callers, perf implications.
7. **Commit per-section** — one commit per major refresh (e.g.
   `docs: refresh §3 jscpd table`), include verification receipts in the
   message.

## Anti-laziness rules (per AGENTS.md §10–§15)

- **Never copy a number from the prior audit without re-deriving it.** If you
  can't run the scan, drop the row.
- **Test the scan tools before trusting them.** `bun run lint:eslint --format
  json` may have changed shape between versions; sanity-check on a known
  file.
- **Production vs total code:** always show both (the codebase size doubled
  in tests). The "33K lines" vs "58K lines" delta in May 2026 was a
  scan-scope bug.
- **Cross-file ≠ intra-file.** A 42-line intra-file dup (same file, two
  copies) is a different fix from a 10-line cross-file dup. Tag them
  separately.
- **Verify "fixed" rows.** A row marked ✅ Fixed in the previous audit may
  have regressed. Grep before re-marking.

## When NOT to run a full audit

- The user asks a narrow question ("how many ESLint warnings are left?") —
  just run that one scan, don't refresh the whole document.
- The audit was refreshed in the last commit and the user wants to act on
  it. Don't waste their time re-scanning.

## When to escalate

- If a scan reports drastically different numbers from the prior audit
  (>50% delta), say so explicitly and double-check the scan scope.
- If a library replacement proposal would touch >5 files, run rubber-duck
  before adding it to Phase A.

## References

- Prior audit: `CODE_AUDIT.md`
- Cleanup history: `DEVLOG.md` (newest first)
- Plan documents: `plans/*.prompt.md`
- AGENTS.md §10–§15 (anti-laziness contract — these audit rules derive from
  the same precedents)
