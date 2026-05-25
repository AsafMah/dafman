import { describe, expect, test, beforeEach } from 'bun:test';
import {
  resolveLanguageExtension,
  resolveLanguageForFile,
  _resetLanguageCache,
} from '@/lib/codeLanguage';

describe('codeLanguage', () => {
  beforeEach(() => {
    _resetLanguageCache();
  });

  test('resolves a known language id', async () => {
    const ext = await resolveLanguageExtension('typescript');
    expect(ext).not.toBeNull();
  });

  test('returns null for an unknown language id', async () => {
    const ext = await resolveLanguageExtension('perl-7');
    expect(ext).toBeNull();
  });

  test('returns null for null/undefined input', async () => {
    expect(await resolveLanguageExtension(null)).toBeNull();
    expect(await resolveLanguageExtension(undefined)).toBeNull();
    expect(await resolveLanguageForFile(null)).toBeNull();
  });

  test('resolves a language from a bare extension', async () => {
    const ext = await resolveLanguageForFile('ts');
    expect(ext).not.toBeNull();
  });

  test('resolves a language from a full filename', async () => {
    const ext = await resolveLanguageForFile('src/main.ts');
    expect(ext).not.toBeNull();
  });

  test('vue files resolve to html highlighting (best-effort)', async () => {
    const ext = await resolveLanguageForFile('App.vue');
    expect(ext).not.toBeNull();
  });

  test('returns null for files with no extension we know', async () => {
    const ext = await resolveLanguageForFile('Makefile');
    expect(ext).toBeNull();
  });

  test('caches repeated lookups by language id', async () => {
    const first = await resolveLanguageExtension('json');
    const second = await resolveLanguageExtension('json');
    expect(first).toBe(second);
  });

  describe('regression coverage (pre-Phase-A-swap safety net)', () => {
    test('aliases ts -> typescript (both resolve, both non-null)', async () => {
      // NOTE: the cache is keyed by the raw input, so `ts` and `typescript`
      // produce distinct Extension instances. Phase A's `language-data`
      // swap or a cache-by-resolved-name change may make these identical.
      const a = await resolveLanguageExtension('ts');
      const b = await resolveLanguageExtension('typescript');
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });

    test('aliases tsx -> typescript+jsx', async () => {
      const ext = await resolveLanguageExtension('tsx');
      expect(ext).not.toBeNull();
    });

    test('resolves a mixed-case extension', async () => {
      const ext = await resolveLanguageForFile('App.TSX');
      expect(ext).not.toBeNull();
    });

    test('resolves windows-style paths', async () => {
      const ext = await resolveLanguageForFile('C:\\repo\\src\\App.ts');
      expect(ext).not.toBeNull();
    });

    test('resolves all currently supported langs', async () => {
      const langs = [
        'javascript',
        'typescript',
        'jsx',
        'tsx',
        'json',
        'markdown',
        'css',
        'html',
        'python',
        'rust',
        'go',
      ];

      for (const lang of langs) {
        const ext = await resolveLanguageExtension(lang);
        expect(ext, `should resolve ${lang}`).not.toBeNull();
      }
    });

    test('resolves all currently mapped extensions', async () => {
      const exts = [
        'js',
        'mjs',
        'cjs',
        'ts',
        'mts',
        'cts',
        'jsx',
        'tsx',
        'json',
        'jsonc',
        'md',
        'markdown',
        'css',
        'scss',
        'html',
        'htm',
        'vue',
        'py',
        'pyi',
        'rs',
        'go',
      ];

      for (const ext of exts) {
        const result = await resolveLanguageForFile(`file.${ext}`);
        expect(result, `should resolve .${ext}`).not.toBeNull();
      }
    });

    test('Makefile-style files without an extension fall back to null', async () => {
      expect(await resolveLanguageForFile('Makefile')).toBeNull();
      expect(await resolveLanguageForFile('Dockerfile')).toBeNull();
    });
  });
});
