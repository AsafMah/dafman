import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setActivePinia, createPinia } from "pinia";
import { cleanup, render, fireEvent } from "@testing-library/vue";
import { nextTick } from "vue";
import CommandPalette from "../CommandPalette.vue";
import { searchValueFor } from "../../lib/palette";
import { useCommandRegistry } from "../../stores/commandRegistry";

/// Mounts the palette and pops it open via the test-only `__testOpen`
/// expose. Returns the test-library handle + the dialog root element
/// (queried via the body, since the library teleports the dialog out
/// of the component subtree).
async function mountOpenPalette() {
  const utils = render(CommandPalette);
  // expose() returns are surfaced via the component instance —
  // @testing-library/vue doesn't give it back directly, so reach in
  // through the rendered root's __vueParentComponent.
  // Easier path: open via the global Ctrl+K hotkey which is what the
  // user would do anyway.
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
    }),
  );
  await nextTick();
  await nextTick();
  return utils;
}

describe("searchValueFor", () => {
  test("includes id + label + group + hint + keywords", () => {
    const value = searchValueFor({
      id: "cmd.test",
      label: "Test Command",
      group: "Group A",
      hint: "hint info",
      keywords: ["alpha", "beta"],
      run: () => {},
    });
    expect(value).toContain("cmd.test");
    expect(value).toContain("Test Command");
    expect(value).toContain("Group A");
    expect(value).toContain("hint info");
    expect(value).toContain("alpha");
    expect(value).toContain("beta");
  });

  test("omits empty / missing optional fields", () => {
    const value = searchValueFor({
      id: "cmd.bare",
      label: "Bare",
      run: () => {},
    });
    expect(value).toBe("cmd.bare Bare");
  });

  test("two commands with similar labels still produce distinct values via id prefix", () => {
    const a = searchValueFor({ id: "a", label: "Open Settings", run: () => {} });
    const b = searchValueFor({ id: "b", label: "Open Settings", run: () => {} });
    expect(a).not.toBe(b);
  });
});

describe("CommandPalette", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // The library teleports `Command.Dialog` to `document.body`.
  // `@testing-library/vue`'s `cleanup()` unmounts the test's mounted
  // component, but Vue's teleport target survives across tests if we
  // don't sweep it — and a zombie palette from one test will intercept
  // queries / events in the next. Clear both.
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  test("Ctrl+K opens the dialog; Escape closes it", async () => {
    const registry = useCommandRegistry();
    registry.register({ id: "x.demo", label: "Demo", run: () => {} });

    await mountOpenPalette();

    // Library teleports the dialog to document.body; query there.
    const dialog = document.querySelector("[command-dialog]");
    expect(dialog).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    await nextTick();
    const dialogAfter = document.querySelector("[command-dialog]");
    expect(dialogAfter).toBeNull();
  });

  test("clicking an item invokes the command's run()", async () => {
    const registry = useCommandRegistry();
    let ranWith: string | null = null;
    registry.register({
      id: "x.run-me",
      label: "Run Me",
      group: "Demo",
      run: () => {
        ranWith = "x.run-me" as string;
      },
    });
    registry.register({
      id: "x.other",
      label: "Other",
      group: "Demo",
      run: () => {
        ranWith = "x.other";
      },
    });

    await mountOpenPalette();

    // Items render with `data-value` derived from `searchValueFor`.
    const items = Array.from(document.querySelectorAll("[command-item]"));
    expect(items.length).toBeGreaterThanOrEqual(2);
    const runMe = items.find((el) =>
      (el.getAttribute("data-value") ?? "").includes("x.run-me"),
    ) as HTMLElement | undefined;
    expect(runMe).toBeTruthy();

    await fireEvent.click(runMe!);
    // `closePalette()` calls `cmd.run()` inside a `nextTick`. Flush a
    // couple of ticks so the closure resolves before we assert.
    await nextTick();
    await nextTick();

    expect(ranWith).toBe("x.run-me");
  });

  test("when() = false commands are not rendered", async () => {
    const registry = useCommandRegistry();
    registry.register({ id: "y.always", label: "Always", run: () => {} });
    registry.register({
      id: "y.never",
      label: "Never",
      when: () => false,
      run: () => {},
    });

    await mountOpenPalette();

    const values = Array.from(document.querySelectorAll("[command-item]"))
      .map((el) => el.getAttribute("data-value") ?? "");
    expect(values.some((v) => v.includes("y.always"))).toBe(true);
    expect(values.some((v) => v.includes("y.never"))).toBe(false);
  });
});
