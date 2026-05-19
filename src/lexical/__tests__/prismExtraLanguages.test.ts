import { describe, expect, test } from "bun:test";
import Prism from "prismjs";
import { PRISM_EXTRA_LANGUAGES_LOADED } from "../prismExtraLanguages";

// Regression pin: a previous edit re-ordered prism component imports
// such that `prism-markup-templating` was imported before `prism-markup`,
// `prism-jsx` before `prism-markup`, etc. Each component's module body
// throws at evaluation time if its prerequisites aren't already on the
// global `Prism.languages` registry — that crashes the bundle at startup
// and the user sees a blank window. Importing this file in a test
// exercises the same module-load path; if any component throws, the
// test runner fails on the import, not in an `expect`.

describe("prismExtraLanguages", () => {
  test("module loads without throwing", () => {
    expect(PRISM_EXTRA_LANGUAGES_LOADED).toBe(true);
  });

  test("registers the full @lexical/code stock language set", () => {
    for (const lang of [
      "markup","clike","c","cpp","javascript","typescript","jsx","tsx",
      "css","markdown","python","rust","java","swift","objectivec",
      "sql","powershell",
    ]) {
      expect(Prism.languages[lang]).toBeDefined();
    }
  });

  test("registers the extras beyond @lexical/code", () => {
    for (const lang of [
      "bash","json","diff","yaml","toml","go","ruby","php","kotlin","csharp",
    ]) {
      expect(Prism.languages[lang]).toBeDefined();
    }
  });
});
