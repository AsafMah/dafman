// Filesystem CRUD for user-authored custom agent definitions
// (Phase 19b.2). The SDK auto-discovers agents from disk on
// session create / resume / reload; this module writes the same
// shape so newly-created agents surface in the picker after a
// `session.rpc.agent.reload` call.
//
// Scope:
//   - User:    `<userConfigDir>/agents/<name>.agent.md`
//   - Project: `<workingDirectory>/.github/agents/<name>.agent.md`
//
// We use `.agent.md` (not bare `.md`) so the SDK's loader (which
// prefers `.agent.md` when both forms exist) treats our files as
// agents unambiguously, and so we don't conflict with arbitrary
// markdown the user might have in the same directory.
//
// **No Edit operation in v1** — the SDK accepts unknown frontmatter
// keys we don't model (e.g. `github.toolsets`, `github.permissions`,
// `mcp-servers`, custom plugins). Editing an existing file with our
// simplified writer would silently strip those keys. We expose
// create + delete only and tell the user to edit the file directly
// for advanced fields.

import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { AppError } from '../shared/errors';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';

/// Per the SDK app.js: `userConfigDir` resolves to `~/.copilot/`
/// (Linux/macOS) or %APPDATA%/.copilot on Windows in practice. We
/// match by defaulting to `homedir()/.copilot/agents/` — Electrobun
/// also persists settings under `Utils.paths.userData` which differs
/// per platform; but the SDK's agent loader specifically reads from
/// the homedir-derived path so we have to match THAT, not Electrobun's
/// userData.
export function userAgentsDir(): string {
  return join(homedir(), '.copilot', 'agents');
}

export function projectAgentsDir(workingDirectory: string): string {
  return join(workingDirectory, '.github', 'agents');
}

export type AgentScope = 'user' | 'project';

export interface AgentFileSpec {
  scope: AgentScope;
  /// Base filename (no `.agent.md` suffix, no path). Validated
  /// against `NAME_RE` + Windows reserved names before any I/O.
  name: string;
  /// Optional `displayName` frontmatter key. SDK falls back to
  /// `name` if missing — we keep undefined out of the file rather
  /// than emit `displayName: name` to avoid noise.
  displayName?: string;
  /// REQUIRED by the SDK's frontmatter schema. Empty string would
  /// pass Zod but is user-hostile; we reject empty descriptions
  /// at write time.
  description: string;
  /// `tools` frontmatter: empty array means inherit ("*").
  tools?: string[];
  /// `skills` frontmatter: which preloaded skills the agent gets.
  skills?: string[];
  /// `model` frontmatter (optional model override).
  model?: string;
  /// `user-invocable` frontmatter, defaults true in the SDK.
  userInvocable?: boolean;
  /// Markdown body — the agent's prompt. Stored verbatim AFTER the
  /// frontmatter; lexer treats it as the prompt template.
  prompt: string;
}

export interface DiscoveredAgentFile {
  scope: AgentScope;
  name: string;
  path: string;
  /// True iff the file's basename ends with `.agent.md` (our
  /// written form). Files ending in `.md` without the `.agent`
  /// segment may exist (e.g. user-edited or SDK-discovered files
  /// from older conventions) — we surface them but recommend
  /// using `.agent.md` for new entries.
  canonical: boolean;
}

/// Filename validation: alphanumerics, dot, hyphen, underscore.
/// Allows `my-agent`, `my.agent.v2`, `my_agent_v2`; rejects path
/// separators, drive prefixes, leading/trailing dots, spaces, etc.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/// Windows reserved device names (case-insensitive) that can't be
/// used as filenames. Per Microsoft's docs.
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/// Validates an agent `name` before any path construction. Throws
/// `AppError.sdk` on rejection so the renderer gets a typed error
/// surface. Exported for tests + so the renderer can pre-validate.
export function validateAgentName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw AppError.sdk('agent name is required');
  }

  if (name.length > 64) {
    throw AppError.sdk('agent name too long (max 64 chars)');
  }

  if (!NAME_RE.test(name)) {
    throw AppError.sdk(
      'agent name must match [A-Za-z0-9][A-Za-z0-9._-]{0,63} (letters, digits, dot, hyphen, underscore)',
    );
  }

  if (WINDOWS_RESERVED.has(name.toLowerCase())) {
    throw AppError.sdk(`agent name "${name}" is a Windows reserved device name`);
  }
}

