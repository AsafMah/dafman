// Session registry + event forwarder.
//
// Holds one entry per active SDK session. Subscribing to `session.on`
// fans every event out through a caller-supplied `emit` callback
// (typically `webview.rpc.send.sessionEvent`). On disconnect we drop
// the entry but the SDK handles its own cleanup.

import {
	approveAll,
	type CopilotSession,
	type SessionEvent,
} from "copilot-sdk-supercharged";
import { tryGetClient } from "./client";
import { AppError } from "./errors";
import { log } from "./logging";
import type {
	SessionEventPayload, SessionMetadataSummary, SessionHistoryCompactionResult, SessionMode, } from "../rpc";

/// Subset of SDK reasoning effort levels. The SDK's `ReasoningEffort`
/// type alias isn't re-exported from the package root, so we mirror it
/// here. Mismatched values are rejected by the SDK at call time.
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

type Emit = (payload: SessionEventPayload) => void;

interface Entry {
	session: CopilotSession;
	unsubscribe: () => void;
}

/// Config shared between `create()` and `resume()` so a resumed session
/// behaves identically to a freshly created one (permission handler,
/// streaming mode, etc.). Per-call overrides (model, reasoningEffort,
/// onEvent) are layered on top by each caller.
function baseSessionConfig() {
	return {
		onPermissionRequest: approveAll,
		streaming: true as const,
	};
}

export class SessionRegistry {
	private readonly entries = new Map<string, Entry>();

	constructor(private readonly emit: Emit) {}

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
			...baseSessionConfig(),
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
		opts: { model?: string; reasoningEffort?: string } = {},
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
				...baseSessionConfig(),
				onEvent: earlyForward,
				...(opts.model ? { model: opts.model } : {}),
				...(opts.reasoningEffort
					? { reasoningEffort: opts.reasoningEffort as ReasoningEffort }
					: {}),
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
	): Promise<string> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			return await entry.session.send({
				prompt: text,
				...(mode ? { mode } : {}),
			});
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
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

	async setApproveAll(sessionId: string, enabled: boolean): Promise<boolean> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			const result = (await entry.session.rpc.permissions.setApproveAll({
				enabled,
			})) as { success?: boolean };
			return result.success ?? true;
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
		this.entries.delete(sessionId);
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
