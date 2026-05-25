import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { browseDirectorySync } from '../app/filesystem/directoryBrowser';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dafman-browse-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'alpha'));
  mkdirSync(join(root, 'Alphabet'));
  mkdirSync(join(root, 'beta'));
  mkdirSync(join(root, '.hidden'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'readme.md'), 'x');
  writeFileSync(join(root, 'afile'), 'x');
  return root;
}

describe('browseDirectorySync', () => {
  test('empty prefix returns []', () => {
    expect(browseDirectorySync('')).toEqual([]);
    expect(browseDirectorySync('   ')).toEqual([]);
  });

  test('non-existent parent returns [] (no throw)', () => {
    expect(browseDirectorySync('/no/such/path/whatever')).toEqual([]);
  });

  test('lists subdirectories matching the leaf prefix (case-insensitive)', () => {
    const root = makeFixture();
    const out = browseDirectorySync(join(root, 'alp'));
    expect(out.length).toBe(2);
    // Sorted case-insensitively
    expect(out[0]?.toLowerCase()).toContain('alpha');
    expect(out[1]?.toLowerCase()).toContain('alphabet');
  });

  test('trailing separator lists everything in the directory', () => {
    const root = makeFixture();
    const out = browseDirectorySync(root + sep);
    // alpha, Alphabet, beta, node_modules — not .hidden, not the
    // regular files (afile, readme.md).
    const names = out.map((p) => p.slice(p.lastIndexOf(sep) + 1));
    expect(names).toContain('alpha');
    expect(names).toContain('Alphabet');
    expect(names).toContain('beta');
    expect(names).toContain('node_modules');
    expect(names).not.toContain('.hidden');
    expect(names).not.toContain('afile');
    expect(names).not.toContain('readme.md');
  });

  test('hidden / dot-prefixed entries are suggested only when typed', () => {
    const root = makeFixture();
    const naked = browseDirectorySync(root + sep);
    expect(naked.some((p) => p.endsWith('.hidden'))).toBe(false);
    const typed = browseDirectorySync(join(root, '.hid'));
    expect(typed.some((p) => p.endsWith('.hidden'))).toBe(true);
  });

  test('only directories — files are filtered out even when their name matches', () => {
    const root = makeFixture();
    const out = browseDirectorySync(join(root, 'rea'));
    expect(out).toEqual([]); // readme.md is a file
  });

  test('returns absolute paths joined with the platform separator', () => {
    const root = makeFixture();
    const out = browseDirectorySync(join(root, 'alp'));
    for (const p of out) {
      expect(p.startsWith(root)).toBe(true);
      expect(p.includes(sep)).toBe(true);
    }
  });
});
