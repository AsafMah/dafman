import { describe, expect, test, beforeEach } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import { render, fireEvent, cleanup } from "@testing-library/vue";
import { nextTick, h } from "vue";
import PrimeVue from "primevue/config";
import MessageActions from "../MessageActions.vue";

function mount(
  props: {
    kind: "user" | "assistant" | "reasoning" | "tool" | "system";
    text?: string;
    eventId?: string;
    toolArgsText?: string;
    toolResultText?: string;
  },
  handlers: Partial<{
    onEdit: () => void;
    onQuote: (t: string) => void;
    onRetry: () => void;
    onFork: () => void;
  }> = {},
) {
  return render(
    {
      setup() {
        return () => h(MessageActions, { ...props, ...handlers });
      },
    },
    { global: { plugins: [PrimeVue] } },
  );
}

describe("MessageActions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("user message renders Copy, Quote, Edit, Fork", () => {
    const { container } = mount({ kind: "user", text: "hi", eventId: "e1" });
    const labels = Array.from(container.querySelectorAll(".p-button-label"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    expect(labels).toEqual(["Copy", "Quote", "Edit", "Fork"]);
    cleanup();
  });

  test("assistant message renders Copy, Quote, Retry, Fork", () => {
    const { container } = mount({
      kind: "assistant",
      text: "ack",
      eventId: "e2",
    });
    const labels = Array.from(container.querySelectorAll(".p-button-label"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    expect(labels).toEqual(["Copy", "Quote", "Retry", "Fork"]);
    cleanup();
  });

  test("system message only renders Copy (no anchor-needing actions)", () => {
    const { container } = mount({ kind: "system", text: "info" });
    const labels = Array.from(container.querySelectorAll(".p-button-label"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    expect(labels).toEqual(["Copy"]);
    cleanup();
  });

  test("tool kind shows Copy args + Copy result + Fork when payloads exist", () => {
    const { container } = mount({
      kind: "tool",
      eventId: "e3",
      toolArgsText: "{}",
      toolResultText: "ok",
    });
    const labels = Array.from(container.querySelectorAll(".p-button-label"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    expect(labels).toEqual(["Copy args", "Copy result", "Fork"]);
    cleanup();
  });

  test("Edit / Retry / Fork disabled without eventId", () => {
    const { container } = mount({ kind: "user", text: "x" });
    const editBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Edit"),
    );
    expect(editBtn?.disabled).toBe(true);
    cleanup();

    const { container: c2 } = mount({ kind: "assistant", text: "y" });
    const retryBtn = Array.from(c2.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Retry"),
    );
    expect(retryBtn?.disabled).toBe(true);
    cleanup();
  });

  test("clicking Quote emits the quoted text with > prefix", async () => {
    let received: string = "";
    const { container } = mount(
      { kind: "user", text: "line1\nline2", eventId: "e1" },
      { onQuote: (t) => (received = t) },
    );
    const quoteBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Quote"),
    );
    await fireEvent.click(quoteBtn!);
    await nextTick();
    expect(received).toBe("> line1\n> line2\n\n");
    cleanup();
  });

  test("clicking Edit emits the edit event", async () => {
    let fired = false;
    const { container } = mount(
      { kind: "user", text: "original", eventId: "e1" },
      { onEdit: () => (fired = true) },
    );
    const editBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Edit"),
    );
    await fireEvent.click(editBtn!);
    await nextTick();
    expect(fired).toBe(true);
    cleanup();
  });
});
