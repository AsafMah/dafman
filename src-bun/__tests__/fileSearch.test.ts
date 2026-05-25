import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchWorkspaceFiles, _resetForTest, invalidate } from '../app/fileSearch';

/// fileSearch tests build a temp workspace, then exercise the two
/// modes (fuzzy + path-nav), the two split toggles (`includeHidden`
/// + `includeIgnored`), and the directory-aware result shape.

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dafman-filesearch-'));
  await Promise.all([
    writeFile(join(workspace, 'README.md'), 'hi'),
    writeFile(join(workspace, 'package.json'), '{}'),
  ]);
  await mkdir(join(workspace, 'src'));
  await mkdir(join(workspace, 'src', 'components'));
  await Promise.all([
    writeFile(join(workspace, 'src', 'main.ts'), '//'),
    writeFile(join(workspace, 'src', 'components', 'ChatWindow.vue'), '<!---->'),
  ]);
  // Ignored dir + dotfile dir — should be hidden by default, visible
  // when includeHidden=true.
  await mkdir(join(workspace, 'node_modules'));
  await writeFile(join(workspace, 'node_modules', 'leak.js'), '//');
  await mkdir(join(workspace, '.git'));
  await writeFile(join(workspace, '.git', 'config'), '');
  await writeFile(join(workspace, '.env'), 'SECRET=1');
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('fuzzy mode', () => {
  test('empty query lists project-root entries first', async () => {
    _resetForTest();
    const results = await searchWorkspaceFiles(workspace, '', 20);
    const paths = results.map((r) => r.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('package.json');
    // Directories come before files at the same depth.
    const srcIdx = paths.indexOf('src');
    const readmeIdx = paths.indexOf('README.md');
    expect(srcIdx).toBeGreaterThanOrEqual(0);
    expect(srcIdx).toBeLessThan(readmeIdx);
  });

  test('filename startsWith ranks above substring matches', async () => {
    _resetForTest();
    const results = await searchWorkspaceFiles(workspace, 'main', 10);
    const paths = results.map((r) => r.path);
    expect(paths[0]).toBe('src/main.ts');
  });

  test('results carry kind', async () => {
    _resetForTest();
    const results = await searchWorkspaceFiles(workspace, '', 20);
    const main = results.find((r) => r.path === 'src/main.ts');
    const src = results.find((r) => r.path === 'src');
    expect(main?.kind).toBe('file');
    expect(src?.kind).toBe('directory');
  });

  test('hides dotfiles + ignored dirs by default', async () => {
    _resetForTest();
    const all = await searchWorkspaceFiles(workspace, '', 100);
    expect(all.find((r) => r.path.startsWith('node_modules'))).toBeUndefined();
    expect(all.find((r) => r.path.startsWith('.git'))).toBeUndefined();
    expect(all.find((r) => r.path === '.env')).toBeUndefined();
  });

  test('includeHidden only surfaces dotfiles (not ignored dirs)', async () => {
    _resetForTest();
    const r = await searchWorkspaceFiles(workspace, '', 200, { includeHidden: true });
    const paths = r.map((x) => x.path);
    expect(paths).toContain('.env');
    // .git is BOTH a dotfile AND an IGNORED_DIRS member — should
    // require BOTH flags to surface.
    expect(paths.some((p) => p.startsWith('.git'))).toBe(false);
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
  });

  test('includeIgnored only surfaces ignored dirs (not dotfiles)', async () => {
    _resetForTest();
    const r = await searchWorkspaceFiles(workspace, '', 200, { includeIgnored: true });
    const paths = r.map((x) => x.path);
    expect(paths).toContain('node_modules');
    expect(paths).not.toContain('.env');
    expect(paths.some((p) => p.startsWith('.git'))).toBe(false);
  });

  test('both flags surface dotfiles + ignored dirs', async () => {
    _resetForTest();
    const all = await searchWorkspaceFiles(workspace, '', 200, {
      includeHidden: true,
      includeIgnored: true,
    });
    const paths = all.map((r) => r.path);
    expect(paths).toContain('.env');
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(true);
    expect(paths.some((p) => p.startsWith('.git'))).toBe(true);
  });

  test('invalidate forces re-index', async () => {
    _resetForTest();
    await searchWorkspaceFiles(workspace, '', 1);
    const newPath = join(workspace, 'FRESH.md');
    await writeFile(newPath, '');
    const cached = await searchWorkspaceFiles(workspace, 'FRESH', 5);
    expect(cached).toHaveLength(0);
    invalidate(workspace);
    const fresh = await searchWorkspaceFiles(workspace, 'FRESH', 5);
    expect(fresh.length).toBeGreaterThan(0);
    await rm(newPath);
  });
});

describe('path-nav mode', () => {
  test('relative dir/leaf prefix lists children', async () => {
    _resetForTest();
    const results = await searchWorkspaceFiles(workspace, 'src/', 20);
    const paths = results.map((r) => r.path);
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('src/components');
    // All results carry the typed `src/` prefix back.
    for (const r of results) {
      expect(r.path.startsWith('src/')).toBe(true);
    }
  });

  test('leaf prefix filters', async () => {
    _resetForTest();
    const results = await searchWorkspaceFiles(workspace, 'src/main', 20);
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('src/main.ts');
    expect(results[0]?.kind).toBe('file');
  });

  test('absolute path navigates from fs root', async () => {
    _resetForTest();
    // Use the temp workspace itself as an absolute path target.
    const results = await searchWorkspaceFiles(workspace, `${workspace}/READ`, 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.name).toBe('README.md');
  });

  test('nonexistent dir returns []', async () => {
    _resetForTest();
    const results = await searchWorkspaceFiles(workspace, 'nope/', 20);
    expect(results).toEqual([]);
  });

  test('path-nav hides dotfiles by default; includeHidden exposes them', async () => {
    _resetForTest();
    const defaulted = await searchWorkspaceFiles(workspace, './', 200);
    expect(defaulted.find((r) => r.path === './.env')).toBeUndefined();
    const hidden = await searchWorkspaceFiles(workspace, './', 200, { includeHidden: true });
    expect(hidden.find((r) => r.path === './.env')).toBeDefined();
  });
});
