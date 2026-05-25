import { describe, expect, test } from 'bun:test';
import { cleanTerminalCommandOutput, stripAnsi } from '../ansi';

describe('terminal ANSI cleanup', () => {
  test('strips CSI and OSC sequences', () => {
    const raw = '\x1b[31;1mGet-ChildItem:\x1b[0m nope\x1b]633;P;Cwd=C%3A%5Crepo\x07';
    expect(stripAnsi(raw)).toBe('Get-ChildItem: nope');
  });

  test('removes trailing shell prompt from captured command output', () => {
    const raw = 'result\n\x1b]633;P;Cwd=C%3A%5Crepo\x07PS C:\\repo> ';
    expect(cleanTerminalCommandOutput(raw)).toBe('result');
  });
});
