import { describe, expect, test } from "bun:test";
import { render, fireEvent } from "@testing-library/vue";
import Counter from "./Counter.vue";

// Smoke test for `tools/bun-vue-loader.ts` — proves that `bun test`
// can import a `.vue` SFC, mount it via `@testing-library/vue`, and
// react to DOM events under the happy-dom registrator.

describe("bun-vue-loader smoke", () => {
	test("renders and reacts to clicks", async () => {
		const { getByText } = render(Counter);
		const button = getByText("count: 0");
		await fireEvent.click(button);
		expect(getByText("count: 1")).toBeTruthy();
	});
});
