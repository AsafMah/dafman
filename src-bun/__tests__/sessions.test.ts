import { afterEach, describe, expect, test } from "bun:test";
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
	send(args: { prompt: string }): Promise<string>;
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
	};
	lastSentPrompt?: string;
	lastModel?: { model: string; opts?: { reasoningEffort?: string } };
	history: Array<{ type: string; [k: string]: unknown }>;
	currentMode: string;
	currentName: string | null;
	approveAll: boolean;
	approvalsReset: number;
	compactCalls: number;
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
		async send({ prompt }) {
			session.lastSentPrompt = prompt;
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
		},
	};
	return session;
}

class FakeClient {
	createdSessions: FakeSession[] = [];
	createdConfigs: Array<Record<string, unknown>> = [];
	resumedSessions: FakeSession[] = [];
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
	async resumeSession(sessionId: string): Promise<FakeSession> {
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
		});
		// Empty / whitespace-only paths must NOT be forwarded — the SDK
		// would treat them literally instead of falling back to its
		// default cwd.
		await reg.create({ workingDirectory: "   " });
		expect(client.createdConfigs[1]).not.toHaveProperty("workingDirectory");
		await reg.create();
		expect(client.createdConfigs[2]).not.toHaveProperty("workingDirectory");
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
});
