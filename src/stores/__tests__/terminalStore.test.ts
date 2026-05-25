import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { setRpcBridge, type RpcBridge } from '../../ipc/invoke';
import type { CommandMap, CommandName } from '../../ipc/types';
import { useTerminalStore } from '../terminalStore';

function makeBridge(
  handlers: Partial<{
    [K in CommandName]: (args: CommandMap[K]['args']) => Promise<CommandMap[K]['result']>;
  }> = {},
): RpcBridge {
  return {
    request: (async <N extends CommandName>(name: N, args: CommandMap[N]['args']) => {
      const handler = handlers[name];
      if (handler) {
        return await (handler as (a: CommandMap[N]['args']) => Promise<CommandMap[N]['result']>)(
          args,
        );
      }
      return undefined as CommandMap[N]['result'];
    }) as RpcBridge['request'],
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
    onTerminalEvent: () => () => {},
  };
}

describe('terminalStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setRpcBridge(makeBridge({ listTerminals: async () => [] }));
  });

  afterEach(() => {
    setRpcBridge(null);
  });

  test('tracks command lifecycle without crossing terminals', () => {
    const store = useTerminalStore();

    store.updateTerminalCwd('t1', 'C:\\repo');
    const started = store.startCommand('t1', {
      command: 'git status',
      cwd: store.currentCwd.t1,
      protocol: 'osc633',
      trusted: true,
    });
    store.startCommand('t2', {
      command: 'npm test',
      cwd: 'C:\\other',
      protocol: 'osc133',
      trusted: false,
    });
    const finished = store.finishCommand('t1', 0);

    expect(finished?.id).toBe(started.id);
    expect(store.commands.t1).toHaveLength(1);
    expect(store.commands.t1[0].command).toBe('git status');
    expect(store.commands.t1[0].cwd).toBe('C:\\repo');
    expect(store.commands.t1[0].exitCode).toBe(0);
    expect(store.commands.t1[0].trusted).toBe(true);
    expect(store.activeCommands.t1).toBeUndefined();
    expect(store.activeCommands.t2.command).toBe('npm test');
    expect(store.commands.t2).toBeUndefined();
  });

  test('ignores finish markers without an active command', () => {
    const store = useTerminalStore();

    expect(store.finishCommand('missing', 1)).toBeNull();
    expect(store.commands.missing).toBeUndefined();
  });

  test('bounds command history per terminal and records dropped commands', () => {
    const store = useTerminalStore();

    for (let i = 0; i < 205; i++) {
      store.startCommand('t1', {
        command: `echo ${i}`,
        protocol: 'osc633',
        trusted: true,
      });
      store.finishCommand('t1', i);
    }

    expect(store.commands.t1).toHaveLength(200);
    expect(store.commands.t1[0].command).toBe('echo 5');
    expect(store.commands.t1[199].exitCode).toBe(204);
    expect(store.droppedCommandCounts.t1).toBe(5);
  });
});
