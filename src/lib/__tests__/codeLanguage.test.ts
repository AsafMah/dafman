import { describe, expect, test, beforeEach } from 'bun:test';
import {
  resolveLanguageExtension,
  resolveLanguageForFile,
  _resetLanguageCache,
} from '../codeLanguage';

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
});
