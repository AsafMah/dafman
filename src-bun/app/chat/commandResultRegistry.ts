import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CommandResultEvent, CommandResultRecord } from '../rpc';
import { AppError } from '../shared/errors';
import { log } from '../observability/logging';
import { recordCommand } from '../observability/audit';
import { toErrorMessage } from '../shared/errorMessage';
import { resolveShellForCommand } from '../terminal/shellUtils';

const OUTPUT_CAP_BYTES = 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MAX_COMMAND_LENGTH = 8_000;
const MAX_RECORDS_PER_SESSION = 100;

type EmitCommandResult = (payload: CommandResultEvent) => void;

interface ActiveCommand {
  proc: Bun.Subprocess;
  record: CommandResultRecord;
  timeout: ReturnType<typeof setTimeout>;
  cancelled: boolean;
  timedOut: boolean;
  totalBytes: number;
}

export class CommandResultRegistry {
  private readonly records = new Map<string, CommandResultRecord[]>();
  private readonly activeBySession = new Map<string, ActiveCommand>();

  constructor(
    private readonly storagePath: string,
    private readonly emit: EmitCommandResult,
  ) {
    this.load();
  }

  list(sessionId: string): CommandResultRecord[] {
    return [...(this.records.get(sessionId) ?? [])];
  }

