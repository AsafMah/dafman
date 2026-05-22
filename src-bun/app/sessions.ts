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
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { tryGetClient } from "./client";
import { AppError } from "./errors";
import { log } from "./logging";
import { PendingRequestQueue } from "./pendingRequests";
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

/// S5: cap replay of `session.getMessages()` history at this many
/// events. The SDK returns the full transcript without pagination —
/// long-lived sessions can produce thousands of events. The renderer
/// reducer reconstructs the visible state from this slice; events
/// older than the cap are still on disk and could be re-fetched later
/// if needed.
const HISTORY_REPLAY_CAP = 500;

/// S5: yield to the event loop between batches of this size while
/// replaying. Avoids blocking IPC and lets the renderer paint between
/// chunks.
const HISTORY_REPLAY_BATCH = 50;

/// S1: per-session disconnect timeout during `shutdownAll`. If the
/// SDK's `session.disconnect()` doesn't resolve in this window we
/// force-clear the entry and move on — the OS process exit handles
/// the rest.
const SHUTDOWN_TIMEOUT_MS = 2000;

type Emit = (payload: SessionEventPayload) => void;
type EmitPending = (payload: PendingRequestPayload) => void;

interface Entry {
	session: CopilotSession;
	unsubscribe: () => void;
	/// Absolute working directory passed to `createSession` /
	/// `resumeSession`. Cached here because the SDK doesn't expose
	/// `session.workingDirectory` or a getter — and the workspace
	/// catalog (`client.listSessions()`) doesn't always contain a
	/// freshly-created session or its `cwd` field. The composer's
	/// @file picker needs this to resolve relative paths.
	workingDirectory?: string;
}

