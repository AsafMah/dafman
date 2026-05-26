// SessionAgentsService — SDK agent.* surface + filesystem-level
// agent file CRUD (Phase 19b.2).
//
// Extracted from `SessionRegistry` (Phase D.3.4, 2026-05-26).
// Includes both:
// - SDK-side: list / getCurrent / select / deselect / reload (the
//   five @experimental `session.rpc.agent.*` calls)
// - filesystem-side: list / write / delete agent files in the
//   library tree (project + user scope). The fs writes call back
//   into `session.rpc.agent.reload()` so the SDK's view stays in
//   sync; failures of the reload are logged but never thrown
//   (best-effort).

import { log } from '../observability/logging';
import { AppError } from '../shared/errors';
import { toErrorMessage } from '../shared/errorMessage';
import {
  listAgentFiles,
  writeAgent,
  deleteAgent,
  type AgentFileSpec,
  type AgentScope as AgentFileScope,
} from '../library/agentFiles';
import { normalizeAgent } from './sessionHelpers';
import type { AgentInfo } from '../../rpc';
import type { SessionServiceContext } from './sessionServiceContext';

export interface AgentFileEntry {
  scope: AgentFileScope;
  name: string;
  path: string;
  canonical: boolean;
}

export class SessionAgentsService {
  constructor(private readonly ctx: SessionServiceContext) {}

  async list(sessionId: string): Promise<AgentInfo[]> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.agent.list()) as {
        agents?: Array<{
          name?: unknown;
          displayName?: unknown;
          description?: unknown;
          path?: unknown;
        }>;
      };

      return (result.agents ?? []).filter((a) => typeof a.name === 'string').map(normalizeAgent);
    });
  }

  async getCurrent(sessionId: string): Promise<AgentInfo | null> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.agent.getCurrent()) as {
        agent?: {
          name?: unknown;
          displayName?: unknown;
          description?: unknown;
          path?: unknown;
        } | null;
      };

      if (!result.agent || typeof result.agent.name !== 'string') return null;

      return normalizeAgent(result.agent);
    });
  }

  async select(sessionId: string, name: string): Promise<AgentInfo> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.agent.select({ name })) as {
        agent?: {
          name?: unknown;
          displayName?: unknown;
          description?: unknown;
          path?: unknown;
        };
      };

      if (!result.agent || typeof result.agent.name !== 'string') {
        throw AppError.sdk('selectAgent: SDK returned no agent');
      }

      return normalizeAgent(result.agent);
    });
  }

  async deselect(sessionId: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      await entry.session.rpc.agent.deselect();

      return true;
    });
  }

  async reload(sessionId: string): Promise<AgentInfo[]> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.agent.reload()) as {
        agents?: Array<{
          name?: unknown;
          displayName?: unknown;
          description?: unknown;
          path?: unknown;
        }>;
      };

      return (result.agents ?? []).filter((a) => typeof a.name === 'string').map(normalizeAgent);
    });
  }

  // ---------- Filesystem agent files (Phase 19b.2) ----------

  async listFiles(sessionId: string): Promise<AgentFileEntry[]> {
    const entry = this.ctx.getEntry(sessionId);
    const opts: Parameters<typeof listAgentFiles>[0] = {
      includeUser: true,
      includeProject: true,
    };

    if (entry.workingDirectory) opts.workingDirectory = entry.workingDirectory;

    return listAgentFiles(opts);
  }

  /// User-scope only — for the Library tab when no session is
  /// open. Doesn't require sessionId / workingDirectory.
  async listFilesGlobal(): Promise<AgentFileEntry[]> {
    return listAgentFiles({ includeUser: true, includeProject: false });
  }

  async writeFile(sessionId: string, spec: AgentFileSpec): Promise<string> {
    // User-scope writes don't need a workingDirectory; project
    // scope does. The registry resolves it from the session entry
    // (no caller-supplied workingDirectory string allowed — defense
    // in depth: a malicious renderer could otherwise pass an
    // arbitrary path).
    const entry = this.ctx.getEntry(sessionId);
    const wd = spec.scope === 'project' ? (entry.workingDirectory ?? undefined) : undefined;

    if (spec.scope === 'project' && !wd) {
      throw AppError.sdk('project scope requires a session with a working directory');
    }

    const path = await writeAgent(spec, wd);

    // Tell the SDK to re-scan so the new agent shows up in
    // `session.rpc.agent.list` immediately. Best-effort: a failed
    // reload doesn't block the user's write.
    try {
      await entry.session.rpc.agent.reload();
    } catch (err) {
      log.warn('agent.reload after writeAgentFile failed', {
        sessionId,
        error: toErrorMessage(err),
      });
    }

    return path;
  }

  async deleteFile(sessionId: string, scope: AgentFileScope, name: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);
    const wd = scope === 'project' ? (entry.workingDirectory ?? undefined) : undefined;

    if (scope === 'project' && !wd) {
      throw AppError.sdk('project scope requires a session with a working directory');
    }

    const removed = await deleteAgent(scope, name, wd);

    if (removed) {
      try {
        await entry.session.rpc.agent.reload();
      } catch (err) {
        log.warn('agent.reload after deleteAgentFile failed', {
          sessionId,
          error: toErrorMessage(err),
        });
      }
    }

    return removed;
  }
}
