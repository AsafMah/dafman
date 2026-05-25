import { describe, expect, test } from 'bun:test';
import { parseTerminalOsc } from '@/lib/terminalShellIntegration';

describe('terminal shell integration OSC parser', () => {
  test('parses trusted VS Code command lifecycle markers', () => {
    expect(parseTerminalOsc(633, 'E;git%20status;nonce-1', 'nonce-1')).toEqual({
      handled: true,
      events: [
        {
          kind: 'commandLine',
          command: 'git status',
          protocol: 'osc633',
          trusted: true,
        },
      ],
    });
    expect(parseTerminalOsc(633, 'C', 'nonce-1')).toEqual({
      handled: true,
      events: [{ kind: 'commandStart', protocol: 'osc633' }],
    });
    expect(parseTerminalOsc(633, 'D;2', 'nonce-1')).toEqual({
      handled: true,
      events: [{ kind: 'commandFinish', exitCode: 2 }],
    });
  });

  test('marks command lines untrusted when the nonce does not match', () => {
    expect(parseTerminalOsc(633, 'E;npm%20test;wrong', 'nonce-1').events).toEqual([
      {
        kind: 'commandLine',
        command: 'npm test',
        protocol: 'osc633',
        trusted: false,
      },
    ]);
  });

  test('parses cwd protocols without swallowing unrelated OSC 9 progress', () => {
    expect(parseTerminalOsc(633, 'P;Cwd=C%3A%5Crepo', '')).toEqual({
      handled: true,
      events: [{ kind: 'cwd', cwd: 'C:\\repo' }],
    });
    expect(parseTerminalOsc(7, 'file:///C:/repo', '')).toEqual({
      handled: true,
      events: [{ kind: 'cwd', cwd: 'C:/repo' }],
    });
    expect(parseTerminalOsc(9, '9;C:\\repo', '')).toEqual({
      handled: true,
      events: [{ kind: 'cwd', cwd: 'C:\\repo' }],
    });
    expect(parseTerminalOsc(1337, 'CurrentDir=C%3A%5Crepo', '')).toEqual({
      handled: true,
      events: [{ kind: 'cwd', cwd: 'C:\\repo' }],
    });
    expect(parseTerminalOsc(9, '4;1;50', '')).toEqual({ handled: false, events: [] });
  });

  test('parses FinalTerm command lifecycle markers', () => {
    expect(parseTerminalOsc(133, 'C', '')).toEqual({
      handled: true,
      events: [{ kind: 'commandStart', protocol: 'osc133' }],
    });
    expect(parseTerminalOsc(133, 'D;0', '')).toEqual({
      handled: true,
      events: [{ kind: 'commandFinish', exitCode: 0 }],
    });
  });
});
