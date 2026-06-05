import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/// Ratcheting file-size gate (AGENTS.md rule 19).
///
/// Rule 19 ("> 800 → split first; > 1,200 → fix the structure before
/// adding anything") was prose, so the D-phase splits silently regrew
/// (`sessions.ts` +313, `ChatWindow.vue` +253 between the 2026-05-27 and
/// 2026-06-04 audits). This makes it a build break instead.
///
/// Mechanism: a committed budget (`tools/file-size-budget.json`) freezes
/// every prod file currently over SOFT at its present size. A file fails
/// when it grows past its cap, or when a NEW file crosses SOFT without a
/// budget entry. Growth is then only possible by editing the budget — a
/// visible, reviewable diff that forces the "why is this god object
/// growing?" conversation. As files are split, ratchet their cap down (or
/// drop the entry); the gate nags about stale/loose entries.
///
/// Re-seed after a split with `--write` (review the diff — it can only be
/// used to *lower* caps in good faith).

const SOFT = 800;
const ROOTS = ["src/", "src-bun/"];
const BUDGET_PATH = "tools/file-size-budget.json";

export interface SizeEntry {
	file: string;
	lines: number;
}

export interface SizeReport {
	/// Files over their cap (budgeted) or over SOFT (un-budgeted).
	violations: { file: string; lines: number; cap: number; budgeted: boolean }[];
	/// Budget entries that are now ≤ SOFT or point at a missing/shrunk file.
	stale: { file: string; lines: number; cap: number }[];
}

/// Conventional line count (matches `wc`/python splitlines): a trailing
/// newline does not add a phantom line.
export function countLines(content: string): number {
	if (content === "") return 0;
	const parts = content.split("\n");
	if (parts[parts.length - 1] === "") parts.pop();
	return parts.length;
}

export function checkFileSizes(
	entries: readonly SizeEntry[],
	budget: Readonly<Record<string, number>>,
	soft: number = SOFT,
): SizeReport {
	const seen = new Set<string>();
	const violations: SizeReport["violations"] = [];
	for (const { file, lines } of entries) {
		seen.add(file);
		const cap = budget[file] ?? soft;
		if (lines > cap) violations.push({ file, lines, cap, budgeted: file in budget });
	}

	const stale: SizeReport["stale"] = [];
	for (const [file, cap] of Object.entries(budget)) {
		const entry = entries.find((e) => e.file === file);
		// Missing file, or it shrank to/below SOFT → the entry is dead weight.
		if (!entry || entry.lines <= soft) stale.push({ file, lines: entry?.lines ?? -1, cap });
	}

	return { violations, stale };
}

function isProdSource(file: string): boolean {
	if (!ROOTS.some((r) => file.startsWith(r))) return false;
	if (!file.endsWith(".ts") && !file.endsWith(".vue")) return false;
	return !file.includes("__tests__/") && !file.endsWith(".test.ts");
}

function trackedEntries(repoRoot: string): SizeEntry[] {
	const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
		.split("\0")
		.filter((p) => p.length > 0 && isProdSource(p));
	return tracked
		.map((file) => ({ file, lines: countLines(readFileSync(resolve(repoRoot, file), "utf8")) }))
		.sort((a, b) => b.lines - a.lines);
}

if (import.meta.main) {
	const repoRoot = resolve(import.meta.dir, "..");
	const budgetFile = resolve(repoRoot, BUDGET_PATH);
	const entries = trackedEntries(repoRoot);

	if (process.argv.includes("--write")) {
		const next: Record<string, number> = {};
		for (const { file, lines } of entries) if (lines > SOFT) next[file] = lines;
		writeFileSync(budgetFile, `${JSON.stringify(next, null, "\t")}\n`);
		console.log(`Wrote ${Object.keys(next).length} budget entries (> ${SOFT} lines) to ${BUDGET_PATH}.`);
		process.exit(0);
	}

	const budget = JSON.parse(readFileSync(budgetFile, "utf8")) as Record<string, number>;
	const { violations, stale } = checkFileSizes(entries, budget);

	for (const s of stale) {
		console.warn(
			s.lines < 0
				? `note: budget entry for missing file ${s.file} — drop it.`
				: `note: ${s.file} is ${s.lines} ≤ ${SOFT}; drop its budget entry (cap ${s.cap}).`,
		);
	}

	if (violations.length > 0) {
		console.error("File-size budget exceeded (AGENTS.md rule 19):");
		for (const v of violations) {
			console.error(
				v.budgeted
					? `  ${v.file}: ${v.lines} > ${v.cap} (its budget). Split it, or — with justification — raise the cap in ${BUDGET_PATH}.`
					: `  ${v.file}: ${v.lines} > ${SOFT}. Split it (rule 19), or add a reviewed budget entry in ${BUDGET_PATH}.`,
			);
		}
		process.exit(1);
	}

	console.log(`All ${entries.length} prod files within budget (${Object.keys(budget).length} over ${SOFT}, frozen).`);
}
