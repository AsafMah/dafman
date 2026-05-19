import { describe, expect, test } from "bun:test";
import { indicatorStyle, styleFor } from "../notificationStyles";

describe("notificationStyles.styleFor", () => {
  test("each event type has a distinct color", () => {
    const colors = [
      styleFor("permission").color,
      styleFor("userInput").color,
      styleFor("elicitation").color,
      styleFor("unseenActivity").color,
    ];
    const unique = new Set(colors);
    expect(unique.size).toBe(4);
  });

  test("each event type has a distinct icon", () => {
    const icons = [
      styleFor("permission").iconSuffix,
      styleFor("userInput").iconSuffix,
      styleFor("elicitation").iconSuffix,
      styleFor("unseenActivity").iconSuffix,
    ];
    const unique = new Set(icons);
    expect(unique.size).toBe(4);
  });

  test("pending kinds pulse; unseenActivity does NOT (so it stays calm)", () => {
    expect(styleFor("permission").pulse).toBe(true);
    expect(styleFor("userInput").pulse).toBe(true);
    expect(styleFor("elicitation").pulse).toBe(true);
    expect(styleFor("unseenActivity").pulse).toBe(false);
  });
});

describe("notificationStyles.indicatorStyle", () => {
  test("returns the pending request's style when one is set (ignoring unseenTurns)", () => {
    // Pending priority test: even if there are unseen turns, the
    // active blocking request wins — that's the higher-priority
    // signal the user needs to action.
    const style = indicatorStyle("permission", 5);
    expect(style?.iconSuffix).toBe("shield");
  });

  test("falls back to 'unseenActivity' when only turns are unseen", () => {
    const style = indicatorStyle(null, 3);
    expect(style?.iconSuffix).toBe("check-circle");
    expect(style?.pulse).toBe(false);
  });

  test("returns null when neither pending nor unseen", () => {
    expect(indicatorStyle(null, 0)).toBeNull();
  });

  test("each pending request type produces a distinct style", () => {
    const perm = indicatorStyle("permission", 0)!;
    const inp = indicatorStyle("userInput", 0)!;
    const eli = indicatorStyle("elicitation", 0)!;
    expect(perm.color).not.toBe(inp.color);
    expect(inp.color).not.toBe(eli.color);
    expect(perm.color).not.toBe(eli.color);
  });
});
