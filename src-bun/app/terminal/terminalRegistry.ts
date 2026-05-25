import { randomUUID } from 'node:crypto';
import type { TerminalCreateParams, TerminalEventPayload, TerminalSummary } from '../rpc';
import { AppError } from '../shared/errors';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';
import { defaultShell } from './shellUtils';

type TerminalStatus = TerminalSummary['status'];

interface TerminalEntry {
  id: string;
  title: string;
  cwd: string;
  sessionId?: string;
  shell: string;
  args: string[];
  integrationNonce: string;
  status: TerminalStatus;
  createdAt: string;
  proc: Bun.Subprocess;
  terminal: {
    write(data: string | BufferSource): number | undefined;
    resize(cols: number, rows: number): void;
    close(): void;
  };
  cols: number;
  rows: number;
  outputQueue: string[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  exitCode?: number | null;
  signal?: string | null;
}

type EmitTerminal = (payload: TerminalEventPayload) => void;

const OUTPUT_FLUSH_MS = 8;
const MAX_QUEUED_CHUNKS = 256;

function shellName(shell: string): string {
  return shell.split(/[\\/]/).pop()?.toLowerCase() ?? shell.toLowerCase();
}

function hasCommandArgs(args: string[]): boolean {
  return args.some((arg) => /^-?(c|command|encodedcommand)$/i.test(arg));
}

function powerShellIntegrationCommand(): string {
  return [
    '$esc=[char]27',
    '$bel=[char]7',
    '$global:__dafmanShellNonce=$env:DAFMAN_NONCE',
    'Remove-Item Env:DAFMAN_NONCE -ErrorAction SilentlyContinue',
    '$global:__dafmanCommandStarted=$false',
    'function global:Prompt {',
    '  if ($global:__dafmanCommandStarted) {',
    '    $code = if ($global:LASTEXITCODE -is [int]) { $global:LASTEXITCODE } elseif ($?) { 0 } else { 1 }',
    '    [Console]::Write("$esc]633;D;$code$bel")',
    '    $global:__dafmanCommandStarted=$false',
    '  }',
    '  $cwd=[Uri]::EscapeDataString((Get-Location).ProviderPath)',
    '  [Console]::Write("$esc]633;P;Cwd=$cwd$bel$esc]633;A$bel")',
    '  "PS $($executionContext.SessionState.Path.CurrentLocation)$(\'>\' * ($nestedPromptLevel + 1)) "',
    '}',
    '$global:__dafmanOriginalReadLine=(Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue).ScriptBlock',
    'if ($global:__dafmanOriginalReadLine) {',
    '  function global:PSConsoleHostReadLine {',
    '    $line=& $global:__dafmanOriginalReadLine @args',
    '    $encoded=[Uri]::EscapeDataString($line)',
    '    [Console]::Write("$esc]633;E;$encoded;$global:__dafmanShellNonce$bel$esc]633;C$bel")',
    '    $global:__dafmanCommandStarted=$true',
    '    return $line',
    '  }',
    '}',
  ].join('; ');
}

function withShellIntegration(shell: string, args: string[]): string[] {
  const name = shellName(shell);

  if (
    (name === 'pwsh.exe' ||
      name === 'pwsh' ||
      name === 'powershell.exe' ||
      name === 'powershell') &&
    !hasCommandArgs(args)
  ) {
    return [...args, '-NoExit', '-Command', powerShellIntegrationCommand()];
  }

  if ((name === 'cmd.exe' || name === 'cmd') && !args.some((arg) => /^\/c$/i.test(arg))) {
    const prompt = '$E]7;file:///$P$E\\$E]133;A$E\\$P$G';

    return [...args, '/k', `prompt ${prompt}`];
  }

  return args;
}

function toSummary(entry: TerminalEntry): TerminalSummary {
  return {
    id: entry.id,
    title: entry.title,
    cwd: entry.cwd,
    shell: entry.shell,
    args: entry.args,
    status: entry.status,
    createdAt: entry.createdAt,
    cols: entry.cols,
    rows: entry.rows,
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    integrationNonce: entry.integrationNonce,
    ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
    ...(entry.signal !== undefined ? { signal: entry.signal } : {}),
  };
}

export class TerminalRegistry {
  private readonly entries = new Map<string, TerminalEntry>();

  constructor(private readonly emit: EmitTerminal) {}

