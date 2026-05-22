// Focused unit tests for the PendingRequestQueue extraction.
//
// Wider integration paths (handler → enqueue → respond) are still
// exercised by `sessions.test.ts`. This file pins down the queue's
// own contract: typed cancellations per kind, mismatch checks,
// audit hand-off, and the `settleForSession` / `settleAll` drains.

import { afterEach, describe, expect, test } from "bun:test";
import { PendingRequestQueue, type AuditPermission } from "../app/pendingRequests";
import type { RespondToRequestParams } from "../rpc";
import type { PermissionAuditEntry } from "../app/audit";

interface CapturedAudit {
	calls: Array<Omit<PermissionAuditEntry, "ts" | "kind">>;
}

function makeAudit(): { fn: AuditPermission; captured: CapturedAudit } {
	const captured: CapturedAudit = { calls: [] };
	const fn: AuditPermission = (entry) => {
		captured.calls.push(entry);
	};
	return { fn, captured };
}

describe("PendingRequestQueue.enqueue", () => {
	test("emits the closure with a new requestId and returns a pending promise", async () => {
		const q = new PendingRequestQueue(() => {});
		let seenRequestId: string | undefined;
		const p = q.enqueue("sess-1", "permission", (rid) => {
			seenRequestId = rid;
		});
		expect(typeof seenRequestId).toBe("string");
		expect(seenRequestId!.length).toBeGreaterThan(0);
		expect(q.size).toBe(1);
		// Cancel so the dangling promise resolves and the test doesn't leak.
		q.cancel(seenRequestId!, "test-cleanup");
		await p;
	});

	test("when emit throws, the entry is cancelled with the kind's typed cancellation", async () => {
		const q = new PendingRequestQueue(() => {});
		const p = q.enqueue("sess-1", "userInput", () => {
			throw new Error("kaboom");
		});
		expect(q.size).toBe(0);
		const resolved = await p;
		expect(resolved).toEqual({
			answer: "User is unavailable in autopilot mode.",
			wasFreeform: true,
		});
	});

	test("elicitation cancellation shape is { action: cancel }", async () => {
		const q = new PendingRequestQueue(() => {});
		const p = q.enqueue("sess-1", "elicitation", () => {
			throw new Error("emit-failure");
		});
		expect(await p).toEqual({ action: "cancel" });
	});

	test("permission cancellation shape is { kind: user-not-available }", async () => {
		const q = new PendingRequestQueue(() => {});
		const p = q.enqueue("sess-1", "permission", () => {
			throw new Error("emit-failure");
		});
		expect(await p).toEqual({ kind: "user-not-available" });
	});

	test("exit-plan cancellation declines approval", async () => {
		const q = new PendingRequestQueue(() => {});
		const p = q.enqueue("sess-1", "exitPlanMode", () => {
			throw new Error("emit-failure");
		});
		expect(await p).toEqual({ approved: false });
	});

	test("auto-mode-switch cancellation answers no", async () => {
		const q = new PendingRequestQueue(() => {});
		const p = q.enqueue("sess-1", "autoModeSwitch", () => {
			throw new Error("emit-failure");
		});
		expect(await p).toEqual("no");
	});
});

