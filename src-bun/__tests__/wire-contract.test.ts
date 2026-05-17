import { describe, expect, test } from "bun:test";
import type { ModelSummary, Settings, SessionEventPayload } from "../rpc";
import type { AppErrorPayload } from "../app/errors";

// Wire-shape snapshots — equivalent to the old `insta` snapshots in
// `src-tauri/tests/ipc_contract.rs`. The whole point is that if anyone
// renames a field, this test breaks loudly. Keep these in sync with the
// types in `../rpc.ts`.

describe("IPC wire contracts", () => {
	test("Settings shape", () => {
		const sample: Settings = {
			version: 3,
			appearance: { theme: "dark", reasoningVisibility: "compact" },
			layout: { dockview: null },
		};
		expect(sample).toMatchSnapshot();
	});

	test("Settings with persisted layout", () => {
		const sample: Settings = {
			version: 3,
			appearance: { theme: "dark", reasoningVisibility: "compact" },
			layout: {
				dockview: {
					grid: {
						root: {},
						height: 600,
						width: 800,
						orientation: "HORIZONTAL",
					},
					panels: { "sess-1": { id: "sess-1", contentComponent: "chat" } },
					activeGroup: "g1",
				},
			},
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

	test("SessionEventPayload with envelope metadata (tool event)", () => {
		const sample: SessionEventPayload = {
			sessionId: "sess-1",
			eventType: "tool.execution_complete",
			data: {
				toolCallId: "call-abc",
				success: true,
				result: { content: "ok", detailedContent: "ok\n" },
			},
			agentId: "sub-agent-7",
			eventId: "00000000-0000-0000-0000-000000000001",
			timestamp: "2026-05-17T15:00:00.000Z",
		};
		expect(sample).toMatchSnapshot();
	});

	test("SessionMetadataSummary shape", () => {
		const sample: import("../rpc").SessionMetadataSummary = {
			sessionId: "s-1",
			startTime: "2026-05-17T10:00:00.000Z",
			modifiedTime: "2026-05-17T11:30:00.000Z",
			summary: "refactor auth",
			isRemote: false,
			cwd: "/repo",
			repository: "AsafMah/dafman",
			branch: "main",
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
});
