import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { scanForConflictMarkers } from "../check-conflict-markers";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "dafman-markers-"));
	tempDirs.push(dir);
	return dir;
}

// Built at runtime so THIS test file never contains a literal conflict
// marker at line-start (which `bun run lint:markers` would otherwise flag).
const OPEN = "<".repeat(7);
const SEP = "=".repeat(7);
const CLOSE = ">".repeat(7);
const BASE = "|".repeat(7);

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("scanForConflictMarkers", () => {
	test("flags every bracket marker in a botched merge", async () => {
		const dir = await tempDir();
		const file = join(dir, "CHANGELOG.md");
		await writeFile(
			file,
			`# Changelog\n${OPEN} HEAD\nours line\n${SEP}\ntheirs line\n${CLOSE} feature\n`,
		);

		const hits = scanForConflictMarkers([file]);

		expect(hits.map((h) => h.line)).toEqual([2, 6]);
		expect(hits.map((h) => h.marker)).toEqual([OPEN, CLOSE]);
	});

	test("flags a diff3 base marker and a lone leftover opener", async () => {
		const dir = await tempDir();
		const base = join(dir, "base.txt");
		const leftover = join(dir, "leftover.md");
		await writeFile(base, `a\n${BASE} parent of x\nb\n`);
		// The exact bug from #139/#142: only the opener survives resolution.
		await writeFile(leftover, `## [Unreleased]\n${OPEN} HEAD\n- entry\n`);

		const hits = scanForConflictMarkers([base, leftover]);

		expect(hits).toHaveLength(2);
		expect(hits.find((h) => h.file === base)?.marker).toBe(BASE);
		expect(hits.find((h) => h.file === leftover)?.marker).toBe(OPEN);
	});

	test("does not flag a clean file, Markdown setext rules, or shift operators", async () => {
		const dir = await tempDir();
		const file = join(dir, "doc.md");
		await writeFile(
			file,
			// `=======` setext underline is legitimate Markdown and must pass;
			// `>>>` / `<<` shorter runs and inline shifts are not markers.
			`Heading\n${SEP}\n\nconst x = a >> 2;\nconst y = b << 3;\nprintln!(">>>");\n`,
		);

		expect(scanForConflictMarkers([file])).toEqual([]);
	});

	test("skips binary/generated extensions", async () => {
		const dir = await tempDir();
		const lock = join(dir, "bun.lock");
		await writeFile(lock, `${OPEN} HEAD\nbinary-ish\n${CLOSE} x\n`);

		expect(scanForConflictMarkers([lock])).toEqual([]);
	});
});