/// Resolves the target file path for a (scope, name) pair and
/// verifies the result is contained within the expected root. The
/// root-check is defense in depth — `validateAgentName` already
/// rejects path traversal characters, but normalizing + checking
/// the prefix catches platform-specific edge cases (NTFS short
/// names, etc.).
function resolveTargetPath(
  scope: AgentScope,
  name: string,
  workingDirectory?: string,
): { path: string; root: string } {
  validateAgentName(name);
  let root: string;

  if (scope === 'user') {
    root = userAgentsDir();
  } else if (scope === 'project') {
    if (!workingDirectory) {
      throw AppError.sdk('project scope requires a workingDirectory');
    }

    if (!isAbsolute(workingDirectory)) {
      throw AppError.sdk('workingDirectory must be absolute');
    }

    root = projectAgentsDir(workingDirectory);
  } else {
    throw AppError.sdk(`unknown agent scope: ${scope}`);
  }

  const normalizedRoot = normalize(root);
  const filename = `${name}.agent.md`;
  const candidate = resolve(normalizedRoot, filename);
  const rel = relative(normalizedRoot, candidate);

  if (rel.startsWith('..') || isAbsolute(rel) || rel.includes('..')) {
    throw AppError.sdk(
      `resolved agent path escapes scope root: ${candidate} not under ${normalizedRoot}`,
    );
  }

  return { path: candidate, root: normalizedRoot };
}

/// Hand-rolled minimal YAML serializer for the frontmatter we
/// support. Limits: only flat key/value pairs (strings, booleans,
/// string arrays). No nested objects (`mcp-servers`, `github`).
/// This is intentional — see the v1 scope note at the top of the
/// file. If the rendered output ever needs to include nested keys,
/// switch to the `yaml` npm dep at that point.
function serializeFrontmatter(spec: AgentFileSpec): string {
  const lines: string[] = [];
  const quote = (s: string): string => {
    // JSON.stringify gives us double-quoted YAML strings with
    // correct escaping (`\n`, `\"`, etc.). Sufficient for our
    // scope; doesn't handle YAML-specific quirks like leading
    // `>` block-scalar markers, which we never emit.
    return JSON.stringify(s);
  };
  const emitArray = (key: string, items: string[]): void => {
    if (items.length === 0) {
      lines.push(`${key}: []`);

      return;
    }

    lines.push(`${key}:`);

    for (const item of items) lines.push(`  - ${quote(item)}`);
  };

  lines.push(`name: ${quote(spec.name)}`);

  if (spec.displayName !== undefined && spec.displayName !== spec.name) {
    lines.push(`displayName: ${quote(spec.displayName)}`);
  }

  lines.push(`description: ${quote(spec.description)}`);

  if (spec.tools && spec.tools.length > 0) emitArray('tools', spec.tools);

  if (spec.skills && spec.skills.length > 0) emitArray('skills', spec.skills);

  if (spec.model) lines.push(`model: ${quote(spec.model)}`);

  if (spec.userInvocable === false) lines.push('user-invocable: false');

  return lines.join('\n');
}

