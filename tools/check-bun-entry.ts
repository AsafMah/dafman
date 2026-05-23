import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export interface BunEntryCheckOptions {
	entrypoint: string;
	outdir?: string;
	cleanupOutdir?: boolean;
}

export interface BunEntryCheckResult {
	ok: boolean;
	logs: string[];
}

function formatBuildLog(log: unknown): string {
	if (typeof log === "string") return log;
	if (log && typeof log === "object") {
		const obj = log as {
			message?: unknown;
			name?: unknown;
			position?: {
				file?: string;
				line?: number;
				column?: number;
			};
		};
		const message = typeof obj.message === "string" ? obj.message : String(log);
		const pos = obj.position;
		if (pos?.file) {
			const line = pos.line === undefined ? "" : `:${pos.line}`;
			const column = pos.column === undefined ? "" : `:${pos.column}`;
			return `${pos.file}${line}${column}: ${message}`;
		}
		return message;
	}
	return String(log);
}

export async function checkBunEntryReachability(
	options: BunEntryCheckOptions,
): Promise<BunEntryCheckResult> {
	const outdir =
		options.outdir ?? (await mkdtemp(join(tmpdir(), "dafman-bun-entry-")));
	const cleanup = options.cleanupOutdir ?? options.outdir === undefined;
	try {
		try {
			const result = await Bun.build({
				entrypoints: [resolve(options.entrypoint)],
				outdir,
				target: "bun",
				format: "esm",
				packages: "external",
				sourcemap: "none",
			});
			return {
				ok: result.success,
				logs: result.logs.map(formatBuildLog),
			};
		} catch (err) {
			const errors =
				err && typeof err === "object" && Array.isArray((err as { errors?: unknown }).errors)
					? ((err as { errors: unknown[] }).errors)
					: [err];
			return {
				ok: false,
				logs: errors.map(formatBuildLog),
			};
		}
	} finally {
		if (cleanup) {
			await rm(outdir, { recursive: true, force: true });
		}
	}
}

if (import.meta.main) {
	const entrypoint = resolve(import.meta.dir, "..", "src-bun", "index.ts");
	const result = await checkBunEntryReachability({ entrypoint });
	if (!result.ok) {
		console.error("Bun entry reachability check failed:");
		for (const log of result.logs) console.error(log);
		process.exit(1);
	}
	console.log("Bun entry reachability check passed.");
}
