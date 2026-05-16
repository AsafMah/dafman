import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import PrimeVue from "primevue/config";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: unknown) => invokeMock(name, args),
  Channel: class {},
}));

import SettingsDialog from "../SettingsDialog.vue";
import { useSettingsStore } from "../../stores/settingsStore";

async function setup(visible = true) {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    version: 2,
    appearance: { theme: "dark", reasoningVisibility: "compact" },
  });
  setActivePinia(createPinia());
  // Prime the store the same way App.vue does.
  await useSettingsStore().load();
  return mount(SettingsDialog, {
    global: { plugins: [PrimeVue] },
    props: { visible },
    attachTo: document.body,
  });
}

describe("SettingsDialog.vue", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders both General and Appearance tabs when visible", async () => {
    const wrapper = await setup();
    await flushPromises();
    // PrimeVue Dialog teleports to body; query the whole document.
    const text = document.body.textContent ?? "";
    expect(text).toContain("General");
    expect(text).toContain("Appearance");
    wrapper.unmount();
  });

  it("displays the current schema version on the General tab", async () => {
    const wrapper = await setup();
    await flushPromises();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Schema version");
    // Default v2 from setup().
    expect(text).toContain("2");
    wrapper.unmount();
  });

  it("emits update:visible(false) when the Close button is clicked", async () => {
    const wrapper = await setup();
    await flushPromises();
    // Find Close button by visible text.
    const buttons = document.body.querySelectorAll("button");
    const close = Array.from(buttons).find(
      (b) => b.textContent?.trim().toLowerCase().includes("close"),
    );
    expect(close).toBeTruthy();
    close!.click();
    await flushPromises();
    const events = wrapper.emitted("update:visible");
    expect(events).toBeTruthy();
    expect(events![events!.length - 1]).toEqual([false]);
    wrapper.unmount();
  });

  it("renders nothing when visible=false", async () => {
    const wrapper = await setup(false);
    await flushPromises();
    // Dialog teleports content to body only when visible; nothing should
    // contain the settings-specific labels.
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Schema version");
    wrapper.unmount();
  });
});
