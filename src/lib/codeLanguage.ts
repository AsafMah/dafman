/// Map a file extension or path → CodeMirror 6 language extension.
///
/// We use `@codemirror/language-data` as the canonical extension→name
/// resolver (it ships with mappings for ~150 languages), but only
/// activate the language packs we've explicitly installed. Anything
/// outside that allowlist resolves to null so we don't pay for grammars
/// we never need.
///
/// Each factory returns a Promise<Extension>; the result is cached
/// across calls.

import type { Extension } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages as languageData } from '@codemirror/language-data';

let cache = new Map<string, Extension>();

type LangFactory = () => Promise<Extension>;

const factories: Record<string, LangFactory> = {
  javascript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');

    return javascript();
  },
  typescript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');

    return javascript({ typescript: true });
  },
  jsx: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');

    return javascript({ jsx: true });
  },
  tsx: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');

    return javascript({ typescript: true, jsx: true });
  },
  json: async () => {
    const { json } = await import('@codemirror/lang-json');

    return json();
  },
  markdown: async () => {
    const { markdown } = await import('@codemirror/lang-markdown');

    return markdown();
  },
  css: async () => {
    const { css } = await import('@codemirror/lang-css');

    return css();
  },
  html: async () => {
    const { html } = await import('@codemirror/lang-html');

    return html();
  },
  python: async () => {
    const { python } = await import('@codemirror/lang-python');

    return python();
  },
  rust: async () => {
    const { rust } = await import('@codemirror/lang-rust');

    return rust();
  },
  go: async () => {
    const { go } = await import('@codemirror/lang-go');

    return go();
  },
};

/// Resolve a LanguageDescription (from language-data) to our factory
/// id. The descriptor's `alias[]` already contains lowercase short
/// names like "ts", "js", "py" so we walk that first, then fall back
/// to the normalised display name.
function factoryIdFor(desc: LanguageDescription): string | null {
  for (const alias of desc.alias) {
    if (alias in factories) return alias;
  }

  const lowered = desc.name.toLowerCase();

  return lowered in factories ? lowered : null;
}

/// Tiny alias table for extensions language-data doesn't cover or
/// where we deliberately want different behaviour (vue → html since
/// we don't ship @codemirror/lang-vue; jsonc → json; pyi → python;
/// scss → css). Everything else goes through language-data.
const extensionAliases: Record<string, string> = {
  jsonc: 'json',
  pyi: 'python',
  scss: 'css',
  vue: 'html',
};

function extractExtension(fileOrExt: string): string {
  const cleaned = fileOrExt.replace(/\\/g, '/');
  const tail = cleaned.split('/').pop() ?? cleaned;
  const dot = tail.lastIndexOf('.');

  return (dot >= 0 ? tail.slice(dot + 1) : tail).toLowerCase();
}

/// Resolve a CM6 language extension by language id (one of the keys
/// of `factories`, a short alias known to language-data, or a name
/// like "TypeScript"). Result is cached across calls.
export async function resolveLanguageExtension(
  langId: string | null | undefined,
): Promise<Extension | null> {
  if (!langId) return null;

  const key = langId.toLowerCase();

  if (cache.has(key)) return cache.get(key) as Extension;

  let factory = factories[key];

  if (!factory) {
    const desc = LanguageDescription.matchLanguageName(languageData, key, true);

    if (desc) {
      const id = factoryIdFor(desc);

      if (id) factory = factories[id];
    }
  }

  if (!factory) return null;

  const ext = await factory();

  cache.set(key, ext);

  return ext;
}

/// Resolve via a file extension OR full filename (e.g. `foo.ts` or
/// `ts`). Path separators tolerated, case-insensitive. We let
/// language-data do the extension→language match; a small alias
/// table covers the four extensions it doesn't track.
export async function resolveLanguageForFile(
  fileOrExt: string | null | undefined,
): Promise<Extension | null> {
  if (!fileOrExt) return null;

  const ext = extractExtension(fileOrExt);

  if (!ext) return null;

  if (extensionAliases[ext]) {
    return resolveLanguageExtension(extensionAliases[ext]);
  }

  const desc = LanguageDescription.matchFilename(languageData, `_.${ext}`);

  if (!desc) return null;

  const id = factoryIdFor(desc);

  return id ? resolveLanguageExtension(id) : null;
}

/// Reset the cache. Used by tests; the renderer doesn't hot-reload
/// language packs so this is otherwise unused.
export function _resetLanguageCache(): void {
  cache = new Map();
}
