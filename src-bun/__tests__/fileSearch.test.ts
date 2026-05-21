import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	searchWorkspaceFiles,
	_resetForTest,
	invalidate,
} from "../app/fileSearch";

/// fileSearch tests build a temp workspace tree, then exercise
/// the indexer's substring matching + ignore rules + cache reset.

let workspace: string;

beforeAll(async () => {
	workspace = await mkdtemp(join(tmpdir(), "dafman-filesearch-"));
	await Promise.all([
		writeFile(join(workspace, "README.md"), "hi"),
		writeFile(join(workspace, "package.json"), "{}"),
	]);
	await mkdir(join(workspace, "src"));
	await mkdir(join(workspace, "src", "components"));
	await Promise.all([
		writeFile(join(workspace, "src", "main.ts"), "//"),
		writeFile(join(workspace, "src", "components", "ChatWindow.vue"), "<!---->"),
	]);
	// Ignored dir — should never appear in results.
	await mkdir(join(workspace, "node_modules"));
	await writeFile(join(workspace, "node_modules", "leak.js"), "//");
	await mkdir(join(workspace, ".git"));
	await writeFile(join(workspace, ".git", "config"), "");
});

afterAll(async () => {
	await rm(workspace, { recursive: true, force: true });
});

describe("searchWorkspaceFiles", () => {
	test("empty query lists project-root files first", async () => {
		_resetForTest();
		const results = await searchWorkspaceFiles(workspace, "", 10);
		const paths = results.map((r) => r.path);
		expect(paths).toContain("README.md");
		expect(paths).toContain("package.json");
		// Root files (shorter paths) should rank above nested.
		const readme = paths.indexOf("README.md");
		const nested = paths.indexOf("src/components/ChatWindow.vue");
		expect(readme).toBeGreaterThanOrEqual(0);
		expect(nested).toBeGreaterThanOrEqual(0);
		expect(readme).toBeLessThan(nested);
	});

	test("filename startsWith ranks above substring matches", async () => {
		_resetForTest();
		const results = await searchWorkspaceFiles(workspace, "main", 10);
		const paths = results.map((r) => r.path);
		expect(paths[0]).toBe("src/main.ts");
	});

	test("nested filename match works", async () => {
		_resetForTest();
		const results = await searchWorkspaceFiles(workspace, "ChatWindow", 10);
		expect(results.map((r) => r.path)).toContain(
			"src/components/ChatWindow.vue",
		);
	});

	test("path-substring match", async () => {
		_resetForTest();
		const results = await searchWorkspaceFiles(workspace, "components", 10);
		expect(results.map((r) => r.path)).toContain(
			"src/components/ChatWindow.vue",
		);
	});

	test("ignores node_modules and dotfile directories", async () => {
		_resetForTest();
		const results = await searchWorkspaceFiles(workspace, "leak", 10);
		expect(results).toHaveLength(0);
		const all = await searchWorkspaceFiles(workspace, "", 100);
		expect(all.find((r) => r.path.startsWith("node_modules"))).toBeUndefined();
		expect(all.find((r) => r.path.startsWith(".git"))).toBeUndefined();
	});

	test("returns absolutePath alongside relative path", async () => {
		_resetForTest();
		const results = await searchWorkspaceFiles(workspace, "README", 1);
		expect(results[0]?.absolutePath).toBe(join(workspace, "README.md"));
		expect(results[0]?.name).toBe("README.md");
	});

	test("invalidate forces re-index", async () => {
		_resetForTest();
		await searchWorkspaceFiles(workspace, "", 1);
		// Add a file AFTER the initial index.
		const newPath = join(workspace, "FRESH.md");
		await writeFile(newPath, "");
		// Cached call won't see it.
		const cached = await searchWorkspaceFiles(workspace, "FRESH", 5);
		expect(cached).toHaveLength(0);
		// invalidate + retry → indexed.
		invalidate(workspace);
		const fresh = await searchWorkspaceFiles(workspace, "FRESH", 5);
		expect(fresh.length).toBeGreaterThan(0);
		await rm(newPath);
	});
});
