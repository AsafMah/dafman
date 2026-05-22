/// In-process mock of the Copilot SDK for E2E tests.
///
/// Mirrors the surface `src-bun/app/sessions.ts` calls — NOT a full
/// CopilotClient impl. Tests assert behavior end-to-end; this fake
/// provides:
///
/// - `createSession` / `resumeSession` returning fake CopilotSession
///   instances with deterministic ids (`fake-session-N`).
/// - `listSessions` / `deleteSession` over an in-memory catalog.
/// - `listModels` returning two canned models.
/// - Per-session `send()` triggers a scripted reply via injected
///   event scripts (defaults to a simple assistant.message reply).
/// - `session.on(cb)` fan-out for scripted events.
/// - `getMessages()` returns the per-session event log so resume
///   replays correctly.
///
/// Test scripts can replace the default response by calling
/// `setSendScript(scriptFn)` on the mock client. The scriptFn
/// receives the send args + a `push(event)` callback and is free
/// to emit any sequence of events.
///
/// All ids / timestamps / event shapes match the SDK wire format
/// so the rest of the dafman pipeline (reducer, audit, log) sees
/// indistinguishable input.

import { randomUUID } from "node:crypto";

interface FakeSessionState {
	sessionId: string;
	cwd?: string;
	model?: string;
	listeners: Set<(event: Record<string, unknown>) => void>;
	history: Record<string, unknown>[];
	disposed: boolean;
	/// `onPermissionRequest` from `baseSessionConfig`. Captured at
	/// create-time so test scripts can invoke the handler to drive
	/// permission flows.
	onPermissionRequest?: (req: unknown) => Promise<unknown>;
}

export type SendScript = (
	args: { prompt: string; mode?: string; attachments?: unknown[] },
	push: (event: Record<string, unknown>) => void,
	state: FakeSessionState,
) => void | Promise<void>;

function defaultSendScript(
	args: { prompt: string },
	push: (event: Record<string, unknown>) => void,
): void {
	// SDK event envelope is { type, data, id, timestamp }. Reducer
	// expects messageId on data.* + content on data.content.
	const ts = new Date().toISOString();
	push({
		type: "user.message",
		id: randomUUID(),
		timestamp: ts,
		data: { messageId: randomUUID(), content: args.prompt },
	});
	push({
		type: "assistant.message",
		id: randomUUID(),
		timestamp: ts,
		data: { messageId: randomUUID(), content: `ok: ${args.prompt}` },
	});
	push({
		type: "assistant.turn_complete",
		id: randomUUID(),
		timestamp: ts,
		data: {},
	});
}

class FakeCopilotSession {
	public readonly sessionId: string;
	private readonly state: FakeSessionState;
	private readonly scriptRef: { current: SendScript };
	public readonly rpc: Record<string, Record<string, (args?: unknown) => Promise<unknown>>>;

	constructor(state: FakeSessionState, scriptRef: { current: SendScript }) {
		this.sessionId = state.sessionId;
		this.state = state;
		this.scriptRef = scriptRef;
		// Stub rpc surface — every namespace returns empty/defaulted
		// payloads. Individual flows can override via setSendScript.
		this.rpc = {
			mode: {
				get: async () => ({ mode: "interactive" }),
				set: async () => undefined,
			},
			name: {
				get: async () => ({ name: null }),
				set: async () => undefined,
			},
			history: {
				compact: async () => ({ removed: 0 }),
				truncate: async () => ({ removed: 0 }),
			},
			permissions: {
				setApproveAll: async () => ({ ok: true }),
				resetSessionApprovals: async () => ({ cleared: 0 }),
			},
			skills: {
				list: async () => ({ skills: [] }),
				enable: async () => undefined,
				disable: async () => undefined,
			},
			usage: {
				getMetrics: async () => ({ requests: 0, totalTokens: 0 }),
			},
			sessions: {
				fork: async () => ({ sessionId: `fake-session-${Date.now()}` }),
			},
		};
	}

	on(callback: (event: Record<string, unknown>) => void): () => void {
		this.state.listeners.add(callback);
		return () => this.state.listeners.delete(callback);
	}

	async send(args: { prompt: string; mode?: string; attachments?: unknown[] }): Promise<void> {
		const push = (event: Record<string, unknown>) => {
			this.state.history.push(event);
			for (const cb of this.state.listeners) cb(event);
		};
		await this.scriptRef.current(args, push, this.state);
	}

	async getMessages(): Promise<Record<string, unknown>[]> {
		return [...this.state.history];
	}

