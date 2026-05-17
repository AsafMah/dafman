// Singleton CopilotClient lifecycle.
//
// At most one client per app instance, matching the Rust
// `AppState.client` slot. `ensure()` is idempotent — the second call
// returns the existing instance and `start()` is only invoked once.

import { CopilotClient } from "copilot-sdk-supercharged";
import { AppError } from "./errors";
import { log } from "./logging";

let instance: CopilotClient | null = null;
let starting: Promise<CopilotClient> | null = null;

export async function ensureClient(): Promise<CopilotClient> {
	if (instance) return instance;
	if (starting) return starting;
	starting = (async () => {
		const client = new CopilotClient();
		try {
			await client.start();
		} catch (err) {
			starting = null;
			const message = err instanceof Error ? err.message : String(err);
			log.error("failed to start copilot client", { error: message });
			throw AppError.sdk(message);
		}
		instance = client;
		starting = null;
		log.info("copilot client started");
		return client;
	})();
	return starting;
}

export function tryGetClient(): CopilotClient {
	if (!instance) throw AppError.clientNotStarted();
	return instance;
}

export async function shutdownClient(): Promise<void> {
	if (!instance) return;
	try {
		const errs = await instance.stop();
		if (errs.length) {
			log.warn("copilot client stopped with errors", {
				count: errs.length,
				errors: errs.map((e) => e.message),
			});
		}
	} catch (err) {
		log.warn("copilot client stop threw", {
			error: err instanceof Error ? err.message : String(err),
		});
	} finally {
		instance = null;
	}
}

/// Test-only seam — inject a fake client for unit tests.
export function _setClientForTest(client: CopilotClient | null): void {
	instance = client;
	starting = null;
}
