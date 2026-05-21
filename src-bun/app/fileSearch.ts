/// Workspace file search for the composer's @file typeahead.
///
/// Walks the session's working directory and returns files whose
/// filenames fuzzy-match the query. Caches the file list per
/// workspace path for the lifetime of the bun process (cheap — a
/// typical repo has thousands of files, the walk completes in ms).
/// On a subsequent search for the same workspace the cache is hit;
/// callers that need fresh data can call `invalidate(cwd)`.
///
/// Ignored directories follow the common dotfile / build-output
/// conventions; this list is intentionally simple and is NOT a
/// full .gitignore parser — that would block the typeahead behind
/// disk reads. Users with weird structures can extend the list.

import { promises as fs } from "node:fs";
import { join, relative, basename } from "node:path";

const IGNORED_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	".next",
	".nuxt",
	".cache",
	".turbo",
	".vite",
	".vscode",
	".idea",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".venv",
	"venv",
	"vendor",
]);

const MAX_FILES_PER_WORKSPACE = 20_000;
const MAX_DEPTH = 12;

interface WorkspaceCache {
	cwd: string;
	files: { path: string; absolutePath: string; name: string }[];
	indexedAt: number;
}

const cache = new Map<string, WorkspaceCache>();

async function walk(
	root: string,
	out: WorkspaceCache["files"],
	current: string = root,
	depth = 0,
): Promise<void> {
	if (depth > MAX_DEPTH || out.length >= MAX_FILES_PER_WORKSPACE) return;
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(current, { withFileTypes: true });
	} catch {
		return; // permission denied / symlink loop / etc. — skip
	}
	for (const entry of entries) {
		if (out.length >= MAX_FILES_PER_WORKSPACE) return;
		if (entry.name.startsWith(".") && entry.isDirectory()) continue;
		if (entry.isDirectory()) {
			if (IGNORED_DIRS.has(entry.name)) continue;
			await walk(root, out, join(current, entry.name), depth + 1);
		} else if (entry.isFile()) {
			const abs = join(current, entry.name);
			const rel = relative(root, abs).replace(/\\/g, "/");
			out.push({ path: rel, absolutePath: abs, name: entry.name });
		}
	}
}

async function index(cwd: string): Promise<WorkspaceCache> {
	const files: WorkspaceCache["files"] = [];
	await walk(cwd, files);
	const entry: WorkspaceCache = { cwd, files, indexedAt: Date.now() };
	cache.set(cwd, entry);
	return entry;
}

/// Public — fuzzy-match files by name + path against `query`. Empty
/// query returns the top results by path-length ascending (shortest
/// paths first, i.e. project-root files surface above deeply-nested
/// ones). Match scoring is intentionally light: filename startsWith
/// wins; substring on filename second; substring on path third.
export async function searchWorkspaceFiles(
	cwd: string,
	query: string,
	limit = 40,
): Promise<{ path: string; absolutePath: string; name: string }[]> {
	const entry = cache.get(cwd) ?? (await index(cwd));
	const q = query.trim().toLowerCase();
	if (q.length === 0) {
		return entry.files.slice(0, limit).sort((a, b) => a.path.length - b.path.length);
	}
	type Scored = (typeof entry.files)[number] & { score: number };
	const scored: Scored[] = [];
	for (const f of entry.files) {
		const nameL = f.name.toLowerCase();
		const pathL = f.path.toLowerCase();
		let score = 0;
		if (nameL.startsWith(q)) score = 3;
		else if (nameL.includes(q)) score = 2;
		else if (pathL.includes(q)) score = 1;
		if (score > 0) scored.push({ ...f, score });
	}
	scored.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return a.path.length - b.path.length;
	});
	return scored.slice(0, limit).map(({ path, absolutePath, name }) => ({
		path,
		absolutePath,
		name,
	}));
}

/// Drop the cached file list for a workspace. Call after operations
/// that materially change the tree (e.g. cloning a repo, large
/// generations). The next search re-indexes lazily.
export function invalidate(cwd: string): void {
	cache.delete(cwd);
}

/// Test seam: throw away the entire cache.
export function _resetForTest(): void {
	cache.clear();
}
