import { describe, expect, test } from "bun:test";
import type {
	ModelSummary,
	PendingRequestPayload,
	PermissionRequestData,
	RespondToRequestParams,
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
			version: 7,
			appearance: { theme: "dark", reasoningVisibility: "compact", streaming: false },
			layout: { dockview: null },
			workspaces: {
				recent: ["D:\\repo\\dafman", "C:\\code\\demo"],
				defaultWorkspace: "D:\\repo\\dafman",
			},
			notifications: { turnEnd: false, waitingForInput: true },
		};
		expect(sample).toMatchSnapshot();
	});

	test("Settings with persisted layout", () => {
		const sample: Settings = {
			version: 7,
			appearance: { theme: "dark", reasoningVisibility: "compact", streaming: true },
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
			workspaces: { recent: [], defaultWorkspace: "" },
			notifications: { turnEnd: true, waitingForInput: true },
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

	test("SessionMode union", () => {
		const variants: SessionMode[] = ["interactive", "plan", "autopilot"];
		expect(variants).toMatchSnapshot();
	});

	test("sendMessage request — default mode (omitted)", () => {
		const sample = { sessionId: "sess-1", text: "hello" };
		expect(sample).toMatchSnapshot();
	});

	test("sendMessage request — explicit enqueue mode", () => {
		const sample = {
			sessionId: "sess-1",
			text: "queue this",
			mode: "enqueue" as const,
		};
		expect(sample).toMatchSnapshot();
	});

	test("sendMessage request — explicit immediate mode", () => {
		const sample = {
			sessionId: "sess-1",
			text: "steer this",
			mode: "immediate" as const,
		};
		expect(sample).toMatchSnapshot();
	});

	test("abortSession request shape", () => {
		const sample = { sessionId: "sess-1" };
		expect(sample).toMatchSnapshot();
	});

	test("SessionHistoryCompactionResult shape", () => {
		const sample: SessionHistoryCompactionResult = {
			success: true,
			tokensFreed: 1234,
			messagesRemoved: 5,
		};
		expect(sample).toMatchSnapshot();
	});

	test("setSessionWorkingDirectory request shape", () => {
		const sample = {
			sessionId: "sess-1",
			workingDirectory: "..\\other",
			baseWorkingDirectory: "C:\\repo\\dafman",
		};
		expect(sample).toMatchSnapshot();
	});

	test("PendingRequestPayload — permission", () => {
		const permission: PermissionRequestData = {
			kind: "shell",
			toolCallId: "tc-abc",
			summary: "shell: rm -rf /tmp/x",
			raw: { command: "rm -rf /tmp/x", cwd: "/home/user" },
		};
		const sample: PendingRequestPayload = {
			sessionId: "sess-1",
			requestId: "req-uuid-1",
			kind: "permission",
			request: permission,
		};
		expect(sample).toMatchSnapshot();
	});

	test("PendingRequestPayload — userInput", () => {
		const sample: PendingRequestPayload = {
			sessionId: "sess-1",
			requestId: "req-uuid-2",
			kind: "userInput",
			request: {
				question: "What is your name?",
				choices: ["Alice", "Bob"],
				allowFreeform: true,
			},
		};
		expect(sample).toMatchSnapshot();
	});

	test("PendingRequestPayload — elicitation url", () => {
		const sample: PendingRequestPayload = {
			sessionId: "sess-1",
			requestId: "req-uuid-3",
			kind: "elicitation",
			request: {
				message: "Authenticate to GitHub",
				mode: "url",
				elicitationSource: "mcp/github",
				url: "https://github.com/login/oauth/authorize",
			},
		};
		expect(sample).toMatchSnapshot();
	});

	test("RespondToRequestParams — permission approve once", () => {
		const sample: RespondToRequestParams = {
			sessionId: "sess-1",
			requestId: "req-uuid-1",
			response: { kind: "permission", decision: "approveOnce" },
		};
		expect(sample).toMatchSnapshot();
	});

	test("RespondToRequestParams — userInput freeform", () => {
		const sample: RespondToRequestParams = {
			sessionId: "sess-1",
			requestId: "req-uuid-2",
			response: { kind: "userInput", answer: "Alice", wasFreeform: false },
		};
		expect(sample).toMatchSnapshot();
	});

	test("RespondToRequestParams — elicitation accept", () => {
		const sample: RespondToRequestParams = {
			sessionId: "sess-1",
			requestId: "req-uuid-3",
			response: { kind: "elicitation", action: "accept" },
		};
		expect(sample).toMatchSnapshot();
	});
});
