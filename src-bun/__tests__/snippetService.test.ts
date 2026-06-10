import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SnippetService } from '../app/config/snippetService';
import type { Snippet } from '../rpc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

function makeTempDir(): string {
  const dir = join(tmpdir(), `snippet-test-${Math.random().toString(16).slice(2)}`);

  mkdirSync(dir, { recursive: true });

  return dir;
}

function makePath(): string {
  return join(testDir, 'snippets.json');
}

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: 'Test snippet',
    body: 'Hello world',
    tags: ['test'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  testDir = makeTempDir();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SnippetService — load-or-default', () => {
  test('returns empty list when file does not exist', () => {
    const svc = SnippetService.loadOrDefault(makePath());

    expect(svc.list()).toEqual([]);
  });

  test('returns empty list when file contains invalid JSON', async () => {
    const path = makePath();

    await Bun.write(path, '{ not valid json !!!');
    const svc = SnippetService.loadOrDefault(path);

    expect(svc.list()).toEqual([]);
  });

  test('returns empty list when file has wrong shape', async () => {
    const path = makePath();

    await Bun.write(path, JSON.stringify({ version: 1, snippets: null }));
    const svc = SnippetService.loadOrDefault(path);

    expect(svc.list()).toEqual([]);
  });

  test('loads valid snippets from file', async () => {
    const path = makePath();
    const snippet = makeSnippet({ id: 'aaa', title: 'From disk' });

    await Bun.write(path, JSON.stringify({ version: 1, snippets: [snippet] }));
    const svc = SnippetService.loadOrDefault(path);

    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0].id).toBe('aaa');
    expect(svc.list()[0].title).toBe('From disk');
  });

  test('skips malformed snippet entries, keeps valid ones', async () => {
    const path = makePath();
    const valid = makeSnippet({ id: 'valid' });

    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        snippets: [null, { not: 'a snippet' }, valid],
      }),
    );
    const svc = SnippetService.loadOrDefault(path);

    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0].id).toBe('valid');
  });
});

describe('SnippetService — save (insert)', () => {
  test('inserts new snippet and persists to disk', async () => {
    const path = makePath();
    const svc = SnippetService.loadOrDefault(path);
    const s = makeSnippet({ id: 'new-1', title: 'New' });

    await svc.save(s);

    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0].id).toBe('new-1');

    // Verify file was written
    expect(existsSync(path)).toBe(true);
    const disk = JSON.parse(readFileSync(path, 'utf8')) as { snippets: Snippet[] };

    expect(disk.snippets).toHaveLength(1);
    expect(disk.snippets[0].id).toBe('new-1');
  });

  test('auto-generates id when snippet.id is empty', async () => {
    const svc = SnippetService.loadOrDefault(makePath());
    const s = makeSnippet({ id: '' });

    await svc.save(s);

    const list = svc.list();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBeTruthy();
    expect(list[0].id).not.toBe('');
  });

  test('stamps createdAt when not provided', async () => {
    const before = Date.now();
    const svc = SnippetService.loadOrDefault(makePath());
    const s: Snippet = {
      id: 'ts-test',
      title: 'Stamp test',
      body: 'body',
      tags: [],
      createdAt: '',
      updatedAt: '',
    };

    await svc.save(s);

    const saved = svc.list()[0];
    const createdMs = new Date(saved.createdAt).getTime();

    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(createdMs).toBeLessThanOrEqual(Date.now());
  });
});

