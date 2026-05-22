import { describe, expect, test } from "bun:test";
import { toModelSummary } from "../app/models";
import type { ModelInfo } from "../app/copilotSdk";

function baseModel(over: Partial<ModelInfo> = {}): ModelInfo {
	return {
		id: "m",
		name: "M",
		capabilities: {} as ModelInfo["capabilities"],
		...over,
	};
}

describe("toModelSummary", () => {
	test("flags supportsReasoningEffort=false when no efforts", () => {
		const s = toModelSummary(baseModel());
		expect(s.supportsReasoningEffort).toBe(false);
		expect(s.supportedReasoningEfforts).toEqual([]);
		expect(s.defaultReasoningEffort).toBeNull();
	});

	test("carries id/name/efforts verbatim when present", () => {
		const s = toModelSummary(
			baseModel({
				id: "claude",
				name: "Claude",
				supportedReasoningEfforts: ["low", "high"],
				defaultReasoningEffort: "low",
			}),
		);
		expect(s).toEqual({
			id: "claude",
			name: "Claude",
			supportsReasoningEffort: true,
			supportedReasoningEfforts: ["low", "high"],
			defaultReasoningEffort: "low",
		});
	});
});
