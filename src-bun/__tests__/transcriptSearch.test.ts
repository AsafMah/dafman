import { afterEach, describe, expect, test } from 'bun:test';
import { _setClientForTest } from '../app/client/client';
import { SessionRegistry } from '../app/chat/sessions';

/// Minimal SDK-event shape. Only the fields the search logic reads.
interface FakeEvent {
  type: string;
  data: Record<string, unknown>;
  id?: string;
  timestamp?: string;
}

function makeReg(history: FakeEvent[] = []): {
  reg: SessionRegistry;
  sessionId: string;
} {
  let openedSessionId: string | null = null;

  const fakeSession = {
    sessionId: 'test-sess-1',
    on: (_h: unknown) => () => {},
    async getEvents() {
      return history;
    },
    async disconnect() {},
    rpc: {
      mode: {
        async get() {
          return 'interactive';
        },
        async set(_p: unknown) {},
      },
      name: {
        async get() {
          return { name: null };
        },
        async set(_p: unknown) {},
      },
      history: {
        async compact() {
          return { success: true };
        },
      },
      eventLog: {
        async read() {
          return { events: [] };
        },
      },
      permissions: {
        async setApproveAll() {
          return { success: true };
        },
        async resetSessionApprovals() {
          return { success: true };
        },
      },
      agent: {
        async list() {
          return { agents: [] };
        },
        async getCurrent() {
          return { agent: null };
        },
        async select(_p: unknown) {
          throw new Error('no agents');
        },
        async deselect() {
          return null;
        },
        async reload() {
          return { agents: [] };
        },
      },
      tasks: {
        async list() {
          return { tasks: [] };
        },
      },
      skills: {
        async list() {
          return { skills: [] };
        },
      },
      mcp: {
        async list() {
          return { servers: [] };
        },
        async setEnabled(_p: unknown) {
          return { success: true };
        },
        async reload() {
          return { success: true };
        },
        async oauth() {
          return {};
        },
      },
      fleetManagement: {
        async startFleet() {
          return { success: true };
        },
      },
      ui: {},
    },
  };

  const fakeClient = {
    async createSession(_cfg: unknown) {
      return { ...fakeSession, sessionId: 'test-sess-1' };
    },
    async resumeSession(id: string, _cfg: unknown) {
      openedSessionId = id;
      return { ...fakeSession, sessionId: id };
    },
    async listSessions() {
      return [
        {
          sessionId: 'test-sess-1',
          summary: 'Test session summary',
          startTime: new Date(),
          modifiedTime: new Date(),
          isRemote: false,
        },
      ];
    },
    async deleteSession() {},
    async getSessionMetadata(_id: string) {
      return null;
    },
    async listModels() {
      return [];
    },
  };

  _setClientForTest(fakeClient as unknown as Parameters<typeof _setClientForTest>[0]);

  const reg = new SessionRegistry((_p) => {});

  // Manually insert the session into the registry's private entries map
  // by injecting it via the test backdoor: resumeSession populates entries.
  // We use a fresh FakeSession variant that wraps the history directly.
  const injectedSession = {
    ...fakeSession,
    sessionId: 'test-sess-1',
    async getEvents() {
      return history;
    },
    on(_h: unknown) {
      return () => {};
    },
  };

  // Access private entries via cast
  (
    reg as unknown as {
      entries: Map<string, { session: typeof injectedSession; unsubscribe: () => void }>;
    }
  ).entries.set('test-sess-1', { session: injectedSession, unsubscribe: () => {} });

  void openedSessionId; // suppress unused warning

  return { reg, sessionId: 'test-sess-1' };
}

afterEach(() => {
  _setClientForTest(null);
});

