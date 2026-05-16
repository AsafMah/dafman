import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import ReasoningBlock from "../ReasoningBlock.vue";

function mountBlock(props: {
  text: string;
  visibility: "hidden" | "compact" | "expanded";
}) {
  return mount(ReasoningBlock, {
    global: { plugins: [PrimeVue] },
    props,
  });
}

describe("ReasoningBlock.vue", () => {
  it("renders nothing when visibility is 'hidden'", () => {
    const wrapper = mountBlock({ text: "anything", visibility: "hidden" });
    expect(wrapper.find(".reasoning-card").exists()).toBe(false);
  });

  it("shows full body when visibility is 'expanded' (no chevron)", () => {
    const wrapper = mountBlock({
      text: "First line\nSecond line",
      visibility: "expanded",
    });
    expect(wrapper.find(".reasoning-card").exists()).toBe(true);
    expect(wrapper.find(".reasoning-body").exists()).toBe(true);
    expect(wrapper.text()).toContain("First line");
    expect(wrapper.text()).toContain("Second line");
    // No expand button in expanded mode.
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("shows preview (first line) and expand chevron when 'compact'", () => {
    const wrapper = mountBlock({
      text: "Visible preview\nHidden by default",
      visibility: "compact",
    });
    expect(wrapper.find(".reasoning-preview").exists()).toBe(true);
    expect(wrapper.find(".reasoning-body").exists()).toBe(false);
    expect(wrapper.text()).toContain("Visible preview");
    expect(wrapper.text()).not.toContain("Hidden by default");
    expect(wrapper.find("button").exists()).toBe(true);
  });

  it("compact + chevron click reveals the full body", async () => {
    const wrapper = mountBlock({
      text: "Visible preview\nFull detail here",
      visibility: "compact",
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.find(".reasoning-body").exists()).toBe(true);
    expect(wrapper.text()).toContain("Full detail here");
  });

  it("falls back to 'Thinking...' placeholder only when text is empty", () => {
    const wrapper = mountBlock({ text: "", visibility: "expanded" });
    expect(wrapper.text()).toContain("Thinking...");
  });

  it("truncates the preview when first line exceeds 120 chars", () => {
    const longLine = "x".repeat(200);
    const wrapper = mountBlock({ text: longLine, visibility: "compact" });
    const preview = wrapper.find(".reasoning-preview").text();
    expect(preview.endsWith("...")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(123);
  });
});
