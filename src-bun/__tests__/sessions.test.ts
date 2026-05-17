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
	currentMode: string;
	currentName: string | null;
	approveAll: boolean;
	approvalsReset: number;
	compactCalls: number;
}

function makeFakeSession(sessionId: string): FakeSession {
	let listener: Handler | null = null;
	const session: FakeSession = {
		sessionId,
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
	async createSession(): Promise<FakeSession> {
		const s = makeFakeSession(`sess-${this.createdSessions.length + 1}`);
		this.createdSessions.push(s);
		return s;
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
});