/// Pending callback shape + queue lifecycle now live in
/// `./pendingRequests.ts`; this module composes one queue per
/// registry. See `PendingRequestQueue` for the typed cancellation
/// semantics and the registry contract around teardown ordering.

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
	// SDK shape varies by kind. Field names verified via the CLI
	// changelog notes (1.0.44+) and runtime inspection: shell uses
	// `fullCommandText` (not `command`), write/read use `fileName`
	// (not `path`). Keep the older aliases as fallbacks in case
	// any SDK upgrade renames them again.
	const path =
		typeof raw.fileName === "string" ? raw.fileName :
		typeof raw.path === "string" ? raw.path : null;
	const command =
		typeof raw.fullCommandText === "string" ? raw.fullCommandText :
		typeof raw.command === "string" ? raw.command :
		typeof raw.cmd === "string" ? raw.cmd : null;
	const url = typeof raw.url === "string" ? raw.url : null;
	const server = typeof raw.serverName === "string" ? raw.serverName : null;
	const tool = typeof raw.toolName === "string" ? raw.toolName : null;
	switch (request.kind) {
		case "shell":
			return command ? `Run \`${command}\`` : "Run a shell command";
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

	/// Pending SDK callbacks. Owned by the queue subobject so the
	/// extraction can be unit-tested in isolation and so the registry
	/// stays focused on session lifecycle. The queue knows nothing
	/// about approve-all (the handler short-circuits before reaching
	/// it) or the registry's entry map (callers must call
	/// `pending.settleForSession` BEFORE deleting their entry — see
	/// `removeEntry`).
	private readonly pending = new PendingRequestQueue();

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
		private readonly excludedToolsResolver: () => string[] = () => [],
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
			// Auto-discover workspace-level MCP server configs (.mcp.json,
			// .vscode/mcp.json) and skill directories. Defaults to false
			// in the SDK, which meant a user dropping an .mcp.json in
			// their repo saw nothing. Custom instruction files
			// (.github/copilot-instructions.md, AGENTS.md, etc.) are
			// loaded regardless. Explicit `mcpServers` / `skillDirectories`
			// would take precedence on collision — we don't supply any
			// yet, so discovery is the only source.
			enableConfigDiscovery: true,
			tools: buildBuiltInTools(this),
			onPermissionRequest: (request: PermissionRequest): Promise<PermissionRequestResult> => {
				const sid = sessionId();
				// Per-session approveAll short-circuit. Returns the SDK's
				// minimal `approve-once` shape — no rule editor here.
				if (this.approveAllBySession.get(sid) === true) {
					return Promise.resolve({ kind: "approve-once" });
				}
				return this.pending.enqueue(
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
				return this.pending.enqueue(sid, "userInput", (requestId) => {
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
				return this.pending.enqueue(sid, "elicitation", (requestId) => {
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
			...((() => {
				const excluded = this.excludedToolsResolver();
				return excluded.length > 0 ? { excludedTools: excluded } : {};
			})()),
		};
	}

	/// Renderer → bun: respond to a pending callback. Idempotent: a
	/// double-submit on an already-resolved request returns `false`
	/// instead of throwing. Delegates to the queue subobject.
	async respondToRequest(params: RespondToRequestParams): Promise<boolean> {
		return this.pending.respond(params);
	}

	/// Centralized session-entry removal. The queue's
	/// settleForSession MUST run before deleting our entry, otherwise
	/// pending callbacks for that session would survive in the queue
	/// until app shutdown drains them.
	private removeEntry(sessionId: string, reason: string): void {
		this.pending.settleForSession(sessionId, reason);
		const entry = this.entries.get(sessionId);
		if (entry) {
			try {
				entry.unsubscribe();
			} catch (err) {
				log.warn("session unsubscribe threw during removeEntry", {
					sessionId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		this.entries.delete(sessionId);
		this.approveAllBySession.delete(sessionId);
	}

	async create(opts: { workingDirectory?: string } = {}): Promise<string> {
		const client = tryGetClient();
		// S2: buffer events that fire BEFORE `createSession` resolves
		// (the SDK's `session.start` event can fire during creation).
		// Forwarding under a literal "pending" placeholder would orphan
		// those events on the renderer side, which keys its pending-
		// events buffer by sessionId. Drain to the real id after.
		let resolvedSessionId: string | null = null;
		const earlyEventBuffer: SessionEvent[] = [];
		const earlyForward = (event: SessionEvent) => {
			if (resolvedSessionId !== null) {
				this.forward(resolvedSessionId, event);
			} else {
				earlyEventBuffer.push(event);
			}
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
		this.entries.set(sessionId, { session, unsubscribe, ...(wd ? { workingDirectory: wd } : {}) });
		// Drain anything that fired during the createSession await.
		for (const event of earlyEventBuffer) this.forward(sessionId, event);
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
		// Look up the persisted cwd BEFORE resume so we can hand it
		// back to the SDK explicitly. The SDK is supposed to remember
		// the cwd in its on-disk catalog, but we hit a bug in prod
		// where resumed sessions ended up with `process.cwd()` (the
		// Electrobun exe folder). Reading the catalog and pinning the
		// value here closes that gap end-to-end.
		let persistedCwd: string | undefined;
		try {
			const meta = await client.getSessionMetadata(sessionId);
			if (meta?.context?.cwd) persistedCwd = meta.context.cwd;
		} catch {
			/* non-fatal */
		}
		const effectiveCwd = opts.workingDirectory ?? persistedCwd;
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
				...(effectiveCwd ? { workingDirectory: effectiveCwd } : {}),
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
		this.entries.set(actualId, {
			session,
			unsubscribe,
			...(effectiveCwd ? { workingDirectory: effectiveCwd } : {}),
		});
		// Hydrate transcript. Failures here aren't fatal — the session is
		// connected and will receive live events; we just won't have the
		// scrollback.
		//
		// S5: cap history at the last `HISTORY_REPLAY_CAP` events to
		// avoid blocking the event loop on long-lived sessions. Replay
		// in `HISTORY_REPLAY_BATCH`-sized chunks separated by
		// `queueMicrotask` yields so the renderer can paint between
		// batches instead of receiving one giant IPC flood.
		try {
			const history = await session.getMessages();
			const total = history.length;
			const capped =
				total > HISTORY_REPLAY_CAP
					? history.slice(total - HISTORY_REPLAY_CAP)
					: history;
			await this.replayHistory(actualId, capped);
			log.info("session resumed", {
				sessionId: actualId,
				historyCount: total,
				replayedCount: capped.length,
				workingDirectory: effectiveCwd ?? null,
			});
		} catch (err) {
			log.warn("failed to hydrate session history", {
				sessionId: actualId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return actualId;
	}

	/// S5 helper: replays history events to `forward` in
	/// HISTORY_REPLAY_BATCH-sized batches separated by microtasks so the
	/// event loop yields between chunks. Returns when every event has
	/// been forwarded.
	private async replayHistory(
		sessionId: string,
		events: ReadonlyArray<SessionEvent>,
	): Promise<void> {
		for (let i = 0; i < events.length; i += HISTORY_REPLAY_BATCH) {
			const chunk = events.slice(i, i + HISTORY_REPLAY_BATCH);
			for (const event of chunk) this.forward(sessionId, event);
			if (i + HISTORY_REPLAY_BATCH < events.length) {
				await new Promise<void>((r) => queueMicrotask(r));
			}
		}
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

		// S3: settle pending FIRST, unsubscribe FIRST, but keep the entry
		// in the map until disconnect resolves. Concurrent RPCs see the
		// entry as live during the disconnect window and get a
		// predictable SessionNotFound after, instead of mid-teardown.
		this.pending.settleForSession(sessionId, "session working directory changed");
		entry.unsubscribe();
		try {
			await entry.session.disconnect();
		} catch (err) {
			log.warn("disconnect-before-cwd-change threw", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		this.entries.delete(sessionId);

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
		this.entries.set(actualId, { session: resumed, unsubscribe, workingDirectory: next });
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
		this.pending.settleForSession(sessionId, "session deleted");
		const entry = this.entries.get(sessionId);
		if (entry) {
			entry.unsubscribe();
			try {
				await entry.session.disconnect();
			} catch (err) {
				log.warn("disconnect-before-delete threw", {
					sessionId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			// S3: delete AFTER disconnect resolves. Concurrent RPCs see
			// the entry as live during the disconnect window so they
			// can fail predictably with SessionNotFound after, rather
			// than mid-teardown.
			this.entries.delete(sessionId);
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

	/// File-typeahead search backing the composer's `@file` picker.
	/// Resolves the session's working directory and delegates to the
	/// shared workspace-files index (`app/fileSearch.ts`).
	async searchWorkspaceFiles(
		sessionId: string,
		query: string,
		limit = 40,
		options: { includeHidden?: boolean; includeIgnored?: boolean } = {},
	): Promise<WorkspaceFileMatch[]> {
		const entry = this.entries.get(sessionId);
		if (!entry) return [];
		const cwd = await this.cwdFor(sessionId);
		if (!cwd) {
			log.warn("searchWorkspaceFiles: cwd unresolved", { sessionId });
			return [];
		}
		return searchWorkspaceFiles(cwd, query, limit, options);
	}

	/// Public accessor for the session's resolved working directory.
	/// Used by RPC handlers (resumeSession surfaces this to the
	/// renderer so the workspace chip stays accurate after restart).
	async getCwd(sessionId: string): Promise<string | undefined> {
		return this.cwdFor(sessionId);
	}

	/// Resolve the session's working directory. Reads from our entry
	/// (set at create/resume time — see `resume()` which actively
	/// pulls the persisted cwd from `getSessionMetadata` and pins it
	/// on the SDK call so the SDK can't drift to its default), then
	/// the catalog as a fallback. Returns undefined if neither
	/// source has a cwd — we deliberately DO NOT fall back to
	/// `process.cwd()` because that silently substitutes the
	/// Electrobun exe folder in prod, which produced the v1 export
	/// regression where every session reported the binary's `bin/`
	/// dir as its workspace.
	private async cwdFor(sessionId: string): Promise<string | undefined> {
		const entry = this.entries.get(sessionId);
		if (entry?.workingDirectory) return entry.workingDirectory;
		const client = tryGetClient();
		if (!client) return undefined;
		try {
			const meta = await client.getSessionMetadata(sessionId);
			if (meta?.context?.cwd) {
				// Backfill the entry so future calls hit it directly.
				if (entry) entry.workingDirectory = meta.context.cwd;
				return meta.context.cwd;
			}
		} catch {
			/* fall through to listSessions */
		}
		try {
			const summaries = await client.listSessions();
			const summary = summaries.find((s) => s.sessionId === sessionId);
			if (summary?.context?.cwd) {
				if (entry) entry.workingDirectory = summary.context.cwd;
				return summary.context.cwd;
			}
		} catch {
			/* non-fatal */
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

	/// Server-scoped: built-in tool catalog. Returns a trimmed
	/// view (name + namespacedName + description) — the renderer
	/// doesn't need the full JSON schema.
	async listBuiltinTools(): Promise<
		Array<{ name: string; namespacedName?: string; description: string }>
	> {
		const client = tryGetClient();
		if (!client) throw AppError.clientNotStarted();
		try {
			const result = (await client.rpc.tools.list({})) as {
				tools?: Array<{
					name?: unknown;
					namespacedName?: unknown;
					description?: unknown;
				}>;
			};
			const tools = result.tools ?? [];
			return tools
				.filter((t) => typeof t.name === "string")
				.map((t) => ({
					name: String(t.name),
					...(typeof t.namespacedName === "string"
						? { namespacedName: t.namespacedName }
						: {}),
					description:
						typeof t.description === "string" ? t.description : "",
				}));
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	/// Session-scoped: MCP server list. Per-server tool lists are
	/// not yet surfaced by the SDK — only name/status/source/error.
	async listSessionMcpServers(
		sessionId: string,
	): Promise<
		Array<{ name: string; status: string; source?: string; error?: string }>
	> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = (await entry.session.rpc.mcp.list()) as {
				servers?: Array<{
					name?: unknown;
					status?: unknown;
					source?: unknown;
					error?: unknown;
				}>;
			};
			const servers = result.servers ?? [];
			return servers
				.filter((s) => typeof s.name === "string")
				.map((s) => ({
					name: String(s.name),
					status: typeof s.status === "string" ? s.status : "unknown",
					...(typeof s.source === "string" ? { source: s.source } : {}),
					...(typeof s.error === "string" ? { error: s.error } : {}),
				}));
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	/// Session-scoped per-MCP toggle. Lives on the live session
	/// (`session.rpc.mcp.enable/disable`) rather than the server-
	/// scoped allowlist — lets the user gate an MCP for one session
	/// without persistently disabling it everywhere.
	async setSessionMcpEnabled(
		sessionId: string,
		serverName: string,
		enabled: boolean,
	): Promise<boolean> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			if (enabled) {
				await entry.session.rpc.mcp.enable({ serverName });
			} else {
				await entry.session.rpc.mcp.disable({ serverName });
			}
			return true;
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async getAccountQuota(): Promise<
		Record<
			string,
			{
				isUnlimitedEntitlement: boolean;
				entitlementRequests: number;
				usedRequests: number;
				remainingPercentage: number;
				overage: number;
				resetDate?: string;
			}
		>
	> {
		const client = tryGetClient();
		if (!client) throw AppError.clientNotStarted();
		try {
			const result = (await client.rpc.account.getQuota()) as {
				quotaSnapshots?: Record<string, Record<string, unknown>>;
			};
			const snaps = result.quotaSnapshots ?? {};
			const out: Record<
				string,
				{
					isUnlimitedEntitlement: boolean;
					entitlementRequests: number;
					usedRequests: number;
					remainingPercentage: number;
					overage: number;
					resetDate?: string;
				}
			> = {};
			for (const [key, snap] of Object.entries(snaps)) {
				out[key] = {
					isUnlimitedEntitlement: snap.isUnlimitedEntitlement === true,
					entitlementRequests:
						typeof snap.entitlementRequests === "number"
							? snap.entitlementRequests
							: 0,
					usedRequests:
						typeof snap.usedRequests === "number" ? snap.usedRequests : 0,
					remainingPercentage:
						typeof snap.remainingPercentage === "number"
							? snap.remainingPercentage
							: 0,
					overage: typeof snap.overage === "number" ? snap.overage : 0,
					...(typeof snap.resetDate === "string"
						? { resetDate: snap.resetDate }
						: {}),
				};
			}
			return out;
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async readPlan(
		sessionId: string,
	): Promise<{ exists: boolean; content: string | null; path: string | null }> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = (await entry.session.rpc.plan.read()) as {
				exists?: unknown;
				content?: unknown;
				path?: unknown;
			};
			return {
				exists: result.exists === true,
				content: typeof result.content === "string" ? result.content : null,
				path: typeof result.path === "string" ? result.path : null,
			};
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async writePlan(sessionId: string, content: string): Promise<boolean> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			await entry.session.rpc.plan.update({ content });
			return true;
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async deletePlan(sessionId: string): Promise<boolean> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			await entry.session.rpc.plan.delete();
			return true;
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	// ---------- MCP config registry (server-scoped, Phase 19a) ----------
	//
	// Moved to `./mcpRegistry.ts` (21a.2). Server-scoped MCP methods
	// don't touch the entries Map and shouldn't live on the session
	// registry. RPC layer calls `mcpRegistry.X` directly. The 3
	// session-scoped MCP methods (listSessionMcpServers,
	// setSessionMcpEnabled, loginToMcpServer) remain below because
	// they need entry lookup.

	async loginToMcpServer(
		sessionId: string,
		serverName: string,
		opts: { forceReauth?: boolean; clientName?: string } = {},
	): Promise<{ authorizationUrl: string | null }> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = (await entry.session.rpc.mcp.oauth.login({
				serverName,
				...(opts.forceReauth ? { forceReauth: opts.forceReauth } : {}),
				...(opts.clientName ? { clientName: opts.clientName } : {}),
			})) as { authorizationUrl?: unknown };
			return {
				authorizationUrl:
					typeof result.authorizationUrl === "string"
						? result.authorizationUrl
						: null,
			};
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	// ---------- Skills registry (server-scoped, Phase 19b) ----------
	//
	// Moved to `./skillsRegistry.ts` (21a.3). The 2 session-scoped
	// skill methods (listSkills, setSkillEnabled) remain above in this
	// file because they need entries Map lookup.

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
		this.pending.settleForSession(sessionId, "session disconnected");
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
		// S3: delete AFTER disconnect so concurrent RPCs see the entry
		// as live during the disconnect window.
		this.entries.delete(sessionId);
		log.info("session closed", { sessionId });
		return "Session closed successfully";
	}

	/// S1: bounded teardown for app quit. Settles every pending callback
	/// across all sessions first (so the SDK doesn't sit on hung
	/// handlers), then disconnects each session with a 2s timeout per.
	/// On timeout we force-clear the entry; the OS process exit handles
	/// the rest. Best-effort: errors are logged, never thrown — the
	/// caller is on the way out anyway.
	async shutdownAll(): Promise<void> {
		// Settle every pending callback first as a belt-and-suspenders.
		// Each per-session disconnect below also settles, but doing it
		// up-front ensures even sessions whose disconnect hangs (and
		// gets force-cleared below) don't leave dangling Promises.
		this.pending.settleAll("app shutdown");
		const ids = [...this.entries.keys()];
		for (const id of ids) {
			const entry = this.entries.get(id);
			if (!entry) continue;
			try {
				entry.unsubscribe();
			} catch {
				/* best-effort */
			}
			try {
				await Promise.race([
					entry.session.disconnect(),
					new Promise<void>((_, reject) =>
						setTimeout(
							() => reject(new Error("disconnect timeout")),
							SHUTDOWN_TIMEOUT_MS,
						),
					),
				]);
			} catch (err) {
				log.warn("shutdown disconnect timed out or threw", {
					sessionId: id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			this.entries.delete(id);
			this.approveAllBySession.delete(id);
		}
	}
}
