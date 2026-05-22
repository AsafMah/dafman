// Focused unit tests for the SkillsRegistry extraction (21a.3).
//
// Mirrors mcpRegistry.test.ts in structure: client injection, error
// wrapping (ClientNotStarted passes through, others become Sdk),
// argument forwarding, discover() shape normalization.

import { describe, expect, test } from "bun:test";
import { SkillsRegistry } from "../app/skillsRegistry";
import { AppError } from "../app/errors";
import type { CopilotClient } from "copilot-sdk-supercharged";

function makeFakeClient(
	overrides: Partial<{
		discover: (args: unknown) => Promise<unknown>;
		setDisabledSkills: (args: unknown) => Promise<void>;
	}> = {},
): { client: CopilotClient; calls: Record<string, unknown[]> } {
	const calls: Record<string, unknown[]> = { discover: [], setDisabledSkills: [] };
	const track = (key: string, fn?: (a: unknown) => Promise<unknown>) =>
		async (args?: unknown) => {
			calls[key]?.push(args);
			return fn ? fn(args as never) : (undefined as never);
		};
	const fake = {
		rpc: {
			skills: {
				discover: track("discover", overrides.discover as never),
				config: {
					setDisabledSkills: track("setDisabledSkills", overrides.setDisabledSkills as never),
				},
			},
		},
	};
	return { client: fake as unknown as CopilotClient, calls };
}

describe("SkillsRegistry.discover", () => {
	test("returns empty list when SDK returns no skills field", async () => {
		const { client } = makeFakeClient({ discover: async () => ({}) });
		const reg = new SkillsRegistry(() => client);
		expect(await reg.discover()).toEqual([]);
	});

	test("normalizes the discovered skill shape and filters non-string names", async () => {
		const { client } = makeFakeClient({
			discover: async () => ({
				skills: [
					{
						name: "review",
						description: "code review",
						source: "user",
						userInvocable: true,
						enabled: true,
						path: "/u/review",
						projectPath: "/p",
					},
					// Dropped: non-string name.
					{ name: 42, description: "x" },
					// Defaults: missing description / source.
					{ name: "bare", userInvocable: false, enabled: false },
				],
			}),
		});
		const reg = new SkillsRegistry(() => client);
		const out = await reg.discover();
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({
			name: "review",
			description: "code review",
			source: "user",
			userInvocable: true,
			enabled: true,
			path: "/u/review",
			projectPath: "/p",
		});
		expect(out[1]).toEqual({
			name: "bare",
			description: "",
			source: "unknown",
			userInvocable: false,
			enabled: false,
		});
	});

	test("threads workingDirectory through as projectPaths", async () => {
		const { client, calls } = makeFakeClient({
			discover: async () => ({ skills: [] }),
		});
		const reg = new SkillsRegistry(() => client);
		await reg.discover();
		await reg.discover("C:/proj");
		expect(calls.discover).toEqual([{}, { projectPaths: ["C:/proj"] }]);
	});

	test("SDK rejection becomes AppError.sdk", async () => {
		const { client } = makeFakeClient({
			discover: async () => {
				throw new Error("skill API not wired");
			},
		});
		const reg = new SkillsRegistry(() => client);
		try {
			await reg.discover();
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AppError);
			expect((err as AppError).payload.kind).toBe("Sdk");
			expect((err as AppError).message).toContain("skill API not wired");
		}
	});

	test("ClientNotStarted from getClient passes through unwrapped", async () => {
		const reg = new SkillsRegistry(() => {
			throw AppError.clientNotStarted();
		});
		try {
			await reg.discover();
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AppError);
			expect((err as AppError).payload.kind).toBe("ClientNotStarted");
		}
	});
});

describe("SkillsRegistry.setGloballyDisabled", () => {
	test("forwards { disabledSkills } and returns true", async () => {
		const { client, calls } = makeFakeClient();
		const reg = new SkillsRegistry(() => client);
		expect(await reg.setGloballyDisabled(["a", "b"])).toBe(true);
		expect(calls.setDisabledSkills).toEqual([{ disabledSkills: ["a", "b"] }]);
	});

	test("SDK rejection becomes AppError.sdk", async () => {
		const { client } = makeFakeClient({
			setDisabledSkills: async () => {
				throw new Error("write failed");
			},
		});
		const reg = new SkillsRegistry(() => client);
		try {
			await reg.setGloballyDisabled([]);
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AppError);
			expect((err as AppError).payload.kind).toBe("Sdk");
		}
	});
});
