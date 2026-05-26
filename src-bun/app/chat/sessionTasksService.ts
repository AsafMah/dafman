// SessionTasksService — SDK tasks.* + fleet.* surface.
//
// Extracted from `SessionRegistry` (Phase D.3.3, 2026-05-26). Owns
// the per-session task list, cancel/remove/promote operations, and
// the parallel `fleet.start` kick-off (Phase 19c). `listJobs`
// (cross-session aggregation) lives here too because it sits on top
// of `list` — but it iterates the registry's entries, so the
// service takes a `getSessionIds` getter to discover them without
// peeking into the entries Map directly.

import type { JobRecord, TaskInfo } from '../../rpc';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';
import { jobFromTask, normalizeTask } from './sessionHelpers';
import type { SessionServiceContext } from './sessionServiceContext';

export class SessionTasksService {
  constructor(
    private readonly ctx: SessionServiceContext,
    /// Returns every currently-registered session id. The registry
    /// owns the entries Map; we ask via a getter so the service
    /// never holds a reference to the mutable collection.
    private readonly getSessionIds: () => Iterable<string>,
  ) {}

  async list(sessionId: string): Promise<TaskInfo[]> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.tasks.list()) as unknown as {
        tasks?: Array<Record<string, unknown>>;
      };

      return (result.tasks ?? [])
        .filter((t) => (t.type === 'agent' || t.type === 'shell') && typeof t.id === 'string')
        .map(normalizeTask);
    });
  }

  async listJobs(): Promise<JobRecord[]> {
    const jobs: JobRecord[] = [];

    for (const sessionId of this.getSessionIds()) {
      try {
        const tasks = await this.list(sessionId);

        for (const task of tasks) jobs.push(jobFromTask(sessionId, task));
      } catch (err) {
        log.warn('listJobs failed for session', {
          sessionId,
          error: toErrorMessage(err),
        });
      }
    }

    return jobs.sort((a, b) => {
      const at = a.startedAt ? Date.parse(a.startedAt) : 0;
      const bt = b.startedAt ? Date.parse(b.startedAt) : 0;

      return bt - at;
    });
  }

  async cancel(sessionId: string, id: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.tasks.cancel({ id })) as {
        cancelled?: boolean;
      };

      return result.cancelled === true;
    });
  }

  async remove(sessionId: string, id: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.tasks.remove({ id })) as {
        removed?: boolean;
      };

      return result.removed === true;
    });
  }

  async promote(sessionId: string, id: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.tasks.promoteToBackground({ id })) as {
        promoted?: boolean;
      };

      return result.promoted === true;
    });
  }

  /// Fleet (Phase 19c): kicks off parallel sub-agent work. Sub-agent
  /// activity streams via the regular session events (each tagged
  /// with the sub-agent's envelope `agentId`), rendered by the chat
  /// reducer's nested SubagentChatItem branch.
  async startFleet(sessionId: string, prompt?: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.fleet.start(prompt ? { prompt } : {})) as {
        started?: boolean;
      };

      return result.started === true;
    });
  }
}