describe("PendingRequestQueue.respond", () => {
	test("returns false on unknown requestId", async () => {
		const q = new PendingRequestQueue(() => {});
		const ok = await q.respond({
			sessionId: "sess-1",
			requestId: "does-not-exist",
			response: { kind: "permission", decision: "reject" },
		});
		expect(ok).toBe(false);
	});

	test("returns false on sessionId mismatch", async () => {
		const q = new PendingRequestQueue(() => {});
		let rid: string | undefined;
		const p = q.enqueue("sess-1", "permission", (id) => {
			rid = id;
		});
		const ok = await q.respond({
			sessionId: "sess-WRONG",
			requestId: rid!,
			response: { kind: "permission", decision: "reject" },
		});
		expect(ok).toBe(false);
		expect(q.size).toBe(1); // entry not consumed by mismatch
		q.cancel(rid!, "test-cleanup");
		await p;
	});

	test("returns false on kind mismatch", async () => {
		const q = new PendingRequestQueue(() => {});
		let rid: string | undefined;
		const p = q.enqueue("sess-1", "permission", (id) => {
			rid = id;
		});
		const ok = await q.respond({
			sessionId: "sess-1",
			requestId: rid!,
			response: {
				kind: "userInput",
				answer: "x",
				wasFreeform: true,
			} as RespondToRequestParams["response"],
		});
		expect(ok).toBe(false);
		expect(q.size).toBe(1);
		q.cancel(rid!, "test-cleanup");
		await p;
	});

	test("permission approveOnce → { kind: approve-once } and audited", async () => {
		const { fn, captured } = makeAudit();
		const q = new PendingRequestQueue(fn);
		let rid: string | undefined;
		const p = q.enqueue(
			"sess-1",
			"permission",
			(id) => {
				rid = id;
			},
			{ permissionKind: "shell", summary: "Run `ls`" },
		);
		const ok = await q.respond({
			sessionId: "sess-1",
			requestId: rid!,
			response: { kind: "permission", decision: "approveOnce" },
		});
		expect(ok).toBe(true);
		expect(await p).toEqual({ kind: "approve-once" });
		expect(captured.calls).toHaveLength(1);
		expect(captured.calls[0]).toMatchObject({
			sessionId: "sess-1",
			permissionKind: "shell",
			decision: "approveOnce",
			summary: "Run `ls`",
		});
	});

	test("permission approveForSession with approval + domain audits both fields", async () => {
		const { fn, captured } = makeAudit();
		const q = new PendingRequestQueue(fn);
		let rid: string | undefined;
		const p = q.enqueue(
			"sess-1",
			"permission",
			(id) => {
				rid = id;
			},
			{ permissionKind: "url" },
		);
		const ok = await q.respond({
			sessionId: "sess-1",
			requestId: rid!,
			response: {
				kind: "permission",
				decision: "approveForSession",
				approval: { kind: "commands", commandIdentifiers: ["git"] },
				domain: "github.com",
			} as RespondToRequestParams["response"],
		});
		expect(ok).toBe(true);
		expect(await p).toEqual({
			kind: "approve-for-session",
			approval: { kind: "commands", commandIdentifiers: ["git"] },
			domain: "github.com",
		});
		expect(captured.calls[0]).toMatchObject({
			approvalKind: "commands",
			approvalDomain: "github.com",
		});
	});

	test("idempotent on double-respond — second call returns false", async () => {
		const q = new PendingRequestQueue(() => {});
		let rid: string | undefined;
		const p = q.enqueue("sess-1", "userInput", (id) => {
			rid = id;
		});
		const params: RespondToRequestParams = {
			sessionId: "sess-1",
			requestId: rid!,
			response: { kind: "userInput", answer: "hi", wasFreeform: true },
		};
		const first = await q.respond(params);
		const second = await q.respond(params);
		expect(first).toBe(true);
		expect(second).toBe(false);
		expect(await p).toEqual({ answer: "hi", wasFreeform: true });
	});

	test("exit-plan approval maps to SDK result shape", async () => {
		const q = new PendingRequestQueue(() => {});
		let rid: string | undefined;
		const p = q.enqueue("sess-1", "exitPlanMode", (id) => {
			rid = id;
		});
		const ok = await q.respond({
			sessionId: "sess-1",
			requestId: rid!,
			response: {
				kind: "exitPlanMode",
				approved: true,
				selectedAction: "autopilot_fleet",
				feedback: "go",
			},
		});
		expect(ok).toBe(true);
		expect(await p).toEqual({
			approved: true,
			selectedAction: "autopilot_fleet",
			feedback: "go",
		});
	});

	test("auto-mode-switch response maps to CLI response string", async () => {
		const q = new PendingRequestQueue(() => {});
		let rid: string | undefined;
		const p = q.enqueue("sess-1", "autoModeSwitch", (id) => {
			rid = id;
		});
		const ok = await q.respond({
			sessionId: "sess-1",
			requestId: rid!,
			response: { kind: "autoModeSwitch", response: "yes_always" },
		});
		expect(ok).toBe(true);
		expect(await p).toBe("yes_always");
	});
});

describe("PendingRequestQueue teardown", () => {
	test("settleForSession cancels only matching sessionId entries", async () => {
		const q = new PendingRequestQueue(() => {});
		const promises: Array<Promise<unknown>> = [];
		for (let i = 0; i < 3; i++) promises.push(q.enqueue("sess-A", "permission", () => {}));
		const stayB = q.enqueue("sess-B", "permission", () => {});
		expect(q.size).toBe(4);
		q.settleForSession("sess-A", "test");
		expect(q.size).toBe(1);
		for (const p of promises) expect(await p).toEqual({ kind: "user-not-available" });
		// sess-B is still in flight.
		q.cancel([...(q as unknown as { entries: Map<string, unknown> }).entries.keys()][0], "test");
		await stayB;
	});

	test("settleAll drains every entry across sessions", async () => {
		const q = new PendingRequestQueue(() => {});
		const a = q.enqueue("sess-A", "userInput", () => {});
		const b = q.enqueue("sess-B", "elicitation", () => {});
		expect(q.size).toBe(2);
		q.settleAll("shutdown");
		expect(q.size).toBe(0);
		expect(await a).toEqual({
			answer: "User is unavailable in autopilot mode.",
			wasFreeform: true,
		});
		expect(await b).toEqual({ action: "cancel" });
	});
});
