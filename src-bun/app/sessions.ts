// Session registry + event forwarder.
//
// Holds one entry per active SDK session. Subscribing to `session.on`
// fans every event out through a caller-supplied `emit` callback
// (typically `webview.rpc.send.sessionEvent`). On disconnect we drop
// the entry but the SDK handles its own cleanup.
//
// Also owns the per-session "pending callback" map: when the SDK
// calls one of `onPermissionRequest` / `onUserInputRequest` /
// `onElicitationRequest` we store the Promise resolver, push a
// `pendingRequest` message to the renderer, and resolve via the
// `respondToRequest` RPC. Teardown paths (disconnect, delete,
// shutdown) settle every outstanding entry with a typed
// "user-not-available" / "cancel" so the SDK never hangs.

import {
	type CopilotSession,
	type ElicitationContext,
	type ElicitationResult,
	type PermissionRequest,
	type PermissionRequestResult,
	type SessionEvent,
	type UserInputRequest,
	type UserInputResponse,
} from "copilot-sdk-supercharged";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { tryGetClient } from "./client";
import { AppError } from "./errors";
import { log } from "./logging";
import { recordPermission } from "./audit";
import { buildBuiltInTools } from "./tools";
import { searchWorkspaceFiles } from "./fileSearch";
import type {
	ElicitationRequestData,
	PendingRequestPayload,
	PermissionRequestData,
	RespondToRequestParams,
	SendMessageAttachment,
	SessionEventPayload, SessionMetadataSummary, SessionHistoryCompactionResult, SessionMode,
	UserInputRequestData,
	WorkspaceFileMatch,
} from "../rpc";

/// Subset of SDK reasoning effort levels. The SDK's `ReasoningEffort`
/// type alias isn't re-exported from the package root, so we mirror it
/// here. Mismatched values are rejected by the SDK at call time.
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

type Emit = (payload: SessionEventPayload) => void;
type EmitPending = (payload: PendingRequestPayload) => void;

interface Entry {
	session: CopilotSession;
	unsubscribe: () => void;
}

/// A single in-flight SDK callback. The handler returns the Promise
/// (so the SDK blocks) and stores resolve/reject here so
/// `respondToRequest` / `settlePendingForSession` can complete it.
/// Resolution shape is a function the registry holds onto so the
/// renderer can keep its discriminated-union narrow — the bun side
/// converts to the SDK's wider shape (e.g. `approve-once` →
/// `{ kind: "approve-once" }`).
interface PendingEntry {
	sessionId: string;
	kind: "permission" | "userInput" | "elicitation";
	resolve: (response: unknown) => void;
	reject: (err: Error) => void;
	/// Set to `true` by `respondToRequest` / teardown paths so a
	/// second response is a benign no-op instead of double-resolving.
	settled: boolean;
	/// For permission entries: the SDK's `kind` (shell / write / read /
	/// mcp / url / custom-tool / memory / hook). Lifted off the
	/// PendingRequest payload at construction time so the audit log
	/// can record it without re-parsing the SDK shape later.
	permissionKind?: string;
	/// For permission entries: the one-line UI summary the modal
	/// shows. Also recorded in the audit log so an operator can
	/// later see "user denied shell `git push origin master`"
	/// instead of just "permission rejected".
	summary?: string;
}

