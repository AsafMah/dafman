import { describe, expect, test } from "bun:test";
import type {
	ModelSummary,
	SessionHistoryCompactionResult,
	SessionMode,
	Settings,
	SessionEventPayload,
} from "../rpc";
import type { AppErrorPayload } from "../app/errors";

// Wire-shape snapshots — equivalent to the old `insta` snapshots in
// `src-tauri/tests/ipc_contract.rs`. The whole point is that if anyone
// renames a field, this test breaks loudly. Keep these in sync with the
// types in `../rpc.ts`.

describe("IPC wire contracts", () => {
	test("Settings shape", () => {
		const sample: Settings = {
			version: 2,
			appearance: { theme: "dark", reasoningVisibility: "compact" },
		};
		expect(sample).toMatchSnapshot();
	});

	test("ModelSummary shape", () => {
		const sample: ModelSummary = {
			id: "claude-sonnet-4.5",
			name: "Claude Sonnet 4.5",
			supportsReasoningEffort: true,
			supportedReasoningEfforts: ["low", "medium", "high"],
			defaultReasoningEffort: "medium",
		};
		expect(sample).toMatchSnapshot();
	});

	test("SessionEventPayload shape", () => {
		const sample: SessionEventPayload = {
			sessionId: "sess-1",
			eventType: "assistant.message_delta",
			data: { deltaContent: "hi" },
		};
		expect(sample).toMatchSnapshot();
	});

	test("AppErrorPayload variants", () => {
		const variants: AppErrorPayload[] = [
			{ kind: "ClientNotStarted" },
			{ kind: "SessionNotFound", data: "sess-42" },
			{ kind: "Settings", data: "disk full" },
			{ kind: "Sdk", data: "rpc closed" },
		];
		expect(variants).toMatchSnapshot();
	});

	test("SessionMode union", () => {
		const variants: SessionMode[] = ["interactive", "plan", "autopilot"];
		expect(variants).toMatchSnapshot();
	});

	test("SessionHistoryCompactionResult shape", () => {
		const sample: SessionHistoryCompactionResult = {
			success: true,
			tokensFreed: 1234,
			messagesRemoved: 5,
		};
		expect(sample).toMatchSnapshot();
	});
});
