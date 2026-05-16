import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: unknown) => invokeMock(name, args),
  Channel: class {},
}));

import { useSettingsStore } from "../settingsStore";
import { useToastStore } from "../toastStore";

describe("settingsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
  });

  it("load() pulls settings from the backend and flips loaded", async () => {
    invokeMock.mockResolvedValueOnce({
      version: 1,
      appearance: { theme: "dark" },
    });
    const store = useSettingsStore();
    const result = await store.load();
    expect(result.appearance.theme).toBe("dark");
    expect(store.loaded).toBe(true);
    expect(store.settings.appearance.theme).toBe("dark");
  });

  it("load() surfaces a toast and rethrows on error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    const store = useSettingsStore();
    const toasts = useToastStore();
    await expect(store.load()).rejects.toThrow("disk full");
    expect(store.loaded).toBe(false);
    expect(toasts.pending.some((t) => t.severity === "error")).toBe(true);
  });

  it("setTheme() forwards a full-replace update_settings with the new theme", async () => {
    invokeMock.mockResolvedValueOnce({
      version: 1,
      appearance: { theme: "light" },
    });
    const store = useSettingsStore();
    await store.setTheme("light");
    expect(invokeMock).toHaveBeenCalledWith("update_settings", {
      next: { version: 1, appearance: { theme: "light" } },
    });
    expect(store.settings.appearance.theme).toBe("light");
    expect(store.isSaving).toBe(false);
  });

  it("update() rolls forward when the backend stamps a new version", async () => {
    invokeMock.mockResolvedValueOnce({
      version: 2,
      appearance: { theme: "dark" },
    });
    const store = useSettingsStore();
    const written = await store.update({
      version: 1,
      appearance: { theme: "dark" },
    });
    expect(written.version).toBe(2);
    expect(store.settings.version).toBe(2);
  });
});
