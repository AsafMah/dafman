// SessionMcpService — SDK session.rpc.mcp.* surface (session-scoped).
//
// Extracted from `SessionRegistry` (Phase D.3.5, 2026-05-26). The
// server-scoped MCP catalog lives in `./mcpRegistry.ts` (21a.2) and
// is unrelated; this file only handles the 3 methods that need an
// entry lookup (list / enable+disable / OAuth login).

import type { SessionServiceContext } from './sessionServiceContext';

export interface SessionMcpServer {
  name: string;
  status: string;
  source?: string;
  error?: string;
}

export class SessionMcpService {
  constructor(private readonly ctx: SessionServiceContext) {}

  /// Session-scoped per-MCP server state. Captures less detail than
  /// the server-scoped catalog — only name/status/source/error.
  async listServers(sessionId: string): Promise<SessionMcpServer[]> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.mcp.list()) as {
        servers?: Array<{
          name?: unknown;
          status?: unknown;
          source?: unknown;
          error?: unknown;
        }>;
      };
      const servers = result.servers ?? [];

      return servers
        .filter((s) => typeof s.name === 'string')
        .map((s) => ({
          name: String(s.name),
          status: typeof s.status === 'string' ? s.status : 'unknown',
          ...(typeof s.source === 'string' ? { source: s.source } : {}),
          ...(typeof s.error === 'string' ? { error: s.error } : {}),
        }));
    });
  }

  /// Session-scoped per-MCP toggle. Lives on the live session
  /// (`session.rpc.mcp.enable/disable`) rather than the server-
  /// scoped allowlist — lets the user gate an MCP for one session
  /// without persistently disabling it everywhere.
  async setEnabled(
    sessionId: string,
    serverName: string,
    enabled: boolean,
  ): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      if (enabled) {
        await entry.session.rpc.mcp.enable({ serverName });
      } else {
        await entry.session.rpc.mcp.disable({ serverName });
      }

      return true;
    });
  }

  async loginToServer(
    sessionId: string,
    serverName: string,
    opts: { forceReauth?: boolean; clientName?: string } = {},
  ): Promise<{ authorizationUrl: string | null }> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.mcp.oauth.login({
        serverName,
        ...(opts.forceReauth ? { forceReauth: opts.forceReauth } : {}),
        ...(opts.clientName ? { clientName: opts.clientName } : {}),
      })) as { authorizationUrl?: unknown };

      return {
        authorizationUrl:
          typeof result.authorizationUrl === 'string' ? result.authorizationUrl : null,
      };
    });
  }
}
