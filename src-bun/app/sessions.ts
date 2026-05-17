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
	SessionEventPayload,
	SessionHistoryCompactionResult,
	SessionMode,
} from "../rpc";

/// Subset of SDK reasoning effort levels. The SDK's `ReasoningEffort`
/// type alias isn't re-exported from the package root, so we mirror it
/// here. Mismatched values are rejected by the SDK at call time.
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

type Emit = (payload: SessionEventPayload) => void;

interface Entry {
	session: CopilotSession;
	unsubscribe: () => void;
}

export class SessionRegistry {
	private readonly entries = new Map<string, Entry>();

	constructor(private readonly emit: Emit) {}

	async create(): Promise<string> {
		const client = tryGetClient();
		// Capture a placeholder sessionId for early events that fire before
		// `client.createSession` resolves. We rebind once we know the real
		// id (a few microseconds later, since the SDK's `session.start`
		// event fires during creation).
		let resolvedSessionId: string | null = null;
		const earlyForward = (event: SessionEvent) => {
			this.forward(resolvedSessionId ?? "pending", event);
		};
		const session = await client.createSession({
			onPermissionRequest: approveAll,
			streaming: true,
			onEvent: earlyForward,
		});
		const sessionId = session.sessionId;
		resolvedSessionId = sessionId;
		// `onEvent` is one-shot for the early window; switch to `session.on`
		// for the live stream and grab its unsubscribe handle.
		const unsubscribe = session.on((event) => {
			this.forward(sessionId, event);
		});
		this.entries.set(sessionId, { session, unsubscribe });
		log.info("session created", { sessionId });
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
		// same shape it always did.
		const data = (
			(event as unknown as { data?: Record<string, unknown> }).data ?? {}
		) as Record<string, unknown>;
		try {
			this.emit({
				sessionId,
				eventType,
				data,
			});
		} catch (err) {
			log.warn("failed to forward session event", {
				sessionId,
				eventType,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	async send(sessionId: string, text: string): Promise<string> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw AppError.sessionNotFound(sessionId);
		try {
			return await entry.session.send({ prompt: text });
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
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
