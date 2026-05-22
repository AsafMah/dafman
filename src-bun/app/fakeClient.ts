/// In-process mock of the Copilot SDK for E2E tests.
///
/// Mirrors the surface `src-bun/app/sessions.ts` calls — NOT a full
/// CopilotClient impl. Tests assert behavior end-to-end; this fake
/// provides:
///
/// - `createSession` / `resumeSession` returning fake CopilotSession
///   instances with deterministic ids (`fake-session-N`).
/// - `listSessions` / `deleteSession` over an in-memory catalog.
/// - `getSessionMetadata` returns the per-session context (cwd, …)
///   so dafman's cwd-persistence logic can re-discover after a
///   process restart.
/// - `listModels` returning two canned models.
/// - Per-session `send()` triggers a scripted reply via injected
///   event scripts (defaults to a simple assistant.message reply).
/// - `session.on(cb)` fan-out for scripted events.
/// - `getMessages()` returns the per-session event log so resume
///   replays correctly.
///
/// **Catalog persistence**: session state (id + cwd) is persisted
/// to a JSON file under the caller-supplied `catalogPath`. This is
/// what lets a fresh bun subprocess (e.g. the second half of a
/// cwd-persistence E2E) find the sessions the first subprocess
/// created. In-memory event history is NOT persisted — resumes
/// just rebuild an empty live session, which matches what the
/// real SDK does when its CLI is restarted.
///
/// Test scripts can replace the default response by calling
/// `setSendScript(scriptFn)` on the mock client.
///
/// All ids / timestamps / event shapes match the SDK wire format
/// so the rest of the dafman pipeline (reducer, audit, log) sees
/// indistinguishable input.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
			plan: {
				read: async () => ({ exists: false, content: null, path: null }),
				update: async () => undefined,
				delete: async () => undefined,
			},
			mcp: {
				list: async () => ({ servers: [] }),
				enable: async () => undefined,
				disable: async () => undefined,
				reload: async () => undefined,
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
	private readonly catalogPath?: string;

	constructor(opts: { catalogPath?: string } = {}) {
		this.catalogPath = opts.catalogPath;
		this.loadCatalog();
	}

	private loadCatalog(): void {
		if (!this.catalogPath || !existsSync(this.catalogPath)) return;
		try {
			const raw = readFileSync(this.catalogPath, "utf8");
			const parsed = JSON.parse(raw) as {
				nextSeq?: number;
				sessions?: Array<{ sessionId: string; cwd?: string; model?: string }>;
			};
			if (typeof parsed.nextSeq === "number") this.nextSeq = parsed.nextSeq;
			for (const s of parsed.sessions ?? []) {
				this.sessions.set(s.sessionId, {
					sessionId: s.sessionId,
					...(s.cwd ? { cwd: s.cwd } : {}),
					...(s.model ? { model: s.model } : {}),
					listeners: new Set(),
					history: [],
					disposed: false,
				});
			}
		} catch {
			/* corrupted catalog → start fresh */
		}
	}

	private saveCatalog(): void {
		if (!this.catalogPath) return;
		try {
			mkdirSync(dirname(this.catalogPath), { recursive: true });
			const data = {
				nextSeq: this.nextSeq,
				sessions: [...this.sessions.values()].map((s) => ({
					sessionId: s.sessionId,
					...(s.cwd ? { cwd: s.cwd } : {}),
					...(s.model ? { model: s.model } : {}),
				})),
			};
			writeFileSync(this.catalogPath, JSON.stringify(data, null, 2));
		} catch {
			/* non-fatal */
		}
	}

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
		this.saveCatalog();
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

	async resumeSession(sessionId: string, opts: { workingDirectory?: string; onEvent?: (e: Record<string, unknown>) => void; onPermissionRequest?: (req: unknown) => Promise<unknown> } = {}): Promise<FakeCopilotSession> {
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
			this.saveCatalog();
		}
		if (opts.onPermissionRequest) state.onPermissionRequest = opts.onPermissionRequest;
		// Resume keeps the persisted cwd unless caller explicitly
		// overrides — same semantics dafman expects from the real SDK.
		if (opts.workingDirectory) {
			state.cwd = opts.workingDirectory;
			this.saveCatalog();
		}
		const session = new FakeCopilotSession(state, this.sendScriptRef);
		if (opts.onEvent) state.listeners.add(opts.onEvent);
		return session;
	}

	async listSessions(): Promise<Array<{ sessionId: string; startTime: Date; modifiedTime: Date; summary?: string; isRemote: boolean; context?: { cwd?: string } }>> {
		const now = new Date();
		return [...this.sessions.values()].map((s) => ({
			sessionId: s.sessionId,
			startTime: now,
			modifiedTime: now,
			isRemote: false,
			...(s.cwd ? { context: { cwd: s.cwd } } : {}),
		}));
	}

	async getSessionMetadata(sessionId: string): Promise<{ sessionId: string; startTime: Date; modifiedTime: Date; isRemote: boolean; context?: { cwd?: string } } | undefined> {
		const s = this.sessions.get(sessionId);
		if (!s) return undefined;
		const now = new Date();
		return {
			sessionId: s.sessionId,
			startTime: now,
			modifiedTime: now,
			isRemote: false,
			...(s.cwd ? { context: { cwd: s.cwd } } : {}),
		};
	}

	async deleteSession(sessionId: string): Promise<void> {
		this.sessions.delete(sessionId);
		this.saveCatalog();
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
			tools: {
				list: async () => ({
					tools: [
						{ name: "bash", description: "Run shell commands" },
						{ name: "str_replace_editor", description: "Edit files" },
						{ name: "grep", description: "Search file contents" },
					],
				}),
			},
			account: {
				getQuota: async () => ({
					quotaSnapshots: {
						chat: {
							isUnlimitedEntitlement: false,
							entitlementRequests: 300,
							usedRequests: 42,
							remainingPercentage: 86,
							overage: 0,
							resetDate: "2026-06-01T00:00:00.000Z",
						},
						premium_interactions: {
							isUnlimitedEntitlement: false,
							entitlementRequests: 50,
							usedRequests: 47,
							remainingPercentage: 6,
							overage: 0,
							resetDate: "2026-06-01T00:00:00.000Z",
						},
					},
				}),
			},
		};
	}
}
