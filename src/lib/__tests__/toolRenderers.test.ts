import { describe, expect, test } from 'bun:test';
import { getToolRenderer } from '@/lib/toolRenderers';

describe('getToolRenderer', () => {
  test('shell renderer surfaces command as the summary', () => {
    const r = getToolRenderer('shell');
    const out = r({ args: { command: 'ls -la /tmp' }, toolName: 'shell' });
    expect(out.summary).toBe('ls -la /tmp');
    expect(out.argsLanguage).toBe('bash');
    expect(out.resultLanguage).toBe('text');
  });

  test('aliases route to the same renderer (bash → shell)', () => {
    const r = getToolRenderer('bash');
    const out = r({ args: { command: 'echo hi' }, toolName: 'bash' });
    expect(out.summary).toBe('echo hi');
    expect(out.argsLanguage).toBe('bash');
  });

  test('read_file infers result language from file extension', () => {
    const r = getToolRenderer('read_file');
    expect(r({ args: { file_path: 'src/main.ts' }, toolName: 'read_file' }).resultLanguage).toBe(
      'typescript',
    );
    expect(r({ args: { file_path: 'README.md' }, toolName: 'read_file' }).resultLanguage).toBe(
      'markdown',
    );
    expect(r({ args: { file_path: 'package.json' }, toolName: 'read_file' }).resultLanguage).toBe(
      'json',
    );
    expect(r({ args: { file_path: 'unknown.xyz' }, toolName: 'read_file' }).resultLanguage).toBe(
      'text',
    );
  });

  test('apply_patch sniffs the first file path from the patch body', () => {
    const r = getToolRenderer('apply_patch');
    const patch = `*** Update File: src/foo.ts\n@@\n-old\n+new\n`;
    const out = r({ args: { patch }, toolName: 'apply_patch' });
    expect(out.summary).toBe('patch src/foo.ts');
    expect(out.argsLanguage).toBe('diff');
    expect(out.resultLanguage).toBe('diff');
  });

  test('grep summary includes pattern and path', () => {
    const r = getToolRenderer('grep');
    const out = r({
      args: { pattern: 'TODO', path: 'src' },
      toolName: 'grep',
    });
    expect(out.summary).toContain('TODO');
    expect(out.summary).toContain('src');
  });

  test('view summary includes line range when provided', () => {
    const r = getToolRenderer('view');
    const out = r({
      args: { path: 'src/foo.ts', view_range: [10, 20] },
      toolName: 'view',
    });
    expect(out.summary).toContain('[10–20]');
  });

  test('MCP-hosted tools fall back to JSON args + markdown result', () => {
    const r = getToolRenderer('some_mcp_tool', 'playwright');
    const out = r({
      args: { selector: '#submit' },
      toolName: 'some_mcp_tool',
      mcpServerName: 'playwright',
      mcpToolName: 'click',
    });
    expect(out.argsLanguage).toBe('json');
    expect(out.resultLanguage).toBe('markdown');
    expect(out.summary).toBeUndefined();
  });

  test('unknown tool falls back to JSON / text without a summary', () => {
    const r = getToolRenderer('never_heard_of_it');
    const out = r({
      args: { foo: 42 },
      toolName: 'never_heard_of_it',
    });
    expect(out.argsLanguage).toBe('json');
    expect(out.resultLanguage).toBe('text');
    expect(out.summary).toBeUndefined();
  });

  test('multi-line shell commands collapse to a single header line', () => {
    const r = getToolRenderer('shell');
    const out = r({
      args: { command: 'echo a\necho b\necho c' },
      toolName: 'shell',
    });
    expect(out.summary).not.toContain('\n');
  });
});
