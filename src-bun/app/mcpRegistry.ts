// Server-scoped MCP server registry.
//
// Extracted from `SessionRegistry` because these methods don't touch
// the per-session entries Map — they talk to the singleton CLI client
// (`client.rpc.mcp.config.*` and `client.rpc.mcp.discover`). Keeping
// them on `SessionRegistry` was a layering violation that made
// sessions.ts harder to follow.
//
// Session-scoped MCP methods (listSessionMcpServers, setSessionMcp-
// Enabled, loginToMcpServer) remain on `SessionRegistry` because they
// need entry lookup. If MCP grows substantially, revisit by passing a
// `getSession(sessionId)` accessor here.

import type { CopilotClient } from "./copilotSdk";
import { tryGetClient } from "./client";
import { AppError } from "./errors";

export interface McpDiscoveredServer {
	name: string;
	type?: string;
	source: string;
	enabled: boolean;
}

export class McpRegistry {
	/// `getClient` is injected so tests can pass a fake without going
	/// through the global `_setClientForTest` seam. Defaults to the
	/// real `tryGetClient` (which throws `AppError.clientNotStarted`
	/// when the singleton isn't up yet).
	constructor(private readonly getClient: () => CopilotClient = tryGetClient) {}

	/// Centralizes the SDK error-wrapping pattern: every method
	/// resolves the client (let `ClientNotStarted` escape unwrapped),
	/// runs the SDK call, wraps anything else as `AppError.sdk` so the
	/// renderer's error UX stays predictable.
	private async withClient<T>(fn: (client: CopilotClient) => Promise<T>): Promise<T> {
		const client = this.getClient();
		try {
			return await fn(client);
		} catch (err) {
			if (err instanceof AppError) throw err;
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
	}

	async listConfigs(): Promise<Record<string, Record<string, unknown>>> {
		return this.withClient(async (client) => {
			const result = (await client.rpc.mcp.config.list()) as {
				servers?: Record<string, Record<string, unknown>>;
			};
			return result.servers ?? {};
		});
	}

	async addConfig(name: string, config: Record<string, unknown>): Promise<boolean> {
		return this.withClient(async (client) => {
			await client.rpc.mcp.config.add({ name, config } as unknown as Record<string, unknown>);
			return true;
		});
	}

	async updateConfig(name: string, config: Record<string, unknown>): Promise<boolean> {
		return this.withClient(async (client) => {
			await client.rpc.mcp.config.update({ name, config } as unknown as Record<string, unknown>);
			return true;
		});
	}

	async removeConfig(name: string): Promise<boolean> {
		return this.withClient(async (client) => {
			await client.rpc.mcp.config.remove({ name });
			return true;
		});
	}

	async enable(names: string[]): Promise<boolean> {
		return this.withClient(async (client) => {
			await client.rpc.mcp.config.enable({ names });
			return true;
		});
	}

	async disable(names: string[]): Promise<boolean> {
		return this.withClient(async (client) => {
			await client.rpc.mcp.config.disable({ names });
			return true;
		});
	}

	/// Workspace-level MCP discovery — surfaces .mcp.json /
	/// .vscode/mcp.json next to a project. The SDK's runtime shape is
	/// `{ name, type?, source, enabled }` per server; we filter on
	/// `typeof name === "string"` to defend against shape drift.
	async discover(workingDirectory?: string): Promise<McpDiscoveredServer[]> {
		return this.withClient(async (client) => {
			const result = (await client.rpc.mcp.discover({
				...(workingDirectory ? { workingDirectory } : {}),
			})) as {
				servers?: Array<{
					name?: unknown;
					type?: unknown;
					source?: unknown;
					enabled?: unknown;
				}>;
			};
			const servers = result.servers ?? [];
			return servers
				.filter((s) => typeof s.name === "string")
				.map((s) => ({
					name: String(s.name),
					...(typeof s.type === "string" ? { type: s.type } : {}),
					source: typeof s.source === "string" ? s.source : "unknown",
					enabled: s.enabled === true,
				}));
		});
	}
}
