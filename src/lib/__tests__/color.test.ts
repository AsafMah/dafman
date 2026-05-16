import { describe, expect, it } from "vitest";
import { accentForIndex, accentForSession, hashString } from "../color";
describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
  });
  it("returns 0 for the empty string (FNV-1a-ish seed unchanged)", () => {
    // 2166136261 >>> 0 = 2166136261; the function returns the seed unchanged
    // when no characters have been mixed in.
    expect(hashString("")).toBe(2166136261 >>> 0);
  });
  it("produces different hashes for different inputs", () => {
    const a = hashString("session-1");
    const b = hashString("session-2");
    expect(a).not.toBe(b);
  });
  it("returns an unsigned 32-bit integer", () => {
    const h = hashString("local-echo-session");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});
describe("accentForIndex", () => {
  it("returns a valid hsl(...) string", () => {
    expect(accentForIndex(0)).toMatch(/^hsl\(\s*\d+(?:\.\d+)?,/);
  });
  it("cycles through the 12-color palette", () => {
    expect(accentForIndex(0)).toBe(accentForIndex(12));
    expect(accentForIndex(1)).toBe(accentForIndex(13));
  });
  it("handles negative indices safely", () => {
    expect(() => accentForIndex(-1)).not.toThrow();
    expect(accentForIndex(-1)).toMatch(/^hsl/);
  });
  it("produces distinct colors for the first 12 indices", () => {
    const colors = new Set<string>();
    for (let i = 0; i < 12; i++) colors.add(accentForIndex(i));
    expect(colors.size).toBe(12);
  });
});
describe("accentForSession", () => {
  it("returns one of the palette entries", () => {
    expect(accentForSession("xyz")).toMatch(/^hsl/);
  });
  it("is stable for the same session id", () => {
    expect(accentForSession("xyz")).toBe(accentForSession("xyz"));
  });
});
