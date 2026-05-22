// AppError — discriminated union that crosses the RPC bridge.
//
// Mirrors the old `AppError` in `src-tauri/src/app/error.rs` field-for-field.
// The frontend (in `src/ipc/invoke.ts`) re-parses this shape into an
// `AppError` class for ergonomic catches. Every RPC handler in `src-bun/`
// wraps its body so failures serialize as this payload instead of leaking
// JS Error stacks.

export type AppErrorPayload =
	| { kind: "ClientNotStarted" }
	| { kind: "SessionNotFound"; data: string }
	| { kind: "Settings"; data: string }
	| { kind: "Sdk"; data: string }
	| { kind: "Io"; data: string };

export class AppError extends Error {
	readonly payload: AppErrorPayload;

	constructor(payload: AppErrorPayload) {
		super(formatPayload(payload));
		this.name = "AppError";
		this.payload = payload;
	}

	static clientNotStarted(): AppError {
		return new AppError({ kind: "ClientNotStarted" });
	}
	static sessionNotFound(sessionId: string): AppError {
		return new AppError({ kind: "SessionNotFound", data: sessionId });
	}
	static settings(detail: string): AppError {
		return new AppError({ kind: "Settings", data: detail });
	}
	static sdk(detail: string): AppError {
		return new AppError({ kind: "Sdk", data: detail });
	}
	static io(detail: string): AppError {
		return new AppError({ kind: "Io", data: detail });
	}
}

function formatPayload(p: AppErrorPayload): string {
	switch (p.kind) {
		case "ClientNotStarted":
			return "client not started";
		case "SessionNotFound":
			return `session ${p.data} not found`;
		case "Settings":
			return `settings: ${p.data}`;
		case "Sdk":
			return `sdk: ${p.data}`;
		case "Io":
			return `io: ${p.data}`;
	}
}

/// Wrap an RPC handler so any thrown `AppError` is serialized as its
/// payload, and any other thrown value is coerced into `Sdk(message)`.
/// The Electrobun bridge serializes errors via `error.message` only and
/// will *drop non-Error throws on the floor* (unhandled rejection in
/// worker, request promise on renderer never settles —
/// see node_modules/electrobun/dist/api/shared/rpc.ts:398). So we
/// always throw a real `Error` whose message is a JSON-encoded
/// `AppErrorPayload`; the renderer's `invokeCommand` decodes it.
export const APP_ERROR_PREFIX = "AppErrorPayload:";

export function rpcGuard<TArgs, TResult>(
	fn: (args: TArgs) => Promise<TResult> | TResult,
): (args: TArgs) => Promise<TResult> {
	return async (args) => {
		try {
			return await fn(args);
		} catch (err) {
			let payload: AppErrorPayload;
			if (err instanceof AppError) {
				payload = err.payload;
			} else {
				const message = err instanceof Error ? err.message : String(err);
				payload = { kind: "Sdk", data: message };
			}
			throw new Error(`${APP_ERROR_PREFIX}${JSON.stringify(payload)}`);
		}
	};
}
