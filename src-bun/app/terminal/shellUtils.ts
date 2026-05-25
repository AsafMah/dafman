import { existsSync } from 'node:fs';

/**
 * Check whether a command is available on the system PATH.
 * If the command contains a path separator, checks for file existence directly.
 */
export function commandExists(command: string): boolean {
  if (command.includes('\\') || command.includes('/')) return existsSync(command);

  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = Bun.spawnSync([lookup, command], {
    stdout: 'ignore',
    stderr: 'ignore',
  });

  return result.exitCode === 0;
}

/**
 * Resolve the default interactive shell for the current platform.
 * Returns the shell binary and default args (e.g. `-NoLogo` for PowerShell).
 */
export function defaultShell(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    if (commandExists('pwsh.exe')) return { shell: 'pwsh.exe', args: ['-NoLogo'] };

    if (commandExists('powershell.exe')) {
      return { shell: 'powershell.exe', args: ['-NoLogo'] };
    }

    return { shell: 'cmd.exe', args: ['/d', '/q'] };
  }

  const shell = process.env.SHELL;

  if (shell && existsSync(shell)) return { shell, args: [] };

  if (commandExists('bash')) return { shell: 'bash', args: [] };

  return { shell: 'sh', args: [] };
}

/**
 * Resolve a shell to execute a single command string and exit.
 * Returns the shell binary and args including the command to run.
 */
export function resolveShellForCommand(command: string): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    if (commandExists('pwsh.exe')) {
      return { shell: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-Command', command] };
    }

    return { shell: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', command] };
  }

  const shell = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/sh';

  return { shell, args: ['-lc', command] };
}