/// Build a one-line human-readable summary of a permission request
/// from whatever extra fields the SDK happens to put on the runtime
/// object. The SDK's TypeScript type lies about the shape — at
/// runtime each `kind` carries extra payload (a `command` for shell,
/// a `path` for write/read, a `url` for url, etc.). We probe common
/// names and fall back to the kind so the modal always has something
/// to display.
/// Short message line shown above the bespoke per-kind detail block
/// in `PermissionDetails.vue`. Keep these terse — the rich payload
/// (command, path, args, etc.) is rendered by the bespoke component
/// from the `raw` field, so the message line is just a one-glance
/// "what kind of permission and against what target".
function summarizePermission(request: PermissionRequest): string {
	const raw = request as unknown as Record<string, unknown>;
	const path = typeof raw.path === "string" ? raw.path : null;
	const url = typeof raw.url === "string" ? raw.url : null;
	const server = typeof raw.serverName === "string" ? raw.serverName : null;
	const tool = typeof raw.toolName === "string" ? raw.toolName : null;
	switch (request.kind) {
		case "shell":
			return "Run a shell command";
		case "write":
			return path ? `Modify ${path}` : "Modify a file";
		case "read":
			return path ? `Read ${path}` : "Read a file";
		case "url":
			return url ? `Open ${url}` : "Open a URL";
		case "mcp":
			return server && tool
				? `Call ${server} / ${tool}`
				: server
					? `Call MCP server ${server}`
					: "Call an MCP tool";
		case "custom-tool":
			return tool ? `Run ${tool}` : "Run a custom tool";
		case "memory":
			return "Save to memory";
		case "hook":
			return "Run a hook";
	}
}

/// Plain-object copy of an SDK runtime payload. Recursively traverses
/// only enumerable own properties and skips functions / non-JSON
/// types — the wire layer otherwise serializes silently to `{}` on a
/// `Date` or method-bearing object. Good enough for diagnostic
/// display; the renderer never inspects the result.
function toPlainObject(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object") return {};
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (typeof v === "function") continue;
		if (typeof v === "object" && v !== null) {
			try {
				JSON.stringify(v);
				out[k] = v;
			} catch {
				/* skip un-serializable */
			}
		} else {
			out[k] = v;
		}
	}
	return out;
}

export class SessionRegistry {
	private readonly entries = new Map<string, Entry>();

	/// Pending SDK callbacks, keyed by our generated requestId. One
	/// session may have many in flight (the SDK is allowed to re-enter
	/// the handler before a prior one resolves), so we never assume
	/// the queue has at most one. Per-session iteration is
	/// O(pending entries) — fine in practice (rarely > 1).
	private readonly pendingHandlers = new Map<string, PendingEntry>();

	/// Registry-owned per-session "approve every permission" toggle.
	/// Mirrors the SDK's `setApproveAll` (which we still call when
	/// the renderer toggles it, for any SDK-internal short-circuits),
	/// but is the authoritative source for OUR `onPermissionRequest`
	/// handler — without this, a renderer-side toggle wouldn't affect
	/// the dafman handler path.
	private readonly approveAllBySession = new Map<string, boolean>();

	/// `streamingResolver` is called at session create/resume time to
	/// pick the current SDK streaming mode. Decoupled from on-disk
	/// settings so this module stays framework-agnostic (per AGENTS.md
	/// `src-bun/app/` rule). The default `() => true` preserves the
	/// pre-toggle behavior when the registry is constructed by tests
	/// that don't care about the setting.
	constructor(
		private readonly emit: Emit,
		private readonly emitPending: EmitPending = () => {},
		private readonly streamingResolver: () => boolean = () => true,
	) {}

	/// Returns the live `CopilotSession` for an id, or undefined if the
	/// session is unknown. Used by built-in tools (see `app/tools.ts`)
	/// that need to call `session.ui.*` from a tool handler.
	public sessionFor(id: string): CopilotSession | undefined {
		return this.entries.get(id)?.session;
	}

