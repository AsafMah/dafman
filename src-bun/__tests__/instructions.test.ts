import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listInstructionSources } from '../app/library/instructions';

let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), 'dafman-instructions-'));
});

afterEach(() => {
  if (!workspaceDir) return;
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe('listInstructionSources', () => {
  test('returns global candidates even without a workspace', async () => {
    const sources = await listInstructionSources({});
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources.every((s) => s.scope === 'global')).toBe(true);
  });

  test('reads root project instruction files', async () => {
    await mkdir(join(workspaceDir, '.github'), { recursive: true });
    await writeFile(join(workspaceDir, 'AGENTS.md'), 'agent rules');
    await writeFile(join(workspaceDir, '.github', 'copilot-instructions.md'), 'copilot rules');

    const sources = await listInstructionSources({ workingDirectory: workspaceDir });
    const project = sources.filter((s) => s.scope === 'project' && s.exists);
    expect(project.map((s) => s.relativePath).sort()).toEqual(
      [join('.github', 'copilot-instructions.md'), 'AGENTS.md'].sort(),
    );
    expect(project.find((s) => s.relativePath === 'AGENTS.md')?.content).toBe('agent rules');
  });

  test('finds nested AGENTS.md but skips node_modules', async () => {
    await mkdir(join(workspaceDir, 'packages', 'app'), { recursive: true });
    await mkdir(join(workspaceDir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(workspaceDir, 'packages', 'app', 'AGENTS.md'), 'nested');
    await writeFile(join(workspaceDir, 'node_modules', 'pkg', 'AGENTS.md'), 'skip');

    const sources = await listInstructionSources({ workingDirectory: workspaceDir });
    const nested = sources.filter((s) => s.name.startsWith('Nested'));
    expect(nested).toHaveLength(1);
    expect(nested[0]?.relativePath).toBe(join('packages', 'app', 'AGENTS.md'));
    expect(nested[0]?.content).toBe('nested');
  });
});