/// Atomic write: temp file in the same directory, then rename.
/// Renames on the same filesystem are atomic on every OS we care
/// about; the temp file gets a `.tmp-<rand>` suffix so concurrent
/// writes don't collide. On crash the temp leaks but we ignore it.
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${randomSuffix()}`;

  await writeFile(tmp, content, 'utf-8');

  try {
    // Use writeFile to do an atomic-enough overwrite via rename
    // fallback. Node's rename is atomic on POSIX; on Windows we
    // rely on it overwriting the destination if it exists (Node
    // 22+ supports it; otherwise we'd unlink first).
    const { rename } = await import('node:fs/promises');

    await rename(tmp, path);
  } catch (err) {
    // Cleanup tmp on failure so we don't leave it on disk.
    try {
      await rm(tmp, { force: true });
    } catch {
      /* ignore */
    }

    throw err;
  }
}

function randomSuffix(): string {
  // 6 hex chars from random. crypto.randomBytes is overkill for
  // a temp-file suffix.
  return Math.random().toString(16).slice(2, 8);
}

/// Lists discovered agent files from disk for the given scopes.
/// Does NOT call the SDK — this is the file-list view for the
/// Library tab, which needs to know what we can edit/delete
/// independently of whether they're loaded into an active session.
/// Returns empty arrays for any scope whose directory doesn't
/// exist (not an error).
export async function listAgentFiles(opts: {
  includeUser?: boolean;
  includeProject?: boolean;
  workingDirectory?: string;
}): Promise<DiscoveredAgentFile[]> {
  const out: DiscoveredAgentFile[] = [];
  const tasks: Array<Promise<void>> = [];

  if (opts.includeUser !== false) {
    tasks.push(scanDir(userAgentsDir(), 'user', out));
  }

  if (opts.includeProject !== false && opts.workingDirectory) {
    tasks.push(scanDir(projectAgentsDir(opts.workingDirectory), 'project', out));
  }

  await Promise.all(tasks);

  return out;
}

async function scanDir(dir: string, scope: AgentScope, out: DiscoveredAgentFile[]): Promise<void> {
  if (!existsSync(dir)) return;

  let entries: Awaited<ReturnType<typeof readdir>>;

  try {
    entries = await readdir(dir);
  } catch (err) {
    log.warn('listAgentFiles: failed to read dir', {
      dir,
      error: toErrorMessage(err),
    });

    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const canonical = entry.endsWith('.agent.md');
    const name = entry.replace(/(\.agent)?\.md$/, '');

    out.push({
      scope,
      name,
      path: join(dir, entry),
      canonical,
    });
  }
}

/// Creates a new agent file. Refuses to overwrite an existing file
/// — Edit is deferred to a future phase; the caller should delete +
/// recreate if they actually want to overwrite (this keeps the
/// "no silent data loss" invariant from the rubber-duck duck).
export async function writeAgent(spec: AgentFileSpec, workingDirectory?: string): Promise<string> {
  if (!spec.description || spec.description.trim().length === 0) {
    throw AppError.sdk('description is required');
  }

  const { path, root } = resolveTargetPath(spec.scope, spec.name, workingDirectory);

  if (existsSync(path)) {
    throw AppError.sdk(`agent already exists at ${path}; delete it first to overwrite`);
  }

  await mkdir(root, { recursive: true });
  const frontmatter = serializeFrontmatter(spec);
  const body = spec.prompt.trim().length > 0 ? `${spec.prompt.trim()}\n` : '';
  const content = `---\n${frontmatter}\n---\n\n${body}`;

  await atomicWrite(path, content);
  log.info('wrote agent file', { path, scope: spec.scope, name: spec.name });

  return path;
}

/// Deletes an agent file. Verifies the resolved path is under the
/// expected root before any unlink. Returns true if a file was
/// removed, false if it didn't exist.
export async function deleteAgent(
  scope: AgentScope,
  name: string,
  workingDirectory?: string,
): Promise<boolean> {
  const { path } = resolveTargetPath(scope, name, workingDirectory);

  if (!existsSync(path)) return false;

  const info = await stat(path);

  if (!info.isFile()) {
    throw AppError.sdk(`refusing to delete non-file at ${path}`);
  }

  await rm(path, { force: true });
  log.info('deleted agent file', { path, scope, name });

  return true;
}
