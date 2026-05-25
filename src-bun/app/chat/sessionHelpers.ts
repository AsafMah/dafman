// Pure helper functions extracted from SessionRegistry.
//
// Normalization, formatting, and conversion utilities that operate on
// SDK wire shapes and turn them into typed Dafman records. None of
// these touch the SDK session or IPC — they're pure data transforms.

import type { PermissionRequest } from '../client/copilotSdk';
import type { AgentInfo, CommandResultRecord, JobRecord, TaskInfo, TaskStatus } from '../rpc';

// ---------------------------------------------------------------------------
// Command-result helpers
// ---------------------------------------------------------------------------

/// Strip ANSI / OSC escape sequences so rendered markdown is clean.
function cleanAnsi(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/[\x1B\x9B]\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[()#;?]*(?:[0-9A-ORZcf-nqry=><~])/g, '')
    .replace(/\x07/g, '')
    .replace(/\r/g, '')
    .trimEnd();
}

export function commandResultMarkdown(result: CommandResultRecord): string {
  const status = result.status === 'completed' && result.exitCode === 0 ? 'success' : result.status;
  const lines = [
    '# Command result',
    '',
    `- Command: \`${result.command.replace(/`/g, '\\`')}\``,
    `- CWD: \`${result.cwd.replace(/`/g, '\\`')}\``,
    `- Shell: \`${result.shell.replace(/`/g, '\\`')}\``,
    `- Status: ${status}`,
    ...(typeof result.exitCode === 'number' ? [`- Exit code: ${result.exitCode}`] : []),
    ...(typeof result.durationMs === 'number' ? [`- Duration: ${result.durationMs} ms`] : []),
    ...(result.truncated ? ['- Output: truncated'] : []),
    '',
    '## stdout',
    '```text',
    cleanAnsi(result.stdout) || '(empty)',
    '```',
    '',
    '## stderr',
    '```text',
    cleanAnsi(result.stderr) || '(empty)',
    '```',
    '',
  ];

  return lines.join('\n');
}

export function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'command-result';
}

export function commandResultBlobAttachment(
  result: CommandResultRecord,
  displayName?: string,
): { type: 'blob'; data: string; mimeType: string; displayName: string } {
  const markdown = commandResultMarkdown(result);
  const data = Buffer.from(markdown, 'utf8').toString('base64');

  return {
    type: 'blob',
    data,
    mimeType: 'text/markdown',
    displayName: displayName ?? `command-result-${safeFilePart(result.id)}.md`,
  };
}

// ---------------------------------------------------------------------------
// Agent normalization
// ---------------------------------------------------------------------------

/// Normalize the SDK's loose AgentInfo wire shape into our typed `AgentInfo`.
export function normalizeAgent(raw: {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  path?: unknown;
}): AgentInfo {
  const out: AgentInfo = {
    name: String(raw.name),
    displayName: typeof raw.displayName === 'string' ? raw.displayName : String(raw.name),
    description: typeof raw.description === 'string' ? raw.description : '',
  };

  if (typeof raw.path === 'string' && raw.path.length > 0) out.path = raw.path;

  return out;
}

// ---------------------------------------------------------------------------
// Task normalization
// ---------------------------------------------------------------------------

const TASK_STATUSES: TaskStatus[] = ['running', 'idle', 'completed', 'failed', 'cancelled'];

export function normalizeTaskStatus(status: unknown): TaskStatus {
  return typeof status === 'string' && TASK_STATUSES.includes(status as TaskStatus)
    ? (status as TaskStatus)
    : 'running';
}