  start(params: { sessionId: string; command: string; cwd: string }): CommandResultRecord {
    const command = params.command.trim();

    if (!command) throw AppError.sdk('Command is required');

    if (command.length > MAX_COMMAND_LENGTH) {
      throw AppError.sdk(`Command is too long (max ${MAX_COMMAND_LENGTH} characters)`);
    }

    if (this.activeBySession.has(params.sessionId)) {
      throw AppError.sdk('A command is already running for this session');
    }

    const { shell, args } = resolveShellForCommand(command);
    const now = new Date().toISOString();
    const record: CommandResultRecord = {
      id: randomUUID(),
      sessionId: params.sessionId,
      command,
      cwd: params.cwd,
      shell,
      status: 'running',
      stdout: '',
      stderr: '',
      truncated: false,
      createdAt: now,
    };

    let proc: Bun.Subprocess;

    try {
      proc = Bun.spawn([shell, ...args], {
        cwd: params.cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (err) {
      throw AppError.sdk(toErrorMessage(err));
    }

    const active: ActiveCommand = {
      proc,
      record,
      cancelled: false,
      timedOut: false,
      totalBytes: 0,
      timeout: setTimeout(() => {
        active.timedOut = true;
        this.kill(active);
      }, TIMEOUT_MS),
    };

    this.activeBySession.set(params.sessionId, active);
    this.appendRecord(record);
    this.emit({ kind: 'started', sessionId: params.sessionId, commandId: record.id, record });
    void recordCommand({
      sessionId: params.sessionId,
      commandId: record.id,
      command,
      cwd: params.cwd,
      shell,
      status: 'started',
    });
    const stdoutDone = this.pump(active, 'stdout', proc.stdout);
    const stderrDone = this.pump(active, 'stderr', proc.stderr);

    void this.awaitExit(active, [stdoutDone, stderrDone]);

    return record;
  }

  cancel(sessionId: string, commandId: string): boolean {
    const active = this.activeBySession.get(sessionId);

    if (!active || active.record.id !== commandId) return false;

    active.cancelled = true;
    this.kill(active);

    return true;
  }

  shutdownAll(): void {
    for (const active of this.activeBySession.values()) {
      active.cancelled = true;
      this.kill(active);
    }
  }

  private async pump(
    active: ActiveCommand,
    stream: 'stdout' | 'stderr',
    source: ReadableStream<Uint8Array> | null,
  ): Promise<void> {
    if (!source) return;

    const reader = source.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (!value || value.byteLength === 0) continue;

        const remaining = OUTPUT_CAP_BYTES - active.totalBytes;

        if (remaining <= 0) {
          this.markTruncated(active);
          continue;
        }

        const accepted = value.byteLength > remaining ? value.slice(0, remaining) : value;

        active.totalBytes += accepted.byteLength;
        const text = decoder.decode(accepted, { stream: true });

        active.record[stream] += text;
        this.emit({
          kind: stream,
          sessionId: active.record.sessionId,
          commandId: active.record.id,
          data: text,
        });

        if (value.byteLength > remaining) this.markTruncated(active);
      }

      const tail = decoder.decode();

      if (tail) {
        active.record[stream] += tail;
        this.emit({
          kind: stream,
          sessionId: active.record.sessionId,
          commandId: active.record.id,
          data: tail,
        });
      }
    } catch (err) {
      log.warn('command result stream read failed', {
        sessionId: active.record.sessionId,
        commandId: active.record.id,
        stream,
        error: toErrorMessage(err),
      });
    }
  }

  private async awaitExit(active: ActiveCommand, streamReads: Promise<void>[]): Promise<void> {
    let exitCode: number | null = null;

    try {
      exitCode = await active.proc.exited;
    } catch (err) {
      log.warn('command result process wait failed', {
        sessionId: active.record.sessionId,
        commandId: active.record.id,
        error: toErrorMessage(err),
      });
    } finally {
      clearTimeout(active.timeout);
    }

    await Promise.all(streamReads);

    const now = new Date();
    const started = new Date(active.record.createdAt).getTime();
    const status = active.timedOut
      ? 'timeout'
      : active.cancelled
        ? 'cancelled'
        : exitCode === 0
          ? 'completed'
          : 'failed';

    active.record.status = status;
    active.record.exitCode = exitCode;
    active.record.completedAt = now.toISOString();
    active.record.durationMs = Math.max(0, now.getTime() - started);
    this.activeBySession.delete(active.record.sessionId);
    this.replaceRecord(active.record);
    this.emit({
      kind: status === 'cancelled' ? 'cancelled' : 'completed',
      sessionId: active.record.sessionId,
      commandId: active.record.id,
      record: active.record,
    });
    void recordCommand({
      sessionId: active.record.sessionId,
      commandId: active.record.id,
      command: active.record.command,
      cwd: active.record.cwd,
      shell: active.record.shell,
      status,
      exitCode,
      durationMs: active.record.durationMs,
      truncated: active.record.truncated,
    });
  }

  private markTruncated(active: ActiveCommand): void {
    if (active.record.truncated) return;

    active.record.truncated = true;
    this.emit({
      kind: 'truncated',
      sessionId: active.record.sessionId,
      commandId: active.record.id,
      limitBytes: OUTPUT_CAP_BYTES,
    });
  }

  private kill(active: ActiveCommand): void {
    try {
      active.proc.kill();
    } catch (err) {
      log.warn('command result kill failed', {
        sessionId: active.record.sessionId,
        commandId: active.record.id,
        error: toErrorMessage(err),
      });
    }
  }

  private appendRecord(record: CommandResultRecord): void {
    const next = [...(this.records.get(record.sessionId) ?? []), record];

    this.records.set(record.sessionId, next.slice(-MAX_RECORDS_PER_SESSION));
    void this.persist();
  }

  private replaceRecord(record: CommandResultRecord): void {
    const existing = this.records.get(record.sessionId) ?? [];
    const idx = existing.findIndex((item) => item.id === record.id);
    const next =
      idx >= 0
        ? existing.map((item) => (item.id === record.id ? record : item))
        : [...existing, record];

    this.records.set(record.sessionId, next.slice(-MAX_RECORDS_PER_SESSION));
    void this.persist();
  }

  private load(): void {
    if (!existsSync(this.storagePath)) return;

    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, CommandResultRecord[]>;

      for (const [sessionId, records] of Object.entries(parsed)) {
        if (Array.isArray(records))
          this.records.set(sessionId, records.slice(-MAX_RECORDS_PER_SESSION));
      }
    } catch (err) {
      log.warn('command results load failed', {
        error: toErrorMessage(err),
      });
    }
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.storagePath), { recursive: true });
      const data = Object.fromEntries(this.records.entries());

      await writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      log.warn('command results persist failed', {
        error: toErrorMessage(err),
      });
    }
  }
}
