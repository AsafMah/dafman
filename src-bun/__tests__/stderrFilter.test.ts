import { describe, expect, test } from "bun:test";
import { isNoiseLine } from "../app/stderrFilter";

describe("stderrFilter.isNoiseLine", () => {
	test("drops node-pty AttachConsole stack frames", () => {
		const lines = [
			"Failed to load package index: C:\\Users\\a\\.copilot\\pkg\\universal\\1.0.49-1\\index.js Error: AttachConsole failed",
			"    at Object.<anonymous> (C:\\Users\\a\\node_modules\\node-pty\\lib\\conpty_console_list_agent.js:13:26)",
			"    at Module._compile (node:internal/modules/cjs/loader:1830:14)",
			"    at Object..js (node:internal/modules/cjs/loader:1961:10)",
			"    at Module.load (node:internal/modules/cjs/loader:1553:32)",
			"    at Module._load (node:internal/modules/cjs/loader:1355:12)",
			"    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)",
			"    at loadCJSModuleWithModuleLoad (node:internal/modules/esm/translators:326:3)",
			"    at ModuleWrap.<anonymous> (node:internal/modules/esm/translators:231:7)",
			"    at ModuleJob.run (node:internal/modules/esm/module_job:437:25)",
			"    at async node:internal/modules/esm/loader:639:26",
		];
		for (const line of lines) {
			expect(isNoiseLine(line)).toBe(true);
		}
	});

	test("keeps normal CLI subprocess log lines", () => {
		expect(isNoiseLine("session started with id sess-1")).toBe(false);
		expect(isNoiseLine("listening on port 12345")).toBe(false);
		expect(isNoiseLine("[debug] ready")).toBe(false);
	});

	test("treats blank lines as non-noise (passthrough preserves newlines)", () => {
		expect(isNoiseLine("")).toBe(false);
		expect(isNoiseLine("   ")).toBe(false);
	});
});
