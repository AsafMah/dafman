// Tests for the Phase 19b.2 agent file CRUD module.
//
// Focus areas: name validation (path traversal + Windows reserved
// names), scope path resolution, frontmatter serialization, atomic
// write + no-overwrite, delete safety.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { AppError } from '../app/shared/errors';
import {
  listAgentFiles,
  validateAgentName,
  writeAgent,
  deleteAgent,
} from '../app/library/agentFiles';

let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), 'dafman-agentfiles-'));
});

afterEach(() => {
  if (workspaceDir) {
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('validateAgentName', () => {
  test('accepts plain names', () => {
    expect(() => validateAgentName('reviewer')).not.toThrow();
    expect(() => validateAgentName('my-agent')).not.toThrow();
    expect(() => validateAgentName('my_agent')).not.toThrow();
    expect(() => validateAgentName('agent.v2')).not.toThrow();
    expect(() => validateAgentName('a1')).not.toThrow();
  });

  test('rejects path traversal', () => {
    expect(() => validateAgentName('../reviewer')).toThrow();
    expect(() => validateAgentName('a/b')).toThrow();
    expect(() => validateAgentName('a\\b')).toThrow();
    expect(() => validateAgentName('/etc/passwd')).toThrow();
    expect(() => validateAgentName('C:\\Windows\\System32\\cmd')).toThrow();
  });

  test('rejects empty / whitespace / leading dot', () => {
    expect(() => validateAgentName('')).toThrow();
    expect(() => validateAgentName(' ')).toThrow();
    expect(() => validateAgentName('.hidden')).toThrow();
  });

  test('rejects Windows reserved names case-insensitively', () => {
    expect(() => validateAgentName('CON')).toThrow();
    expect(() => validateAgentName('con')).toThrow();
    expect(() => validateAgentName('PRN')).toThrow();
    expect(() => validateAgentName('aux')).toThrow();
    expect(() => validateAgentName('NUL')).toThrow();
    expect(() => validateAgentName('COM1')).toThrow();
    expect(() => validateAgentName('lpt9')).toThrow();
  });

  test('rejects names longer than 64 chars', () => {
    expect(() => validateAgentName('a'.repeat(65))).toThrow();
  });
});

describe('writeAgent + deleteAgent + listAgentFiles (project scope)', () => {
  test('writes a .agent.md file with YAML frontmatter', async () => {
    const path = await writeAgent(
      {
        scope: 'project',
        name: 'reviewer',
        displayName: 'Code Reviewer',
        description: 'Reviews PRs',
        tools: ['read', 'grep'],
        skills: ['pr-review'],
        prompt: 'You are a strict code reviewer.',
      },
      workspaceDir,
    );
    expect(path).toBe(join(workspaceDir, '.github', 'agents', 'reviewer.agent.md'));
    const content = readFileSync(path, 'utf-8');
    // Frontmatter delimiters.
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('---\n\n');
    // Required fields.
    expect(content).toContain('name: "reviewer"');
    expect(content).toContain('displayName: "Code Reviewer"');
    expect(content).toContain('description: "Reviews PRs"');
    // Arrays with quoted items.
    expect(content).toMatch(/tools:\n {2}- "read"\n {2}- "grep"/);
    expect(content).toMatch(/skills:\n {2}- "pr-review"/);
    // Body (prompt) follows.
    expect(content).toContain('You are a strict code reviewer.');
  });

  test('omits displayName when it equals name (matches SDK default)', async () => {
    const path = await writeAgent(
      {
        scope: 'project',
        name: 'twin',
        displayName: 'twin',
        description: 'd',
        prompt: 'p',
      },
      workspaceDir,
    );
    const content = readFileSync(path, 'utf-8');
    expect(content).not.toContain('displayName:');
  });

  test('rejects empty description', async () => {
    await expect(
      writeAgent(
        {
          scope: 'project',
          name: 'x',
          description: '',
          prompt: 'p',
        },
        workspaceDir,
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      writeAgent(
        {
          scope: 'project',
          name: 'x',
          description: '   ',
          prompt: 'p',
        },
        workspaceDir,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  test('refuses to overwrite an existing file', async () => {
    await writeAgent(
      {
        scope: 'project',
        name: 'dupe',
        description: 'first',
        prompt: 'p',
      },
      workspaceDir,
    );
    await expect(
      writeAgent(
        {
          scope: 'project',
          name: 'dupe',
          description: 'second',
          prompt: 'p',
        },
        workspaceDir,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  test('project scope requires workingDirectory', async () => {
    await expect(
      writeAgent({
        scope: 'project',
        name: 'x',
        description: 'd',
        prompt: 'p',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  test('path-traversal name throws before any I/O', async () => {
    await expect(
      writeAgent(
        {
          scope: 'project',
          name: '../etc/passwd',
          description: 'd',
          prompt: 'p',
        },
        workspaceDir,
      ),
    ).rejects.toBeInstanceOf(AppError);
    // Confirm the .github/agents dir wasn't created.
    expect(existsSync(join(workspaceDir, '.github', 'agents'))).toBe(false);
  });

  test('listAgentFiles discovers both .agent.md and bare .md files', async () => {
    const dir = join(workspaceDir, '.github', 'agents');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.agent.md'), '---\ndescription: d\n---\nbody\n');
    await writeFile(join(dir, 'b.md'), '---\ndescription: d\n---\nbody\n');
    // Non-md ignored.
    await writeFile(join(dir, 'notes.txt'), 'hi');

    const list = await listAgentFiles({
      includeUser: false,
      includeProject: true,
      workingDirectory: workspaceDir,
    });
    const names = list.map((a) => a.name).sort();
    expect(names).toEqual(['a', 'b']);
    const a = list.find((x) => x.name === 'a')!;
    expect(a.canonical).toBe(true);
    const b = list.find((x) => x.name === 'b')!;
    expect(b.canonical).toBe(false);
  });

  test('listAgentFiles returns empty when dir missing (not an error)', async () => {
    const list = await listAgentFiles({
      includeUser: false,
      includeProject: true,
      workingDirectory: workspaceDir,
    });
    expect(list).toEqual([]);
  });

  test('deleteAgent removes the file and returns true', async () => {
    await writeAgent(
      {
        scope: 'project',
        name: 'doomed',
        description: 'd',
        prompt: 'p',
      },
      workspaceDir,
    );
    const path = join(workspaceDir, '.github', 'agents', 'doomed.agent.md');
    expect(existsSync(path)).toBe(true);
    const removed = await deleteAgent('project', 'doomed', workspaceDir);
    expect(removed).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  test('deleteAgent returns false for missing file (not an error)', async () => {
    const removed = await deleteAgent('project', 'ghost', workspaceDir);
    expect(removed).toBe(false);
  });

  test('deleteAgent validates name before resolving path', async () => {
    await expect(deleteAgent('project', '../x', workspaceDir)).rejects.toBeInstanceOf(AppError);
  });
});

describe('Edit path — readAgentForEdit + writeAgent (overwrite + preserved tail)', () => {
  test('readAgentForEdit parses known keys and preserves unknown keys verbatim', async () => {
    const dir = join(workspaceDir, '.github', 'agents');
    await mkdir(dir, { recursive: true });
    // Hand-write a file with a mix of known + unknown keys.
    const fileContent = [
      '---',
      'name: "reviewer"',
      'description: "Reviews PRs"',
      'tools:',
      '  - "read"',
      '  - "grep"',
      'mcp-servers:',
      '  - name: "fancy"',
      '    transport: "stdio"',
      'github:',
      '  toolsets:',
      '    - "default"',
      '---',
      '',
      'You are a strict code reviewer.',
      '',
    ].join('\n');
    await writeFile(join(dir, 'reviewer.agent.md'), fileContent);

    const { readAgentForEdit } = await import('../app/library/agentFiles');
    const result = await readAgentForEdit('project', 'reviewer', workspaceDir);
    expect(result.spec.name).toBe('reviewer');
    expect(result.spec.description).toBe('Reviews PRs');
    expect(result.spec.tools).toEqual(['read', 'grep']);
    expect(result.prompt).toBe('You are a strict code reviewer.');
    // Unknown keys preserved verbatim (byte-for-byte).
    expect(result.preservedTail).toContain('mcp-servers:');
    expect(result.preservedTail).toContain('  - name: "fancy"');
    expect(result.preservedTail).toContain('github:');
    expect(result.preservedTail).toContain('  toolsets:');
  });

  test('writeAgent with preservedTail + allowOverwrite keeps unknown keys after edit', async () => {
    const dir = join(workspaceDir, '.github', 'agents');
    await mkdir(dir, { recursive: true });
    const original = [
      '---',
      'name: "reviewer"',
      'description: "Reviews PRs"',
      'mcp-servers:',
      '  - name: "fancy"',
      '---',
      '',
      'Original prompt.',
      '',
    ].join('\n');
    const path = join(dir, 'reviewer.agent.md');
    await writeFile(path, original);

    const { readAgentForEdit } = await import('../app/library/agentFiles');
    const read = await readAgentForEdit('project', 'reviewer', workspaceDir);

    // Edit: change the description + prompt, keep the unknown mcp-servers block.
    await writeAgent(
      {
        scope: 'project',
        name: 'reviewer',
        description: 'EDITED description',
        prompt: 'Edited prompt.',
      },
      workspaceDir,
      { allowOverwrite: true, preservedTail: read.preservedTail },
    );

    const written = readFileSync(path, 'utf-8');
    expect(written).toContain('description: "EDITED description"');
    expect(written).toContain('Edited prompt.');
    // Unknown keys survive verbatim.
    expect(written).toContain('mcp-servers:');
    expect(written).toContain('  - name: "fancy"');
  });

  test('writeAgent without allowOverwrite still refuses to clobber', async () => {
    await writeAgent(
      {
        scope: 'project',
        name: 'existing',
        description: 'd',
        prompt: 'p',
      },
      workspaceDir,
    );
    await expect(
      writeAgent(
        {
          scope: 'project',
          name: 'existing',
          description: 'd2',
          prompt: 'p2',
        },
        workspaceDir,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});
