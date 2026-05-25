/// Map a file extension or path → CodeMirror 6 language extension.
///
/// We delegate **all** extension/name lookups to `@codemirror/language-data`
/// and just whitelist which language packs we've actually installed.
/// Adding a language is two lines: add the dep, then add its
/// language-data name to `enabledLanguages`.

import type { Extension } from '@codemirror/state';
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages as languageData } from '@codemirror/language-data';

let cache = new Map<string, Extension>();

/// language-data display names for the language packs we've installed.
/// Anything not in this set resolves to null, even if language-data
/// knows the language — keeps us from accidentally trying to import a
/// missing @codemirror/lang-* package at runtime.
const enabledLanguages: ReadonlySet<string> = new Set([
  'JavaScript',
  'TypeScript',
  'JSX',
  'TSX',
  'JSON',
  'Markdown',
  'CSS',
  'Sass',
  'SCSS',
  'HTML',
  'Python',
  'Rust',
  'Go',
  'Vue',
]);

/// language-data's Python descriptor doesn't include `.pyi`; its JSON
/// descriptor doesn't include `.jsonc`. Patch them in so a single
/// table covers every extension we care about. Empty list otherwise.
const extraExtensionsFor: Record<string, readonly string[]> = {
  Python: ['pyi'],
  JSON: ['jsonc'],
};

function isEnabled(desc: LanguageDescription): boolean {
  return enabledLanguages.has(desc.name);
}

function extractExtension(fileOrExt: string): string {
  const tail = fileOrExt.replace(/\\/g, '/').split('/').pop() ?? fileOrExt;
  const dot = tail.lastIndexOf('.');

  return (dot >= 0 ? tail.slice(dot + 1) : tail).toLowerCase();
}

function findByExtension(ext: string): LanguageDescription | null {
  for (const desc of languageData) {
    if (!isEnabled(desc)) continue;

    if (desc.extensions.includes(ext)) return desc;

    const extras = extraExtensionsFor[desc.name];

    if (extras?.includes(ext)) return desc;
  }

  return null;
}

async function loadFromDescription(desc: LanguageDescription): Promise<Extension> {
  const support: LanguageSupport = await desc.load();

  return support;
}

/// Resolve a CM6 language extension by language id (a short alias
/// like `ts`, `tsx`, `py`, or a display name like `TypeScript`).
/// Result is cached across calls.
export async function resolveLanguageExtension(
  langId: string | null | undefined,
): Promise<Extension | null> {
  if (!langId) return null;

  const key = langId.toLowerCase();

  if (cache.has(key)) return cache.get(key) as Extension;

  const desc = LanguageDescription.matchLanguageName(languageData, key, true);

  if (!desc || !isEnabled(desc)) return null;

  const ext = await loadFromDescription(desc);

  cache.set(key, ext);

  return ext;
}

/// Resolve via a file extension OR full filename (e.g. `foo.ts` or
/// `ts`). Path separators tolerated, case-insensitive.
export async function resolveLanguageForFile(
  fileOrExt: string | null | undefined,
): Promise<Extension | null> {
  if (!fileOrExt) return null;

  const ext = extractExtension(fileOrExt);

  if (!ext) return null;

  if (cache.has(ext)) return cache.get(ext) as Extension;

  const desc = findByExtension(ext);

  if (!desc) return null;

  const result = await loadFromDescription(desc);

  cache.set(ext, result);

  return result;
}

/// Reset the cache. Used by tests; the renderer doesn't hot-reload
/// language packs so this is otherwise unused.
export function _resetLanguageCache(): void {
  cache = new Map();
}