  create(params: TerminalCreateParams): TerminalSummary {
    const id = randomUUID();
    const cwd = params.cwd?.trim() || process.cwd();
    const profile = defaultShell();
    const shell = params.shell?.trim() || profile.shell;
    const args = withShellIntegration(shell, params.args ?? profile.args);
    const title = params.title?.trim() || shell.split(/[\\/]/).pop() || 'Terminal';
    const cols = Math.max(10, Math.floor(params.cols ?? 80));
    const rows = Math.max(3, Math.floor(params.rows ?? 24));
    const createdAt = new Date().toISOString();
    const integrationNonce = randomUUID();
    const options = {
      id,
      title,
      cwd,
      shell,
      args,
      cols,
      rows,
      createdAt,
      integrationNonce,
      sessionId: params.sessionId,
    };
    let entry: TerminalEntry;

    try {
      entry = this.createNativeTerminal(options);
    } catch (err) {
      throw AppError.sdk(toErrorMessage(err));
    }

    this.entries.set(id, entry);
    const summary = toSummary(entry);

    this.emit({ terminalId: id, kind: 'status', summary });
    log.info('terminal created', { terminalId: id, shell, cwd, backend: 'pty' });

    return summary;
  }

  list(): TerminalSummary[] {
    return [...this.entries.values()].map(toSummary);
  }

  private createNativeTerminal(options: {
    id: string;
    title: string;
    cwd: string;
    shell: string;
    args: string[];
    cols: number;
    rows: number;
    createdAt: string;
    integrationNonce: string;
    sessionId?: string;
  }): TerminalEntry {
    const { id, title, cwd, shell, args, cols, rows, createdAt, integrationNonce } = options;
    const proc = Bun.spawn([shell, ...args], {
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        DAFMAN_SHELL_INTEGRATION: '1',
        DAFMAN_NONCE: integrationNonce,
      },
      terminal: {
        cols,
        rows,
        name: 'xterm-256color',
        data: (_terminal, data) => {
          this.enqueueOutput(id, Buffer.from(data).toString('utf8'));
        },
        exit: (_terminal, exitCode, signal) => {
          this.markExited(id, exitCode, signal);
        },
      },
      onExit: (_proc, exitCode, signalCode, error) => {
        if (error) {
          log.warn('terminal child exited with error', {
            terminalId: id,
            error: error.message,
          });
        }

        this.markExited(id, exitCode, signalCode);
      },
    });

    if (!proc.terminal) {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }

      throw new Error(
        `Bun native terminal unsupported in this runtime (Bun ${process.versions.bun ?? 'unknown'} ${process.platform} ${process.arch})`,
      );
    }

    return {
      id,
      title,
      cwd,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      shell,
      args,
      integrationNonce,
      status: 'running',
      createdAt,
      proc,
      terminal: proc.terminal,
      cols,
      rows,
      outputQueue: [],
      flushTimer: null,
    };
  }

  write(id: string, data: string): boolean {
    const entry = this.entries.get(id);

    if (!entry || entry.status !== 'running') return false;

    entry.terminal.write(data);

    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const entry = this.entries.get(id);

    if (!entry || entry.status === 'exited' || entry.status === 'failed') return false;

    const nextCols = Math.max(10, Math.floor(cols));
    const nextRows = Math.max(3, Math.floor(rows));

    entry.cols = nextCols;
    entry.rows = nextRows;
    entry.terminal.resize(nextCols, nextRows);
    this.emit({ terminalId: id, kind: 'status', summary: toSummary(entry) });

    return true;
  }

  kill(id: string): boolean {
    const entry = this.entries.get(id);

    if (!entry) return false;

    if (entry.status === 'running') {
      entry.status = 'exiting';

      try {
        entry.proc.kill();
      } catch {
        // fall through to terminal close
      }
    }

    try {
      entry.terminal.close();
    } catch {
      // already closed
    }

    this.markExited(id, entry.exitCode ?? null, entry.signal ?? null);

    return true;
  }

  shutdownAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id);
  }

  private enqueueOutput(id: string, data: string): void {
    const entry = this.entries.get(id);

    if (!entry) return;

    entry.outputQueue.push(data);

    if (entry.outputQueue.length > MAX_QUEUED_CHUNKS) {
      entry.outputQueue.splice(0, entry.outputQueue.length - MAX_QUEUED_CHUNKS);
      entry.outputQueue.unshift('\r\n[terminal output truncated]\r\n');
    }

    if (entry.flushTimer) return;

    entry.flushTimer = setTimeout(() => this.flushOutput(id), OUTPUT_FLUSH_MS);
  }

  private flushOutput(id: string): void {
    const entry = this.entries.get(id);

    if (!entry) return;

    entry.flushTimer = null;
    const data = entry.outputQueue.join('');

    entry.outputQueue = [];

    if (data) this.emit({ terminalId: id, kind: 'output', data });
  }

  private markExited(id: string, exitCode: number | null, signal: string | null): void {
    const entry = this.entries.get(id);

    if (!entry || entry.status === 'exited') return;

    this.flushOutput(id);
    entry.status = 'exited';
    entry.exitCode = exitCode;
    entry.signal = signal;
    this.emit({ terminalId: id, kind: 'exit', summary: toSummary(entry) });
    log.info('terminal exited', { terminalId: id, exitCode, signal });
  }
}
