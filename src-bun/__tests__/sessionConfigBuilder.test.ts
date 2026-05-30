// SessionConfigBuilder hook tests.
//
// Focused on the #37 `onPreMcpToolCall` hook: it must record a
// forensic MCP audit entry (server/tool/argKeys, never raw arg
// values), preserve `_meta` (return undefined), and never throw on
// the MCP critical path.

import { describe, expect, test, beforeEach } from 'bun:test';
import { buildBaseSessionConfig } from '../app/chat/sessionConfigBuilder';
import type { SessionConfigBuilderDeps } from '../app/chat/sessionConfigBuilder';
import {
  _resetAudit,
  recentAudit,
  subscribeAudit,
  type AuditEntry,
} from '../app/observability/audit';
import type { PendingRequestQueue } from '../app/chat/pendingRequests';
import type { PreMcpToolCallInput } from '../app/client/copilotSdk';

function makeDeps(): SessionConfigBuilderDeps {
  return {
    tools: [],
    emit: () => {},
    emitPending: () => {},
    approveAllBySession: new Map(),
    modeBySession: new Map(),
    // The MCP hook never touches the pending queue; a bare stub is
    // enough for these tests.
    pending: {} as PendingRequestQueue,
    streamingResolver: () => false,
    excludedToolsResolver: () => [],
    allowedToolsResolver: () => [],
  };
}

/// Minimal PreMcpToolCallInput-shaped object. The real SDK type is
/// structural; we build the fields the hook reads and cast.
function mcpInput(over: Record<string, unknown>): PreMcpToolCallInput {
  return {
    sessionId: 'sdk-sess',
    timestamp: Date.now(),
    workingDirectory: '/repo',
    serverName: 'github',
    toolName: 'create_issue',
    arguments: {},
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('sessionConfigBuilder onPreMcpToolCall (#37)', () => {
  beforeEach(() => {
    _resetAudit();
  });

  test('records an mcp audit entry with key names only and preserves _meta', () => {
    const config = buildBaseSessionConfig(makeDeps(), () => 'sess-1');
    const seen: AuditEntry[] = [];
    const unsubscribe = subscribeAudit((entry) => seen.push(entry));

    const result = config.hooks?.onPreMcpToolCall?.(
      mcpInput({
        serverName: 'github',
        toolName: 'create_issue',
        toolCallId: 'tc-9',
        arguments: { title: 'hi', token: 'super-secret' },
      }),
    );

    // Preserve _meta — the hook only observes.
    expect(result).toBeUndefined();

    // Audit entry recorded (synchronously into the ring).
    const ring = recentAudit();
    expect(ring).toHaveLength(1);
    const entry = ring[0];
    expect(entry?.kind).toBe('mcp');
    if (entry?.kind === 'mcp') {
      expect(entry.serverName).toBe('github');
      expect(entry.toolName).toBe('create_issue');
      expect(entry.toolCallId).toBe('tc-9');
      expect(entry.argKeys).toEqual(['title', 'token']);
      // Value never captured.
      expect(JSON.stringify(entry)).not.toContain('super-secret');
    }

    // Fan-out fired.
    expect(seen).toHaveLength(1);
    unsubscribe();
  });

  test('does not throw when arguments is exotic (returns undefined)', () => {
    const config = buildBaseSessionConfig(makeDeps(), () => 'sess-1');

    // arguments is a primitive — extractArgKeys degrades to empty.
    const result = config.hooks?.onPreMcpToolCall?.(
      mcpInput({ arguments: 'not-an-object', toolName: 'list_repos' }),
    );

    expect(result).toBeUndefined();
    const ring = recentAudit();
    expect(ring).toHaveLength(1);
    if (ring[0]?.kind === 'mcp') {
      expect(ring[0].argKeys).toEqual([]);
      expect(ring[0].argKeyCount).toBe(0);
    }
  });
});