	/// Config shared between `create()` and `resume()` so a resumed
	/// session behaves identically to a freshly created one
	/// (permission handler, streaming mode, etc.). Has to be a method
	/// because handlers close over `this` (registry state).
	private baseSessionConfig(sessionId: () => string) {
		return {
			tools: buildBuiltInTools(this),
			onPermissionRequest: (request: PermissionRequest): Promise<PermissionRequestResult> => {
				const sid = sessionId();
				// Per-session approveAll short-circuit. Returns the SDK's
				// minimal `approve-once` shape — no rule editor here.
				if (this.approveAllBySession.get(sid) === true) {
					return Promise.resolve({ kind: "approve-once" });
				}
				return this.enqueuePending(
					sid,
					"permission",
					(requestId) => {
						const data: PermissionRequestData = {
							kind: request.kind,
							...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
							summary: summarizePermission(request),
							raw: toPlainObject(request),
						};
						this.emitPending({
							sessionId: sid,
							requestId,
							kind: "permission",
							request: data,
						});
					},
					{
						permissionKind: request.kind,
						summary: summarizePermission(request),
					},
				) as Promise<PermissionRequestResult>;
			},
			onUserInputRequest: (request: UserInputRequest): Promise<UserInputResponse> => {
				const sid = sessionId();
				return this.enqueuePending(sid, "userInput", (requestId) => {
					const data: UserInputRequestData = {
						question: request.question,
						...(request.choices ? { choices: request.choices } : {}),
						allowFreeform: request.allowFreeform ?? true,
					};
					this.emitPending({
						sessionId: sid,
						requestId,
						kind: "userInput",
						request: data,
					});
				}) as Promise<UserInputResponse>;
			},
			onElicitationRequest: (context: ElicitationContext): Promise<ElicitationResult> => {
				const sid = sessionId();
				return this.enqueuePending(sid, "elicitation", (requestId) => {
					const data: ElicitationRequestData = {
						message: context.message,
						mode: context.mode ?? "form",
						...(context.elicitationSource
							? { elicitationSource: context.elicitationSource }
							: {}),
						...(context.url ? { url: context.url } : {}),
						...(context.requestedSchema
							? { requestedSchema: toPlainObject(context.requestedSchema) }
							: {}),
					};
					this.emitPending({
						sessionId: sid,
						requestId,
						kind: "elicitation",
						request: data,
					});
				}) as Promise<ElicitationResult>;
			},
			streaming: this.streamingResolver(),
		};
	}

	/// Allocates a PendingEntry + Promise, registers it, runs the
	/// caller's emit closure so the renderer hears about it. Returns
	/// the Promise the SDK awaits.
	private enqueuePending(
		sessionId: string,
		kind: PendingEntry["kind"],
		emit: (requestId: string) => void,
		extras?: { permissionKind?: string; summary?: string },
	): Promise<unknown> {
		const requestId = randomUUID();
		const promise = new Promise<unknown>((resolve, reject) => {
			this.pendingHandlers.set(requestId, {
				sessionId,
				kind,
				resolve,
				reject,
				settled: false,
				...(extras?.permissionKind ? { permissionKind: extras.permissionKind } : {}),
				...(extras?.summary ? { summary: extras.summary } : {}),
			});
		});
		try {
			emit(requestId);
		} catch (err) {
			// Emit failure shouldn't deadlock the SDK. Resolve with a
			// safe "unavailable" so the SDK can move on.
			log.warn("pendingRequest emit threw; cancelling", {
				sessionId,
				requestId,
				kind,
				error: err instanceof Error ? err.message : String(err),
			});
			this.cancelPending(requestId, "emit-failure");
		}
		return promise;
	}