describe('SnippetService — save (update)', () => {
  test('updates existing snippet by id', async () => {
    const path = makePath();
    const svc = SnippetService.loadOrDefault(path);
    const original = makeSnippet({ id: 'upd-1', title: 'Original', body: 'Old body' });

    await svc.save(original);
    await svc.save({ ...original, title: 'Updated', body: 'New body' });

    const list = svc.list();

    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Updated');
    expect(list[0].body).toBe('New body');
  });

  test('updates updatedAt to a value later than the original', async () => {
    const svc = SnippetService.loadOrDefault(makePath());
    const original = '2000-01-01T00:00:00.000Z';
    const s = makeSnippet({ id: 'time-1', updatedAt: original });

    await svc.save(s);

    // The service overwrites updatedAt with the current time, so the saved
    // value must be strictly later than the far-past original we supplied.
    const saved = svc.list()[0].updatedAt;

    expect(new Date(saved).getTime()).toBeGreaterThan(new Date(original).getTime());
  });

  test('preserves original createdAt on update', async () => {
    const svc = SnippetService.loadOrDefault(makePath());
    const created = '2020-01-01T00:00:00.000Z';
    const s = makeSnippet({ id: 'created-1', createdAt: created });

    await svc.save(s);
    await svc.save({ ...s, title: 'Updated' });

    expect(svc.list()[0].createdAt).toBe(created);
  });
});

describe('SnippetService — delete', () => {
  test('deletes snippet by id', async () => {
    const svc = SnippetService.loadOrDefault(makePath());
    const a = makeSnippet({ id: 'del-a', title: 'A' });
    const b = makeSnippet({ id: 'del-b', title: 'B' });

    await svc.save(a);
    await svc.save(b);
    await svc.delete('del-a');

    const list = svc.list();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('del-b');
  });

  test('no-op delete on unknown id', async () => {
    const svc = SnippetService.loadOrDefault(makePath());
    const s = makeSnippet({ id: 'keep' });

    await svc.save(s);
    await svc.delete('does-not-exist');

    expect(svc.list()).toHaveLength(1);
  });
});

describe('SnippetService — body length validation', () => {
  test('rejects body exceeding 10 000 characters', async () => {
    const svc = SnippetService.loadOrDefault(makePath());
    const s = makeSnippet({ body: 'x'.repeat(10_001) });

    await expect(svc.save(s)).rejects.toThrow();
  });

  test('accepts body exactly at 10 000 characters', async () => {
    const svc = SnippetService.loadOrDefault(makePath());
    const s = makeSnippet({ id: 'max-body', body: 'x'.repeat(10_000) });

    await expect(svc.save(s)).resolves.toBeUndefined();
    expect(svc.list()[0].body).toHaveLength(10_000);
  });
});

describe('SnippetService — list ordering', () => {
  test('preserves insertion order', async () => {
    const svc = SnippetService.loadOrDefault(makePath());

    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      await svc.save(makeSnippet({ id: title.toLowerCase(), title }));
    }

    const ids = svc.list().map((s) => s.id);

    expect(ids).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('SnippetService — atomic persistence round-trip', () => {
  test('persisted data survives reload', async () => {
    const path = makePath();
    const svc1 = SnippetService.loadOrDefault(path);
    const s = makeSnippet({ id: 'persist-1', title: 'Persist me', tags: ['foo', 'bar'] });

    await svc1.save(s);

    // Load a fresh instance from the same path
    const svc2 = SnippetService.loadOrDefault(path);
    const list = svc2.list();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('persist-1');
    expect(list[0].title).toBe('Persist me');
    expect(list[0].tags).toEqual(['foo', 'bar']);
  });

  test('delete is persisted to disk', async () => {
    const path = makePath();
    const svc1 = SnippetService.loadOrDefault(path);

    await svc1.save(makeSnippet({ id: 'del-persist' }));
    await svc1.delete('del-persist');

    const svc2 = SnippetService.loadOrDefault(path);

    expect(svc2.list()).toHaveLength(0);
  });

  test('written file uses atomic rename (not left as .tmp)', async () => {
    const path = makePath();
    const svc = SnippetService.loadOrDefault(path);

    await svc.save(makeSnippet({ id: 'atomic-1' }));

    // The target file must exist; no .tmp file should be left behind
    expect(existsSync(path)).toBe(true);

    const tmpFiles = existsSync(testDir)
      ? require('node:fs')
          .readdirSync(testDir)
          .filter((f: string) => f.includes('.tmp'))
      : [];

    expect(tmpFiles).toHaveLength(0);
  });
});
