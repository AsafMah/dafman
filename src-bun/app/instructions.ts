// Read-only discovery for instruction files shown in Library → Instructions.
//
// Deliberately read-only: editing AGENTS.md / copilot-instructions.md is a
// project file write and must go through the normal permissioned file-write
// UX, not a silent Library save button.

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export type InstructionScope = "global" | "project";

export interface InstructionSource {
	name: string;
	scope: InstructionScope;
	path: string;
	relativePath: string;
	exists: boolean;
	content: string | null;
	sizeBytes: number | null;
}

const MAX_CONTENT_BYTES = 80 * 1024;
const MAX_NESTED_AGENTS = 50;
const SKIP_DIRS = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"dist",
	"build",
	"out",
	".vite",
	".turbo",
	".next",
]);

async function readSource(
	scope: InstructionScope,
	name: string,
	path: string,
	basePath: string,
): Promise<InstructionSource> {
	if (!existsSync(path)) {
		return {
			name,
			scope,
			path,
			relativePath: scope === "project" ? relative(basePath, path) : path,
			exists: false,
			content: null,
			sizeBytes: null,
		};
	}
	const info = await stat(path);
	if (!info.isFile()) {
		return {
			name,
			scope,
			path,
			relativePath: scope === "project" ? relative(basePath, path) : path,
			exists: false,
			content: null,
			sizeBytes: null,
		};
	}
	const raw = await readFile(path);
	const truncated = raw.length > MAX_CONTENT_BYTES;
	const slice = truncated ? raw.subarray(0, MAX_CONTENT_BYTES) : raw;
	const suffix = truncated
		? `\n\n[truncated at ${MAX_CONTENT_BYTES} bytes; file is ${raw.length} bytes]`
		: "";
	return {
		name,
		scope,
		path,
		relativePath: scope === "project" ? relative(basePath, path) : path,
		exists: true,
		content: slice.toString("utf8") + suffix,
		sizeBytes: raw.length,
	};
}

async function findNestedAgents(root: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		if (found.length >= MAX_NESTED_AGENTS) return;
		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (found.length >= MAX_NESTED_AGENTS) return;
			const path = join(dir, entry.name);
			if (entry.isFile() && entry.name === "AGENTS.md" && path !== join(root, "AGENTS.md")) {
				found.push(path);
				continue;
			}
			if (!entry.isDirectory()) continue;
			if (SKIP_DIRS.has(entry.name)) continue;
			await walk(path);
		}
	}
	await walk(root);
	return found;
}

export async function listInstructionSources(opts: {
	workingDirectory?: string;
}): Promise<InstructionSource[]> {
	const home = homedir();
	const out: InstructionSource[] = [];

	const globalCandidates = [
		{ name: "Copilot user instructions", path: join(home, ".copilot", "instructions.md") },
		{ name: "GitHub Copilot user instructions", path: join(home, ".github", "copilot-instructions.md") },
		{ name: "GitHub Copilot config instructions", path: join(home, ".config", "github-copilot", "instructions.md") },
	];
	for (const candidate of globalCandidates) {
		out.push(await readSource("global", candidate.name, candidate.path, home));
	}

	const wd = opts.workingDirectory?.trim();
	if (!wd) return out;

	const projectCandidates = [
		{ name: "AGENTS.md", path: join(wd, "AGENTS.md") },
		{ name: ".github/copilot-instructions.md", path: join(wd, ".github", "copilot-instructions.md") },
	];
	for (const candidate of projectCandidates) {
		out.push(await readSource("project", candidate.name, candidate.path, wd));
	}
	for (const nested of await findNestedAgents(wd)) {
		out.push(await readSource("project", `Nested ${relative(wd, nested)}`, nested, wd));
	}
	return out;
}
