import { describe, expect, test } from "bun:test";
import { checkFileSizes, countLines } from "../check-file-sizes";

const budget = {
	"src/big.vue": 1200,
	"src-bun/huge.ts": 900,
};

describe("countLines", () => {
	test("ignores a single trailing newline", () => {
		expect(countLines("a\nb\n")).toBe(2);
		expect(countLines("a\nb")).toBe(2);
		expect(countLines("")).toBe(0);
		expect(countLines("a\n\n")).toBe(2); // blank last line counts; phantom trailing does not
	});
});

describe("checkFileSizes", () => {
	test("flags a budgeted file that grew past its cap", () => {
		const r = checkFileSizes([{ file: "src/big.vue", lines: 1201 }], budget);
		expect(r.violations).toEqual([{ file: "src/big.vue", lines: 1201, cap: 1200, budgeted: true }]);
	});

	test("a budgeted file at or under its cap passes", () => {
		const r = checkFileSizes([{ file: "src/big.vue", lines: 1200 }], budget);
		expect(r.violations).toHaveLength(0);
	});

	test("flags a NEW file that crosses SOFT (800) with no budget entry", () => {
		const r = checkFileSizes([{ file: "src/new.ts", lines: 801 }], budget);
		expect(r.violations).toEqual([{ file: "src/new.ts", lines: 801, cap: 800, budgeted: false }]);
	});

	test("an un-budgeted file at or under SOFT passes", () => {
		const r = checkFileSizes([{ file: "src/small.ts", lines: 800 }], budget);
		expect(r.violations).toHaveLength(0);
	});

	test("marks a budget entry stale once the file shrinks to <= SOFT", () => {
		const r = checkFileSizes([{ file: "src-bun/huge.ts", lines: 780 }], budget);
		expect(r.violations).toHaveLength(0);
		expect(r.stale).toContainEqual({ file: "src-bun/huge.ts", lines: 780, cap: 900 });
	});

	test("marks a budget entry stale when its file is gone", () => {
		const r = checkFileSizes([], budget);
		expect(r.stale).toContainEqual({ file: "src/big.vue", lines: -1, cap: 1200 });
	});

	test("a file between SOFT and its cap is neither a violation nor stale", () => {
		const r = checkFileSizes(
			[
				{ file: "src/big.vue", lines: 1000 },
				{ file: "src-bun/huge.ts", lines: 850 },
			],
			budget,
		);
		expect(r.violations).toHaveLength(0);
		expect(r.stale).toHaveLength(0);
	});
});
