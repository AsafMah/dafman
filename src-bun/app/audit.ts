// Append-only audit log writers.
//
// Separate from the diagnostic JSON log (which can be redacted /
// rotated / cleared). Audit entries record privileged decisions —
// permission grants/denials, URL opens — for forensic review, never
// auto-deleted. One JSONL file per category under
// `<userData>/audit/`:
//
//   audit/permissions.jsonl   — every respondToRequest decision
//   audit/urls.jsonl          — every openUrl + decision
//
// Schema: each line a JSON object with `ts` (ISO8601), `kind`, and
// kind-specific fields. Stable; future readers (an in-app Activity
// view) will parse this verbatim. Avoid raw user prompts or
// command bytes — record only what's strictly needed to answer
// "what was approved, when, by whom, on which session".

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logging";

export type PermissionAuditDecision = "approveOnce" | "approveForSession" | "reject";

export interface PermissionAuditEntry {
	ts: string;
	kind: "permission";
	sessionId: string;
	requestId: string;
	permissionKind: string;          // shell / write / read / mcp / url / custom-tool / memory / hook
	decision: PermissionAuditDecision;
	/// One-line summary (matches what surfaced in the UI). Already
	/// redaction-safe — bun side derived this for the modal.
	summary?: string;
	/// For `approveForSession` decisions, the rule kind (`commands`,
	/// `read`, `write`, `mcp`, `url`, …). Lets a reader correlate
	/// "user granted blanket reads" without re-deriving from the raw
	/// SDK shape.
	approvalKind?: string;
	/// For `approveForSession` URL decisions, the domain that was
	/// allowed.
	approvalDomain?: string;
}

export interface UrlAuditEntry {
	ts: string;
	kind: "url";
	url: string;
	allowed: boolean;
	/// "scheme-blocked" / "ok" — why the URL was/wasn't opened.
	reason: string;
}

export type AuditEntry = PermissionAuditEntry | UrlAuditEntry;

interface AuditConfig {
	dir: string | null;
}

const config: AuditConfig = { dir: null };

type Subscriber = (entry: AuditEntry) => void;
const subscribers = new Set<Subscriber>();

const RECENT_CAP = 500;
const recent: AuditEntry[] = [];

export interface InitAuditOptions {
	dir: string;
}

export async function initAudit(opts: InitAuditOptions): Promise<void> {
	config.dir = opts.dir;
	try {
		await mkdir(opts.dir, { recursive: true });
	} catch {
		// Best-effort — never block startup on audit log init.
	}
	// Hydrate the in-memory ring from the persisted JSONL files so
	// the Activity view shows history immediately on app restart
	// (otherwise the panel reads empty until the next live event).
	// Bounded by RECENT_CAP: read the last ~N lines from each file.
	await hydrateRecent();
}

async function hydrateRecent(): Promise<void> {
	const dir = config.dir;
	if (!dir) return;
	const files = ["permissions.jsonl", "urls.jsonl"];
	const collected: AuditEntry[] = [];
	for (const name of files) {
		const path = join(dir, name);
		if (!existsSync(path)) continue;
		try {
			const raw = await readFile(path, "utf8");
			const lines = raw.split(/\r?\n/);
			// Take the tail of the file; sufficient for the ring cap.
			const tail = lines.slice(Math.max(0, lines.length - RECENT_CAP));
			for (const line of tail) {
				if (!line.trim()) continue;
				try {
					const parsed = JSON.parse(line) as AuditEntry;
					if (parsed && typeof parsed === "object" && (parsed as { kind?: string }).kind) {
						collected.push(parsed);
					}
				} catch {
					/* skip malformed line */
				}
			}
		} catch (err) {
			log.warn("audit hydrate failed", {
				file: path,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	// Sort by ts so interleaved categories restore in chronological
	// order. Trim to ring cap.
	collected.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
	const start = Math.max(0, collected.length - RECENT_CAP);
	for (let i = start; i < collected.length; i++) {
		recent.push(collected[i]!);
	}
}

export function subscribeAudit(fn: Subscriber): () => void {
	subscribers.add(fn);
	return () => {
		subscribers.delete(fn);
	};
}

export function recentAudit(limit?: number): AuditEntry[] {
	if (limit === undefined || limit >= recent.length) return recent.slice();
	return recent.slice(recent.length - limit);
}

async function append(entry: AuditEntry): Promise<void> {
	pushRecent(entry);
	for (const sub of subscribers) {
		try {
			sub(entry);
		} catch {
			/* swallow */
		}
	}
	const dir = config.dir;
	if (!dir) return;
	const file = join(dir, entry.kind === "permission" ? "permissions.jsonl" : "urls.jsonl");
	const line = `${JSON.stringify(entry)}\n`;
	try {
		await appendFile(file, line);
	} catch (err) {
		log.warn("audit append failed", {
			file,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

function pushRecent(entry: AuditEntry): void {
	recent.push(entry);
	if (recent.length > RECENT_CAP) {
		recent.splice(0, recent.length - RECENT_CAP);
	}
}

/// Public surface: append-only writers. Returned promise resolves
/// when the record has been written + fanned out; callers (including
/// tests) can await it to deterministically observe the side-effects.
/// The shape lets the existing `void recordPermission(...)` /
/// `void recordUrl(...)` sites keep their fire-and-forget posture.
export function recordPermission(
	entry: Omit<PermissionAuditEntry, "ts" | "kind">,
): Promise<void> {
	return append({ ts: new Date().toISOString(), kind: "permission", ...entry });
}

export function recordUrl(
	entry: Omit<UrlAuditEntry, "ts" | "kind">,
): Promise<void> {
	return append({ ts: new Date().toISOString(), kind: "url", ...entry });
}

/// Test-only.
export function _resetAudit(): void {
	config.dir = null;
	recent.length = 0;
	subscribers.clear();
}
