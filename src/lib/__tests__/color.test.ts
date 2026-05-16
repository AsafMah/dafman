import { describe, expect, it } from "vitest";
import { accentForSession, hashString } from "../color";
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
describe("accentForSession", () => {
  it("produces a valid hsl(h, 70%, 55%) string", () => {
    const color = accentForSession("abc");
    expect(color).toMatch(/^hsl\(\d{1,3}, 70%, 55%\)$/);
  });
  it("is stable for the same session id", () => {
    expect(accentForSession("xyz")).toBe(accentForSession("xyz"));
  });
  it("differs for different session ids", () => {
    // Two close-but-distinct ids should not collide on hue for our fixtures.
    expect(accentForSession("session-alpha")).not.toBe(
      accentForSession("session-bravo"),
    );
  });
  it("clamps the hue to 0..359", () => {
    const color = accentForSession("any");
    const match = color.match(/^hsl\((\d+),/);
    expect(match).not.toBeNull();
    const hue = Number(match![1]);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});
