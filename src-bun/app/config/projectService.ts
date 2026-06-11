// Per-workspace project config overlay store.
//
// Persists `{ version: 1, projects: Project[] }` in `<userData>/projects.json`
// via atomicWrite. Paths are canonicalized before compare/store so a lookup
// by `/home/user/work/api` and `C:\Users\dev\work\api` both find the right entry.
//
// Mirrors the SessionMetadataStore / SettingsService load-or-default + coerce
// pattern so failure modes are consistent.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, normalize } from 'node:path';
import type { Project } from '../../rpc';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';
import { atomicWrite } from '../shared/atomicWrite';

const PROJECTS_VERSION = 1;

interface ProjectsFile {
  version: number;
  projects: Project[];
}

/// Canonical-path normalisation: resolve + normalize separators.
/// On Windows we also lowercase because NTFS is case-insensitive.
export function canonicalizePath(p: string): string {
  const abs = resolve(normalize(p));

  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

export class ProjectService {
  /// Serializes writes so concurrent save/delete calls can't interleave a partial file.
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private data: ProjectsFile,
  ) {}

  static loadOrDefault(filePath: string): ProjectService {
    const empty: ProjectsFile = { version: PROJECTS_VERSION, projects: [] };

    if (!existsSync(filePath)) return new ProjectService(filePath, empty);

    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;

      return new ProjectService(filePath, ProjectService.coerce(parsed));
    } catch (err) {
      log.warn('projects load failed; starting empty', {
        filePath,
        error: toErrorMessage(err),
      });

      return new ProjectService(filePath, empty);
    }
  }

  private static coerce(input: unknown): ProjectsFile {
    const out: ProjectsFile = { version: PROJECTS_VERSION, projects: [] };

    if (!input || typeof input !== 'object') return out;

    const raw = input as { projects?: unknown };

    if (!Array.isArray(raw.projects)) return out;

    for (const item of raw.projects) {
      if (!item || typeof item !== 'object') continue;

      const p = item as Record<string, unknown>;

      if (typeof p.path !== 'string' || !p.path) continue;

      const project: Project = {
        path: p.path,
        defaults:
          p.defaults && typeof p.defaults === 'object' ? (p.defaults as Project['defaults']) : {},
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
        updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
      };

      if (typeof p.name === 'string') project.name = p.name;

      out.projects.push(project);
    }

    return out;
  }

  list(): Project[] {
    return [...this.data.projects];
  }

  /// Exact canonical-path match (Phase 1). Returns the first project whose
  /// canonical path equals `cwd`'s canonical form.
  getForPath(cwd: string): Project | undefined {
    const canonical = canonicalizePath(cwd);

    return this.data.projects.find((p) => canonicalizePath(p.path) === canonical);
  }

  /// Insert or update by canonical path. Stores the canonical form.
  async save(project: Project): Promise<void> {
    const canonical = canonicalizePath(project.path);
    const stored: Project = { ...project, path: canonical };
    const idx = this.data.projects.findIndex((p) => canonicalizePath(p.path) === canonical);

    if (idx >= 0) {
      this.data.projects[idx] = stored;
    } else {
      this.data.projects.push(stored);
    }

    await this.persist();
  }

  async delete(path: string): Promise<void> {
    const canonical = canonicalizePath(path);

    this.data.projects = this.data.projects.filter((p) => canonicalizePath(p.path) !== canonical);
    await this.persist();
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);

    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        await atomicWrite(this.filePath, snapshot);
      })
      .catch((err) => {
        log.warn('projects persist failed', {
          path: this.filePath,
          error: toErrorMessage(err),
        });
      });

    return this.writeChain;
  }
}
