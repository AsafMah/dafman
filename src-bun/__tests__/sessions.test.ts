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
	lastSentPrompt?: string;
	lastModel?: { model: string; opts?: { reasoningEffort?: string } };
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
});