describe('SessionRegistry.searchTranscripts', () => {
  test('returns empty array for empty query', async () => {
    const { reg } = makeReg([{ type: 'user.message', data: { message: 'hello world' } }]);
    const results = await reg.searchTranscripts('');

    expect(results).toEqual([]);
  });

  test('matches user.message events case-insensitively', async () => {
    const history: FakeEvent[] = [
      { type: 'user.message', data: { message: 'Tell me about the retry logic please' } },
      { type: 'user.message', data: { message: 'Something unrelated' } },
    ];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('retry');

    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe('test-sess-1');
    expect(results[0]?.matches).toHaveLength(1);
    expect(results[0]?.matches[0]?.role).toBe('user');
    expect(results[0]?.matches[0]?.snippet).toContain('<<retry>>');
  });

  test('matches assistant.message_complete events', async () => {
    const history: FakeEvent[] = [
      {
        type: 'assistant.message_complete',
        data: { text: 'You can use exponential backoff for retrying failed requests.' },
      },
    ];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('exponential backoff');

    expect(results).toHaveLength(1);
    expect(results[0]?.matches[0]?.role).toBe('assistant');
    expect(results[0]?.matches[0]?.snippet).toContain('<<exponential backoff>>');
  });

  test('matches system.notification events', async () => {
    const history: FakeEvent[] = [
      { type: 'system.notification', data: { message: 'Session context updated with new files' } },
    ];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('context updated');

    expect(results[0]?.matches[0]?.role).toBe('system');
    expect(results[0]?.matches[0]?.snippet).toContain('<<context updated>>');
  });

  test('skips non-message event types', async () => {
    const history: FakeEvent[] = [
      { type: 'tool.execution_start', data: { name: 'retry_tool', args: {} } },
      { type: 'assistant.message_delta', data: { text: 'retry partial' } },
      { type: 'session.idle', data: {} },
      { type: 'user.message', data: { message: 'retry this' } },
    ];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('retry');

    // Only user.message should match (assistant.message_delta is skipped)
    expect(results[0]?.matches).toHaveLength(1);
    expect(results[0]?.matches[0]?.role).toBe('user');
  });

  test('returns correct eventIndex (ordinal in getEvents array)', async () => {
    const history: FakeEvent[] = [
      { type: 'session.start', data: {} }, // idx 0 — skipped
      { type: 'user.message', data: { message: 'first message' } }, // idx 1
      { type: 'tool.execution_start', data: {} }, // idx 2 — skipped
      { type: 'assistant.message_complete', data: { text: 'first response with keyword' } }, // idx 3
    ];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('first response');

    expect(results[0]?.matches[0]?.eventIndex).toBe(3);
  });

  test('snippet contains <<match>> delimiters preserving original case', async () => {
    const history: FakeEvent[] = [
      { type: 'user.message', data: { message: 'Please explain Retry Logic to me' } },
    ];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('Retry Logic');

    const snippet = results[0]?.matches[0]?.snippet ?? '';
    // Match delimiters wrap the original-case text
    expect(snippet).toContain('<<Retry Logic>>');
  });

  test('snippet includes surrounding context (up to ~300 chars)', async () => {
    const prefix = 'x'.repeat(200);
    const suffix = 'y'.repeat(200);
    const history: FakeEvent[] = [
      { type: 'user.message', data: { message: `${prefix}MATCH${suffix}` } },
    ];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('MATCH');

    const snippet = results[0]?.matches[0]?.snippet ?? '';
    expect(snippet.length).toBeLessThanOrEqual(350); // context (150+150) + match + delimiters + ellipses
    expect(snippet).toContain('<<MATCH>>');
    expect(snippet).toContain('\u2026'); // has ellipsis indicating truncation
  });

  test('respects options.limit', async () => {
    // Create history with many matching events across 'sessions' by having
    // many matches in a single session.
    const history: FakeEvent[] = Array.from({ length: 20 }, (_, i) => ({
      type: 'user.message',
      data: { message: `match number ${i}` },
    }));
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('match', { limit: 5 });

    const totalMatches = results.reduce((s, r) => s + r.matches.length, 0);

    expect(totalMatches).toBeLessThanOrEqual(5);
  });

  test('returns empty when no open sessions match', async () => {
    const { reg } = makeReg([
      { type: 'user.message', data: { message: 'unrelated content here' } },
    ]);
    const results = await reg.searchTranscripts('xyznotfound');

    expect(results).toEqual([]);
  });

  test('includes timestamp when event has one', async () => {
    const history: FakeEvent[] = [
      {
        type: 'user.message',
        data: { message: 'timestamped message here' },
        timestamp: '2026-06-10T10:00:00.000Z',
      },
    ];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('timestamped message');

    expect(results[0]?.matches[0]?.timestamp).toBe('2026-06-10T10:00:00.000Z');
  });

  test('omits timestamp field when event has none', async () => {
    const history: FakeEvent[] = [{ type: 'user.message', data: { message: 'no timestamp here' } }];
    const { reg } = makeReg(history);
    const results = await reg.searchTranscripts('no timestamp');

    expect(results[0]?.matches[0]).not.toHaveProperty('timestamp');
  });

  test('gracefully handles events with missing data fields', async () => {
    const history: FakeEvent[] = [
      { type: 'user.message', data: {} }, // no 'message' field
      { type: 'assistant.message_complete', data: {} }, // no 'text' field
      { type: 'user.message', data: { message: 'good message' } },
    ];
    const { reg } = makeReg(history);

    // Should not throw; only the third event should match
    const results = await reg.searchTranscripts('good');

    expect(results[0]?.matches).toHaveLength(1);
    expect(results[0]?.matches[0]?.snippet).toContain('<<good>>');
  });
});
