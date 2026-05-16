import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import PrimeVue from "primevue/config";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: unknown) => invokeMock(name, args),
  Channel: class FakeChannel {
    onmessage: ((p: unknown) => void) | null = null;
  },
}));

import ChatWindow from "../ChatWindow.vue";
import type { SessionEventPayload } from "../../ipc/types";

function mountChat(events: SessionEventPayload[]) {
  return mount(ChatWindow, {
    global: { plugins: [PrimeVue] },
    props: {
      sessionId: "sess-test",
      accent: "hsl(200, 80%, 52%)",
      events,
      model: null,
      reasoningEffort: null,
    },
  });
}

describe("ChatWindow.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    // list_models is fired on mount; default to empty list.
    invokeMock.mockResolvedValue([]);
  });

  it("renders the session id Tag in the header", () => {
    const wrapper = mountChat([]);
    expect(wrapper.text()).toContain("sess-test");
  });

  it("shows the empty-state message when no events have arrived", () => {
    const wrapper = mountChat([]);
    expect(wrapper.text()).toContain("Start typing below");
  });

  it("renders an assistant card when an assistant.message event arrives", async () => {
    const events = reactive<SessionEventPayload[]>([]);
    const wrapper = mountChat(events);
    events.push({
      eventType: "assistant.message_start",
      data: { messageId: "m1" },
    });
    events.push({
      eventType: "assistant.message_delta",
      data: { messageId: "m1", deltaContent: "Hello, world." },
    });
    await flushPromises();

    expect(wrapper.findAll(".message-card.assistant").length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("Hello, world.");
  });

  it("renders a reasoning card with the streamed content (NOT empty)", async () => {
    const events = reactive<SessionEventPayload[]>([]);
    const wrapper = mountChat(events);
    events.push({
      eventType: "assistant.reasoning_delta",
      data: { reasoningId: "r1", deltaContent: "Let me think about this..." },
    });
    await flushPromises();

    expect(wrapper.find(".reasoning-card").exists()).toBe(true);
    expect(wrapper.text()).toContain("Let me think about this...");
    expect(wrapper.find(".reasoning-card").text()).not.toContain("Thinking...");
  });

  it("does NOT render a reasoning card for an empty-payload reasoning event", async () => {
    const events = reactive<SessionEventPayload[]>([]);
    const wrapper = mountChat(events);
    events.push({ eventType: "assistant.reasoning", data: {} });
    events.push({ eventType: "assistant.reasoning_delta", data: {} });
    await flushPromises();

    expect(wrapper.find(".reasoning-card").exists()).toBe(false);
  });

  it("renders reasoning content under alternate field name 'delta'", async () => {
    const events = reactive<SessionEventPayload[]>([]);
    const wrapper = mountChat(events);
    events.push({
      eventType: "assistant.reasoning_delta",
      data: { reasoningId: "r1", delta: "Considering alternatives" },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Considering alternatives");
  });
});