	/// Resolves a pending entry with a typed cancellation. Used by
	/// teardown paths (disconnect, delete, shutdown) and the emit-
	/// failure fallback above.
	private cancelPending(requestId: string, _reason: string): void {
		const entry = this.pendingHandlers.get(requestId);
		if (!entry || entry.settled) return;
		entry.settled = true;
		this.pendingHandlers.delete(requestId);
		const cancellation: unknown =
			entry.kind === "permission"
				? { kind: "user-not-available" }
				: entry.kind === "userInput"
					? { answer: "", wasFreeform: false }
					: { action: "cancel" };
		try {
			entry.resolve(cancellation);
		} catch (err) {
			log.warn("cancelPending resolve threw", {
				requestId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/// Drains every pending entry for a given session, used on
	/// disconnect / delete / shutdown so the SDK never hangs on a
	/// handler whose UI counterpart is gone.
	private settlePendingForSession(sessionId: string, reason: string): void {
		const requestIds: string[] = [];
		for (const [id, entry] of this.pendingHandlers) {
			if (entry.sessionId === sessionId) requestIds.push(id);
		}
		for (const id of requestIds) this.cancelPending(id, reason);
	}

	/// Renderer → bun: respond to a pending callback. Idempotent: a
	/// double-submit on an already-resolved request returns `false`
	/// instead of throwing. Type-narrows the renderer's compact
	/// response shape into the SDK's wider one.
	async respondToRequest(params: RespondToRequestParams): Promise<boolean> {
		const entry = this.pendingHandlers.get(params.requestId);
		if (!entry || entry.settled) {
			log.debug("respondToRequest on already-resolved request", {
				requestId: params.requestId,
			});
			return false;
		}
		if (entry.sessionId !== params.sessionId) {
			log.warn("respondToRequest sessionId mismatch", {
				requestId: params.requestId,
				expected: entry.sessionId,
				got: params.sessionId,
			});
			return false;
		}
		if (entry.kind !== params.response.kind) {
			log.warn("respondToRequest kind mismatch", {
				requestId: params.requestId,
				expected: entry.kind,
				got: params.response.kind,
			});
			return false;
		}
		entry.settled = true;
		this.pendingHandlers.delete(params.requestId);
		let sdkResult: unknown;
		let approvalKind: string | undefined;
		let approvalDomain: string | undefined;
		switch (params.response.kind) {
			case "permission":
				if (params.response.decision === "approveOnce") {
					sdkResult = { kind: "approve-once" };
				} else if (params.response.decision === "reject") {
					sdkResult = { kind: "reject" };
				} else {
					// approveForSession — assemble the full SDK shape.
					// The `approval` field is per-kind:
					//   - commands : { commandIdentifiers: string[] }
					//   - read / write / memory : kind only
					//   - mcp : { serverName, toolName | null }
					//   - mcp-sampling : { serverName }
					//   - custom-tool : { toolName }
					// `domain` is exclusive to `url` permission requests and
					// goes at the top level (not inside `approval`).
					const out: Record<string, unknown> = { kind: "approve-for-session" };
					if (params.response.approval) {
						out.approval = params.response.approval;
						approvalKind = params.response.approval.kind;
					}
					if (params.response.domain) {
						out.domain = params.response.domain;
						approvalDomain = params.response.domain;
					}
					sdkResult = out;
				}
				// Audit log: every permission decision recorded as one
				// line in <userData>/audit/permissions.jsonl. Captures
				// what + when + who + scope without leaking command
				// bodies or paths beyond the bun-derived summary.
				recordPermission({
					sessionId: params.sessionId,
					requestId: params.requestId,
					permissionKind: entry.permissionKind ?? "unknown",
					decision: params.response.decision,
					...(entry.summary ? { summary: entry.summary } : {}),
					...(approvalKind ? { approvalKind } : {}),
					...(approvalDomain ? { approvalDomain } : {}),
				});
				break;
			case "userInput":
				sdkResult = {
					answer: params.response.answer,
					wasFreeform: params.response.wasFreeform,
				};
				break;
			case "elicitation":
				sdkResult = {
					action: params.response.action,
					...(params.response.content ? { content: params.response.content } : {}),
				};
				break;
		}
		try {
			entry.resolve(sdkResult);
		} catch (err) {
			log.warn("respondToRequest resolve threw", {
				requestId: params.requestId,
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
		return true;
	}

	async create(opts: { workingDirectory?: string } = {}): Promise<string> {
		const client = tryGetClient();
		// Capture a placeholder sessionId for early events that fire before
		// `client.createSession` resolves. We rebind once we know the real
		// id (a few microseconds later, since the SDK's `session.start`
		// event fires during creation).
		let resolvedSessionId: string | null = null;
		const earlyForward = (event: SessionEvent) => {
			this.forward(resolvedSessionId ?? "pending", event);
		};
		const wd = opts.workingDirectory?.trim();
		const session = await client.createSession({
			...this.baseSessionConfig(() => resolvedSessionId ?? "pending"),
			onEvent: earlyForward,
			...(wd ? { workingDirectory: wd } : {}),
		});
		const sessionId = session.sessionId;
		resolvedSessionId = sessionId;
		// `onEvent` is one-shot for the early window; switch to `session.on`
		// for the live stream and grab its unsubscribe handle.
		const unsubscribe = session.on((event) => {
			this.forward(sessionId, event);
		});
		this.entries.set(sessionId, { session, unsubscribe });
		log.info("session created", { sessionId, workingDirectory: wd ?? null });
		return sessionId;
	}

	/// Resumes a previously-created session by id. After resume succeeds
	/// we immediately replay `session.getMessages()` through the same
	/// forwarder so the frontend reducer rebuilds its transcript from
	/// scratch — the SDK's `session.on` does NOT replay history on its
	/// own, so without this the restored pane would render empty until
	/// the next turn.
	///
	/// Idempotent: a duplicate resume of an already-registered id is a
	/// no-op (returns the same id).
	async resume(
		sessionId: string,
		opts: { model?: string; reasoningEffort?: string; workingDirectory?: string } = {},
	): Promise<string> {
		if (this.entries.has(sessionId)) {
			log.debug("resume on already-registered session, returning id", {
				sessionId,
			});
			return sessionId;
		}
		const client = tryGetClient();
		let resolvedSessionId: string | null = null;
		const earlyForward = (event: SessionEvent) => {
			this.forward(resolvedSessionId ?? sessionId, event);
		};
		let session: CopilotSession;
		try {
			session = await client.resumeSession(sessionId, {
				...this.baseSessionConfig(() => resolvedSessionId ?? sessionId),
				onEvent: earlyForward,
				...(opts.model ? { model: opts.model } : {}),
				...(opts.reasoningEffort
					? { reasoningEffort: opts.reasoningEffort as ReasoningEffort }
					: {}),
				...(opts.workingDirectory ? { workingDirectory: opts.workingDirectory } : {}),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn("session resume failed", { sessionId, error: message });
			throw AppError.sdk(message);
		}
		const actualId = session.sessionId;
		resolvedSessionId = actualId;
		const unsubscribe = session.on((event) => {
			this.forward(actualId, event);
		});
		this.entries.set(actualId, { session, unsubscribe });
		// Hydrate transcript. Failures here aren't fatal — the session is
		// connected and will receive live events; we just won't have the
		// scrollback.
		try {
			const history = await session.getMessages();
			for (const event of history) this.forward(actualId, event);
			log.info("session resumed", { sessionId: actualId, historyCount: history.length });
		} catch (err) {
			log.warn("failed to hydrate session history", {
				sessionId: actualId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return actualId;
	}

	async setWorkingDirectory(
		sessionId: string,
		workingDirectory: string,
		baseWorkingDirectory?: string | null,
	): Promise<string> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		const requested = workingDirectory.trim();
		if (!requested) throw AppError.sdk("workingDirectory is required");
		const base = baseWorkingDirectory?.trim() || process.cwd();
		const next = isAbsolute(requested) ? requested : resolve(base, requested);
		let info: Awaited<ReturnType<typeof stat>>;
		try {
			info = await stat(next);
		} catch {
			throw AppError.sdk(`workingDirectory does not exist: ${next}`);
		}
		if (!info.isDirectory()) {
			throw AppError.sdk(`workingDirectory is not a directory: ${next}`);
		}

		this.settlePendingForSession(sessionId, "session working directory changed");
		this.entries.delete(sessionId);
		entry.unsubscribe();
		try {
			await entry.session.disconnect();
		} catch (err) {
			log.warn("disconnect-before-cwd-change threw", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			});
		}

		const client = tryGetClient();
		let resumed: CopilotSession;
		try {
			resumed = await client.resumeSession(sessionId, {
				...this.baseSessionConfig(() => sessionId),
				workingDirectory: next,
			});
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
		const actualId = resumed.sessionId;
		const unsubscribe = resumed.on((event) => {
			this.forward(actualId, event);
		});
		this.entries.set(actualId, { session: resumed, unsubscribe });
		log.info("session working directory changed", {
			sessionId: actualId,
			workingDirectory: next,
		});
		return next;
	}

	async list(): Promise<SessionMetadataSummary[]> {
		const client = tryGetClient();
		const items = await client.listSessions();
		return items.map((m) => ({
			sessionId: m.sessionId,
			startTime:
				m.startTime instanceof Date
					? m.startTime.toISOString()
					: String(m.startTime),
			modifiedTime:
				m.modifiedTime instanceof Date
					? m.modifiedTime.toISOString()
					: String(m.modifiedTime),
			summary: m.summary,
			isRemote: m.isRemote,
			cwd: m.context?.cwd,
			repository: m.context?.repository,
			branch: m.context?.branch,
		}));
	}

	/// Permanently deletes the CLI-side session data. If the session is
	/// currently open in this app, disconnect it first so the SDK can
	/// release its session handle cleanly before deletion.
	async deleteCliSession(sessionId: string): Promise<string> {
		// Settle any pending callbacks first so the SDK doesn't hang
		// awaiting a response that will never come once the session is
		// gone.
		this.settlePendingForSession(sessionId, "session deleted");
		const entry = this.entries.get(sessionId);
		if (entry) {
			this.entries.delete(sessionId);
			entry.unsubscribe();
			try {
				await entry.session.disconnect();
			} catch (err) {
				log.warn("disconnect-before-delete threw", {
					sessionId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		this.approveAllBySession.delete(sessionId);
		const client = tryGetClient();
		try {
			await client.deleteSession(sessionId);
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
		log.info("session deleted", { sessionId });
		return sessionId;
	}

	private forward(sessionId: string, event: SessionEvent): void {
		const eventType = event.type;
		const isDiagnostic =
			eventType === "assistant.reasoning" ||
			eventType === "assistant.reasoning_delta" ||
			eventType === "session.error" ||
			eventType === "session.warning" ||
			eventType === "model.call_failure";
		if (isDiagnostic) {
			log.debug("session event", {
				sessionId,
				eventType,
				event,
			});
		} else {
			log.trace("session event", { sessionId, eventType });
		}
		// The SDK wraps each event as { type, data, id, parentId, ts, ... }.
		// The Rust port forwarded only `event.data`, and our `chatEvents.ts`
		// reads fields like `payload.data.messageId` directly off the
		// payload. Unwrap the SDK's nested `data` so the frontend sees the
		// same shape it always did, but also lift envelope-level fields
		// (`agentId`, `id`, `timestamp`) so the frontend can correlate
		// sub-agent activity without us mirroring every variant.
		const envelope = event as unknown as {
			data?: unknown;
			agentId?: string;
			id?: string;
			timestamp?: string;
		};
		// SDK is typed as `data: Record<string, unknown>` but we can't
		// trust the wire — a malformed `null` / array / primitive would
		// silently coerce to `{}` and downstream reducers (which read
		// `data.messageId`, `data.toolCallId`, …) would see an empty
		// payload instead of the real one. Reject anything that isn't a
		// plain object and warn so the issue surfaces in diagnostics.
		const rawData = envelope.data;
		const isPlainObject =
			rawData !== null &&
			typeof rawData === "object" &&
			!Array.isArray(rawData);
		if (!isPlainObject && rawData !== undefined) {
			log.warn("dropping malformed event.data on forward", {
				sessionId,
				eventType,
				dataType: rawData === null ? "null" : Array.isArray(rawData) ? "array" : typeof rawData,
			});
		}
		const data = (isPlainObject ? rawData : {}) as Record<string, unknown>;
		try {
			this.emit({
				sessionId,
				eventType,
				data,
				...(envelope.agentId ? { agentId: envelope.agentId } : {}),
				...(envelope.id ? { eventId: envelope.id } : {}),
				...(envelope.timestamp ? { timestamp: envelope.timestamp } : {}),
			});
		} catch (err) {
			log.warn("failed to forward session event", {
				sessionId,
				eventType,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	async send(
		sessionId: string,
		text: string,
		mode?: "enqueue" | "immediate",
		attachments?: SendMessageAttachment[],
	): Promise<string> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		if (attachments && attachments.length > 0) {
			log.info("session.send with attachments", {
				sessionId,
				attachmentCount: attachments.length,
				kinds: attachments.map((a) => a.type),
				// Log just the type+displayName so we don't dump base64
				// blobs into the log file.
				names: attachments.map((a) =>
					"displayName" in a ? a.displayName : null,
				),
			});
		}
		try {
			return await entry.session.send({
				prompt: text,
				...(mode ? { mode } : {}),
				...(attachments && attachments.length > 0
					? { attachments: attachments as Parameters<typeof entry.session.send>[0]["attachments"] }
					: {}),
			});
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	/// File-typeahead search backing the composer's `@file` mention
	/// plugin. Resolves the session's working directory and delegates
	/// to the shared workspace-files index (`app/fileSearch.ts`).
	async searchWorkspaceFiles(
		sessionId: string,
		query: string,
		limit = 40,
	): Promise<WorkspaceFileMatch[]> {
		const entry = this.entries.get(sessionId);
		if (!entry) return [];
		const cwd = await this.cwdFor(sessionId);
		if (!cwd) return [];
		return searchWorkspaceFiles(cwd, query, limit);
	}

	/// Resolve the session's working directory. Tries the workspace
	/// catalog first (cheap, in-memory), then falls back to
	/// `session.getWorkingDirectory()` if the SDK exposes it. Returns
	/// undefined when the session has no associated cwd (which is
	/// rare — most sessions are created with one).
	private async cwdFor(sessionId: string): Promise<string | undefined> {
		const client = tryGetClient();
		if (!client) return undefined;
		try {
			const summaries = await client.listSessions();
			const summary = summaries.find((s) => s.sessionId === sessionId);
			if (summary?.cwd) return summary.cwd;
		} catch {
			// Ignore catalog-read failures; the cwd is best-effort.
		}
		return undefined;
	}

	async abort(sessionId: string): Promise<string> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			await entry.session.abort();
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
		return "Aborted";
	}

	async setModel(
		sessionId: string,
		model: string,
		reasoningEffort: string | null,
	): Promise<string> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		const opts = reasoningEffort
			? { reasoningEffort: reasoningEffort as ReasoningEffort }
			: undefined;
		try {
			await entry.session.setModel(model, opts);
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
		return model;
	}

	async getMode(sessionId: string): Promise<SessionMode> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = await entry.session.rpc.mode.get();
			if (
				result !== "interactive" &&
				result !== "plan" &&
				result !== "autopilot"
			) {
				throw AppError.sdk(
					`unexpected session mode from SDK: ${JSON.stringify(result)}`,
				);
			}
			return result;
		} catch (err) {
			if (err instanceof AppError) throw err;
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async setMode(sessionId: string, mode: SessionMode): Promise<SessionMode> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			await entry.session.rpc.mode.set({ mode });
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
		return mode;
	}

	async getName(sessionId: string): Promise<string | null> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = await entry.session.rpc.name.get();
			const name = (result as { name?: unknown }).name;
			if (typeof name === "string") return name;
			if (name === null || name === undefined) return null;
			throw AppError.sdk(
				`unexpected session name from SDK: ${JSON.stringify(name)}`,
			);
		} catch (err) {
			if (err instanceof AppError) throw err;
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async setName(sessionId: string, name: string): Promise<string> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			await entry.session.rpc.name.set({ name });
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
		return name;
	}

	async compactHistory(
		sessionId: string,
	): Promise<SessionHistoryCompactionResult> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = (await entry.session.rpc.history.compact()) as {
				success?: boolean;
				tokensFreed?: number;
				messagesRemoved?: number;
			};
			return {
				success: result.success ?? true,
				tokensFreed:
					typeof result.tokensFreed === "number" ? result.tokensFreed : null,
				messagesRemoved:
					typeof result.messagesRemoved === "number"
						? result.messagesRemoved
						: null,
			};
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	/// Wraps `session.history.truncate`. The given event AND all later
	/// events are removed; callers typically follow this with a fresh
	/// `sendMessage` (Edit / Retry flows).
	async truncateHistory(
		sessionId: string,
		eventId: string,
	): Promise<{ eventsRemoved: number }> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = (await entry.session.rpc.history.truncate({
				eventId,
			})) as { eventsRemoved?: number };
			return { eventsRemoved: result.eventsRemoved ?? 0 };
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	/// Wraps `sessions.fork`. Returns the new session id; we do NOT
	/// auto-register it — the renderer opens it via the regular
	/// resume flow once it has the id (keeps lifecycle uniform).
	async fork(
		sessionId: string,
		toEventId?: string,
	): Promise<{ sessionId: string }> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		const client = tryGetClient();
		if (!client) throw AppError.clientNotStarted();
		try {
			const result = (await client.rpc.sessions.fork({
				sessionId,
				...(toEventId ? { toEventId } : {}),
			})) as { sessionId?: string };
			if (!result.sessionId) {
				throw AppError.sdk("fork: SDK returned no sessionId");
			}
			return { sessionId: result.sessionId };
		} catch (err) {
			if (err instanceof AppError) throw err;
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async setApproveAll(sessionId: string, enabled: boolean): Promise<boolean> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		// Source of truth for OUR onPermissionRequest handler. Mirror to
		// the SDK so any SDK-internal short-circuits that respect this
		// flag stay consistent.
		this.approveAllBySession.set(sessionId, enabled);
		try {
			const result = (await entry.session.rpc.permissions.setApproveAll({
				enabled,
			})) as { success?: boolean };
			return result.success ?? true;
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	/// Lists session skills (name, description, enabled, source).
	/// The popover renders a toggle per skill so the user can flip
	/// any skill on/off mid-session. Errors are wrapped — skill APIs
	/// are @experimental in the SDK; if they aren't wired the renderer
	/// surfaces a toast and falls back to an empty list.
	async listSkills(sessionId: string): Promise<Array<{
		name: string;
		description: string;
		source: string;
		enabled: boolean;
		userInvocable: boolean;
	}>> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = (await entry.session.rpc.skills.list()) as {
				skills?: Array<{
					name?: unknown;
					description?: unknown;
					source?: unknown;
					enabled?: unknown;
					userInvocable?: unknown;
				}>;
			};
			const skills = result.skills ?? [];
			return skills
				.filter((s) => typeof s.name === "string")
				.map((s) => ({
					name: String(s.name),
					description: typeof s.description === "string" ? s.description : "",
					source: typeof s.source === "string" ? s.source : "",
					enabled: s.enabled === true,
					userInvocable: s.userInvocable === true,
				}));
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async setSkillEnabled(
		sessionId: string,
		name: string,
		enabled: boolean,
	): Promise<boolean> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			if (enabled) {
				await entry.session.rpc.skills.enable({ name });
			} else {
				await entry.session.rpc.skills.disable({ name });
			}
			return true;
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	/// Per-session usage metrics. Returns the raw SDK response shape
	/// (totals + per-model + token details) without filtering — the
	/// renderer cherry-picks what to display.
	async getUsageMetrics(sessionId: string): Promise<Record<string, unknown>> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			return (await entry.session.rpc.usage.getMetrics()) as Record<
				string,
				unknown
			>;
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async resetApprovals(sessionId: string): Promise<boolean> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = (await entry.session.rpc.permissions.resetSessionApprovals()) as {
				success?: boolean;
			};
			return result.success ?? true;
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async disconnect(sessionId: string): Promise<string> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		// Settle pending callbacks BEFORE tearing down the session so
		// the SDK never sees a hung onPermissionRequest / etc.
		this.settlePendingForSession(sessionId, "session disconnected");
		this.entries.delete(sessionId);
		this.approveAllBySession.delete(sessionId);
		entry.unsubscribe();
		try {
			await entry.session.disconnect();
		} catch (err) {
			log.warn("session disconnect threw", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		log.info("session closed", { sessionId });
		return "Session closed successfully";
	}

	async shutdownAll(): Promise<void> {
		const ids = [...this.entries.keys()];
		for (const id of ids) {
			try {
				await this.disconnect(id);
			} catch {
				/* best-effort */
			}
		}
	}
}
