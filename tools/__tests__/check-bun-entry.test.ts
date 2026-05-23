import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { checkBunEntryReachability } from "../check-bun-entry";

const tempDirs: string[] = [];

async function tempProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "dafman-bun-entry-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("checkBunEntryReachability", () => {
	test("passes when relative imports are reachable", async () => {
		const root = await tempProject();
		await writeFile(join(root, "dep.ts"), "export const value = 1;\n");
		await writeFile(
			join(root, "entry.ts"),
			'import { value } from "./dep";\nconsole.log(value);\n',
		);

		const result = await checkBunEntryReachability({
			entrypoint: join(root, "entry.ts"),
			outdir: join(root, "out"),
		});

		expect(result.ok).toBe(true);
	});

	test("fails when a relative import is dead", async () => {
		const root = await tempProject();
		await writeFile(join(root, "entry.ts"), 'import "./missing";\n');

		const result = await checkBunEntryReachability({
			entrypoint: join(root, "entry.ts"),
			outdir: join(root, "out"),
		});

		expect(result.ok).toBe(false);
		expect(result.logs.join("\n")).toContain("missing");
	});
});
