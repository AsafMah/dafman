import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_setClientForTest,
} from "../app/client";
import { SessionRegistry } from "../app/sessions";
import { AppError } from "../app/errors";
import type { SessionEventPayload } from "../rpc";

type Handler = (event: { type: string; [k: string]: unknown }) => void;

interface FakeSession {
	sessionId: string;
	on(handler: Handler): () => void;
	send(args: { prompt: string; attachments?: unknown[] }): Promise<string>;
	setModel(model: string, opts?: { reasoningEffort?: string }): Promise<void>;
	getMessages(): Promise<Array<{ type: string; [k: string]: unknown }>>;
	disconnect(): Promise<void>;
	fire(event: { type: string; [k: string]: unknown }): void;
	rpc: {
		mode: {
			get: () => Promise<string>;
			set: (params: { mode: string }) => Promise<void>;
		};
		name: {
			get: () => Promise<{ name: string | null }>;
			set: (params: { name: string }) => Promise<void>;
		};
		history: {
			compact: () => Promise<{
				success: boolean;
				tokensFreed?: number;
				messagesRemoved?: number;
			}>;
		};
		permissions: {
			setApproveAll: (params: { enabled: boolean }) => Promise<{
				success: boolean;
			}>;
			resetSessionApprovals: () => Promise<{ success: boolean }>;
		};
		agent: {
			list: () => Promise<{
				agents: Array<{
					name: string;
					displayName: string;
					description: string;
					path?: string;
				}>;
			}>;
			getCurrent: () => Promise<{
				agent: {
					name: string;
					displayName: string;
					description: string;
					path?: string;
				} | null;
			}>;
			select: (params: { name: string }) => Promise<{
				agent: {
					name: string;
					displayName: string;
					description: string;
					path?: string;
				};
			}>;
			deselect: () => Promise<null>;
			reload: () => Promise<{
				agents: Array<{
					name: string;
					displayName: string;
					description: string;
					path?: string;
				}>;
			}>;
		};
		tasks: {
			list: () => Promise<{ tasks: Array<Record<string, unknown>> }>;
			cancel: (params: { id: string }) => Promise<{ cancelled: boolean }>;
			remove: (params: { id: string }) => Promise<{ removed: boolean }>;
		};
		fleet: {
			start: (params?: { prompt?: string }) => Promise<{ started: boolean }>;
		};
	};
	lastSentPrompt?: string;
	lastSentAttachments?: unknown[];
	lastModel?: { model: string; opts?: { reasoningEffort?: string } };
	history: Array<{ type: string; [k: string]: unknown }>;
	currentMode: string;
	currentName: string | null;
	approveAll: boolean;
	approvalsReset: number;
	compactCalls: number;
	/// Stateful agents fixture. Tests seed via `seedAgents()`.
	agentsList: Array<{
		name: string;
		displayName: string;
		description: string;
		path?: string;
	}>;
	currentAgentName: string | null;
	agentReloadCount: number;
	/// 19b.1: stateful tasks fixture.
	tasksList: Array<Record<string, unknown>>;
	cancelCalls: string[];
	removeCalls: string[];
	promoteCalls: string[];
	fleetStartCalls: Array<string | undefined>;
}

function makeFakeSession(
	sessionId: string,
	history: Array<{ type: string; [k: string]: unknown }> = [],
): FakeSession {
	let listener: Handler | null = null;
	const session: FakeSession = {
		sessionId,
		history,
		on(h) {
			listener = h;
			return () => {
				listener = null;
			};
		},
		async send({ prompt, attachments }) {
			session.lastSentPrompt = prompt;
			session.lastSentAttachments = attachments;
			return "msg-id";
		},
		async setModel(model, opts) {
			session.lastModel = { model, opts };
		},
		async getMessages() {
			return session.history;
		},
		async disconnect() {},
		fire(event) {
			listener?.(event);
		},
		currentMode: "interactive",
		currentName: null,
		approveAll: true,
		approvalsReset: 0,
		compactCalls: 0,
		rpc: {
			mode: {
				async get() {
					return session.currentMode;
				},
				async set({ mode }) {
					session.currentMode = mode;
				},
			},
			name: {
				async get() {
					return { name: session.currentName };
				},
				async set({ name }) {
					session.currentName = name;
				},
			},
			history: {
				async compact() {
					session.compactCalls++;
					return { success: true, tokensFreed: 42, messagesRemoved: 3 };
				},
			},
			permissions: {
				async setApproveAll({ enabled }) {
					session.approveAll = enabled;
					return { success: true };
				},
				async resetSessionApprovals() {
					session.approvalsReset++;
					return { success: true };
				},
			},
			agent: {
				async list() {
					return { agents: session.agentsList.slice() };
				},
				async getCurrent() {
					const found =
						session.currentAgentName == null
							? null
							: session.agentsList.find((a) => a.name === session.currentAgentName);
					return { agent: found ?? null };
				},
				async select({ name }) {
					const found = session.agentsList.find((a) => a.name === name);
					if (!found) throw new Error(`unknown agent: ${name}`);
					session.currentAgentName = name;
					return { agent: found };
				},
				async deselect() {
					session.currentAgentName = null;
					return null;
				},
				async reload() {
					session.agentReloadCount++;
					return { agents: session.agentsList.slice() };
				},
			},
			tasks: {
				async list() {
					return { tasks: session.tasksList.slice() };
				},
				async cancel({ id }) {
					session.cancelCalls.push(id);
					const t = session.tasksList.find((row) => row.id === id);
					if (!t) return { cancelled: false };
					t.status = "cancelled";
					return { cancelled: true };
				},
				async remove({ id }) {
					session.removeCalls.push(id);
					const idx = session.tasksList.findIndex((row) => row.id === id);
					if (idx < 0) return { removed: false };
					session.tasksList.splice(idx, 1);
					return { removed: true };
				},
				async promoteToBackground({ id }) {
					session.promoteCalls.push(id);
					const t = session.tasksList.find((row) => row.id === id);
					if (!t) return { promoted: false };
					t.executionMode = "background";
					t.canPromoteToBackground = false;
					return { promoted: true };
				},
			},
			fleet: {
				async start(params?: { prompt?: string }) {
					session.fleetStartCalls.push(params?.prompt);
					return { started: true };
				},
			},
		},
		agentsList: [],
		currentAgentName: null,
		agentReloadCount: 0,
		tasksList: [],
		cancelCalls: [],
		removeCalls: [],
		promoteCalls: [],
		fleetStartCalls: [],
	};
	return session;
}

