import { describe, expect, test } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/vue";
import { nextTick, h } from "vue";
import PrimeVue from "primevue/config";
import JsonValueView from "../JsonValueView.vue";

function mount(value: unknown, depth = 0) {
  return render(
    {
      components: { JsonValueView },
      setup() {
        return () => h(JsonValueView, { value, depth });
      },
    },
    { global: { plugins: [PrimeVue] } },
  );
}

describe("JsonValueView", () => {
  test("renders primitives with kind-specific classes", () => {
    const { container } = mount("hello");
    expect(container.querySelector(".jv-str")?.textContent).toBe("hello");
    cleanup();

    const n = mount(42);
    expect(n.container.querySelector(".jv-num")?.textContent).toBe("42");
    cleanup();

    const b = mount(true);
    expect(b.container.querySelector(".jv-bool")?.textContent?.trim()).toBe("true");
    cleanup();

    const z = mount(null);
    expect(z.container.querySelector(".jv-null")?.textContent).toBe("null");
    cleanup();
  });

  test("renders multiline string in a <pre>", () => {
    const { container } = mount("line1\nline2\nline3");
    const pre = container.querySelector("pre.jv-multiline");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("line2");
    cleanup();
  });

  test("renders an object as key/value rows", () => {
    const { container } = mount({ name: "asaf", count: 3, active: true });
    const keys = Array.from(container.querySelectorAll(".jv-key")).map(
      (k) => k.textContent,
    );
    expect(keys).toEqual(["name", "count", "active"]);
    cleanup();
  });

  test("renders an array with indices", () => {
    const { container } = mount(["a", "b", "c"]);
    const indices = Array.from(container.querySelectorAll(".jv-index")).map(
      (e) => e.textContent,
    );
    expect(indices).toEqual(["0", "1", "2"]);
    cleanup();
  });

  test("collapse/expand toggle hides children", async () => {
    const { container } = mount({ a: 1, b: 2 });
    expect(container.querySelector("dl.jv-object")).not.toBeNull();
    const toggle = container.querySelector("button.jv-toggle")!;
    await fireEvent.click(toggle);
    await nextTick();
    expect(container.querySelector("dl.jv-object")).toBeNull();
    cleanup();
  });

  test("collapses deeply nested levels by default (depth >= 3)", () => {
    const { container } = mount({ a: 1 }, 3);
    expect(container.querySelector("dl.jv-object")).toBeNull();
    cleanup();
  });

  test("recurses into nested objects", () => {
    const { container } = mount({
      outer: { inner: { deepest: "x" } },
    });
    // Three "outer/inner/deepest" keys somewhere in the tree:
    const allKeys = Array.from(container.querySelectorAll(".jv-key")).map(
      (k) => k.textContent,
    );
    expect(allKeys).toContain("outer");
    expect(allKeys).toContain("inner");
    expect(allKeys).toContain("deepest");
    cleanup();
  });
});