	async abort(): Promise<void> {
		// no-op for the fake; tests that need abort semantics push a
		// custom script.
	}

	async disconnect(): Promise<void> {
		this.state.disposed = true;
		this.state.listeners.clear();
	}

	async setModel(model: string, _opts?: Record<string, unknown>): Promise<void> {
		this.state.model = model;
	}
}

export class FakeCopilotClient {
	private readonly sessions = new Map<string, FakeSessionState>();
	private readonly sendScriptRef: { current: SendScript } = { current: defaultSendScript };
	private nextSeq = 1;

	/// Test seam: drive a permission request through a live session's
	/// captured onPermissionRequest handler. Returns the handler's
	/// resolved value so tests can assert the decision shape.
	async triggerPermission(sessionId: string, request: unknown): Promise<unknown> {
		const state = this.sessions.get(sessionId);
		if (!state) throw new Error(`fake session not found: ${sessionId}`);
		if (!state.onPermissionRequest) {
			throw new Error(`session ${sessionId} has no onPermissionRequest handler`);
		}
		return state.onPermissionRequest(request);
	}

	setSendScript(script: SendScript): void {
		this.sendScriptRef.current = script;
	}

	resetSendScript(): void {
		this.sendScriptRef.current = defaultSendScript;
	}

	async start(): Promise<void> {
		/* no-op */
	}

	async stop(): Promise<Error[]> {
		this.sessions.clear();
		return [];
	}

	async createSession(opts: { workingDirectory?: string; onEvent?: (e: Record<string, unknown>) => void; onPermissionRequest?: (req: unknown) => Promise<unknown> } = {}): Promise<FakeCopilotSession> {
		const sessionId = `fake-session-${this.nextSeq++}`;
		const state: FakeSessionState = {
			sessionId,
			...(opts.workingDirectory ? { cwd: opts.workingDirectory } : {}),
			listeners: new Set(),
			history: [],
			disposed: false,
			...(opts.onPermissionRequest ? { onPermissionRequest: opts.onPermissionRequest } : {}),
		};
		this.sessions.set(sessionId, state);
		const session = new FakeCopilotSession(state, this.sendScriptRef);
		if (opts.onEvent) {
			state.listeners.add(opts.onEvent);
		}
		// Push a session-ready event so dafman's reducer sees one.
		const ts = new Date().toISOString();
		const ready = {
			type: "session.ready",
			id: randomUUID(),
			timestamp: ts,
			data: { sessionId },
		};
		state.history.push(ready);
		for (const cb of state.listeners) cb(ready);
		return session;
	}

	async resumeSession(sessionId: string, opts: { workingDirectory?: string; onEvent?: (e: Record<string, unknown>) => void } = {}): Promise<FakeCopilotSession> {
		let state = this.sessions.get(sessionId);
		if (!state) {
			state = {
				sessionId,
				...(opts.workingDirectory ? { cwd: opts.workingDirectory } : {}),
				listeners: new Set(),
				history: [],
				disposed: false,
			};
			this.sessions.set(sessionId, state);
		}
		const session = new FakeCopilotSession(state, this.sendScriptRef);
		if (opts.onEvent) state.listeners.add(opts.onEvent);
		return session;
	}

	async listSessions(): Promise<Array<{ sessionId: string; cwd?: string; context?: { cwd?: string } }>> {
		return [...this.sessions.values()].map((s) => ({
			sessionId: s.sessionId,
			...(s.cwd ? { cwd: s.cwd, context: { cwd: s.cwd } } : {}),
		}));
	}

	async deleteSession(sessionId: string): Promise<void> {
		this.sessions.delete(sessionId);
	}

	async listModels(): Promise<Array<{ id: string; name: string; vendor: string; reasoning?: boolean }>> {
		return [
			{ id: "fake-gpt-5", name: "Fake GPT-5", vendor: "fake", reasoning: false },
			{ id: "fake-claude", name: "Fake Claude", vendor: "fake", reasoning: true },
		];
	}

	get rpc(): Record<string, Record<string, (args?: unknown) => Promise<unknown>>> {
		return {
			sessions: {
				fork: async (args) => {
					const opts = (args ?? {}) as { sessionId?: string };
					const src = opts.sessionId ? this.sessions.get(opts.sessionId) : undefined;
					const newId = `fake-session-${this.nextSeq++}`;
					this.sessions.set(newId, {
						sessionId: newId,
						...(src?.cwd ? { cwd: src.cwd } : {}),
						listeners: new Set(),
						history: src ? [...src.history] : [],
						disposed: false,
					});
					return { sessionId: newId };
				},
			},
		};
	}
}