class FakeClient {
	createdSessions: FakeSession[] = [];
	createdConfigs: Array<Record<string, unknown>> = [];
	resumedSessions: FakeSession[] = [];
	resumedConfigs: Array<Record<string, unknown>> = [];
	listed: Array<{
		sessionId: string;
		startTime: Date;
		modifiedTime: Date;
		summary?: string;
		isRemote: boolean;
		context?: { cwd?: string; repository?: string; branch?: string };
	}> = [];
	/// Seeds history that the next `resumeSession` call will hand back
	/// via `getMessages()`. Populated by tests before triggering resume.
	nextResumeHistory: Array<{ type: string; [k: string]: unknown }> = [];
	async createSession(config: Record<string, unknown> = {}): Promise<FakeSession> {
		this.createdConfigs.push(config);
		const s = makeFakeSession(`sess-${this.createdSessions.length + 1}`);
		this.createdSessions.push(s);
		return s;
	}
	async resumeSession(
		sessionId: string,
		config: Record<string, unknown> = {},
	): Promise<FakeSession> {
		this.resumedConfigs.push(config);
		const s = makeFakeSession(sessionId, this.nextResumeHistory);
		this.nextResumeHistory = [];
		this.resumedSessions.push(s);
		return s;
	}
	async listSessions() {
		return this.listed;
	}
}

afterEach(() => {
	_setClientForTest(null);
});

