import baseStripAnsi from 'strip-ansi';

export function stripAnsi(value: string): string {
  // strip-ansi handles CSI + OSC (BEL, ESC\, 0x9C terminators) properly,
  // but does not remove lone BELs that aren't part of an OSC sequence —
  // those leak out of some shells, so strip them too.
  return baseStripAnsi(value).replace(/\x07/g, '');
}

export function cleanTerminalCommandOutput(value: string): string {
  const stripped = stripAnsi(value).replace(/\r/g, '');
  const lines = stripped.split('\n');

  while (
    lines.length > 0 &&
    /^\s*(?:PS [^>]*>|[^\s>]+[>$#])\s*$/.test(lines[lines.length - 1] ?? '')
  ) {
    lines.pop();
  }

  return lines.join('\n').trimEnd();
}
