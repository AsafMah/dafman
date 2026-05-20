/// Map a file extension or path → CodeMirror 6 language extension.
///
/// Lazily resolved so any single tool card only pays for the languages
/// it actually renders. The CM6 lang packages each export a factory
/// (e.g. `javascript({ typescript: true })`) — we call them at lookup
/// time and cache the result.

import type { Extension } from "@codemirror/state";

let cache = new Map<string, Extension>();

type LangFactory = () => Promise<Extension>;

const factories: Record<string, LangFactory> = {
  javascript: async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript();
  },
  typescript: async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ typescript: true });
  },
  jsx: async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ jsx: true });
  },
  tsx: async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ typescript: true, jsx: true });
  },
  json: async () => {
    const { json } = await import("@codemirror/lang-json");
    return json();
  },
  markdown: async () => {
    const { markdown } = await import("@codemirror/lang-markdown");
    return markdown();
  },
  css: async () => {
    const { css } = await import("@codemirror/lang-css");
    return css();
  },
  html: async () => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  python: async () => {
    const { python } = await import("@codemirror/lang-python");
    return python();
  },
  rust: async () => {
    const { rust } = await import("@codemirror/lang-rust");
    return rust();
  },
  go: async () => {
    const { go } = await import("@codemirror/lang-go");
    return go();
  },
};

const extensionMap: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "css",
  html: "html",
  htm: "html",
  vue: "html",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
};

/// Resolve a CM6 language extension by language id (one of the keys
/// of `factories` OR a short alias from `extensionMap`). Result is
/// cached across calls. Aliases mean a markdown fence like ```ts
/// resolves to the typescript pack the same way `App.ts` does.
export async function resolveLanguageExtension(
  langId: string | null | undefined,
): Promise<Extension | null> {
  if (!langId) return null;
  const key = langId.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  // Direct factory lookup first…
  let factory = factories[key];
  // …then fall through aliases ("ts" → "typescript", "py" → "python",
  // "md" → "markdown", "rs" → "rust", "vue" → "html", etc.). Reuses
  // the file-extension table so we only maintain one mapping.
  if (!factory) {
    const aliased = extensionMap[key];
    if (aliased) factory = factories[aliased];
  }
  if (!factory) return null;
  const ext = await factory();
  cache.set(key, ext);
  return ext;
}

/// Resolve via a file extension OR full filename (e.g. `foo.ts` or
/// `ts`). Path separators are tolerated.
export async function resolveLanguageForFile(
  fileOrExt: string | null | undefined,
): Promise<Extension | null> {
  if (!fileOrExt) return null;
  const cleaned = fileOrExt.replace(/^.*[\\\/.]/, "").toLowerCase();
  const langId = extensionMap[cleaned];
  return resolveLanguageExtension(langId);
}

/// Reset the cache. Used by tests; the renderer doesn't hot-reload
/// language packs so this is otherwise unused.
export function _resetLanguageCache(): void {
  cache = new Map();
}
