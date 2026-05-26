// SessionSkillsService — SDK skills.* surface.
//
// Extracted from `SessionRegistry` (Phase D.3.2, 2026-05-26). The
// registry keeps thin delegating methods so existing callers stay
// unchanged.

import type { SessionServiceContext } from './sessionServiceContext';

export interface SkillInfo {
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  userInvocable: boolean;
  path?: string;
}

export class SessionSkillsService {
  constructor(private readonly ctx: SessionServiceContext) {}

  /// Lists session skills (name, description, enabled, source).
  /// The popover renders a toggle per skill so the user can flip
  /// any skill on/off mid-session. Errors are wrapped — skill APIs
  /// are @experimental in the SDK; if they aren't wired the renderer
  /// surfaces a toast and falls back to an empty list.
  async list(sessionId: string): Promise<SkillInfo[]> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.skills.list()) as {
        skills?: Array<{
          name?: unknown;
          description?: unknown;
          source?: unknown;
          enabled?: unknown;
          userInvocable?: unknown;
          path?: unknown;
        }>;
      };
      const skills = result.skills ?? [];

      return skills
        .filter((s) => typeof s.name === 'string')
        .map((s) => ({
          name: String(s.name),
          description: typeof s.description === 'string' ? s.description : '',
          source: typeof s.source === 'string' ? s.source : '',
          enabled: s.enabled === true,
          userInvocable: s.userInvocable === true,
          ...(typeof s.path === 'string' ? { path: s.path } : {}),
        }));
    });
  }

  async setEnabled(sessionId: string, name: string, enabled: boolean): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      if (enabled) {
        await entry.session.rpc.skills.enable({ name });
      } else {
        await entry.session.rpc.skills.disable({ name });
      }

      return true;
    });
  }
}
