import { describe, expect, test, beforeEach } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import { render, fireEvent, cleanup } from "@testing-library/vue";
import { nextTick, h } from "vue";
import PrimeVue from "primevue/config";
import AttachmentStrip from "../AttachmentStrip.vue";
import type { SendMessageAttachment } from "../../ipc/types";

/// AttachmentStrip's contract: render a chip per attachment, click
/// chip body → emit 'open', click ✕ → emit 'remove'. No global state.

function mount(
  attachments: SendMessageAttachment[],
  handlers: Partial<{
    onRemove: (idx: number) => void;
    onOpen: (idx: number) => void;
  }> = {},
) {
  return render(
    {
      setup() {
        return () =>
          h(AttachmentStrip, { attachments, ...handlers });
      },
    },
    { global: { plugins: [PrimeVue] } },
  );
}

describe("AttachmentStrip", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("renders no chips when the list is empty", () => {
    const { container } = mount([]);
    expect(container.querySelectorAll(".attachment-chip").length).toBe(0);
    cleanup();
  });

  test("renders a chip per attachment with the filename label", () => {
    const { container } = mount([
      { type: "file", path: "/abs/src/main.ts", displayName: "src/main.ts" },
      { type: "blob", data: "AA==", mimeType: "image/png", displayName: "shot.png" },
    ]);
    const labels = Array.from(
      container.querySelectorAll(".attachment-chip-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["src/main.ts", "shot.png"]);
    cleanup();
  });

  test("clicking the chip body emits 'open' with the index", async () => {
    const opened: { value: number | null } = { value: null };
    const { container } = mount(
      [
        { type: "file", path: "/abs/a.ts", displayName: "a.ts" },
        { type: "file", path: "/abs/b.ts", displayName: "b.ts" },
      ],
      { onOpen: (idx) => (opened.value = idx) },
    );
    const mainButtons = container.querySelectorAll(".attachment-chip-main");
    await fireEvent.click(mainButtons[1]!);
    await nextTick();
    expect(opened.value).toBe(1);
    cleanup();
  });

  test("clicking the ✕ button emits 'remove' with the index (and NOT 'open')", async () => {
    const opened: { value: number | null } = { value: null };
    const removed: { value: number | null } = { value: null };
    const { container } = mount(
      [
        { type: "file", path: "/abs/a.ts", displayName: "a.ts" },
        { type: "file", path: "/abs/b.ts", displayName: "b.ts" },
      ],
      {
        onOpen: (idx) => (opened.value = idx),
        onRemove: (idx) => (removed.value = idx),
      },
    );
    const removeButtons = container.querySelectorAll(".attachment-chip-remove");
    await fireEvent.click(removeButtons[0]!);
    await nextTick();
    expect(removed.value).toBe(0);
    expect(opened.value).toBe(null);
    cleanup();
  });

  test("blob attachments without displayName fall back to a generic label", () => {
    const { container } = mount([
      { type: "blob", data: "AA==", mimeType: "image/png" },
    ]);
    const label = container.querySelector(".attachment-chip-label")?.textContent;
    expect(label).toBe("pasted png");
    cleanup();
  });
});