describe("SessionRegistry", () => {
	test("forwards session events through emit with sessionId tag", async () => {
		const client = new FakeClient();
		_setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);
		const emitted: SessionEventPayload[] = [];
		const reg = new SessionRegistry((p) => emitted.push(p));
		const id = await reg.create();
		client.createdSessions[0]?.fire({
			type: "assistant.intent",
			data: { intent: "hi" },
		});
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			sessionId: id,
			eventType: "assistant.intent",
		});
		expect((emitted[0]?.data as { intent?: string }).intent).toBe("hi");
	});

	test("forward coerces non-object data payloads to empty object", async () => {
		// SDK is typed as `data: Record<string, unknown>` but we can't
		// trust the wire — if a build ever sends `null` / array / string
		// the downstream reducer must still see an object. The previous
		// `?? {}` fallback silently passed `null` through into a cast,
		// so this regression-pins the guard added to `forward`.
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const emitted: SessionEventPayload[] = [];
		const reg = new SessionRegistry((p) => emitted.push(p));
		await reg.create();
		const fake = client.createdSessions[0]!;
		fake.fire({ type: "x.null", data: null as unknown as Record<string, unknown> });
		fake.fire({
			type: "x.array",
			data: ["nope"] as unknown as Record<string, unknown>,
		});
		fake.fire({
			type: "x.string",
			data: "nope" as unknown as Record<string, unknown>,
		});
		fake.fire({ type: "x.missing" } as unknown as { type: string; data: Record<string, unknown> });
		expect(emitted).toHaveLength(4);
		for (const p of emitted) {
			expect(p.data).toEqual({});
		}
	});

	test("send/setModel proxy through the fake session", async () => {
		const client = new FakeClient();
		_setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		await reg.send(id, "hello");
		expect(fake.lastSentPrompt).toBe("hello");
		await reg.setModel(id, "claude", "high");
		expect(fake.lastModel).toEqual({
			model: "claude",
			opts: { reasoningEffort: "high" },
		});
	});

	test("send converts command result pills into temp file attachments", async () => {
		const client = new FakeClient();
		_setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		await reg.send(id, "use this", undefined, [
			{
				type: "commandResult",
				displayName: "cmd-result.md",
				result: {
					id: "cmd-1",
					sessionId: id,
					command: "echo hi",
					cwd: process.cwd(),
					shell: "pwsh.exe",
					status: "completed",
					stdout: "hi\n",
					stderr: "",
					truncated: false,
					createdAt: new Date().toISOString(),
					exitCode: 0,
				},
			},
		]);
		expect(fake.lastSentPrompt).toBe("use this");
		expect(fake.lastSentAttachments).toHaveLength(1);
		expect(fake.lastSentAttachments?.[0]).toMatchObject({
			type: "file",
			displayName: "cmd-result.md",
		});
		expect((fake.lastSentAttachments?.[0] as { path?: string }).path).toContain("cmd-result.md");
	});

	test("disconnect on unknown sessionId throws SessionNotFound", async () => {
		const reg = new SessionRegistry(() => {});
		await expect(reg.disconnect("ghost")).rejects.toBeInstanceOf(AppError);
	});

	test("resume hydrates history through the same emit path", async () => {
		const client = new FakeClient();
		client.nextResumeHistory = [
			{ type: "assistant.message_start", data: { messageId: "m1" } },
			{
				type: "assistant.message_delta",
				data: { messageId: "m1", deltaContent: "hi" },
			},
		];
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const emitted: SessionEventPayload[] = [];
		const reg = new SessionRegistry((p) => emitted.push(p));
		const id = await reg.resume("sess-42");
		expect(id).toBe("sess-42");
		expect(emitted).toHaveLength(2);
		expect(emitted[0]?.eventType).toBe("assistant.message_start");
		expect(emitted[1]?.eventType).toBe("assistant.message_delta");
		// Live events after resume use the same forwarder.
		client.resumedSessions[0]?.fire({
			type: "assistant.turn_end",
			data: { turnId: "t1" },
		});
		expect(emitted).toHaveLength(3);
		expect(emitted[2]?.eventType).toBe("assistant.turn_end");
	});

	test("resume is idempotent for an already-registered session", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const first = await reg.resume("sess-1");
		const second = await reg.resume("sess-1");
		expect(first).toBe(second);
		expect(client.resumedSessions).toHaveLength(1);
	});

	test("resume propagates SDK failures as AppError.sdk", async () => {
		const client = new FakeClient();
		client.resumeSession = async () => {
			throw new Error("session deleted");
		};
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		await expect(reg.resume("ghost-id")).rejects.toBeInstanceOf(AppError);
	});

	test("list maps SDK SessionMetadata into JSON-safe summaries", async () => {
		const client = new FakeClient();
		client.listed = [
			{
				sessionId: "s1",
				startTime: new Date("2026-05-17T10:00:00.000Z"),
				modifiedTime: new Date("2026-05-17T11:00:00.000Z"),
				summary: "refactor auth",
				isRemote: false,
				context: {
					cwd: "/repo",
					repository: "AsafMah/dafman",
					branch: "main",
				},
			},
		];
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const items = await reg.list();
		expect(items).toEqual([
			{
				sessionId: "s1",
				startTime: "2026-05-17T10:00:00.000Z",
				modifiedTime: "2026-05-17T11:00:00.000Z",
				summary: "refactor auth",
				isRemote: false,
				cwd: "/repo",
				repository: "AsafMah/dafman",
				branch: "main",
			},
		]);
	});

	test("mode/name/compact/approve-all proxy to the session rpc surface", async () => {
		const client = new FakeClient();
		_setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;

		expect(await reg.getMode(id)).toBe("interactive");
		await reg.setMode(id, "plan");
		expect(fake.currentMode).toBe("plan");

		await reg.setName(id, "My chat");
		expect(fake.currentName).toBe("My chat");
		expect(await reg.getName(id)).toBe("My chat");

		const compaction = await reg.compactHistory(id);
		expect(compaction).toEqual({
			success: true,
			tokensFreed: 42,
			messagesRemoved: 3,
		});
		expect(fake.compactCalls).toBe(1);

		await reg.setApproveAll(id, false);
		expect(fake.approveAll).toBe(false);

		await reg.resetApprovals(id);
		expect(fake.approvalsReset).toBe(1);
	});

	test("session-rpc methods on unknown sessionId throw SessionNotFound", async () => {
		const reg = new SessionRegistry(() => {});
		await expect(reg.getMode("ghost")).rejects.toBeInstanceOf(AppError);
		await expect(reg.setMode("ghost", "plan")).rejects.toBeInstanceOf(AppError);
		await expect(reg.compactHistory("ghost")).rejects.toBeInstanceOf(AppError);
		await expect(reg.setApproveAll("ghost", true)).rejects.toBeInstanceOf(
			AppError,
		);
		await expect(reg.resetApprovals("ghost")).rejects.toBeInstanceOf(AppError);
		await expect(reg.setName("ghost", "x")).rejects.toBeInstanceOf(AppError);
	});

	test("getMode rejects an unexpected SDK value as AppError.sdk", async () => {
		const client = new FakeClient();
		_setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		(fake as unknown as { currentMode: string }).currentMode = "garbage";
		await expect(reg.getMode(id)).rejects.toBeInstanceOf(AppError);
	});

	test("create forwards workingDirectory to the SDK when provided", async () => {
		const client = new FakeClient();
		_setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);
		const reg = new SessionRegistry(() => {});
		await reg.create({ workingDirectory: "C:\\repo" });
		expect(client.createdConfigs[0]).toMatchObject({
			workingDirectory: "C:\\repo",
			// Workspace-level MCP + skill discovery is always on — flipping
			// it off would silently break any `.mcp.json` in the user's
			// repo. Pinned by this test.
			enableConfigDiscovery: true,
		});
		// Empty / whitespace-only paths must NOT be forwarded — the SDK
		// would treat them literally instead of falling back to its
		// default cwd.
		await reg.create({ workingDirectory: "   " });
		expect(client.createdConfigs[1]).not.toHaveProperty("workingDirectory");
		await reg.create();
		expect(client.createdConfigs[2]).not.toHaveProperty("workingDirectory");
	});

	test("setWorkingDirectory resumes the same session with a validated directory", async () => {
		const client = new FakeClient();
		_setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create({ workingDirectory: "C:\\repo" });
		const dir = mkdtempSync(join(tmpdir(), "dafman-cwd-"));

		const next = await reg.setWorkingDirectory(id, dir);

		expect(next).toBe(dir);
		expect(client.resumedSessions[0]?.sessionId).toBe(id);
		expect(client.resumedConfigs[0]).toMatchObject({
			workingDirectory: dir,
		});
	});

	test("getName returns null for nullish/missing and rejects non-string", async () => {
		const client = new FakeClient();
		_setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		// nullish → null
		fake.currentName = null;
		expect(await reg.getName(id)).toBeNull();
		// non-string → AppError.sdk
		(fake as unknown as { currentName: unknown }).currentName = 42;
		await expect(reg.getName(id)).rejects.toBeInstanceOf(AppError);
	});

	test("onPermissionRequest emits a pending payload and respondToRequest resolves the SDK promise", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const pendingEmitted: unknown[] = [];
		const reg = new SessionRegistry(
			() => {},
			(p) => pendingEmitted.push(p),
		);
		const id = await reg.create();
		const config = client.createdConfigs[0] as {
			onPermissionRequest: (req: { kind: string; command?: string }) => Promise<unknown>;
		};
		// SDK invokes the registered handler; we should get a pending
		// emit synchronously and a Promise we can resolve later.
		const sdkPromise = config.onPermissionRequest({
			kind: "shell",
			command: "ls -la",
		});
		expect(pendingEmitted).toHaveLength(1);
		const emitted = pendingEmitted[0] as {
			sessionId: string;
			requestId: string;
			kind: string;
			request: { kind: string; summary: string };
		};
		expect(emitted.sessionId).toBe(id);
		expect(emitted.kind).toBe("permission");
		expect(emitted.request.kind).toBe("shell");
		expect(emitted.request.summary).toBe("Run `ls -la`");

		const ok = await reg.respondToRequest({
			sessionId: id,
			requestId: emitted.requestId,
			response: { kind: "permission", decision: "approveOnce" },
		});
		expect(ok).toBe(true);
		await expect(sdkPromise).resolves.toEqual({ kind: "approve-once" });
	});

	test("respondToRequest on an already-resolved request is idempotent (returns false, no throw)", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const pendingEmitted: Array<{ requestId: string }> = [];
		const reg = new SessionRegistry(
			() => {},
			(p) => pendingEmitted.push(p as { requestId: string }),
		);
		const id = await reg.create();
		const config = client.createdConfigs[0] as {
			onPermissionRequest: (req: { kind: string }) => Promise<unknown>;
		};
		const sdkPromise = config.onPermissionRequest({ kind: "shell" });
		const reqId = pendingEmitted[0]!.requestId;
		const first = await reg.respondToRequest({
			sessionId: id,
			requestId: reqId,
			response: { kind: "permission", decision: "reject" },
		});
		expect(first).toBe(true);
		const second = await reg.respondToRequest({
			sessionId: id,
			requestId: reqId,
			response: { kind: "permission", decision: "reject" },
		});
		expect(second).toBe(false);
		// SDK promise still resolves with the first response.
		await expect(sdkPromise).resolves.toEqual({ kind: "reject" });
	});

	test("respondToRequest records an audit entry with the right kind + decision + summary", async () => {
		const { _resetAudit, recentAudit, initAudit } = await import("../app/audit");
		_resetAudit();
		const { tmpdir } = await import("node:os");
		const { mkdtemp } = await import("node:fs/promises");
		const { join } = await import("node:path");
		await initAudit({ dir: await mkdtemp(join(tmpdir(), "dafman-audit-sess-")) });
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const pendingEmitted: unknown[] = [];
		const reg = new SessionRegistry(
			() => {},
			(p) => pendingEmitted.push(p),
		);
		const id = await reg.create();
		const config = client.createdConfigs[0] as {
			onPermissionRequest: (req: { kind: string; command?: string }) => Promise<unknown>;
		};
		const sdkPromise = config.onPermissionRequest({ kind: "shell", command: "ls -la" });
		const reqId = (pendingEmitted[0] as { requestId: string }).requestId;
		await reg.respondToRequest({
			sessionId: id,
			requestId: reqId,
			response: {
				kind: "permission",
				decision: "approveForSession",
				approval: { kind: "commands", commandIdentifiers: ["ls"] },
			},
		});
		await sdkPromise;
		const audit = recentAudit();
		// May contain entries from prior tests in this same test file if
		// _resetAudit isn't called between them — filter by sessionId.
		const ours = audit.filter(
			(e) => e.kind === "permission" && e.sessionId === id,
		);
		expect(ours).toHaveLength(1);
		const first = ours[0];
		expect(first?.kind).toBe("permission");
		if (first?.kind === "permission") {
			expect(first.permissionKind).toBe("shell");
			expect(first.decision).toBe("approveForSession");
			expect(first.approvalKind).toBe("commands");
			expect(first.summary).toBe("Run `ls -la`");
		}
	});

	test("disconnect settles every pending callback for the session with a typed cancellation", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(
			() => {},
			() => {},
		);
		const id = await reg.create();
		const config = client.createdConfigs[0] as {
			onPermissionRequest: (req: { kind: string }) => Promise<unknown>;
			onUserInputRequest: (req: { question: string }) => Promise<unknown>;
			onElicitationRequest: (ctx: { sessionId: string; message: string; mode: string }) => Promise<unknown>;
		};
		// Three pending callbacks, none resolved yet.
		const permPromise = config.onPermissionRequest({ kind: "shell" });
		const inputPromise = config.onUserInputRequest({ question: "name?" });
		const elicPromise = config.onElicitationRequest({
			sessionId: id,
			message: "go",
			mode: "url",
		});
		await reg.disconnect(id);
		// Each promise settles with the kind-appropriate cancellation
		// so the SDK never hangs after the session is gone.
		await expect(permPromise).resolves.toEqual({ kind: "user-not-available" });
		await expect(inputPromise).resolves.toEqual({
			answer: "User is unavailable in autopilot mode.",
			wasFreeform: true,
		});
		await expect(elicPromise).resolves.toEqual({ action: "cancel" });
	});

	test("registry-owned approveAll short-circuits the permission handler with approve-once", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const pendingEmitted: unknown[] = [];
		const reg = new SessionRegistry(
			() => {},
			(p) => pendingEmitted.push(p),
		);
		const id = await reg.create();
		await reg.setApproveAll(id, true);
		const config = client.createdConfigs[0] as {
			onPermissionRequest: (req: { kind: string }) => Promise<unknown>;
		};
		// With approveAll on, the handler must NOT emit a pending
		// request — it short-circuits with approve-once so the user
		// is never prompted.
		const decision = await config.onPermissionRequest({ kind: "shell" });
		expect(decision).toEqual({ kind: "approve-once" });
		expect(pendingEmitted).toHaveLength(0);
	});

	test("autopilot returns unavailable/decline instead of prompting", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const pendingEmitted: unknown[] = [];
		const reg = new SessionRegistry(
			() => {},
			(p) => pendingEmitted.push(p),
		);
		const id = await reg.create();
		await reg.setApproveAll(id, false);
		await reg.setMode(id, "autopilot");
		const config = client.createdConfigs[0] as {
			onPermissionRequest: (req: { kind: string }) => Promise<unknown>;
			onUserInputRequest: (req: { question: string }) => Promise<unknown>;
			onElicitationRequest: (ctx: { sessionId: string; message: string; mode: string }) => Promise<unknown>;
		};

		await expect(config.onPermissionRequest({ kind: "write" })).resolves.toEqual({
			kind: "user-not-available",
		});
		await expect(config.onUserInputRequest({ question: "continue?" })).resolves.toEqual({
			answer: "User is unavailable in autopilot mode.",
			wasFreeform: true,
		});
		await expect(
			config.onElicitationRequest({ sessionId: id, message: "pick", mode: "form" }),
		).resolves.toEqual({ action: "decline" });
		expect(pendingEmitted).toHaveLength(0);
	});

	test("exit plan and auto mode switch callbacks emit pending payloads and resolve", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const pendingEmitted: Array<{ requestId: string; kind: string }> = [];
		const reg = new SessionRegistry(
			() => {},
			(p) => pendingEmitted.push(p as { requestId: string; kind: string }),
		);
		const id = await reg.create();
		const config = client.createdConfigs[0] as {
			onExitPlanMode: (req: {
				summary: string;
				planContent?: string;
				actions: string[];
				recommendedAction: string;
			}) => Promise<unknown>;
			onAutoModeSwitch: (req: {
				errorCode?: string;
				retryAfterSeconds?: number;
			}) => Promise<unknown>;
		};

		const exitPromise = config.onExitPlanMode({
			summary: "- Looks good",
			planContent: "# Plan",
			actions: ["interactive", "autopilot"],
			recommendedAction: "interactive",
		});
		expect(pendingEmitted[0]?.kind).toBe("exitPlanMode");
		await reg.respondToRequest({
			sessionId: id,
			requestId: pendingEmitted[0]!.requestId,
			response: {
				kind: "exitPlanMode",
				approved: true,
				selectedAction: "interactive",
			},
		});
		await expect(exitPromise).resolves.toEqual({
			approved: true,
			selectedAction: "interactive",
		});

		const autoPromise = config.onAutoModeSwitch({
			errorCode: "rate_limit",
			retryAfterSeconds: 30,
		});
		expect(pendingEmitted[1]?.kind).toBe("autoModeSwitch");
		await reg.respondToRequest({
			sessionId: id,
			requestId: pendingEmitted[1]!.requestId,
			response: { kind: "autoModeSwitch", response: "yes_always" },
		});
		await expect(autoPromise).resolves.toBe("yes_always");
	});

	test("S2: create() buffers events fired during createSession await + drains under the real sessionId", async () => {
		// Reproduces the original bug: SDK can fire `session.start`
		// (or similar) through `config.onEvent` BEFORE returning the
		// session object. Pre-fix: those events forwarded under the
		// literal "pending" id and were dropped by the renderer.
		// Post-fix: they buffer + drain under the real sessionId.
		class RacingFakeClient extends FakeClient {
			override async createSession(
				config: Record<string, unknown> = {},
			): Promise<FakeSession> {
				const s = makeFakeSession(`raced-${this.createdSessions.length + 1}`);
				this.createdSessions.push(s);
				this.createdConfigs.push(config);
				// Fire BEFORE returning, simulating the SDK's race.
				const onEvent = config.onEvent as
					| ((e: { type: string; data: Record<string, unknown> }) => void)
					| undefined;
				onEvent?.({ type: "session.start", data: { early: true } });
				return s;
			}
		}
		const client = new RacingFakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const emitted: SessionEventPayload[] = [];
		const reg = new SessionRegistry((p) => emitted.push(p));
		const id = await reg.create();
		// The early "session.start" event must have been delivered
		// under the real sessionId, not "pending".
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.sessionId).toBe(id);
		expect(emitted[0]?.sessionId).not.toBe("pending");
		expect(emitted[0]?.eventType).toBe("session.start");
	});

	test("S1: shutdownAll completes within the timeout even if session.disconnect hangs", async () => {
		// Builds a fake whose disconnect() never resolves. Pre-fix:
		// shutdownAll() would hang forever. Post-fix: each session's
		// disconnect is raced against SHUTDOWN_TIMEOUT_MS (2s) and
		// the entry is force-cleared on timeout.
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		await reg.create();
		const fake = client.createdSessions[0]!;
		// Replace disconnect with a never-resolving Promise.
		let disconnectStarted = false;
		fake.disconnect = () =>
			new Promise<void>(() => {
				disconnectStarted = true;
			});
		const t0 = Date.now();
		await reg.shutdownAll();
		const elapsed = Date.now() - t0;
		expect(disconnectStarted).toBe(true);
		// Should complete close to the 2s timeout, definitely under 4s.
		expect(elapsed).toBeLessThan(4000);
		// Entry must be cleared so a follow-up shutdownAll is a no-op.
		const t1 = Date.now();
		await reg.shutdownAll();
		expect(Date.now() - t1).toBeLessThan(200);
	}, 8000);

	test("S5: resume caps history replay at HISTORY_REPLAY_CAP and forwards all under sessionId", async () => {
		// Builds a 1500-event history. Pre-fix: all 1500 events would
		// fire synchronously through `forward`, blocking the event
		// loop for the duration. Post-fix: at most HISTORY_REPLAY_CAP
		// (500) replay through `forward`, batched via queueMicrotask.
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const history: Array<{ type: string; [k: string]: unknown }> = [];
		for (let i = 0; i < 1500; i++) {
			history.push({ type: "assistant.message", data: { messageId: `m-${i}` } });
		}
		client.nextResumeHistory = history;
		const emitted: SessionEventPayload[] = [];
		const reg = new SessionRegistry((p) => emitted.push(p));
		const id = await reg.resume("sess-history");
		expect(id).toBe("sess-history");
		// Capped at 500 (HISTORY_REPLAY_CAP); the last 500 of 1500 are
		// the most-recent slice.
		expect(emitted).toHaveLength(500);
		// All replayed events tagged with the resumed sessionId.
		for (const p of emitted) expect(p.sessionId).toBe(id);
		// Most-recent event present.
		const last = emitted[emitted.length - 1];
		expect((last?.data as { messageId?: string }).messageId).toBe("m-1499");
	});

	test("19a: listAgents returns the SDK shape normalized", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		fake.agentsList = [
			{
				name: "reviewer",
				displayName: "Code Reviewer",
				description: "Reviews PRs",
				path: "C:/repo/.github/agents/reviewer.md",
			},
			{ name: "bare", displayName: "Bare", description: "" },
		];
		const agents = await reg.listAgents(id);
		expect(agents).toEqual([
			{
				name: "reviewer",
				displayName: "Code Reviewer",
				description: "Reviews PRs",
				path: "C:/repo/.github/agents/reviewer.md",
			},
			{ name: "bare", displayName: "Bare", description: "" },
		]);
	});

	test("19a: getCurrentAgent returns null when no agent is selected", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		expect(await reg.getCurrentAgent(id)).toBeNull();
	});

	test("19a: selectAgent + getCurrentAgent + deselectAgent round-trip", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		fake.agentsList = [
			{
				name: "reviewer",
				displayName: "Code Reviewer",
				description: "Reviews PRs",
			},
		];
		const selected = await reg.selectAgent(id, "reviewer");
		expect(selected.name).toBe("reviewer");
		const current = await reg.getCurrentAgent(id);
		expect(current?.name).toBe("reviewer");
		await reg.deselectAgent(id);
		expect(await reg.getCurrentAgent(id)).toBeNull();
	});

	test("19a: selectAgent on unknown name wraps SDK error as AppError.sdk", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		try {
			await reg.selectAgent(id, "does-not-exist");
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AppError);
			expect((err as AppError).payload.kind).toBe("Sdk");
		}
	});

	test("19a: reloadAgents bumps the SDK reload counter and returns the fresh list", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		fake.agentsList = [
			{ name: "a1", displayName: "Agent 1", description: "" },
		];
		expect(fake.agentReloadCount).toBe(0);
		const out = await reg.reloadAgents(id);
		expect(fake.agentReloadCount).toBe(1);
		expect(out).toHaveLength(1);
		expect(out[0]?.name).toBe("a1");
	});

	test("19a: all agent RPCs reject with SessionNotFound on unknown sessionId", async () => {
		_setClientForTest(
			new FakeClient() as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		await expect(reg.listAgents("ghost")).rejects.toBeInstanceOf(AppError);
		await expect(reg.getCurrentAgent("ghost")).rejects.toBeInstanceOf(AppError);
		await expect(reg.selectAgent("ghost", "any")).rejects.toBeInstanceOf(AppError);
		await expect(reg.deselectAgent("ghost")).rejects.toBeInstanceOf(AppError);
		await expect(reg.reloadAgents("ghost")).rejects.toBeInstanceOf(AppError);
	});

	test("19b.1: listTasks normalizes agent and shell task shapes", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		fake.tasksList = [
			{
				type: "agent",
				id: "task-1",
				toolCallId: "tc-1",
				description: "Explore the codebase",
				status: "running",
				agentType: "explore",
				agentName: "explorer",
				agentDisplayName: "Code Explorer",
				startedAt: "2026-05-22T10:00:00Z",
				activeTimeMs: 1234,
			},
			{
				type: "shell",
				id: "shell-1",
				status: "idle",
				description: "Run check",
				command: "bun run check",
				logPath: "C:\\logs\\check.log",
				pid: 1234,
			},
			// Type-missing entry also dropped (defensive against SDK drift).
			{ id: "no-type", status: "running" },
			// Non-string id dropped.
			{ type: "agent", id: 42, status: "running" },
		];
		const tasks = await reg.listTasks(id);
		expect(tasks).toHaveLength(2);
		expect(tasks[0]).toMatchObject({
			id: "task-1",
			type: "agent",
			description: "Explore the codebase",
			status: "running",
			agentType: "explore",
			agentName: "explorer",
			agentDisplayName: "Code Explorer",
			startedAt: "2026-05-22T10:00:00Z",
			activeTimeMs: 1234,
		});
		expect(tasks[1]).toMatchObject({
			id: "shell-1",
			type: "shell",
			status: "idle",
			command: "bun run check",
			logPath: "C:\\logs\\check.log",
			pid: 1234,
		});
	});

	test("19b.1: listTasks defaults unknown status to running", async () => {
		// SDK shape drift defense: an unexpected status string falls
		// back to running rather than leaking into the UI.
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		fake.tasksList = [
			{ type: "agent", id: "task-1", status: "WHO_KNOWS", description: "x" },
		];
		const tasks = await reg.listTasks(id);
		expect(tasks[0]?.status).toBe("running");
	});

	test("19b.1: cancelTask forwards id and returns boolean", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		fake.tasksList = [
			{ type: "agent", id: "task-1", status: "running", description: "" },
		];
		expect(await reg.cancelTask(id, "task-1")).toBe(true);
		expect(fake.cancelCalls).toEqual(["task-1"]);
		// Unknown id: SDK returns false; we propagate.
		expect(await reg.cancelTask(id, "ghost")).toBe(false);
	});

	test("19b.1: removeTask forwards id and returns boolean", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		fake.tasksList = [
			{ type: "agent", id: "task-1", status: "completed", description: "" },
		];
		expect(await reg.removeTask(id, "task-1")).toBe(true);
		expect(fake.removeCalls).toEqual(["task-1"]);
		// Unknown id: false.
		expect(await reg.removeTask(id, "ghost")).toBe(false);
	});

	test("19b.1: promoteTask forwards id and returns boolean", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		fake.tasksList = [
			{ type: "agent", id: "task-1", status: "running", description: "" },
		];
		expect(await reg.promoteTask(id, "task-1")).toBe(true);
		expect(fake.promoteCalls).toEqual(["task-1"]);
		expect(await reg.promoteTask(id, "ghost")).toBe(false);
	});

	test("Long jobs: listJobs aggregates normalized tasks across sessions", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const first = await reg.create();
		const second = await reg.create();
		client.createdSessions[0]!.tasksList = [
			{
				type: "agent",
				id: "agent-1",
				status: "running",
				description: "Explore",
				agentType: "explore",
				agentDisplayName: "Explorer",
				canPromoteToBackground: true,
				startedAt: "2026-05-22T10:00:00Z",
			},
		];
		client.createdSessions[1]!.tasksList = [
			{
				type: "shell",
				id: "shell-1",
				status: "completed",
				description: "Check",
				command: "bun run check",
				startedAt: "2026-05-22T11:00:00Z",
			},
		];
		const jobs = await reg.listJobs();
		expect(jobs.map((j) => j.id).sort()).toEqual([
			`${first}:agent-1`,
			`${second}:shell-1`,
		].sort());
		expect(jobs.find((j) => j.id === `${first}:agent-1`)).toMatchObject({
			source: "sdk-task",
			kind: "agent",
			title: "Explorer",
			canCancel: true,
			canPromoteToBackground: true,
		});
		expect(jobs.find((j) => j.id === `${second}:shell-1`)).toMatchObject({
			kind: "shell",
			title: "bun run check",
			canCancel: false,
			canRemove: true,
		});
	});

	test("19b.1: task RPCs reject with SessionNotFound on unknown sessionId", async () => {
		_setClientForTest(
			new FakeClient() as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		await expect(reg.listTasks("ghost")).rejects.toBeInstanceOf(AppError);
		await expect(reg.cancelTask("ghost", "any")).rejects.toBeInstanceOf(AppError);
		await expect(reg.removeTask("ghost", "any")).rejects.toBeInstanceOf(AppError);
		await expect(reg.promoteTask("ghost", "any")).rejects.toBeInstanceOf(AppError);
	});

	test("19c: startFleet forwards optional prompt and returns started", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		const id = await reg.create();
		const fake = client.createdSessions[0]!;
		expect(await reg.startFleet(id, "review this PR")).toBe(true);
		expect(await reg.startFleet(id)).toBe(true);
		expect(fake.fleetStartCalls).toEqual(["review this PR", undefined]);
	});

	test("19c: startFleet rejects with SessionNotFound on unknown sessionId", async () => {
		_setClientForTest(
			new FakeClient() as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(() => {});
		await expect(reg.startFleet("ghost")).rejects.toBeInstanceOf(AppError);
	});

	// ---------- 22b: tools allow/deny precedence ----------
	//
	// SDK semantics: `availableTools` (allowlist) takes precedence over
	// `excludedTools` (denylist). When the allowlist is non-empty, the
	// SDK ignores `excludedTools` entirely, so we omit it from the
	// config to keep the wire shape honest. When the allowlist is
	// empty, we MUST NOT pass `availableTools: []` — the SDK would
	// interpret that as "allow no tools" rather than "no restriction".

	test("22b: empty allowlist omits availableTools entirely", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(
			() => {},
			() => {},
			() => false,
			() => ["bash"],
			() => [], // empty allowlist
		);
		await reg.create();
		const cfg = client.createdConfigs[0] as Record<string, unknown>;
		expect(cfg.availableTools).toBeUndefined();
		expect(cfg.excludedTools).toEqual(["bash"]);
	});

	test("22b: non-empty allowlist wins over excludedTools (excludedTools omitted)", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(
			() => {},
			() => {},
			() => false,
			() => ["bash"], // denylist
			() => ["str_replace_editor", "playwright/navigate"], // allowlist wins
		);
		await reg.create();
		const cfg = client.createdConfigs[0] as Record<string, unknown>;
		expect(cfg.availableTools).toEqual([
			"str_replace_editor",
			"playwright/navigate",
		]);
		// excludedTools must be absent — passing both would lead callers
		// to think the SDK is honoring the denylist when it isn't.
		expect(cfg.excludedTools).toBeUndefined();
	});

	test("22b: both lists empty -> no tool config in SDK call", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const reg = new SessionRegistry(
			() => {},
			() => {},
			() => false,
			() => [],
			() => [],
		);
		await reg.create();
		const cfg = client.createdConfigs[0] as Record<string, unknown>;
		expect(cfg.availableTools).toBeUndefined();
		expect(cfg.excludedTools).toBeUndefined();
	});

	test("23: registers non-colliding library SDK slash command", async () => {
		const client = new FakeClient();
		_setClientForTest(
			client as unknown as Parameters<typeof _setClientForTest>[0],
		);
		const emitted: SessionEventPayload[] = [];
		const reg = new SessionRegistry((p) => emitted.push(p));
		await reg.create();
		const cfg = client.createdConfigs[0] as {
			commands?: Array<{ name: string; handler: (ctx: { args: string }) => void }>;
		};
		expect(cfg.commands?.map((c) => c.name)).toEqual(["library"]);
		expect(cfg.commands?.some((c) => c.name === "mcp" || c.name === "skills")).toBe(false);
		cfg.commands?.[0]?.handler({ args: "instructions" });
		expect(emitted[0]).toMatchObject({
			eventType: "system.notification",
		});
		expect(String(emitted[0]?.data.content ?? "")).toContain("instructions");
	});
});
