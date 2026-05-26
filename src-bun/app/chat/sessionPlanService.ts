// SessionPlanService — SDK plan.* surface.
//
// Extracted from `SessionRegistry` (Phase D.3.1, 2026-05-26). The
// registry keeps thin delegating methods so existing callers
// (src-bun/index.ts, src-bun/test-server.ts, 50+ tests in
// src-bun/__tests__/) stay working unchanged.

import type { SessionServiceContext } from './sessionServiceContext';

export interface ReadPlanResult {
  exists: boolean;
  content: string | null;
  path: string | null;
}

export class SessionPlanService {
  constructor(private readonly ctx: SessionServiceContext) {}

  async read(sessionId: string): Promise<ReadPlanResult> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.plan.read()) as {
        exists?: unknown;
        content?: unknown;
        path?: unknown;
      };

      return {
        exists: result.exists === true,
        content: typeof result.content === 'string' ? result.content : null,
        path: typeof result.path === 'string' ? result.path : null,
      };
    });
  }

  async write(sessionId: string, content: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      await entry.session.rpc.plan.update({ content });

      return true;
    });
  }

  async delete(sessionId: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      await entry.session.rpc.plan.delete();

      return true;
    });
  }
}
