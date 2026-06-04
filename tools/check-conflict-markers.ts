import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/// Tree-wide unresolved-conflict-marker gate.
///
/// Why this exists: CI's lint/test globs only cover `src/**` and
/// `src-bun/**`, so a stray Git conflict marker left in a Markdown doc
/// (CHANGELOG/DEVLOG/STATUS/…) merges silently — it bit us twice on the
/// 2026-06-01 merge trains (#139, #142). Prose rules don't fail CI; this
/// does. Scans every *tracked* text file, not just the lint globs.
///
/// Detection is deliberately limited to the three bracket markers Git
/// always brackets a real conflict with: `<<<<<<<`, `|||||||`, `>>>>>>>`.
/// We do NOT flag a bare `=======` line, because a 7-char Markdown setext
/// underline is legitimately `=======` and every real conflict still
/// carries at least one bracket marker. Zero false positives, full recall
/// on Git-produced conflicts.

/// 7-char marker prefixes, built at runtime so this source file does not
/// itself contain a line that starts with a literal conflict marker.
const MARKERS: readonly string[] = ["<".repeat(7), "|".repeat(7), ">".repeat(7)];

/// Tracked paths with these extensions are binary/generated; reading them
/// as text is wasteful and never carries a conflict marker we care about.
const SKIP_EXTENSIONS: Record<string, true> = {
	png: true, jpg: true, jpeg: true, gif: true, webp: true, ico: true, icns: true,
	woff: true, woff2: true, ttf: true, eot: true, otf: true,
	pdf: true, zip: true, gz: true, tgz: true, tar: true, wasm: true, node: true,
	lock: true, snap: true,
};

export interface ConflictHit {
	file: string;
	line: number;
	marker: string;
}

function conflictMarkerOnLine(line: string): string | null {
	for (const marker of MARKERS) {
		// `<<<<<<<` alone or `<<<<<<< <label>` — require the 7 chars to be
		// the whole line or be followed by a space, so `<<<<<<<x` (not a
		// marker) and shift operators never trip it.
		const followedBySpaceOrEol = line.length === marker.length || line[marker.length] === " ";
		if (line.startsWith(marker) && followedBySpaceOrEol) return marker;
	}
	return null;
}

export function scanForConflictMarkers(files: readonly string[]): ConflictHit[] {
	const hits: ConflictHit[] = [];
	for (const file of files) {
		const ext = file.includes(".") ? file.slice(file.lastIndexOf(".") + 1).toLowerCase() : "";
		if (SKIP_EXTENSIONS[ext]) continue;

		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			// Unreadable (deleted mid-scan, permission) — skip rather than crash.
			continue;
		}

		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const marker = conflictMarkerOnLine(lines[i]!.replace(/\r$/, ""));
			if (marker) hits.push({ file, line: i + 1, marker });
		}
	}
	return hits;
}

if (import.meta.main) {
	const repoRoot = resolve(import.meta.dir, "..");
	const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
		.split("\0")
		.filter((p) => p.length > 0)
		.map((p) => resolve(repoRoot, p));
	const hits = scanForConflictMarkers(tracked);

	if (hits.length > 0) {
		console.error("Unresolved Git conflict markers found:");
		for (const hit of hits) {
			const rel = hit.file.startsWith(repoRoot) ? hit.file.slice(repoRoot.length + 1) : hit.file;
			console.error(`  ${rel.replaceAll("\\", "/")}:${hit.line}  ${hit.marker}`);
		}
		console.error(`\n${hits.length} marker line(s). Resolve the conflict before committing.`);
		process.exit(1);
	}

	console.log("No unresolved conflict markers in tracked files.");
}
