import { describe, expect, it } from "vitest";
import { generateSessionAlias } from "../sessionAlias";

describe("generateSessionAlias", () => {
  it("produces a two-word kebab string", () => {
    const alias = generateSessionAlias();
    expect(alias).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("is deterministic given a fixed rng", () => {
    let seed = 0;
    const rng = () => {
      seed += 0.123456789;
      return seed - Math.floor(seed);
    };
    const a = generateSessionAlias(rng);
    let seed2 = 0;
    const rng2 = () => {
      seed2 += 0.123456789;
      return seed2 - Math.floor(seed2);
    };
    expect(generateSessionAlias(rng2)).toBe(a);
  });

  it("picks the first word of each list when rng returns 0", () => {
    const rng = () => 0;
    expect(generateSessionAlias(rng)).toBe("amber-anchor");
  });
});
