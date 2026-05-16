import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: unknown) => invokeMock(name, args),
}));

import { AppError, invokeCommand } from "../invoke";

describe("invoke wrapper", () => {
  it("returns the resolved value verbatim on success", async () => {
    invokeMock.mockResolvedValueOnce("Copilot client created");
    const result = await invokeCommand("create_client", {});
    expect(result).toBe("Copilot client created");
    expect(invokeMock).toHaveBeenCalledWith("create_client", {});
  });

  it("wraps an AppErrorPayload rejection into a typed AppError", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "ClientNotStarted" });
    await expect(
      invokeCommand("create_session", { onEvent: {} as never }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("formats ClientNotStarted with a friendly message", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "ClientNotStarted" });
    try {
      await invokeCommand("create_client", {});
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toBe("Copilot client not started");
      expect((err as AppError).payload).toEqual({ kind: "ClientNotStarted" });
    }
  });

  it("formats SessionNotFound with the id", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "SessionNotFound",
      data: "sess-42",
    });
    try {
      await invokeCommand("disconnect_session", { sessionId: "sess-42" });
    } catch (err) {
      expect((err as AppError).message).toBe("Session sess-42 not found");
    }
  });

  it("formats Settings errors with the inner detail", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "Settings", data: "disk full" });
    try {
      await invokeCommand("get_settings", {});
    } catch (err) {
      expect((err as AppError).message).toBe("Settings error: disk full");
    }
  });

  it("formats Sdk errors with the inner detail", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "Sdk", data: "rpc timeout" });
    try {
      await invokeCommand("send_message", { sessionId: "s", text: "hi" });
    } catch (err) {
      expect((err as AppError).message).toBe("SDK error: rpc timeout");
    }
  });

  it("rethrows raw Error instances unchanged", async () => {
    const original = new Error("boom");
    invokeMock.mockRejectedValueOnce(original);
    await expect(invokeCommand("create_client", {})).rejects.toBe(original);
  });

  it("wraps non-Error non-AppErrorPayload rejections via String()", async () => {
    invokeMock.mockRejectedValueOnce("string rejection");
    await expect(invokeCommand("create_client", {})).rejects.toThrow(
      "string rejection",
    );
  });

  it("does not treat objects without a known 'kind' as AppError", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "Unknown", data: "x" });
    await expect(invokeCommand("create_client", {})).rejects.not.toBeInstanceOf(
      AppError,
    );
  });
});
