// Audit log writer tests.

import { describe, expect, test, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	_resetAudit,
	initAudit,
	recentAudit,
	recordCommand,
	recordPermission,
	recordUrl,
	subscribeAudit,
} from "../app/audit";
import type { AuditEntry } from "../app/audit";

describe("audit log writer", () => {
	beforeEach(() => {
		_resetAudit();
	});

	test("recordPermission appends a JSONL line + bumps ring + fires subscribers", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dafman-audit-"));
		await initAudit({ dir });
		const seen: AuditEntry[] = [];
		const unsubscribe = subscribeAudit((entry) => seen.push(entry));
		await recordPermission({
			sessionId: "sess-1",
			requestId: "req-1",
			permissionKind: "shell",
			decision: "approveOnce",
			summary: "shell: ls -la",
		});
		// Ring populated.
		const ring = recentAudit();
		expect(ring).toHaveLength(1);
		expect(ring[0]?.kind).toBe("permission");
		// Subscriber fired.
		expect(seen).toHaveLength(1);
		// File appended.
		const file = join(dir, "permissions.jsonl");
		const stats = await stat(file);
		expect(stats.size).toBeGreaterThan(0);
		const content = await readFile(file, "utf8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.kind).toBe("permission");
		expect(parsed.sessionId).toBe("sess-1");
		expect(parsed.decision).toBe("approveOnce");
		expect(parsed.summary).toBe("shell: ls -la");
		unsubscribe();
	});

	test("recordUrl appends a separate JSONL file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dafman-audit-"));
		await initAudit({ dir });
		await Promise.all([
			recordUrl({ url: "https://github.com/login", allowed: true, reason: "ok" }),
			recordUrl({ url: "javascript:alert(1)", allowed: false, reason: "scheme-blocked" }),
		]);
		const file = join(dir, "urls.jsonl");
		const content = await readFile(file, "utf8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);
		// Order isn't strictly guaranteed (both promises start near-
		// simultaneously). Sort by URL for the assertion.
		const parsed = lines.map((l) => JSON.parse(l)).sort((a, b) => a.url.localeCompare(b.url));
		expect(parsed[0].url).toBe("https://github.com/login");
		expect(parsed[0].allowed).toBe(true);
		expect(parsed[1].url).toBe("javascript:alert(1)");
		expect(parsed[1].allowed).toBe(false);
		expect(parsed[1].reason).toBe("scheme-blocked");
	});

	test("recordCommand appends command metadata without output", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dafman-audit-"));
		await initAudit({ dir });
		await recordCommand({
			sessionId: "sess-1",
			commandId: "cmd-1",
			command: "echo SECRET",
			cwd: "C:\\repo",
			shell: "pwsh.exe",
			status: "completed",
			exitCode: 0,
			durationMs: 12,
			truncated: false,
		});
		const content = await readFile(join(dir, "commands.jsonl"), "utf8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.kind).toBe("command");
		expect(parsed.command).toBe("echo SECRET");
		expect(parsed).not.toHaveProperty("stdout");
		expect(parsed).not.toHaveProperty("stderr");
	});

	test("ring buffer caps at 500 entries", async () => {
		// No init — purely in-memory.
		const promises: Promise<void>[] = [];
		for (let i = 0; i < 600; i++) {
			promises.push(recordUrl({ url: `https://example.com/${i}`, allowed: true, reason: "ok" }));
		}
		await Promise.all(promises);
		const ring = recentAudit();
		expect(ring.length).toBe(500);
		// Oldest dropped → first entry is i=100.
		const first = ring[0];
		expect(first?.kind).toBe("url");
		if (first?.kind === "url") {
			expect(first.url).toBe("https://example.com/100");
		}
	});

	test("permissions + urls each write to their own file (no commingling)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dafman-audit-"));
		await initAudit({ dir });
		await Promise.all([
			recordPermission({
				sessionId: "s",
				requestId: "r",
				permissionKind: "read",
				decision: "approveForSession",
				approvalKind: "read",
			}),
			recordUrl({ url: "https://github.com", allowed: true, reason: "ok" }),
		]);
		const perms = await readFile(join(dir, "permissions.jsonl"), "utf8");
		const urls = await readFile(join(dir, "urls.jsonl"), "utf8");
		expect(perms).toContain("permission");
		expect(perms).not.toContain("https://github.com");
		expect(urls).toContain("github.com");
		expect(urls).not.toContain("permission");
	});
});
