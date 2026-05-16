// End-to-end style test using Tauri's official mockIPC.
//
// Mounts the real App.vue with PrimeVue + Pinia and a fake IPC layer; no
// Tauri binary is launched. Verifies the user journey we care about today:
//
//   1. App auto-creates the client on mount.
//   2. New Session button enables once the client is ready.
//   3. Clicking it creates a session and renders a ChatWindow.
//   4. Streaming events on the per-session channel render assistant text.
//   5. Sending a message invokes send_message with the right args.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

import App from "../App.vue";

function setupIpc() {
  const sentMessages: { sessionId: string; text: string }[] = [];
  let activeChannel: { onmessage?: (v: unknown) => void } | null = null;

  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "get_settings":
        return {
          version: 2,
          appearance: { theme: "system", reasoningVisibility: "compact" },
        };
      case "create_client":
        return "Copilot client created";
      case "list_models":
        return [];
      case "create_session": {
        const onEvent = args?.onEvent as
          | { onmessage?: (v: unknown) => void }
          | undefined;
        if (onEvent) activeChannel = onEvent;
        return "sess-mock-1";
      }
      case "send_message":
        sentMessages.push({
          sessionId: String(args?.sessionId ?? ""),
          text: String(args?.text ?? ""),
        });
        return "msg-1";
      case "disconnect_session":
        return "Session closed successfully";
      default:
        throw new Error(`unmocked command: ${cmd}`);
    }
  });

  return {
    sentMessages,
    pushEvent: (eventType: string, data: Record<string, unknown>) => {
      activeChannel?.onmessage?.({ eventType, data });
    },
  };
}

function mountApp() {
  return mount(App, {
    global: { plugins: [PrimeVue, ToastService] },
    attachTo: document.body,
  });
}

describe("App.vue end-to-end via mockIPC", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
  });

  afterEach(() => {
    clearMocks();
  });

  it("auto-creates the client on mount and enables New Session", async () => {
    setupIpc();
    const wrapper = mountApp();
    await flushPromises();

    const newSessionBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("New Session"));
    expect(newSessionBtn).toBeTruthy();
    expect(newSessionBtn!.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("creates a session and renders a ChatWindow when New Session is clicked", async () => {
    setupIpc();
    const wrapper = mountApp();
    await flushPromises();

    const btn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("New Session"))!;
    await btn.trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".chat-tile").length).toBe(1);
    expect(wrapper.text()).toContain("sess-mock-1");
    wrapper.unmount();
  });

  it("streams assistant message events into the chat", async () => {
    const ipc = setupIpc();
    const wrapper = mountApp();
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("New Session"))!
      .trigger("click");
    await flushPromises();

    ipc.pushEvent("assistant.message_start", { messageId: "m1" });
    ipc.pushEvent("assistant.message_delta", {
      messageId: "m1",
      deltaContent: "Hi there!",
    });
    ipc.pushEvent("session.idle", {});
    await flushPromises();

    expect(wrapper.text()).toContain("Hi there!");
    wrapper.unmount();
  });

  it("sends the composer text via send_message", async () => {
    const ipc = setupIpc();
    const wrapper = mountApp();
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("New Session"))!
      .trigger("click");
    await flushPromises();

    const input = wrapper.find('input[type="text"]');
    expect(input.exists()).toBe(true);
    await input.setValue("hello agent");
    await wrapper.find("form.chat-composer").trigger("submit");
    await flushPromises();

    expect(ipc.sentMessages).toEqual([
      { sessionId: "sess-mock-1", text: "hello agent" },
    ]);
    wrapper.unmount();
  });
});
