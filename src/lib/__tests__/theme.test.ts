import { describe, expect, it } from "vitest";
import { resolveIsDark } from "../theme";

describe("resolveIsDark", () => {
  it("follows the system preference when theme is 'system'", () => {
    expect(resolveIsDark("system", true)).toBe(true);
    expect(resolveIsDark("system", false)).toBe(false);
  });

  it("ignores the system preference when theme is explicit", () => {
    expect(resolveIsDark("dark", false)).toBe(true);
    expect(resolveIsDark("light", true)).toBe(false);
  });
});
