// Focused unit tests for the McpRegistry extraction (21a.2).
//
// The wider integration paths (renderer → RPC → registry → SDK) are
// covered by the E2E flows that exercise the Library MCP tab. This
// file pins down the registry's own contract: client injection, the
// error-wrapping shape (`ClientNotStarted` passes through unwrapped,
// other failures become `AppError.sdk`), and the discover() result
// shape filter.

import { describe, expect, test } from "bun:test";
import { McpRegistry } from "../app/mcpRegistry";
import { AppError } from "../app/errors";
import type { CopilotClient } from "copilot-sdk-supercharged";

/// Minimal fake client that satisfies the McpRegistry surface. Lets
/// each test script its own behavior without instantiating the real
/// CopilotClient (which would require the prebuilt CLI binary).
function makeFakeClient(
	overrides: Partial<{
		list: () => Promise<{ servers?: Record<string, Record<string, unknown>> }>;
		add: (args: unknown) => Promise<void>;
		update: (args: unknown) => Promise<void>;
		remove: (args: unknown) => Promise<void>;
		enable: (args: unknown) => Promise<void>;
		disable: (args: unknown) => Promise<void>;
		discover: (args: unknown) => Promise<unknown>;
	}> = {},
): { client: CopilotClient; calls: Record<string, unknown[]> } {
	const calls: Record<string, unknown[]> = {
		list: [],
		add: [],
		update: [],
		remove: [],
		enable: [],
		disable: [],
		discover: [],
	};
	const track = (key: string, fn?: (a: unknown) => Promise<unknown>) =>
		async (args?: unknown) => {
			calls[key]?.push(args);
			return fn ? fn(args as never) : (undefined as never);
		};
	const fake = {
		rpc: {
			mcp: {
				config: {
					list: track("list", overrides.list as never) as () => Promise<{
						servers?: Record<string, Record<string, unknown>>;
					}>,
					add: track("add", overrides.add as never),
					update: track("update", overrides.update as never),
					remove: track("remove", overrides.remove as never),
					enable: track("enable", overrides.enable as never),
					disable: track("disable", overrides.disable as never),
				},
				discover: track("discover", overrides.discover as never),
			},
		},
	};
	return { client: fake as unknown as CopilotClient, calls };
}

describe("McpRegistry.listConfigs", () => {
	test("returns the SDK's servers map", async () => {
		const { client } = makeFakeClient({
			list: async () => ({ servers: { foo: { command: "x" } } }),
		});
		const reg = new McpRegistry(() => client);
		expect(await reg.listConfigs()).toEqual({ foo: { command: "x" } });
	});

	test("returns empty object when SDK returns no servers field", async () => {
		const { client } = makeFakeClient({ list: async () => ({}) });
		const reg = new McpRegistry(() => client);
		expect(await reg.listConfigs()).toEqual({});
	});

	test("SDK rejection becomes AppError.sdk", async () => {
		const { client } = makeFakeClient({
			list: async () => {
				throw new Error("connection refused");
			},
		});
		const reg = new McpRegistry(() => client);
		try {
			await reg.listConfigs();
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AppError);
			expect((err as AppError).payload.kind).toBe("Sdk");
			expect((err as AppError).message).toContain("connection refused");
		}
	});
});

describe("McpRegistry — getClient", () => {
	test("ClientNotStarted from getClient passes through unwrapped", async () => {
		const reg = new McpRegistry(() => {
			throw AppError.clientNotStarted();
		});
		try {
			await reg.listConfigs();
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AppError);
			// Must NOT be re-wrapped as Sdk.
			expect((err as AppError).payload.kind).toBe("ClientNotStarted");
		}
	});
});

describe("McpRegistry — mutators forward args + return true", () => {
	test("addConfig calls SDK with { name, config }", async () => {
		const { client, calls } = makeFakeClient();
		const reg = new McpRegistry(() => client);
		expect(await reg.addConfig("srv", { command: "x" })).toBe(true);
		expect(calls.add).toEqual([{ name: "srv", config: { command: "x" } }]);
	});

	test("updateConfig calls SDK with { name, config }", async () => {
		const { client, calls } = makeFakeClient();
		const reg = new McpRegistry(() => client);
		expect(await reg.updateConfig("srv", { command: "y" })).toBe(true);
		expect(calls.update).toEqual([{ name: "srv", config: { command: "y" } }]);
	});

	test("removeConfig calls SDK with { name }", async () => {
		const { client, calls } = makeFakeClient();
		const reg = new McpRegistry(() => client);
		expect(await reg.removeConfig("srv")).toBe(true);
		expect(calls.remove).toEqual([{ name: "srv" }]);
	});

	test("enable / disable call SDK with { names }", async () => {
		const { client, calls } = makeFakeClient();
		const reg = new McpRegistry(() => client);
		await reg.enable(["a", "b"]);
		await reg.disable(["c"]);
		expect(calls.enable).toEqual([{ names: ["a", "b"] }]);
		expect(calls.disable).toEqual([{ names: ["c"] }]);
	});
});

describe("McpRegistry.discover", () => {
	test("normalizes server shape and filters non-string names", async () => {
		const { client } = makeFakeClient({
			discover: async () => ({
				servers: [
					{ name: "real", type: "stdio", source: "config", enabled: true },
					{ name: 123, source: "config", enabled: true }, // dropped
					{ name: "no-source", enabled: false },
				],
			}),
		});
		const reg = new McpRegistry(() => client);
		const out = await reg.discover();
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({
			name: "real",
			type: "stdio",
			source: "config",
			enabled: true,
		});
		expect(out[1]).toEqual({
			name: "no-source",
			source: "unknown",
			enabled: false,
		});
	});

	test("threads workingDirectory through when provided", async () => {
		const { client, calls } = makeFakeClient({
			discover: async () => ({ servers: [] }),
		});
		const reg = new McpRegistry(() => client);
		await reg.discover();
		await reg.discover("C:/proj");
		expect(calls.discover).toEqual([{}, { workingDirectory: "C:/proj" }]);
	});
});
