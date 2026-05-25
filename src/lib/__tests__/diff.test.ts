import { describe, expect, test } from 'bun:test';
import { parseApplyPatch } from '@/lib/diff';

describe('parseApplyPatch', () => {
  test('parses an Update File hunk', () => {
    const patch =
      '*** Begin Patch\n' +
      '*** Update File: src/App.vue\n' +
      '@@\n' +
      '-const isDark = false;\n' +
      '+const isDark = true;\n' +
      '*** End Patch\n';
    const files = parseApplyPatch(patch);
    expect(files.length).toBe(1);
    expect(files[0]!.op).toBe('update');
    expect(files[0]!.path).toBe('src/App.vue');
    expect(files[0]!.hunks.length).toBe(1);
    const lines = files[0]!.hunks[0]!.lines;
    expect(lines[0]).toEqual({ kind: 'removed', text: 'const isDark = false;' });
    expect(lines[1]).toEqual({ kind: 'added', text: 'const isDark = true;' });
  });

  test('parses multiple files with different ops', () => {
    const patch =
      '*** Begin Patch\n' +
      '*** Add File: new.txt\n' +
      '+hello\n' +
      '*** Update File: a.txt\n' +
      '@@\n' +
      ' context\n' +
      '-old\n' +
      '+new\n' +
      '*** Delete File: gone.txt\n' +
      '*** End Patch\n';
    const files = parseApplyPatch(patch);
    expect(files.map((f) => f.op)).toEqual(['add', 'update', 'delete']);
    expect(files.map((f) => f.path)).toEqual(['new.txt', 'a.txt', 'gone.txt']);
    expect(files[1]!.hunks[0]!.lines[0]).toEqual({
      kind: 'context',
      text: 'context',
    });
  });

  test('tolerates a missing trailing End Patch', () => {
    const patch = '*** Begin Patch\n' + '*** Update File: x.ts\n' + '@@\n' + '+added\n';
    const files = parseApplyPatch(patch);
    expect(files.length).toBe(1);
    expect(files[0]!.hunks[0]!.lines[0]).toEqual({
      kind: 'added',
      text: 'added',
    });
  });
});
