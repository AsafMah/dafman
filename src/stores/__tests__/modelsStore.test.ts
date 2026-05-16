import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: unknown) => invokeMock(name, args),
  Channel: class {},
}));

import { useModelsStore } from "../modelsStore";
import { useToastStore } from "../toastStore";

describe("modelsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
  });

  it("load() hydrates the models list from the backend", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "gpt-5",
        name: "GPT 5",
        supportsReasoningEffort: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
      },
    ]);
    const store = useModelsStore();
    const models = await store.load();
    expect(models).toHaveLength(1);
    expect(store.loaded).toBe(true);
    expect(store.isLoading).toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("load() dedupes concurrent calls into a single in-flight request", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "a",
        name: "A",
        supportsReasoningEffort: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
      },
    ]);
    const store = useModelsStore();
    const [a, b] = await Promise.all([store.load(), store.load()]);
    expect(a).toBe(b);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("load() is idempotent after success (no re-fetch)", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const store = useModelsStore();
    await store.load();
    await store.load();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("load() surfaces a toast and rethrows on backend error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    const store = useModelsStore();
    const toasts = useToastStore();
    await expect(store.load()).rejects.toThrow("nope");
    expect(store.loaded).toBe(false);
    expect(toasts.pending.some((t) => t.severity === "error")).toBe(true);
  });

  it("find() returns the model by id or undefined", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "claude-sonnet-4.5",
        name: "Claude",
        supportsReasoningEffort: true,
        supportedReasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
      },
    ]);
    const store = useModelsStore();
    await store.load();
    expect(store.find("claude-sonnet-4.5")?.name).toBe("Claude");
    expect(store.find("missing")).toBeUndefined();
  });
});
