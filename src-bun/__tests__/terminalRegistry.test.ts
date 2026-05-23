import { describe, expect, test } from "bun:test";
import { TerminalRegistry } from "../app/terminalRegistry";
import type { TerminalEventPayload } from "../rpc";

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("TerminalRegistry", () => {
	test("creates a Bun native PTY terminal and emits output/exit", async () => {
		const events: TerminalEventPayload[] = [];
		const registry = new TerminalRegistry((event) => events.push(event));
		const summary = registry.create(
			process.platform === "win32"
				? { shell: "cmd.exe", args: ["/d", "/c", "echo TERM_OK"], cols: 80, rows: 24 }
				: { shell: "sh", args: ["-lc", "echo TERM_OK"], cols: 80, rows: 24 },
		);

		await wait(250);

		expect(summary.status).toBe("running");
		expect(events.some((event) => event.kind === "status")).toBe(true);
		expect(
			events.some(
				(event) => event.kind === "output" && event.data.includes("TERM_OK"),
			),
		).toBe(true);
		expect(events.some((event) => event.kind === "exit")).toBe(true);
		registry.shutdownAll();
	});

	test("write, resize, list, and kill are idempotent for a live terminal", async () => {
		const events: TerminalEventPayload[] = [];
		const registry = new TerminalRegistry((event) => events.push(event));
		const summary = registry.create(
			process.platform === "win32"
				? { shell: "cmd.exe", args: ["/d", "/q"], cols: 80, rows: 24 }
				: { shell: "sh", cols: 80, rows: 24 },
		);

		expect(registry.list().map((terminal) => terminal.id)).toContain(summary.id);
		expect(registry.resize(summary.id, 100, 30)).toBe(true);
		expect(registry.write(summary.id, process.platform === "win32" ? "echo LIVE_OK\r" : "echo LIVE_OK\n")).toBe(true);
		await wait(250);
		expect(
			events.some(
				(event) => event.kind === "output" && event.data.includes("LIVE_OK"),
			),
		).toBe(true);
		expect(registry.kill(summary.id)).toBe(true);
		expect(registry.kill("missing")).toBe(false);
	});
});
