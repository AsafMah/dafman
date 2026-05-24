// Server-scoped skills registry.
//
// Mirror of `McpRegistry`: only the two methods that talk to the
// singleton CLI client (`client.rpc.skills.discover` /
// `client.rpc.skills.config.setDisabledSkills`) live here. The two
// session-scoped skill methods (`listSkills`, `setSkillEnabled`)
// remain on `SessionRegistry` because they need entries Map lookup.

import type { CopilotClient } from "./copilotSdk";
import { tryGetClient } from "./client";
import { AppError } from "./errors";
import { toErrorMessage } from "./errorMessage";

export interface DiscoveredSkill {
	name: string;
	description: string;
	source: string;
	userInvocable: boolean;
	enabled: boolean;
	path?: string;
	projectPath?: string;
}

export class SkillsRegistry {
	/// `getClient` is injected so tests can pass a fake without going
	/// through the global `_setClientForTest` seam. Defaults to the
	/// real `tryGetClient` (which throws `AppError.clientNotStarted`
	/// when the singleton isn't up yet).
	constructor(private readonly getClient: () => CopilotClient = tryGetClient) {}

	/// Centralizes SDK error-wrapping. Mirrors `McpRegistry.withClient`
	/// — `ClientNotStarted` escapes unwrapped so the renderer's error
	/// UX stays predictable; everything else becomes `AppError.sdk`.
	private async withClient<T>(fn: (client: CopilotClient) => Promise<T>): Promise<T> {
		const client = this.getClient();
		try {
			return await fn(client);
		} catch (err) {
			if (err instanceof AppError) throw err;
			throw AppError.sdk(toErrorMessage(err));
		}
	}

	/// Workspace skill discovery — walks
	/// `<workingDirectory>/.github/skills/` (and project-level skill
	/// directories) and lists every skill found. With no
	/// `workingDirectory`, the SDK falls back to user-scoped skill
	/// directories.
	async discover(workingDirectory?: string): Promise<DiscoveredSkill[]> {
		return this.withClient(async (client) => {
			const args = workingDirectory ? { projectPaths: [workingDirectory] } : {};
			const result = (await client.rpc.skills.discover(args)) as {
				skills?: Array<{
					name?: unknown;
					description?: unknown;
					source?: unknown;
					userInvocable?: unknown;
					enabled?: unknown;
					path?: unknown;
					projectPath?: unknown;
				}>;
			};
			const skills = result.skills ?? [];
			return skills
				.filter((s) => typeof s.name === "string")
				.map((s) => ({
					name: String(s.name),
					description: typeof s.description === "string" ? s.description : "",
					source: typeof s.source === "string" ? s.source : "unknown",
					userInvocable: s.userInvocable === true,
					enabled: s.enabled === true,
					...(typeof s.path === "string" ? { path: s.path } : {}),
					...(typeof s.projectPath === "string" ? { projectPath: s.projectPath } : {}),
				}));
		});
	}

	/// Replaces the global disabled-skill list (NOT a toggle for one
	/// skill — pass the full set every time). Used by the Library
	/// Skills tab's bulk-edit flow.
	async setGloballyDisabled(disabledSkills: string[]): Promise<boolean> {
		return this.withClient(async (client) => {
			await client.rpc.skills.config.setDisabledSkills({ disabledSkills });
			return true;
		});
	}
}
