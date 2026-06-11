import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectService, canonicalizePath } from '../app/config/projectService';
import type { Project } from '../rpc';

const TEST_DIR = join(tmpdir(), `dafman-projects-test-${Date.now()}`);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    path: '/test/workspace',
    defaults: { agentName: 'my-agent', runMode: 'autopilot' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('ProjectService', () => {
  test('loadOrDefault returns empty list for missing file', () => {
    const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'missing.json'));

    expect(svc.list()).toEqual([]);
  });

  test('loadOrDefault returns empty list for corrupt file', () => {
    const path = join(TEST_DIR, 'corrupt.json');

    writeFileSync(path, '{ invalid json !!!', 'utf8');
    const svc = ProjectService.loadOrDefault(path);

    expect(svc.list()).toEqual([]);
  });

  test('save inserts a new project', async () => {
    const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'p.json'));
    const p = makeProject({ path: '/test/a' });

    await svc.save(p);
    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0]?.defaults.agentName).toBe('my-agent');
  });

  test('save updates an existing project by canonical path', async () => {
    const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'p.json'));
    const p = makeProject({ path: '/test/a' });

    await svc.save(p);
    await svc.save({ ...p, defaults: { agentName: 'updated' } });
    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0]?.defaults.agentName).toBe('updated');
  });

  test('getForPath returns matching project', async () => {
    const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'p.json'));
    const p = makeProject({ path: '/test/workspace' });

    await svc.save(p);
    expect(svc.getForPath('/test/workspace')?.defaults.agentName).toBe('my-agent');
  });

  test('getForPath returns undefined for no match', async () => {
    const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'p.json'));

    await svc.save(makeProject({ path: '/test/a' }));
    expect(svc.getForPath('/test/b')).toBeUndefined();
  });

  test('delete removes project by path', async () => {
    const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'p.json'));

    await svc.save(makeProject({ path: '/test/a' }));
    await svc.save(makeProject({ path: '/test/b' }));
    expect(svc.list()).toHaveLength(2);
    await svc.delete('/test/a');
    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0]?.path).toContain('test');
    expect(svc.list()[0]?.path).toContain('b');
  });

  test('list returns all projects', async () => {
    const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'p.json'));

    await svc.save(makeProject({ path: '/test/a' }));
    await svc.save(makeProject({ path: '/test/b' }));
    await svc.save(makeProject({ path: '/test/c' }));
    expect(svc.list()).toHaveLength(3);
  });

  test('atomic round-trip: reloaded file contains saved projects', async () => {
    const file = join(TEST_DIR, 'p.json');
    const svc = ProjectService.loadOrDefault(file);

    await svc.save(makeProject({ path: '/test/persist', name: 'My Project' }));
    expect(existsSync(file)).toBe(true);

    const svc2 = ProjectService.loadOrDefault(file);

    expect(svc2.list()).toHaveLength(1);
    expect(svc2.list()[0]?.name).toBe('My Project');
  });

  test('Windows case-fold: getForPath matches case-insensitively on Windows', async () => {
    // canonicalizePath lowercases on win32; this test verifies the logic
    // directly since the test may run on any platform.
    if (process.platform === 'win32') {
      const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'p.json'));

      await svc.save(makeProject({ path: 'C:\\Users\\Dev\\repo' }));
      expect(svc.getForPath('C:\\Users\\dev\\REPO')).toBeDefined();
      expect(svc.getForPath('c:\\users\\dev\\repo')).toBeDefined();
    } else {
      // On non-Windows, verify canonicalization at least resolves the path
      const canon = canonicalizePath('/home/user/../user/repo');

      expect(canon).toBe('/home/user/repo');
    }
  });

  test('loadOrDefault tolerates missing file gracefully and returns empty service', () => {
    const svc = ProjectService.loadOrDefault(join(TEST_DIR, 'nonexistent', 'p.json'));

    expect(svc.list()).toEqual([]);
    // getForPath on empty store returns undefined
    expect(svc.getForPath('/any/path')).toBeUndefined();
  });
});
