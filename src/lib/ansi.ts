const OSC_PATTERN = /\x1B\][^\x07]*(?:\x07|\x1B\\)/g;
const CSI_PATTERN = /[\x1B\x9B]\[[0-?]*[ -/]*[@-~]/g;
const ESCAPE_PATTERN = /\x1B[()#;?]*(?:[0-9A-ORZcf-nqry=><~])/g;

export function stripAnsi(value: string): string {
  return value
    .replace(OSC_PATTERN, '')
    .replace(CSI_PATTERN, '')
    .replace(ESCAPE_PATTERN, '')
    .replace(/\x07/g, '');
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
