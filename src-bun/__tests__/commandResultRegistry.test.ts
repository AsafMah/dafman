import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CommandResultRegistry } from '../app/chat/commandResultRegistry';
import type { CommandResultEvent } from '../rpc';

function waitFor(
  events: CommandResultEvent[],
  predicate: (event: CommandResultEvent) => boolean,
  timeoutMs = 3000,
): Promise<CommandResultEvent> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const hit = events.find(predicate);
      if (hit) {
        resolve(hit);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('timed out waiting for command result event'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('CommandResultRegistry', () => {
  test('runs a command, streams stdout, persists the capped record, and audits metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dafman-command-results-'));
    const events: CommandResultEvent[] = [];
    const registry = new CommandResultRegistry(join(dir, 'command-results.json'), (event) =>
      events.push(event),
    );

    const record = registry.start({
      sessionId: 'sess-1',
      command: 'echo COMMAND_OK',
      cwd: process.cwd(),
    });

    await waitFor(events, (event) => event.kind === 'stdout' && event.data.includes('COMMAND_OK'));
    const completed = await waitFor(
      events,
      (event) => event.kind === 'completed' && event.commandId === record.id,
    );
    expect(completed.kind).toBe('completed');
    if (completed.kind === 'completed') {
      expect(completed.record.stdout).toContain('COMMAND_OK');
      expect(completed.record.status).toBe('completed');
      expect(completed.record.exitCode).toBe(0);
    }

    await waitForPersistedStdout(dir);
    const restored = new CommandResultRegistry(join(dir, 'command-results.json'), () => {});
    expect(restored.list('sess-1')[0]?.stdout).toContain('COMMAND_OK');
  });

  test('rejects a second running command in the same session', () => {
    const events: CommandResultEvent[] = [];
    const registry = new CommandResultRegistry(
      join(tmpdir(), `dafman-command-results-${crypto.randomUUID()}.json`),
      (event) => events.push(event),
    );
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 2' : 'sleep 2';
    const record = registry.start({ sessionId: 'sess-1', command, cwd: process.cwd() });
    expect(() =>
      registry.start({ sessionId: 'sess-1', command: 'echo nope', cwd: process.cwd() }),
    ).toThrow();
    expect(registry.cancel('sess-1', record.id)).toBe(true);
  });
});

async function waitForPersistedStdout(dir: string): Promise<void> {
  const file = Bun.file(join(dir, 'command-results.json'));
  const start = Date.now();
  while (Date.now() - start < 1000) {
    const text = await file.text().catch(() => '');
    if (text.includes('COMMAND_OK')) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
