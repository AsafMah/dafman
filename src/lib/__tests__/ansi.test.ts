import { describe, expect, test } from 'bun:test';
import { cleanTerminalCommandOutput, stripAnsi } from '@/lib/ansi';

describe('terminal ANSI cleanup', () => {
  test('strips CSI and OSC sequences', () => {
    const raw = '\x1b[31;1mGet-ChildItem:\x1b[0m nope\x1b]633;P;Cwd=C%3A%5Crepo\x07';
    expect(stripAnsi(raw)).toBe('Get-ChildItem: nope');
  });

  test('removes trailing shell prompt from captured command output', () => {
    const raw = 'result\n\x1b]633;P;Cwd=C%3A%5Crepo\x07PS C:\\repo> ';
    expect(cleanTerminalCommandOutput(raw)).toBe('result');
  });

  describe('regression coverage (pre-Phase-A-swap safety net)', () => {
    test('strips VS Code shell-integration OSC 633 sequences (BEL terminator)', () => {
      const raw = '\x1b]633;A\x07hello\x1b]633;B\x07';
      expect(stripAnsi(raw)).toBe('hello');
    });

    // NOTE: ST-terminated (`\x1b\\`) OSC sequences are currently not stripped
    // correctly because OSC_PATTERN's `[^\x07]*` body allows ESC, which lets
    // the greedy engine swallow nested sequences. The Phase A `strip-ansi`
    // swap is expected to fix this — this test will be flipped to a regular
    // assertion at that time.
    test.todo('strips VS Code shell-integration OSC 633 sequences (ST terminator)', () => {
      const raw = '\x1b]633;A\x1b\\hello\x1b]633;B\x1b\\';
      expect(stripAnsi(raw)).toBe('hello');
    });

    test('strips final-term OSC 133 sequences', () => {
      const raw = '\x1b]133;A\x07prompt\x1b]133;B\x07cmd\x1b]133;C\x07output';
      expect(stripAnsi(raw)).toBe('promptcmdoutput');
    });

    test('strips OSC 7 working-directory reports', () => {
      const raw = '\x1b]7;file:///home/user\x07ls';
      expect(stripAnsi(raw)).toBe('ls');
    });

    test('strips ANSI color foreground/background and reset', () => {
      const raw = '\x1b[31mred\x1b[42;1mgreen-bg\x1b[0m\x1b[39;49mdone';
      expect(stripAnsi(raw)).toBe('redgreen-bgdone');
    });

    test('strips cursor movement CSI', () => {
      const raw = 'a\x1b[2Ab\x1b[3Cc\x1b[K';
      expect(stripAnsi(raw)).toBe('abc');
    });

    test('removes lone BEL characters', () => {
      expect(stripAnsi('beep\x07boop')).toBe('beepboop');
    });

    test('passes through plain text unchanged', () => {
      expect(stripAnsi('hello world')).toBe('hello world');
      expect(stripAnsi('')).toBe('');
    });

    test('cleanTerminalCommandOutput strips PowerShell prompt variants', () => {
      expect(cleanTerminalCommandOutput('out\nPS C:\\repo> ')).toBe('out');
      expect(cleanTerminalCommandOutput('out\nPS> ')).toBe('out');
    });

    test('cleanTerminalCommandOutput strips bash/zsh prompts', () => {
      expect(cleanTerminalCommandOutput('out\nuser@host:~$ ')).toBe('out');
      expect(cleanTerminalCommandOutput('out\nroot# ')).toBe('out');
    });

    test('cleanTerminalCommandOutput normalises CRLF', () => {
      expect(cleanTerminalCommandOutput('a\r\nb\r\n')).toBe('a\nb');
    });

    test('cleanTerminalCommandOutput preserves multiline output above the prompt', () => {
      expect(cleanTerminalCommandOutput('a\nb\nc\nPS C:\\> ')).toBe('a\nb\nc');
    });
  });
});