/// Normalize the SDK's loose TaskInfo union into our typed `TaskInfo`.
export function normalizeTask(raw: Record<string, unknown>): TaskInfo {
  const common = {
    id: String(raw.id),
    description: typeof raw.description === 'string' ? raw.description : '',
    status: normalizeTaskStatus(raw.status),
  };

  if (typeof raw.type === 'string' && raw.type === 'shell') {
    const out: TaskInfo = {
      ...common,
      type: 'shell',
      command: typeof raw.command === 'string' ? raw.command : '',
    };

    if (typeof raw.startedAt === 'string') out.startedAt = raw.startedAt;

    if (typeof raw.completedAt === 'string') out.completedAt = raw.completedAt;

    if (typeof raw.activeTimeMs === 'number') out.activeTimeMs = raw.activeTimeMs;

    if (typeof raw.error === 'string') out.error = raw.error;

    if (raw.executionMode === 'sync' || raw.executionMode === 'background')
      out.executionMode = raw.executionMode;

    if (typeof raw.canPromoteToBackground === 'boolean')
      out.canPromoteToBackground = raw.canPromoteToBackground;

    if (raw.attachmentMode === 'pty' || raw.attachmentMode === 'detached')
      out.attachmentMode = raw.attachmentMode;

    if (typeof raw.logPath === 'string') out.logPath = raw.logPath;

    if (typeof raw.pid === 'number') out.pid = raw.pid;

    return out;
  }

  // Default to agent type.
  const out: TaskInfo = {
    ...common,
    type: 'agent',
    agentType: typeof raw.agentType === 'string' ? raw.agentType : 'unknown',
  };

  if (typeof raw.toolCallId === 'string') out.toolCallId = raw.toolCallId;

  if (typeof raw.startedAt === 'string') out.startedAt = raw.startedAt;

  if (typeof raw.completedAt === 'string') out.completedAt = raw.completedAt;

  if (typeof raw.activeTimeMs === 'number') out.activeTimeMs = raw.activeTimeMs;

  if (typeof raw.error === 'string') out.error = raw.error;

  if (raw.executionMode === 'sync' || raw.executionMode === 'background')
    out.executionMode = raw.executionMode;

  if (typeof raw.canPromoteToBackground === 'boolean')
    out.canPromoteToBackground = raw.canPromoteToBackground;

  if (typeof raw.agentName === 'string') out.agentName = raw.agentName;

  if (typeof raw.agentDisplayName === 'string') out.agentDisplayName = raw.agentDisplayName;

  if (typeof raw.prompt === 'string') out.prompt = raw.prompt;

  if (typeof raw.result === 'string') out.result = raw.result;

  if (typeof raw.model === 'string') out.model = raw.model;

  if (typeof raw.latestResponse === 'string') out.latestResponse = raw.latestResponse;

  if (typeof raw.idleSince === 'string') out.idleSince = raw.idleSince;

  return out;
}

// ---------------------------------------------------------------------------
// Job conversion
// ---------------------------------------------------------------------------

export function jobFromTask(sessionId: string, task: TaskInfo): JobRecord {
  const running = task.status === 'running' || task.status === 'idle';
  const terminal =
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
  const base = {
    id: `${sessionId}:${task.id}`,
    sessionId,
    source: 'sdk-task' as const,
    kind: task.type,
    status: task.status,
    title:
      task.type === 'agent'
        ? (task.agentDisplayName ?? task.agentName ?? task.agentType)
        : task.command || task.description || 'Shell task',
    description: task.description,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    activeTimeMs: task.activeTimeMs,
    error: task.error,
    executionMode: task.executionMode,
    canCancel: running,
    canRemove: terminal,
    canPromoteToBackground: task.canPromoteToBackground === true,
    canOpenSession: true,
  };

  if (task.type === 'agent') {
    return {
      ...base,
      kind: 'agent',
      agentType: task.agentType,
      agentName: task.agentName,
      agentDisplayName: task.agentDisplayName,
      model: task.model,
      prompt: task.prompt,
      latestResponse: task.latestResponse,
      result: task.result,
      toolCallId: task.toolCallId,
    };
  }

  return {
    ...base,
    kind: 'shell',
    command: task.command,
    logPath: task.logPath,
    pid: task.pid,
  };
}

// ---------------------------------------------------------------------------
// Permission summary
// ---------------------------------------------------------------------------

/// One-line human-readable summary of a permission request.
export function summarizePermission(request: PermissionRequest): string {
  const raw = request as unknown as Record<string, unknown>;
  const path =
    typeof raw.fileName === 'string'
      ? raw.fileName
      : typeof raw.path === 'string'
        ? raw.path
        : null;
  const command =
    typeof raw.fullCommandText === 'string'
      ? raw.fullCommandText
      : typeof raw.command === 'string'
        ? raw.command
        : typeof raw.cmd === 'string'
          ? raw.cmd
          : null;
  const url = typeof raw.url === 'string' ? raw.url : null;
  const server = typeof raw.serverName === 'string' ? raw.serverName : null;
  const tool = typeof raw.toolName === 'string' ? raw.toolName : null;

  switch (request.kind) {
    case 'shell':
      return command ? `Run \`${command}\`` : 'Run a shell command';
    case 'write':
      return path ? `Modify ${path}` : 'Modify a file';
    case 'read':
      return path ? `Read ${path}` : 'Read a file';
    case 'url':
      return url ? `Open ${url}` : 'Open a URL';
    case 'mcp':
      return server && tool
        ? `Call ${server} / ${tool}`
        : server
          ? `Call MCP server ${server}`
          : 'Call an MCP tool';
    case 'custom-tool':
      return tool ? `Run ${tool}` : 'Run a custom tool';
    case 'memory':
      return 'Save to memory';
    case 'hook':
      return 'Run a hook';
  }
}

// ---------------------------------------------------------------------------
// Generic utilities
// ---------------------------------------------------------------------------

/// Plain-object copy of an SDK runtime payload for diagnostic display.
export function toPlainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {};

  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'function') continue;

    if (typeof v === 'object' && v !== null) {
      try {
        JSON.stringify(v);
        out[k] = v;
      } catch {
        /* skip un-serializable */
      }
    } else {
      out[k] = v;
    }
  }

  return out;
}
