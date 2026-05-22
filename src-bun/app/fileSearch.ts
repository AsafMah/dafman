/// Workspace file search for the composer's @file picker.
///
/// Two modes:
///
/// 1. **Fuzzy mode (default)** — query has no path separators. Walks
///    the session cwd recursively (cached) and returns files +
///    directories whose name/path matches.
///
/// 2. **Path-navigation mode** — query starts with `/`, `~/`, `./`,
///    `../`, a Windows drive letter, or contains a `/`. The query is
///    split into `dirPart + leafPrefix`; we list the immediate
///    children of `dirPart` (resolved relative to the appropriate
///    base — fs root for absolute, home for `~`, cwd otherwise)
///    whose name starts with `leafPrefix`. Matches the CLI's
///    `@/abs`, `@~/foo`, `@../path` ergonomics (CLI 1.0.5).
///
/// `includeHidden` controls whether dotfiles + ignored build-output
/// dirs (node_modules, dist, target, …) appear.
///
/// Results carry `kind: "file" | "directory"` so the renderer picks
/// the right AttachmentNode type + icon.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

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

export type FileSearchKind = "file" | "directory";

export interface FileSearchEntry {
	path: string;
	absolutePath: string;
	name: string;
	kind: FileSearchKind;
}

interface WorkspaceCache {
	cwd: string;
	includeHidden: boolean;
	entries: FileSearchEntry[];
	indexedAt: number;
}

/// Separate caches per `(cwd, includeHidden)` so flipping the popup
/// toggle doesn't trigger a re-walk.
const cache = new Map<string, WorkspaceCache>();

function cacheKey(cwd: string, includeHidden: boolean): string {
	return `${cwd}::${includeHidden ? "all" : "default"}`;
}

async function walk(
	root: string,
	out: FileSearchEntry[],
	includeHidden: boolean,
	current: string = root,
	depth = 0,
): Promise<void> {
	if (depth > MAX_DEPTH || out.length >= MAX_FILES_PER_WORKSPACE) return;
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(current, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (out.length >= MAX_FILES_PER_WORKSPACE) return;
		const isHidden = entry.name.startsWith(".");
		const isBlacklisted = entry.isDirectory() && IGNORED_DIRS.has(entry.name);
		if (!includeHidden && (isHidden || isBlacklisted)) continue;
		const abs = join(current, entry.name);
		const rel = relative(root, abs).replace(/\\/g, "/");
		if (entry.isDirectory()) {
			out.push({ path: rel, absolutePath: abs, name: entry.name, kind: "directory" });
			await walk(root, out, includeHidden, abs, depth + 1);
		} else if (entry.isFile()) {
			out.push({ path: rel, absolutePath: abs, name: entry.name, kind: "file" });
		}
	}
}

async function index(cwd: string, includeHidden: boolean): Promise<WorkspaceCache> {
	const entries: FileSearchEntry[] = [];
	await walk(cwd, entries, includeHidden);
	const c: WorkspaceCache = { cwd, includeHidden, entries, indexedAt: Date.now() };
	cache.set(cacheKey(cwd, includeHidden), c);
	return c;
}

function isPathNav(query: string): boolean {
	if (query.length === 0) return false;
	if (query.startsWith("/")) return true;
	if (query.startsWith("~")) return true;
	if (query.startsWith("./") || query.startsWith("../")) return true;
	if (/^[a-zA-Z]:[\\/]/.test(query)) return true;
	return query.includes("/") || query.includes("\\");
}

interface ResolvedNav {
	baseDir: string;
	leafPrefix: string;
	/// What to prepend to the leaf name when rendering. Always ends in
	/// `/` (or is empty). Preserves the user's input shape so they
	/// see what they typed reflected back.
	displayPrefix: string;
}

async function resolveNavQuery(cwd: string, query: string): Promise<ResolvedNav | null> {
	// Normalize to forward slash for splitting + display.
	const q = query.replace(/\\/g, "/");
	let base: string;
	let stripped: string;
	if (q.startsWith("~")) {
		stripped = q.slice(1).replace(/^\//, "");
		base = homedir();
	} else if (q.startsWith("/") || /^[a-zA-Z]:\//.test(q)) {
		base = "/";
		stripped = q;
	} else {
		base = cwd;
		stripped = q;
	}
	const lastSlash = stripped.lastIndexOf("/");
	const dirPart = lastSlash >= 0 ? stripped.slice(0, lastSlash) : "";
	const leafPrefix = lastSlash >= 0 ? stripped.slice(lastSlash + 1) : stripped;
	const baseDir = resolve(base, dirPart);
	try {
		const st = await fs.stat(baseDir);
		if (!st.isDirectory()) return null;
	} catch {
		return null;
	}
	// displayPrefix is the substring of the normalized query up to and
	// including the final separator.
	const displayPrefix = lastSlash >= 0 ? q.slice(0, lastSlash + 1) : "";
	return { baseDir, leafPrefix, displayPrefix };
}

async function listDirectory(
	resolved: ResolvedNav,
	includeHidden: boolean,
	limit: number,
): Promise<FileSearchEntry[]> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(resolved.baseDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const lp = resolved.leafPrefix.toLowerCase();
	const out: FileSearchEntry[] = [];
	for (const e of entries) {
		if (!includeHidden && e.name.startsWith(".")) continue;
		if (!includeHidden && e.isDirectory() && IGNORED_DIRS.has(e.name)) continue;
		if (lp.length > 0 && !e.name.toLowerCase().startsWith(lp)) continue;
		const abs = join(resolved.baseDir, e.name);
		const kind: FileSearchKind = e.isDirectory() ? "directory" : "file";
		out.push({
			path: `${resolved.displayPrefix}${e.name}`,
			absolutePath: abs,
			name: e.name,
			kind,
		});
	}
	out.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return out.slice(0, limit);
}

export async function searchWorkspaceFiles(
	cwd: string,
	query: string,
	limit = 40,
	includeHidden = false,
): Promise<FileSearchEntry[]> {
	if (isPathNav(query)) {
		const resolved = await resolveNavQuery(cwd, query);
		if (!resolved) return [];
		return listDirectory(resolved, includeHidden, limit);
	}
	const entry = cache.get(cacheKey(cwd, includeHidden)) ?? (await index(cwd, includeHidden));
	const q = query.trim().toLowerCase();
	if (q.length === 0) {
		return [...entry.entries]
			.sort((a, b) => {
				if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
				return a.path.length - b.path.length;
			})
			.slice(0, limit);
	}
	type Scored = FileSearchEntry & { score: number };
	const scored: Scored[] = [];
	for (const f of entry.entries) {
		const nameL = f.name.toLowerCase();
		const pathL = f.path.toLowerCase();
		let score = 0;
		if (nameL === q) score = 4;
		else if (nameL.startsWith(q)) score = 3;
		else if (nameL.includes(q)) score = 2;
		else if (pathL.includes(q)) score = 1;
		if (score > 0) scored.push({ ...f, score });
	}
	scored.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
		return a.path.length - b.path.length;
	});
	return scored.slice(0, limit).map(({ path, absolutePath, name, kind }) => ({
		path,
		absolutePath,
		name,
		kind,
	}));
}

export function invalidate(cwd: string): void {
	cache.delete(cacheKey(cwd, false));
	cache.delete(cacheKey(cwd, true));
}

export function _resetForTest(): void {
	cache.clear();
}
