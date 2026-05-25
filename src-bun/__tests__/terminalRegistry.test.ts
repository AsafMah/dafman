import { afterEach, describe, expect, test } from 'bun:test';
import { TerminalRegistry } from '../app/terminal/terminalRegistry';
import type { TerminalEventPayload } from '../rpc';
import { AppError } from '../app/shared/errors';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const realSpawn = Bun.spawn;

afterEach(() => {
  (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = realSpawn;
});

describe('TerminalRegistry', () => {
  test('creates a Bun native PTY terminal and emits output/exit', async () => {
    const events: TerminalEventPayload[] = [];
    const registry = new TerminalRegistry((event) => events.push(event));
    const summary = registry.create(
      process.platform === 'win32'
        ? { shell: 'cmd.exe', args: ['/d', '/c', 'echo TERM_OK'], cols: 80, rows: 24 }
        : { shell: 'sh', args: ['-lc', 'echo TERM_OK'], cols: 80, rows: 24 },
    );

    await wait(250);

    expect(summary.status).toBe('running');
    expect(events.some((event) => event.kind === 'status')).toBe(true);
    expect(events.some((event) => event.kind === 'output' && event.data.includes('TERM_OK'))).toBe(
      true,
    );
    expect(events.some((event) => event.kind === 'exit')).toBe(true);
    registry.shutdownAll();
  });

  test('write, resize, list, and kill are idempotent for a live terminal', async () => {
    const events: TerminalEventPayload[] = [];
    const registry = new TerminalRegistry((event) => events.push(event));
    const summary = registry.create(
      process.platform === 'win32'
        ? { shell: 'cmd.exe', args: ['/d', '/q'], cols: 80, rows: 24 }
        : { shell: 'sh', cols: 80, rows: 24 },
    );

    expect(registry.list().map((terminal) => terminal.id)).toContain(summary.id);
    expect(registry.resize(summary.id, 100, 30)).toBe(true);
    expect(
      registry.write(
        summary.id,
        process.platform === 'win32' ? 'echo LIVE_OK\r' : 'echo LIVE_OK\n',
      ),
    ).toBe(true);
    await wait(250);
    expect(events.some((event) => event.kind === 'output' && event.data.includes('LIVE_OK'))).toBe(
      true,
    );
    expect(registry.kill(summary.id)).toBe(true);
    expect(registry.kill('missing')).toBe(false);
  });

  test('surfaces an error instead of falling back when native PTY is unavailable', () => {
    let spawnCalls = 0;
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((_cmd, options) => {
      spawnCalls++;
      const opts = options as { terminal?: unknown };
      expect(opts.terminal).toBeDefined();
      return {
        terminal: undefined,
        kill: () => true,
      } as unknown as Bun.Subprocess;
    }) as typeof Bun.spawn;

    const events: TerminalEventPayload[] = [];
    const registry = new TerminalRegistry((event) => events.push(event));

    expect(() => registry.create({ shell: 'fake-shell', cols: 80, rows: 24 })).toThrow(AppError);
    expect(spawnCalls).toBe(1);
    expect(registry.list()).toEqual([]);
    expect(events).toEqual([]);
  });

  test('passes shell integration nonce and wraps interactive PowerShell', () => {
    let capturedCommand: string[] = [];
    let capturedEnv: Record<string, string | undefined> = {};
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((cmd, options) => {
      capturedCommand = cmd as string[];
      const opts = options as { env?: Record<string, string | undefined> };
      capturedEnv = opts.env ?? {};
      return {
        terminal: {
          write: () => 0,
          resize: () => undefined,
          close: () => undefined,
        },
        kill: () => true,
      } as unknown as Bun.Subprocess;
    }) as typeof Bun.spawn;

    const registry = new TerminalRegistry(() => {});
    const summary = registry.create({ shell: 'pwsh.exe', args: ['-NoLogo'], cols: 80, rows: 24 });

    expect(summary.integrationNonce).toBeTruthy();
    expect(capturedEnv.DAFMAN_SHELL_INTEGRATION).toBe('1');
    expect(capturedEnv.DAFMAN_NONCE).toBe(summary.integrationNonce);
    expect(capturedCommand).toContain('-NoExit');
    expect(capturedCommand).toContain('-Command');
    expect(capturedCommand.join(' ')).toContain(']633;E');
  });
});
